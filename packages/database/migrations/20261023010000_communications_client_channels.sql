BEGIN;

-- Collaboration is a separate purpose from the one-to-one booking ownership link.
CREATE UNIQUE INDEX IF NOT EXISTS clients_invoice_identity ON clients(id,tenant_id);
CREATE TABLE customer_collaboration_relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 client_id uuid NOT NULL,customer_account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
 UNIQUE(id,tenant_id),UNIQUE(tenant_id,client_id,customer_account_id),
 FOREIGN KEY(client_id,tenant_id) REFERENCES clients(id,tenant_id) ON DELETE RESTRICT,
 CHECK((status='REVOKED')=(revoked_at IS NOT NULL))
);
CREATE INDEX customer_collaboration_account_active ON customer_collaboration_relationships(customer_account_id,tenant_id,id) WHERE status='ACTIVE';
CREATE FUNCTION check_customer_collaboration_relationship() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'COLLABORATION_CREATOR_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.tenant_id,NEW.client_id,NEW.customer_account_id,NEW.created_by) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.client_id,OLD.customer_account_id,OLD.created_by) THEN RAISE EXCEPTION 'COLLABORATION_IDENTITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_collaboration_relationship_scope BEFORE INSERT OR UPDATE ON customer_collaboration_relationships FOR EACH ROW EXECUTE FUNCTION check_customer_collaboration_relationship();

ALTER TABLE conversations ADD COLUMN external_client_channel boolean NOT NULL DEFAULT false,
 ADD COLUMN collaboration_request_id uuid,ADD COLUMN collaboration_request_hash varchar(64),
 ADD CONSTRAINT collaboration_channel_kind CHECK(NOT external_client_channel OR (access_mode='MEMBERS' AND conversation_type='CLIENT' AND primary_channel='NATIVE' AND client_id IS NOT NULL)),
 ADD CONSTRAINT collaboration_channel_request CHECK(num_nonnulls(collaboration_request_id,collaboration_request_hash)=0 OR (external_client_channel AND num_nonnulls(collaboration_request_id,collaboration_request_hash)=2 AND length(collaboration_request_hash)=64));
CREATE UNIQUE INDEX collaboration_channel_request_unique ON conversations(tenant_id,collaboration_request_id) WHERE external_client_channel;
CREATE FUNCTION check_collaboration_channel() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.external_client_channel IS DISTINCT FROM OLD.external_client_channel OR (OLD.external_client_channel AND (NEW.tenant_id,NEW.client_id,NEW.collaboration_request_id,NEW.collaboration_request_hash) IS DISTINCT FROM (OLD.tenant_id,OLD.client_id,OLD.collaboration_request_id,OLD.collaboration_request_hash))) THEN RAISE EXCEPTION 'COLLABORATION_CHANNEL_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.external_client_channel AND (NOT EXISTS(SELECT 1 FROM clients WHERE id=NEW.client_id AND tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by_user_id AND tenant_id=NEW.tenant_id)) THEN RAISE EXCEPTION 'COLLABORATION_CHANNEL_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER collaboration_channel_scope BEFORE INSERT OR UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION check_collaboration_channel();

