-- Phase 10.2 - additive, reviewed migration. Do not apply automatically.
-- Customer booking management remains an API-only capability. The tables below
-- are deliberately unavailable through the Supabase Data API browser roles.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS customer_cancellation_enabled boolean DEFAULT true NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS customer_rescheduling_enabled boolean DEFAULT true NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS minimum_cancellation_notice_minutes integer DEFAULT 1440 NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS minimum_reschedule_notice_minutes integer DEFAULT 1440 NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS maximum_customer_reschedules integer DEFAULT 3 NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS require_cancellation_reason boolean DEFAULT false NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS late_cancellation_message text DEFAULT 'Online changes are no longer available because your appointment is within the salon notice period. Please contact the salon.' NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deposit_policy_message text DEFAULT 'Cancelling an appointment does not automatically issue a refund. The salon will review any payment already made.' NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS public_reference uuid DEFAULT gen_random_uuid();
UPDATE users SET public_reference = gen_random_uuid() WHERE public_reference IS NULL;
ALTER TABLE users ALTER COLUMN public_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_public_reference_unique ON users(public_reference);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS version integer DEFAULT 1 NOT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS customer_reschedule_count integer DEFAULT 0 NOT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_source varchar(20);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_reason_code varchar(40);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_reason_text text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_tenant_public_reference_unique
  ON appointments(tenant_id, public_reference);
CREATE INDEX IF NOT EXISTS appointments_tenant_staff_active_time_idx
  ON appointments(tenant_id, user_id, start_time, end_time)
  WHERE status NOT IN ('CANCELLED','NO_SHOW');
CREATE INDEX IF NOT EXISTS appointments_tenant_resource_active_time_idx
  ON appointments(tenant_id, resource_id, start_time, end_time)
  WHERE resource_id IS NOT NULL AND status NOT IN ('CANCELLED','NO_SHOW');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_customer_notice_nonnegative') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_customer_notice_nonnegative
      CHECK (minimum_cancellation_notice_minutes >= 0 AND minimum_reschedule_notice_minutes >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_customer_reschedules_nonnegative') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_customer_reschedules_nonnegative
      CHECK (maximum_customer_reschedules >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_customer_notice_approved') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_customer_notice_approved
      CHECK (minimum_cancellation_notice_minutes IN (0,120,360,720,1440,2880,4320)
        AND minimum_reschedule_notice_minutes IN (0,120,360,720,1440,2880,4320));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_customer_reschedules_approved') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_customer_reschedules_approved
      CHECK (maximum_customer_reschedules IN (0,1,2,3,5,10));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_customer_policy_text_safe') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_customer_policy_text_safe CHECK (
      length(late_cancellation_message) BETWEEN 1 AND 1000
      AND length(deposit_policy_message) BETWEEN 1 AND 1000
      AND late_cancellation_message !~ '[<>]' AND deposit_policy_message !~ '[<>]'
      AND late_cancellation_message !~ '(\{\{|\}\}|\$\{)'
      AND deposit_policy_message !~ '(\{\{|\}\}|\$\{)'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_version_positive') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_version_positive CHECK (version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_customer_reschedules_nonnegative') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_customer_reschedules_nonnegative CHECK (customer_reschedule_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_cancellation_source_valid') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_cancellation_source_valid
      CHECK (cancellation_source IS NULL OR cancellation_source IN ('CUSTOMER','STAFF','OWNER','SYSTEM'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_cancellation_reason_valid') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_cancellation_reason_valid CHECK (
      cancellation_reason_code IS NULL OR cancellation_reason_code IN (
        'NO_LONGER_NEEDED','SCHEDULE_CONFLICT','UNWELL','BOOKED_BY_MISTAKE','OTHER','PREFER_NOT_TO_SAY'
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_cancellation_reason_text_safe') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_cancellation_reason_text_safe CHECK (
      cancellation_reason_text IS NULL OR (length(cancellation_reason_text) BETWEEN 1 AND 500 AND cancellation_reason_text !~ '[<>]')
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.increment_appointment_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.version = OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.increment_appointment_version() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS appointments_increment_version ON appointments;
CREATE TRIGGER appointments_increment_version
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION public.increment_appointment_version();

CREATE TABLE IF NOT EXISTS customer_booking_management_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS customer_booking_management_tokens_appointment_status_idx
  ON customer_booking_management_tokens(appointment_id, status);
CREATE INDEX IF NOT EXISTS customer_booking_management_tokens_status_expiry_idx
  ON customer_booking_management_tokens(status, expires_at);

CREATE TABLE IF NOT EXISTS customer_booking_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  change_type varchar(20) NOT NULL CHECK (change_type IN ('RESCHEDULED','CANCELLED')),
  source varchar(20) NOT NULL CHECK (source IN ('CUSTOMER','STAFF','OWNER','SYSTEM')),
  previous_start_time timestamptz,
  previous_end_time timestamptz,
  new_start_time timestamptz,
  new_end_time timestamptz,
  previous_staff_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  new_staff_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason_code varchar(40),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_booking_change_history_tenant_appointment_created_idx
  ON customer_booking_change_history(tenant_id, appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_booking_change_history_previous_staff_idx
  ON customer_booking_change_history(previous_staff_user_id) WHERE previous_staff_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_booking_change_history_new_staff_idx
  ON customer_booking_change_history(new_staff_user_id) WHERE new_staff_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_booking_action_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  action varchar(20) NOT NULL CHECK (action IN ('RESCHEDULE','CANCEL')),
  actor_scope_hash varchar(64) NOT NULL,
  idempotency_key uuid NOT NULL,
  request_fingerprint varchar(64) NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_booking_action_idempotency_scope_unique
  ON customer_booking_action_idempotency(actor_scope_hash, appointment_id, action, idempotency_key);
CREATE INDEX IF NOT EXISTS customer_booking_action_idempotency_tenant_appointment_idx
  ON customer_booking_action_idempotency(tenant_id, appointment_id);

ALTER TABLE customer_booking_management_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_booking_change_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_booking_action_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_booking_management_tokens, customer_booking_change_history, customer_booking_action_idempotency FROM anon, authenticated;
