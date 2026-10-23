BEGIN;
ALTER TABLE communication_preferences ADD COLUMN push boolean NOT NULL DEFAULT false,
 ADD COLUMN meetings boolean NOT NULL DEFAULT true, ADD COLUMN incoming_calls boolean NOT NULL DEFAULT true,
 ADD COLUMN content_previews boolean NOT NULL DEFAULT false;
ALTER TABLE internal_notifications ADD COLUMN chat_meeting_id uuid REFERENCES communication_meetings(id) ON DELETE CASCADE,
 ADD COLUMN meeting_version integer, ADD COLUMN expires_at timestamptz;
CREATE UNIQUE INDEX meeting_notification_once ON internal_notifications(recipient_user_id,source_type,source_id) WHERE source_type='MEETING';
CREATE INDEX meeting_notification_recipient ON internal_notifications(tenant_id,recipient_user_id,created_at DESC,id DESC) WHERE source_type='MEETING';

CREATE TABLE mobile_push_registrations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id uuid NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('APNS','FCM')), channel text NOT NULL CHECK(channel IN ('ALERT','VOIP')),
 token_ciphertext text NOT NULL, token_hash varchar(64) NOT NULL, token_version integer NOT NULL DEFAULT 1 CHECK(token_version>0),
 token_updated_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,invalidated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(device_id,provider,channel), CHECK(provider='APNS' OR channel='ALERT')
);
CREATE UNIQUE INDEX mobile_push_active_token ON mobile_push_registrations(token_hash) WHERE revoked_at IS NULL AND invalidated_at IS NULL;
CREATE TABLE mobile_push_contexts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id uuid NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,application_context text NOT NULL CHECK(application_context IN ('TENANT','CUSTOMER')),
 user_id uuid REFERENCES users(id) ON DELETE CASCADE,customer_relationship_id uuid REFERENCES customer_collaboration_relationships(id) ON DELETE CASCADE,
 security_version integer,enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((application_context='TENANT' AND user_id IS NOT NULL AND customer_relationship_id IS NULL AND security_version IS NOT NULL)
 OR(application_context='CUSTOMER' AND customer_relationship_id IS NOT NULL AND user_id IS NULL))
);
CREATE UNIQUE INDEX mobile_push_context_once ON mobile_push_contexts(device_id,tenant_id,(coalesce(user_id,customer_relationship_id)));
CREATE INDEX mobile_push_context_recipient ON mobile_push_contexts(tenant_id,(coalesce(user_id,customer_relationship_id))) WHERE enabled;
CREATE TABLE mobile_push_deliveries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),notification_id uuid NOT NULL REFERENCES internal_notifications(id) ON DELETE CASCADE,
 registration_id uuid NOT NULL REFERENCES mobile_push_registrations(id) ON DELETE CASCADE,context_id uuid NOT NULL REFERENCES mobile_push_contexts(id) ON DELETE CASCADE,
 token_version integer NOT NULL,tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','RETRY','ACCEPTED','CANCELLED','FAILED','EXPIRED')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 6),next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,lease_expires_at timestamptz,expires_at timestamptz NOT NULL,last_error_code varchar(100),provider_reference varchar(255),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),accepted_at timestamptz,
 UNIQUE(notification_id,registration_id)
);
CREATE INDEX mobile_push_due ON mobile_push_deliveries(next_attempt_at,created_at) WHERE status IN ('PENDING','RETRY');
CREATE INDEX mobile_push_lease ON mobile_push_deliveries(lease_expires_at) WHERE status='PROCESSING';
CREATE INDEX mobile_push_context_pending ON mobile_push_deliveries(context_id) WHERE status IN ('PENDING','PROCESSING','RETRY');
CREATE TABLE mobile_push_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),delivery_id uuid NOT NULL REFERENCES mobile_push_deliveries(id) ON DELETE CASCADE,
 attempt integer NOT NULL,lease_id uuid NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 outcome varchar(20),error_code varchar(100),UNIQUE(delivery_id,attempt)
);
CREATE INDEX mobile_push_attempt_retention ON mobile_push_attempts(started_at);

