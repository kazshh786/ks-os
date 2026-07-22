-- Phase 12.0: unified authentication contexts. Additive only; existing Phase 12
-- agency/commercial/operations data and every operational users(id) FK remain.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_reference uuid DEFAULT gen_random_uuid();
UPDATE tenants SET business_reference = gen_random_uuid() WHERE business_reference IS NULL;
ALTER TABLE tenants ALTER COLUMN business_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_business_reference_unique ON tenants (business_reference);

ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id uuid;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_normalized varchar(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by_user_id uuid;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by_agency_user_id uuid;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_version integer DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;
UPDATE users SET auth_user_id = id WHERE auth_user_id IS NULL AND account_status <> 'INVITED';
UPDATE users SET email_normalized = lower(trim(email)) WHERE email_normalized IS NULL;
UPDATE users SET accepted_at = COALESCE(accepted_at, created_at) WHERE account_status = 'ACTIVE';
UPDATE users SET security_version = 1 WHERE security_version IS NULL;
ALTER TABLE users ALTER COLUMN email_normalized SET NOT NULL;
ALTER TABLE users ALTER COLUMN security_version SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_auth_user_unique ON users (tenant_id, auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email_normalized_unique ON users (tenant_id, email_normalized);
CREATE INDEX IF NOT EXISTS users_auth_status_idx ON users (auth_user_id, account_status);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_invited_by_user_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_invited_by_user_fk FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_account_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_account_status_check CHECK (account_status IN ('INVITED','ACTIVE','SUSPENDED','DEACTIVATED'));
  END IF;
END $$;

ALTER TABLE agency_users ALTER COLUMN auth_user_id DROP NOT NULL;
ALTER TABLE agency_users ADD COLUMN IF NOT EXISTS public_reference uuid DEFAULT gen_random_uuid();
ALTER TABLE agency_users ADD COLUMN IF NOT EXISTS mfa_required boolean DEFAULT true;
ALTER TABLE agency_users ADD COLUMN IF NOT EXISTS invited_at timestamptz;
ALTER TABLE agency_users ADD COLUMN IF NOT EXISTS activated_at timestamptz;
ALTER TABLE agency_users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE agency_users ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE agency_users ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE agency_users ADD COLUMN IF NOT EXISTS security_version integer DEFAULT 1;
ALTER TABLE agency_users ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;
UPDATE agency_users SET
  mfa_required = role <> 'FULFILMENT_ADMINISTRATOR',
  invited_at = COALESCE(invited_at, created_at),
  activated_at = CASE WHEN status = 'ACTIVE' THEN COALESCE(activated_at, created_at) ELSE activated_at END,
  security_version = COALESCE(security_version, 1);
UPDATE agency_users SET public_reference = gen_random_uuid() WHERE public_reference IS NULL;
ALTER TABLE agency_users ALTER COLUMN public_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agency_users_public_reference_unique ON agency_users (public_reference);
ALTER TABLE agency_users ALTER COLUMN mfa_required SET NOT NULL;
ALTER TABLE agency_users ALTER COLUMN security_version SET NOT NULL;
ALTER TABLE agency_users DROP CONSTRAINT IF EXISTS agency_users_status_check;
ALTER TABLE agency_users ADD CONSTRAINT agency_users_status_check CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','DEACTIVATED'));

CREATE TABLE IF NOT EXISTS account_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invitation_type varchar(30) NOT NULL CHECK (invitation_type IN ('AGENCY','TENANT_OWNER','TENANT_STAFF')),
  email_normalized varchar(255) NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  agency_role varchar(40),
  tenant_role varchar(20),
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','EXPIRED','CANCELLED','SUPERSEDED')),
  supabase_auth_user_id uuid,
  provisioning_mode varchar(30) CHECK (provisioning_mode IS NULL OR provisioning_mode IN ('SUPABASE_INVITE','EXISTING_ACCOUNT')),
  invited_by_auth_user_id uuid NOT NULL,
  invited_by_tenant_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  invited_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  last_sent_at timestamptz,
  send_count integer NOT NULL DEFAULT 0 CHECK (send_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((invitation_type = 'AGENCY' AND tenant_id IS NULL AND agency_role IS NOT NULL AND tenant_role IS NULL)
      OR (invitation_type IN ('TENANT_OWNER','TENANT_STAFF') AND tenant_id IS NOT NULL AND tenant_role IN ('owner','staff') AND agency_role IS NULL))
);

ALTER TABLE agency_sessions ADD COLUMN IF NOT EXISTS public_reference uuid DEFAULT gen_random_uuid();
UPDATE agency_sessions SET public_reference = gen_random_uuid() WHERE public_reference IS NULL;
ALTER TABLE agency_sessions ALTER COLUMN public_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agency_sessions_public_reference_unique ON agency_sessions (public_reference);
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;
CREATE INDEX IF NOT EXISTS account_invitations_tenant_email_status_idx ON account_invitations (tenant_id, email_normalized, status);
CREATE INDEX IF NOT EXISTS account_invitations_agency_email_status_idx ON account_invitations (email_normalized, status) WHERE invitation_type = 'AGENCY';
CREATE INDEX IF NOT EXISTS account_invitations_status_expiry_idx ON account_invitations (status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS account_invitations_pending_intent_unique
  ON account_invitations (invitation_type, email_normalized, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'PENDING';

-- Backfill the two former invitation sources for audit continuity. New writes use
-- account_invitations; staff_invitations remains a read-compatible legacy table.
INSERT INTO account_invitations (
  invitation_type, email_normalized, tenant_id, tenant_role, status,
  supabase_auth_user_id, invited_by_auth_user_id, invited_by_tenant_user_id,
  expires_at, accepted_at, cancelled_at, last_sent_at, send_count, created_at, updated_at
)
SELECT 'TENANT_STAFF', si.email_normalized, si.tenant_id, 'staff',
  CASE WHEN si.status IN ('PENDING','ACCEPTED','EXPIRED','CANCELLED') THEN si.status ELSE 'CANCELLED' END,
  si.auth_user_id, COALESCE(u.auth_user_id, u.id), si.invited_by_user_id,
  si.expires_at, si.accepted_at, si.cancelled_at, si.last_sent_at, si.send_count, si.created_at, now()
FROM staff_invitations si
JOIN users u ON u.id = si.invited_by_user_id
WHERE NOT EXISTS (
  SELECT 1 FROM account_invitations ai
  WHERE ai.invitation_type = 'TENANT_STAFF' AND ai.tenant_id = si.tenant_id
    AND ai.email_normalized = si.email_normalized AND ai.created_at = si.created_at
);

INSERT INTO account_invitations (
  invitation_type, email_normalized, agency_role, status, supabase_auth_user_id,
  invited_by_auth_user_id, invited_by_agency_user_id, expires_at, last_sent_at,
  send_count, created_at, updated_at
)
SELECT 'AGENCY', au.email_normalized, au.role,
  CASE WHEN au.status = 'INVITED' THEN 'PENDING' ELSE 'ACCEPTED' END,
  au.auth_user_id, inviter.auth_user_id, au.invited_by_agency_user_id,
  COALESCE(au.invited_at, au.created_at) + interval '7 days', au.invited_at,
  CASE WHEN au.invited_at IS NULL THEN 0 ELSE 1 END, au.created_at, now()
FROM agency_users au
JOIN agency_users inviter ON inviter.id = au.invited_by_agency_user_id
WHERE NOT EXISTS (
  SELECT 1 FROM account_invitations ai
  WHERE ai.invitation_type = 'AGENCY' AND ai.email_normalized = au.email_normalized
);

CREATE TABLE IF NOT EXISTS application_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  auth_session_id uuid NOT NULL,
  auth_user_id uuid NOT NULL,
  application_context varchar(20) NOT NULL CHECK (application_context IN ('AGENCY','TENANT','CUSTOMER')),
  selected_tenant_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  security_version integer NOT NULL DEFAULT 1,
  assurance_level varchar(10) NOT NULL DEFAULT 'aal1' CHECK (assurance_level IN ('aal1','aal2')),
  device_summary varchar(255),
  ip_hash varchar(64),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_session_id, application_context)
);
CREATE INDEX IF NOT EXISTS application_sessions_user_context_expiry_idx ON application_sessions (auth_user_id, application_context, expires_at DESC);
CREATE INDEX IF NOT EXISTS application_sessions_selected_membership_idx ON application_sessions (selected_tenant_user_id);

CREATE TABLE IF NOT EXISTS account_access_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid,
  agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  tenant_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  application_context varchar(20),
  action varchar(120) NOT NULL,
  outcome varchar(30) NOT NULL DEFAULT 'SUCCESS',
  reason varchar(500),
  request_id varchar(100),
  ip_hash varchar(64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_access_audit_auth_occurred_idx ON account_access_audit_events (auth_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS account_access_audit_tenant_occurred_idx ON account_access_audit_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS account_access_audit_action_occurred_idx ON account_access_audit_events (action, occurred_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_invited_by_agency_user_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_invited_by_agency_user_fk FOREIGN KEY (invited_by_agency_user_id) REFERENCES agency_users(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE account_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_access_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_invitations, application_sessions, account_access_audit_events FROM anon, authenticated;
REVOKE ALL ON users FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON account_invitations, application_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO service_role;
GRANT SELECT, INSERT ON account_access_audit_events TO service_role;

CREATE OR REPLACE FUNCTION prevent_account_access_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'account access audit events are append-only'; END $$;
DROP TRIGGER IF EXISTS account_access_audit_append_only ON account_access_audit_events;
CREATE TRIGGER account_access_audit_append_only
  BEFORE UPDATE OR DELETE ON account_access_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_account_access_audit_mutation();
REVOKE UPDATE, DELETE ON account_access_audit_events FROM service_role;

COMMENT ON TABLE account_invitations IS 'Server-only application access intent. Supabase Auth owns invitation tokens.';
COMMENT ON TABLE application_sessions IS 'Server-validated application context and workspace selection keyed by the verified Supabase session_id claim.';
COMMENT ON TABLE account_access_audit_events IS 'Append-only security audit; never stores raw tokens, MFA secrets, passwords or links.';
