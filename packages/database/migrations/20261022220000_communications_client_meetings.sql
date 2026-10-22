BEGIN;
ALTER TABLE communication_meetings ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE communication_meetings DROP CONSTRAINT communication_meetings_status_check;
ALTER TABLE communication_meetings DROP CONSTRAINT communication_meetings_check;
ALTER TABLE communication_meetings ADD CONSTRAINT meeting_status_valid CHECK(status IN ('SCHEDULED','CREATED','RINGING','ACTIVE','ENDED','CANCELLED','FAILED','EXPIRED'));
ALTER TABLE communication_meetings ADD CONSTRAINT meeting_terminal_time CHECK((status IN ('ENDED','CANCELLED','FAILED','EXPIRED'))=(ended_at IS NOT NULL));
ALTER TABLE communication_meetings ADD COLUMN audience text NOT NULL DEFAULT 'INTERNAL' CHECK(audience IN ('INTERNAL','EXTERNAL_CLIENT')),
 ADD COLUMN description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 ADD COLUMN host_user_id uuid REFERENCES users(id), ADD COLUMN scheduled_start_at timestamptz, ADD COLUMN scheduled_end_at timestamptz,
 ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/London', ADD COLUMN customer_id uuid REFERENCES clients(id), ADD COLUMN appointment_id uuid REFERENCES appointments(id),
 ADD COLUMN appointment_version integer, ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN waiting_room_enabled boolean NOT NULL DEFAULT true CHECK(waiting_room_enabled), ADD COLUMN guest_screen_share boolean NOT NULL DEFAULT false,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN request_fingerprint text CHECK(request_fingerprint IS NULL OR length(request_fingerprint)=64);