CREATE FUNCTION mobile_push_context_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM mobile_devices d WHERE d.id=NEW.device_id AND d.revoked_at IS NULL AND (
   (NEW.application_context='TENANT' AND EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.tenant_id=NEW.tenant_id AND u.auth_user_id=d.auth_user_id)) OR
   (NEW.application_context='CUSTOMER' AND EXISTS(SELECT 1 FROM customer_collaboration_relationships r JOIN customer_accounts a ON a.id=r.customer_account_id WHERE r.id=NEW.customer_relationship_id AND r.tenant_id=NEW.tenant_id AND a.auth_user_id=d.auth_user_id))))
 THEN RAISE EXCEPTION 'Invalid mobile push context'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER mobile_push_context_scope BEFORE INSERT OR UPDATE OF device_id,tenant_id,application_context,user_id,customer_relationship_id ON mobile_push_contexts FOR EACH ROW EXECUTE FUNCTION mobile_push_context_scope();

-- Fan-out is part of the canonical notification transaction. A push is never the source of truth.
CREATE FUNCTION enqueue_mobile_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_type NOT IN ('CHAT','MEETING') OR NEW.type NOT IN ('CHAT_MESSAGE','CHAT_MENTION','CHAT_THREAD','CHAT_INVITATION','CALL_INCOMING','CALL_MISSED','MEETING_INVITATION','MEETING_UPDATED','MEETING_CANCELLED','MEETING_REMINDER') THEN RETURN NEW; END IF;
 INSERT INTO mobile_push_deliveries(notification_id,registration_id,context_id,tenant_id,token_version,expires_at)
 SELECT NEW.id,r.id,c.id,NEW.tenant_id,r.token_version,coalesce(NEW.expires_at,NEW.created_at+interval '24 hours')
 FROM mobile_push_contexts c JOIN mobile_devices d ON d.id=c.device_id JOIN mobile_push_registrations r ON r.device_id=d.id
 JOIN communication_preferences p ON p.tenant_id=c.tenant_id AND coalesce(p.user_id,p.customer_relationship_id)=coalesce(c.user_id,c.customer_relationship_id)
 WHERE c.tenant_id=NEW.tenant_id AND coalesce(c.user_id,c.customer_relationship_id)=coalesce(NEW.recipient_user_id,NEW.recipient_customer_relationship_id)
 AND c.enabled AND d.revoked_at IS NULL AND r.revoked_at IS NULL AND r.invalidated_at IS NULL AND p.push AND NOT p.dnd
 AND r.created_at<=NEW.created_at AND c.created_at<=NEW.created_at
 AND ((NEW.type='CALL_INCOMING' AND (r.channel='VOIP' OR NOT EXISTS(SELECT 1 FROM mobile_push_registrations v WHERE v.device_id=d.id AND v.channel='VOIP' AND v.revoked_at IS NULL AND v.invalidated_at IS NULL))) OR (NEW.type<>'CALL_INCOMING' AND r.channel='ALERT'))
 ON CONFLICT DO NOTHING; RETURN NEW;
END $$;
CREATE TRIGGER enqueue_mobile_push AFTER INSERT ON internal_notifications FOR EACH ROW EXECUTE FUNCTION enqueue_mobile_push();
CREATE FUNCTION revoke_mobile_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
  UPDATE mobile_push_registrations SET revoked_at=now(),token_ciphertext='',updated_at=now() WHERE device_id=NEW.id AND revoked_at IS NULL;
  UPDATE mobile_push_contexts SET enabled=false,updated_at=now() WHERE device_id=NEW.id;
  UPDATE mobile_push_deliveries SET status='CANCELLED',last_error_code='DEVICE_REVOKED',updated_at=now() WHERE registration_id IN (SELECT id FROM mobile_push_registrations WHERE device_id=NEW.id) AND status IN ('PENDING','RETRY','PROCESSING');
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER revoke_mobile_push AFTER UPDATE OF revoked_at ON mobile_devices FOR EACH ROW EXECUTE FUNCTION revoke_mobile_push();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['mobile_push_registrations','mobile_push_contexts','mobile_push_deliveries','mobile_push_attempts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON %I FROM anon,authenticated',name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO service_role',name);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION mobile_push_context_scope(),enqueue_mobile_push(),revoke_mobile_push() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mobile_push_context_scope(),enqueue_mobile_push(),revoke_mobile_push() TO service_role;
COMMIT;