CREATE TABLE customer_collaboration_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 client_id uuid NOT NULL,conversation_id uuid NOT NULL,email_normalized text NOT NULL CHECK(email_normalized=lower(btrim(email_normalized)) AND length(email_normalized) BETWEEN 3 AND 254),
 secret_hash varchar(64) NOT NULL UNIQUE CHECK(length(secret_hash)=64),status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
 expires_at timestamptz NOT NULL,accepted_at timestamptz,revoked_at timestamptz,accepted_customer_account_id uuid REFERENCES customer_accounts(id),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,
 UNIQUE(tenant_id,request_id),FOREIGN KEY(client_id,tenant_id) REFERENCES clients(id,tenant_id),FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE,
 CHECK((accepted_customer_account_id IS NULL)=(accepted_at IS NULL)),CHECK(status<>'ACCEPTED' OR accepted_customer_account_id IS NOT NULL),CHECK(status<>'REVOKED' OR revoked_at IS NOT NULL)
);
CREATE INDEX collaboration_invitation_channel ON customer_collaboration_invitations(tenant_id,conversation_id,created_at DESC);
CREATE INDEX collaboration_invitation_pending ON customer_collaboration_invitations(expires_at) WHERE status='PENDING';
CREATE FUNCTION check_collaboration_invitation() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND client_id=NEW.client_id AND external_client_channel) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'COLLABORATION_INVITATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.tenant_id,NEW.client_id,NEW.conversation_id,NEW.email_normalized,NEW.secret_hash,NEW.created_by,NEW.request_id) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.client_id,OLD.conversation_id,OLD.email_normalized,OLD.secret_hash,OLD.created_by,OLD.request_id) THEN RAISE EXCEPTION 'COLLABORATION_INVITATION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (OLD.status='ACCEPTED' AND NEW.status NOT IN ('ACCEPTED','REVOKED')) OR (OLD.status IN ('REVOKED','EXPIRED') AND NEW.status IN ('PENDING','ACCEPTED')) OR (OLD.accepted_customer_account_id IS NOT NULL AND (NEW.accepted_customer_account_id,NEW.accepted_at) IS DISTINCT FROM (OLD.accepted_customer_account_id,OLD.accepted_at)) THEN RAISE EXCEPTION 'COLLABORATION_INVITATION_CONSUMED' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.accepted_customer_account_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.accepted_customer_account_id IS DISTINCT FROM OLD.accepted_customer_account_id) AND NOT EXISTS(SELECT 1 FROM customer_accounts WHERE id=NEW.accepted_customer_account_id AND email_normalized=NEW.email_normalized) THEN RAISE EXCEPTION 'COLLABORATION_INVITATION_ACCOUNT_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER collaboration_invitation_scope BEFORE INSERT OR UPDATE ON customer_collaboration_invitations FOR EACH ROW EXECUTE FUNCTION check_collaboration_invitation();
CREATE TABLE customer_collaboration_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),invitation_id uuid NOT NULL REFERENCES customer_collaboration_invitations(id) ON DELETE CASCADE,
 secret_hash varchar(64) NOT NULL UNIQUE CHECK(length(secret_hash)=64),expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collaboration_handoff_expiry ON customer_collaboration_handoffs(expires_at);
CREATE FUNCTION check_collaboration_handoff() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF (NEW.id,NEW.invitation_id,NEW.secret_hash,NEW.expires_at) IS DISTINCT FROM (OLD.id,OLD.invitation_id,OLD.secret_hash,OLD.expires_at) OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN RAISE EXCEPTION 'COLLABORATION_HANDOFF_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER collaboration_handoff_scope BEFORE UPDATE ON customer_collaboration_handoffs FOR EACH ROW EXECUTE FUNCTION check_collaboration_handoff();

-- Historical rows retain their principal after revocation; authorization rechecks active access.
CREATE FUNCTION collaboration_principal_matches(p_tenant uuid,p_conversation uuid,p_relationship uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM customer_collaboration_relationships r JOIN conversations c ON c.tenant_id=r.tenant_id AND c.client_id=r.client_id WHERE r.id=p_relationship AND r.tenant_id=p_tenant AND c.id=p_conversation AND c.external_client_channel)
$$;
ALTER TABLE conversation_members ADD COLUMN customer_relationship_id uuid,
 DROP CONSTRAINT conversation_members_check,
 ADD CONSTRAINT conversation_member_principal CHECK(num_nonnulls(user_id,customer_link_id,customer_relationship_id)=1),
 ADD CONSTRAINT conversation_member_relationship FOREIGN KEY(customer_relationship_id,tenant_id) REFERENCES customer_collaboration_relationships(id,tenant_id),
 ADD CONSTRAINT conversation_member_relationship_role CHECK(customer_relationship_id IS NULL OR role IN ('EXTERNAL','GUEST')),
 ADD CONSTRAINT conversation_member_relationship_unique UNIQUE(conversation_id,customer_relationship_id);