ALTER TABLE communication_meetings ADD CONSTRAINT meeting_schedule_valid CHECK((scheduled_start_at IS NULL AND scheduled_end_at IS NULL AND conversation_id IS NOT NULL) OR (scheduled_start_at IS NOT NULL AND scheduled_end_at>scheduled_start_at AND host_user_id IS NOT NULL));
CREATE UNIQUE INDEX meeting_appointment_once ON communication_meetings(tenant_id,appointment_id) WHERE appointment_id IS NOT NULL AND status NOT IN ('CANCELLED','FAILED','EXPIRED');
CREATE INDEX meeting_schedule_dashboard ON communication_meetings(tenant_id,scheduled_start_at DESC,id DESC) WHERE scheduled_start_at IS NOT NULL;
CREATE INDEX meeting_customer_history ON communication_meetings(tenant_id,customer_id,scheduled_start_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX meeting_capacity ON communication_meetings(tenant_id,status) WHERE status IN ('CREATED','RINGING','ACTIVE');
ALTER TABLE communication_meeting_participants ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE communication_meeting_participants DROP CONSTRAINT communication_meeting_participants_role_check;
ALTER TABLE communication_meeting_participants ADD COLUMN guest_name text CHECK(length(guest_name) BETWEEN 1 AND 100),
 ADD CONSTRAINT meeting_participant_kind CHECK((user_id IS NOT NULL AND guest_name IS NULL AND role IN ('ORGANIZER','COHOST','PARTICIPANT')) OR (user_id IS NULL AND guest_name IS NOT NULL AND role='GUEST')),
 ADD CONSTRAINT meeting_participant_scope UNIQUE(id,meeting_id,tenant_id);
CREATE TABLE communication_meeting_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,meeting_id uuid NOT NULL,secret_hash text NOT NULL UNIQUE CHECK(length(secret_hash)=64),
 request_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES users(id),email text CHECK(length(email)<=254),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,revoked_by uuid REFERENCES users(id),claimed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,meeting_id,tenant_id),UNIQUE(meeting_id,request_id),FOREIGN KEY(meeting_id,tenant_id) REFERENCES communication_meetings(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX meeting_invitation_active ON communication_meeting_invitations(tenant_id,meeting_id,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE communication_meeting_guests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,meeting_id uuid NOT NULL,participant_id uuid NOT NULL,
 invitation_id uuid NOT NULL UNIQUE,request_id uuid NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),credential_hash text NOT NULL CHECK(length(credential_hash)=64),
 state text NOT NULL DEFAULT 'WAITING' CHECK(state IN ('WAITING','APPROVED','DENIED','EXPIRED','CANCELLED')),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),admitted_at timestamptz,decided_by uuid REFERENCES users(id),revoked_at timestamptz,
 UNIQUE(id,meeting_id,participant_id,tenant_id),UNIQUE(id,meeting_id,tenant_id),
 FOREIGN KEY(invitation_id,meeting_id,tenant_id) REFERENCES communication_meeting_invitations(id,meeting_id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(participant_id,meeting_id,tenant_id) REFERENCES communication_meeting_participants(id,meeting_id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX meeting_guest_waiting ON communication_meeting_guests(tenant_id,meeting_id,created_at) WHERE state='WAITING';
CREATE INDEX meeting_guest_expiry ON communication_meeting_guests(expires_at) WHERE revoked_at IS NULL;
ALTER TABLE communication_meeting_sessions ALTER COLUMN user_id DROP NOT NULL,ALTER COLUMN auth_session_id DROP NOT NULL,ALTER COLUMN auth_issued_at DROP NOT NULL;
ALTER TABLE communication_meeting_sessions ADD COLUMN guest_session_id uuid,
 ADD CONSTRAINT meeting_session_principal CHECK((guest_session_id IS NULL AND user_id IS NOT NULL AND auth_session_id IS NOT NULL AND auth_issued_at IS NOT NULL) OR (guest_session_id IS NOT NULL AND user_id IS NULL AND auth_session_id IS NULL AND auth_issued_at IS NULL)),
 ADD CONSTRAINT meeting_session_guest_scope FOREIGN KEY(guest_session_id,meeting_id,participant_id,tenant_id) REFERENCES communication_meeting_guests(id,meeting_id,participant_id,tenant_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX meeting_guest_join_retry ON communication_meeting_sessions(guest_session_id,request_id) WHERE guest_session_id IS NOT NULL;
ALTER TABLE communication_events ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE communication_events ADD COLUMN meeting_id uuid,ADD COLUMN actor_user_id uuid REFERENCES users(id),ADD CONSTRAINT communication_event_meeting_scope FOREIGN KEY(meeting_id,tenant_id) REFERENCES communication_meetings(id,tenant_id) ON DELETE CASCADE;
ALTER TABLE communication_events ADD CONSTRAINT communication_event_resource CHECK(conversation_id IS NOT NULL OR meeting_id IS NOT NULL);
CREATE INDEX communication_event_meeting_replay ON communication_events(tenant_id,meeting_id,id) WHERE meeting_id IS NOT NULL;
CREATE OR REPLACE FUNCTION check_communication_meeting_user_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='communication_meetings' THEN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'MEETING_USER_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
  IF NEW.host_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.host_user_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'MEETING_HOST_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM clients WHERE id=NEW.customer_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'MEETING_CUSTOMER_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
  IF NEW.appointment_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM appointments WHERE id=NEW.appointment_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'MEETING_APPOINTMENT_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
   IF TG_OP='INSERT' OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    IF NOT EXISTS(SELECT 1 FROM appointments WHERE id=NEW.appointment_id AND tenant_id=NEW.tenant_id AND client_id=NEW.customer_id) THEN RAISE EXCEPTION 'MEETING_APPOINTMENT_CUSTOMER_INVALID' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
 ELSE
  IF NEW.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'MEETING_USER_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION check_meeting_guest_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.decided_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.decided_by AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'MEETING_GUEST_ACTOR_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM communication_meeting_participants WHERE id=NEW.participant_id AND meeting_id=NEW.meeting_id AND tenant_id=NEW.tenant_id AND user_id IS NULL AND role='GUEST') THEN RAISE EXCEPTION 'MEETING_GUEST_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER meeting_guest_scope BEFORE INSERT OR UPDATE ON communication_meeting_guests FOR EACH ROW EXECUTE FUNCTION check_meeting_guest_scope();
CREATE FUNCTION check_meeting_invitation_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND tenant_id=NEW.tenant_id) OR (NEW.revoked_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.revoked_by AND tenant_id=NEW.tenant_id)) THEN RAISE EXCEPTION 'MEETING_INVITATION_ACTOR_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER meeting_invitation_scope BEFORE INSERT OR UPDATE ON communication_meeting_invitations FOR EACH ROW EXECUTE FUNCTION check_meeting_invitation_scope();
ALTER TABLE communication_meeting_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_meeting_guests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON communication_meeting_invitations,communication_meeting_guests FROM anon,authenticated;
GRANT ALL ON communication_meeting_invitations,communication_meeting_guests TO service_role;
COMMIT;
