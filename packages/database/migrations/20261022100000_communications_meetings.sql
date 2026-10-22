BEGIN;
CREATE TABLE communication_meetings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 conversation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title)<=160), type text NOT NULL CHECK(type IN ('AUDIO','VIDEO')),
 status text NOT NULL DEFAULT 'CREATED' CHECK(status IN ('CREATED','RINGING','ACTIVE','ENDED','CANCELLED','FAILED')),
 provider text NOT NULL DEFAULT 'LIVEKIT' CHECK(provider='LIVEKIT'), provider_room_name text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, ended_at timestamptz, end_reason text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '2 minutes', last_reconciled_at timestamptz,
 cleanup_pending boolean NOT NULL DEFAULT false,
 UNIQUE(id,tenant_id), UNIQUE(tenant_id,created_by,request_id),
 FOREIGN KEY(conversation_id,tenant_id) REFERENCES conversations(id,tenant_id),
 CHECK((status IN ('ENDED','CANCELLED','FAILED'))=(ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX communication_meetings_one_live ON communication_meetings(conversation_id) WHERE status IN ('CREATED','RINGING','ACTIVE');
CREATE INDEX communication_meetings_history ON communication_meetings(tenant_id,conversation_id,created_at DESC,id DESC);
CREATE INDEX communication_meetings_reconcile ON communication_meetings(last_reconciled_at NULLS FIRST) WHERE status IN ('CREATED','RINGING','ACTIVE') OR cleanup_pending;
CREATE TABLE communication_meeting_participants (
 meeting_id uuid NOT NULL, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('ORGANIZER','PARTICIPANT')),
 invitation_state text NOT NULL DEFAULT 'INVITED' CHECK(invitation_state IN ('INVITED','ACCEPTED','DECLINED','REMOVED')),
 invited_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz, joined_at timestamptz, left_at timestamptz,
 PRIMARY KEY(meeting_id,user_id), UNIQUE(meeting_id,user_id,tenant_id),
 FOREIGN KEY(meeting_id,tenant_id) REFERENCES communication_meetings(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX communication_meeting_incoming ON communication_meeting_participants(tenant_id,user_id,invited_at DESC) WHERE invitation_state='INVITED';
-- A session represents one explicit device/tab join. Identity is server-generated,
-- so another tab cannot eject a participant by guessing their user ID.
CREATE TABLE communication_meeting_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, meeting_id uuid NOT NULL, user_id uuid NOT NULL,
 auth_session_id uuid NOT NULL, auth_issued_at timestamptz NOT NULL, request_id uuid NOT NULL,
 identity text NOT NULL UNIQUE, provider_sid text, created_at timestamptz NOT NULL DEFAULT now(),
 token_expires_at timestamptz NOT NULL, token_count integer NOT NULL DEFAULT 0, token_issued_at timestamptz NOT NULL DEFAULT now(), joined_at timestamptz, left_at timestamptz, revoked_at timestamptz,
 UNIQUE(meeting_id,user_id,auth_session_id,request_id),
 FOREIGN KEY(meeting_id,user_id,tenant_id) REFERENCES communication_meeting_participants(meeting_id,user_id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX communication_meeting_sessions_active ON communication_meeting_sessions(meeting_id,user_id) WHERE revoked_at IS NULL AND left_at IS NULL;
CREATE INDEX communication_meeting_token_rate ON communication_meeting_sessions(tenant_id,user_id,created_at DESC);
CREATE TABLE communication_meeting_webhooks (
 id text PRIMARY KEY CHECK(length(id)<=200), body_hash text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX communication_meeting_webhooks_cleanup ON communication_meeting_webhooks(processed_at);
ALTER TABLE communication_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_meeting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_meeting_webhooks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON communication_meetings,communication_meeting_participants,communication_meeting_sessions,communication_meeting_webhooks FROM anon,authenticated;
GRANT ALL ON communication_meetings,communication_meeting_participants,communication_meeting_sessions,communication_meeting_webhooks TO service_role;
CREATE FUNCTION check_communication_meeting_user_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $
BEGIN
 IF TG_TABLE_NAME='communication_meetings' THEN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'MEETING_USER_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'MEETING_USER_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $;
CREATE TRIGGER meeting_creator_scope BEFORE INSERT OR UPDATE ON communication_meetings FOR EACH ROW EXECUTE FUNCTION check_communication_meeting_user_scope();
CREATE TRIGGER meeting_participant_scope BEFORE INSERT OR UPDATE ON communication_meeting_participants FOR EACH ROW EXECUTE FUNCTION check_communication_meeting_user_scope();
COMMIT;