CREATE INDEX conversation_member_relationship_active ON conversation_members(tenant_id,customer_relationship_id,conversation_id) WHERE left_at IS NULL;
CREATE INDEX conversation_member_effective_active ON conversation_members(tenant_id,(coalesce(user_id,customer_relationship_id)),conversation_id) WHERE left_at IS NULL;
ALTER TABLE conversation_messages ADD COLUMN sender_customer_relationship_id uuid,
 ADD CONSTRAINT message_customer_relationship FOREIGN KEY(sender_customer_relationship_id,tenant_id) REFERENCES customer_collaboration_relationships(id,tenant_id),
 ADD CONSTRAINT message_customer_principal CHECK(sender_customer_relationship_id IS NULL OR (sender_user_id IS NULL AND channel_type='NATIVE' AND sender_type='CUSTOMER'));
CREATE UNIQUE INDEX native_customer_message_retry ON conversation_messages(conversation_id,sender_customer_relationship_id,client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX native_customer_sender_search ON conversation_messages(tenant_id,sender_customer_relationship_id,native_position DESC) WHERE channel_type='NATIVE' AND deleted_at IS NULL;
CREATE INDEX native_effective_sender_search ON conversation_messages(tenant_id,(coalesce(sender_user_id,sender_customer_relationship_id)),native_position DESC) WHERE channel_type='NATIVE' AND deleted_at IS NULL;
CREATE OR REPLACE FUNCTION check_communication_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='conversation_messages' AND TG_OP='UPDATE' THEN
  IF (NEW.sender_customer_relationship_id IS NOT NULL OR OLD.sender_customer_relationship_id IS NOT NULL) AND (NEW.sender_customer_relationship_id,NEW.sender_user_id,NEW.tenant_id,NEW.conversation_id,NEW.channel_type) IS DISTINCT FROM (OLD.sender_customer_relationship_id,OLD.sender_user_id,OLD.tenant_id,OLD.conversation_id,OLD.channel_type) THEN RAISE EXCEPTION 'COMMUNICATION_AUTHOR_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='conversation_members' THEN
  IF NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND access_mode='MEMBERS')
   OR (NEW.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND tenant_id=NEW.tenant_id))
   OR (NEW.customer_link_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_client_links WHERE id=NEW.customer_link_id AND tenant_id=NEW.tenant_id))
   OR (NEW.customer_relationship_id IS NOT NULL AND NOT collaboration_principal_matches(NEW.tenant_id,NEW.conversation_id,NEW.customer_relationship_id))
   OR (NEW.customer_link_id IS NOT NULL AND EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND external_client_channel)) THEN RAISE EXCEPTION 'COMMUNICATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 ELSIF NEW.channel_type='NATIVE' THEN
  IF NEW.native_position IS NULL OR NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND access_mode='MEMBERS')
   OR (NEW.sender_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.sender_user_id AND tenant_id=NEW.tenant_id))
   OR (NEW.sender_customer_relationship_id IS NOT NULL AND NOT collaboration_principal_matches(NEW.tenant_id,NEW.conversation_id,NEW.sender_customer_relationship_id))
   OR (NEW.reply_to_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_messages WHERE id=NEW.reply_to_message_id AND conversation_id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND reply_to_message_id IS NULL AND channel_type='NATIVE')) THEN RAISE EXCEPTION 'COMMUNICATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.sender_customer_relationship_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_members m JOIN customer_collaboration_relationships r ON r.id=m.customer_relationship_id JOIN customer_accounts a ON a.id=r.customer_account_id WHERE m.tenant_id=NEW.tenant_id AND m.conversation_id=NEW.conversation_id AND m.customer_relationship_id=NEW.sender_customer_relationship_id AND m.left_at IS NULL AND r.status='ACTIVE' AND a.status='ACTIVE') THEN RAISE EXCEPTION 'COMMUNICATION_CUSTOMER_MEMBERSHIP_REQUIRED' USING ERRCODE='23514'; END IF;
 ELSIF EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND access_mode='MEMBERS') THEN RAISE EXCEPTION 'COMMUNICATION_SCOPE_INVALID' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

ALTER TABLE communication_reactions DROP CONSTRAINT communication_reactions_pkey,ALTER COLUMN user_id DROP NOT NULL,
 ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ADD COLUMN customer_relationship_id uuid,
 ADD CONSTRAINT reaction_principal CHECK(num_nonnulls(user_id,customer_relationship_id)=1),
 ADD CONSTRAINT reaction_relationship FOREIGN KEY(customer_relationship_id,tenant_id) REFERENCES customer_collaboration_relationships(id,tenant_id),
 ADD CONSTRAINT reaction_user_unique UNIQUE(message_id,user_id,emoji),ADD CONSTRAINT reaction_customer_unique UNIQUE(message_id,customer_relationship_id,emoji);
ALTER TABLE communication_mentions ALTER COLUMN user_id DROP NOT NULL,ADD COLUMN customer_relationship_id uuid,
 ADD CONSTRAINT mention_principal CHECK(num_nonnulls(user_id,customer_relationship_id)=1),
 ADD CONSTRAINT mention_relationship FOREIGN KEY(customer_relationship_id,tenant_id) REFERENCES customer_collaboration_relationships(id,tenant_id);
CREATE INDEX communication_mentions_customer ON communication_mentions(tenant_id,customer_relationship_id,message_id);
CREATE OR REPLACE FUNCTION check_communication_annotation_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM conversation_messages WHERE id=NEW.message_id AND conversation_id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND channel_type='NATIVE' AND deleted_at IS NULL)
  OR NOT (EXISTS(SELECT 1 FROM conversation_members m JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id WHERE m.conversation_id=NEW.conversation_id AND m.tenant_id=NEW.tenant_id AND m.user_id=NEW.user_id AND m.left_at IS NULL AND u.account_status='ACTIVE')
   OR EXISTS(SELECT 1 FROM conversation_members m JOIN customer_collaboration_relationships r ON r.id=m.customer_relationship_id AND r.tenant_id=m.tenant_id JOIN customer_accounts a ON a.id=r.customer_account_id WHERE m.conversation_id=NEW.conversation_id AND m.tenant_id=NEW.tenant_id AND m.customer_relationship_id=NEW.customer_relationship_id AND m.left_at IS NULL AND r.status='ACTIVE' AND a.status='ACTIVE' AND collaboration_principal_matches(NEW.tenant_id,NEW.conversation_id,r.id))) THEN RAISE EXCEPTION 'COMMUNICATION_ANNOTATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE conversation_attachments ADD COLUMN uploaded_by_customer_relationship_id uuid,
 ADD CONSTRAINT attachment_relationship FOREIGN KEY(uploaded_by_customer_relationship_id,tenant_id) REFERENCES customer_collaboration_relationships(id,tenant_id),
 DROP CONSTRAINT chat_attachment_identity,
 ADD CONSTRAINT chat_attachment_identity CHECK(status='LEGACY' OR (conversation_id IS NOT NULL AND num_nonnulls(uploaded_by,uploaded_by_customer_relationship_id)=1));
CREATE INDEX chat_customer_uploader ON conversation_attachments(tenant_id,uploaded_by_customer_relationship_id,created_at) WHERE status<>'LEGACY';
CREATE INDEX chat_effective_uploader ON conversation_attachments(tenant_id,(coalesce(uploaded_by,uploaded_by_customer_relationship_id)),created_at) WHERE status<>'LEGACY';
CREATE FUNCTION check_collaboration_attachment() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.uploaded_by_customer_relationship_id IS NOT NULL AND (NEW.status='LEGACY' OR NOT collaboration_principal_matches(NEW.tenant_id,NEW.conversation_id,NEW.uploaded_by_customer_relationship_id)) THEN RAISE EXCEPTION 'COLLABORATION_ATTACHMENT_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.uploaded_by_customer_relationship_id IS NOT NULL OR OLD.uploaded_by_customer_relationship_id IS NOT NULL) AND (NEW.uploaded_by_customer_relationship_id,NEW.uploaded_by,NEW.tenant_id,NEW.conversation_id) IS DISTINCT FROM (OLD.uploaded_by_customer_relationship_id,OLD.uploaded_by,OLD.tenant_id,OLD.conversation_id) THEN RAISE EXCEPTION 'COLLABORATION_ATTACHMENT_OWNER_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER collaboration_attachment_scope BEFORE INSERT OR UPDATE ON conversation_attachments FOR EACH ROW EXECUTE FUNCTION check_collaboration_attachment();
ALTER TABLE communication_preferences DROP CONSTRAINT communication_preferences_pkey,ALTER COLUMN user_id DROP NOT NULL,
 ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ADD COLUMN customer_relationship_id uuid,
 ADD CONSTRAINT preference_user_unique UNIQUE(user_id),ADD CONSTRAINT preference_relationship_unique UNIQUE(customer_relationship_id),
 ADD CONSTRAINT preference_principal CHECK(num_nonnulls(user_id,customer_relationship_id)=1),
 ADD CONSTRAINT preference_relationship FOREIGN KEY(customer_relationship_id,tenant_id) REFERENCES customer_collaboration_relationships(id,tenant_id);
CREATE INDEX communication_preference_effective ON communication_preferences(tenant_id,(coalesce(user_id,customer_relationship_id)));
ALTER TABLE internal_notifications ADD COLUMN recipient_customer_relationship_id uuid,
 ADD CONSTRAINT notification_customer_relationship FOREIGN KEY(recipient_customer_relationship_id,tenant_id) REFERENCES customer_collaboration_relationships(id,tenant_id),
 ADD CONSTRAINT notification_principal CHECK(num_nonnulls(recipient_user_id,recipient_customer_relationship_id)<=1);
CREATE UNIQUE INDEX chat_customer_notification_once ON internal_notifications(recipient_customer_relationship_id,source_type,source_id) WHERE source_type='CHAT';
CREATE INDEX chat_customer_notification_recipient ON internal_notifications(tenant_id,recipient_customer_relationship_id,created_at DESC,id DESC) WHERE source_type='CHAT';
CREATE INDEX chat_effective_notification_recipient ON internal_notifications(tenant_id,(coalesce(recipient_user_id,recipient_customer_relationship_id)),created_at DESC,id DESC) WHERE source_type='CHAT';
ALTER TABLE communication_events ADD COLUMN actor_customer_relationship_id uuid,ADD COLUMN recipient_customer_relationship_id uuid,
 ADD CONSTRAINT event_customer_actor FOREIGN KEY(actor_customer_relationship_id,tenant_id) REFERENCES customer_collaboration_relationships(id,tenant_id),
 ADD CONSTRAINT event_customer_recipient FOREIGN KEY(recipient_customer_relationship_id,tenant_id) REFERENCES customer_collaboration_relationships(id,tenant_id),
 ADD CONSTRAINT event_actor_principal CHECK(num_nonnulls(actor_user_id,actor_customer_relationship_id)<=1),
 ADD CONSTRAINT event_recipient_principal CHECK(num_nonnulls(recipient_user_id,recipient_customer_relationship_id)<=1);
CREATE FUNCTION check_collaboration_recipient() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='internal_notifications' THEN
  IF NEW.recipient_customer_relationship_id IS NOT NULL AND (NEW.source_type<>'CHAT' OR NOT collaboration_principal_matches(NEW.tenant_id,NEW.chat_conversation_id,NEW.recipient_customer_relationship_id)) THEN RAISE EXCEPTION 'COLLABORATION_NOTIFICATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 ELSIF (NEW.actor_customer_relationship_id IS NOT NULL AND NOT collaboration_principal_matches(NEW.tenant_id,NEW.conversation_id,NEW.actor_customer_relationship_id)) OR (NEW.recipient_customer_relationship_id IS NOT NULL AND NOT collaboration_principal_matches(NEW.tenant_id,NEW.conversation_id,NEW.recipient_customer_relationship_id)) THEN RAISE EXCEPTION 'COLLABORATION_EVENT_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER collaboration_notification_scope BEFORE INSERT OR UPDATE ON internal_notifications FOR EACH ROW EXECUTE FUNCTION check_collaboration_recipient();
CREATE TRIGGER collaboration_event_scope BEFORE INSERT OR UPDATE ON communication_events FOR EACH ROW EXECUTE FUNCTION check_collaboration_recipient();

-- Scheduled meetings keep their existing history. These rows only grant channel access.
CREATE TABLE communication_meeting_customer_grants (
 tenant_id uuid NOT NULL,meeting_id uuid NOT NULL,conversation_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
 PRIMARY KEY(meeting_id,conversation_id),FOREIGN KEY(meeting_id,tenant_id) REFERENCES communication_meetings(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX customer_meeting_grant_channel ON communication_meeting_customer_grants(tenant_id,conversation_id,meeting_id) WHERE revoked_at IS NULL;
CREATE FUNCTION check_customer_meeting_grant() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.tenant_id,NEW.meeting_id,NEW.conversation_id,NEW.created_by) IS DISTINCT FROM (OLD.tenant_id,OLD.meeting_id,OLD.conversation_id,OLD.created_by) THEN RAISE EXCEPTION 'CUSTOMER_MEETING_GRANT_IDENTITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NOT EXISTS(SELECT 1 FROM communication_meetings m JOIN conversations c ON c.tenant_id=m.tenant_id AND c.client_id=m.customer_id WHERE m.id=NEW.meeting_id AND m.tenant_id=NEW.tenant_id AND c.id=NEW.conversation_id AND c.external_client_channel AND m.audience='EXTERNAL_CLIENT') OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND tenant_id=NEW.tenant_id)) THEN RAISE EXCEPTION 'CUSTOMER_MEETING_GRANT_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_meeting_grant_scope BEFORE INSERT OR UPDATE ON communication_meeting_customer_grants FOR EACH ROW EXECUTE FUNCTION check_customer_meeting_grant();
ALTER TABLE communication_meeting_guests ALTER COLUMN invitation_id DROP NOT NULL,
 ADD COLUMN customer_relationship_id uuid,ADD COLUMN customer_conversation_id uuid,
 ADD COLUMN customer_auth_session_id uuid,ADD COLUMN customer_auth_user_id uuid,ADD COLUMN customer_issued_at timestamptz,ADD COLUMN customer_expires_at timestamptz,
 ADD CONSTRAINT meeting_guest_customer_relationship FOREIGN KEY(customer_relationship_id,tenant_id) REFERENCES customer_collaboration_relationships(id,tenant_id),
 ADD CONSTRAINT meeting_guest_customer_channel FOREIGN KEY(tenant_id,customer_conversation_id) REFERENCES conversations(tenant_id,id),
 ADD CONSTRAINT meeting_guest_customer_grant FOREIGN KEY(meeting_id,customer_conversation_id) REFERENCES communication_meeting_customer_grants(meeting_id,conversation_id),
 ADD CONSTRAINT meeting_guest_principal_source CHECK((invitation_id IS NOT NULL AND num_nonnulls(customer_relationship_id,customer_conversation_id,customer_auth_session_id,customer_auth_user_id,customer_issued_at,customer_expires_at)=0) OR (invitation_id IS NULL AND num_nonnulls(customer_relationship_id,customer_conversation_id,customer_auth_session_id,customer_auth_user_id,customer_issued_at,customer_expires_at)=6));
CREATE UNIQUE INDEX meeting_customer_guest_retry ON communication_meeting_guests(meeting_id,customer_relationship_id,customer_auth_session_id,request_id) WHERE customer_relationship_id IS NOT NULL;
CREATE INDEX meeting_customer_guest_relationship ON communication_meeting_guests(tenant_id,customer_relationship_id,state) WHERE customer_relationship_id IS NOT NULL;
CREATE FUNCTION check_customer_meeting_guest() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.customer_relationship_id IS NOT NULL AND (NOT collaboration_principal_matches(NEW.tenant_id,NEW.customer_conversation_id,NEW.customer_relationship_id) OR NOT EXISTS(SELECT 1 FROM communication_meeting_customer_grants g JOIN communication_meetings m ON m.id=g.meeting_id JOIN conversations c ON c.id=g.conversation_id JOIN customer_collaboration_relationships r ON r.id=NEW.customer_relationship_id JOIN customer_accounts a ON a.id=r.customer_account_id JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.customer_relationship_id=r.id WHERE g.meeting_id=NEW.meeting_id AND g.conversation_id=NEW.customer_conversation_id AND g.tenant_id=NEW.tenant_id AND g.revoked_at IS NULL AND m.customer_id=c.client_id AND m.audience='EXTERNAL_CLIENT' AND a.auth_user_id=NEW.customer_auth_user_id AND a.status='ACTIVE' AND r.status='ACTIVE' AND cm.left_at IS NULL)) THEN RAISE EXCEPTION 'CUSTOMER_MEETING_GUEST_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.customer_relationship_id IS NOT NULL OR OLD.customer_relationship_id IS NOT NULL) AND (NEW.customer_relationship_id,NEW.customer_conversation_id,NEW.customer_auth_session_id,NEW.customer_auth_user_id,NEW.customer_issued_at,NEW.customer_expires_at,NEW.tenant_id,NEW.meeting_id) IS DISTINCT FROM (OLD.customer_relationship_id,OLD.customer_conversation_id,OLD.customer_auth_session_id,OLD.customer_auth_user_id,OLD.customer_issued_at,OLD.customer_expires_at,OLD.tenant_id,OLD.meeting_id) THEN RAISE EXCEPTION 'CUSTOMER_MEETING_GUEST_IDENTITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_meeting_guest_scope BEFORE INSERT OR UPDATE ON communication_meeting_guests FOR EACH ROW EXECUTE FUNCTION check_customer_meeting_guest();

-- The API can check provider logout without obtaining access to provider auth rows.
CREATE FUNCTION customer_provider_session_is_current(p_session_id uuid,p_auth_user_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id WHERE s.id=p_session_id AND s.user_id=p_auth_user_id AND (s.not_after IS NULL OR s.not_after>now()) AND u.email_confirmed_at IS NOT NULL AND coalesce(u.is_anonymous,false)=false AND (u.banned_until IS NULL OR u.banned_until<now()))
$$;
REVOKE ALL ON FUNCTION customer_provider_session_is_current(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION customer_provider_session_is_current(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION check_customer_collaboration_relationship(),check_collaboration_channel(),check_collaboration_invitation(),check_collaboration_handoff(),collaboration_principal_matches(uuid,uuid,uuid),check_collaboration_attachment(),check_collaboration_recipient(),check_customer_meeting_grant(),check_customer_meeting_guest() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION collaboration_principal_matches(uuid,uuid,uuid) TO service_role;
ALTER TABLE customer_collaboration_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_collaboration_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_collaboration_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_meeting_customer_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_collaboration_relationships,customer_collaboration_invitations,customer_collaboration_handoffs,communication_meeting_customer_grants FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON customer_collaboration_relationships,customer_collaboration_invitations,customer_collaboration_handoffs,communication_meeting_customer_grants TO service_role;
COMMIT;
