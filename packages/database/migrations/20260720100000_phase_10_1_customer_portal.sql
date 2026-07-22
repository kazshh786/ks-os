-- Phase 10.1 — additive, reviewed migration. Do not apply automatically.
-- The Fastify API is the only customer-portal database access path. These tables
-- are not granted to Supabase anon/authenticated Data API roles.
CREATE TABLE IF NOT EXISTS customer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE,
  email_normalized varchar(255) NOT NULL,
  display_name varchar(255) NOT NULL,
  phone_e164 varchar(20),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_signed_in_at timestamptz
);

CREATE TABLE IF NOT EXISTS customer_client_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  link_source varchar(30) NOT NULL CHECK (link_source IN ('BOOKING_CLAIM','FORM_CLAIM','OWNER_INVITATION','EXISTING_VERIFIED_LINK')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT customer_client_links_tenant_client_unique UNIQUE (tenant_id, client_id),
  CONSTRAINT customer_client_links_tenant_auth_unique UNIQUE (tenant_id, auth_user_id)
);
CREATE INDEX IF NOT EXISTS customer_client_links_customer_status_idx ON customer_client_links(customer_account_id, status);

CREATE TABLE IF NOT EXISTS customer_account_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  email_normalized varchar(255) NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','USED','EXPIRED','REVOKED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  revoked_at timestamptz,
  created_by_type varchar(30) NOT NULL DEFAULT 'PUBLIC_BOOKING'
);
CREATE INDEX IF NOT EXISTS customer_account_claims_pending_appointment_idx ON customer_account_claims(appointment_id, status);
CREATE INDEX IF NOT EXISTS customer_account_claims_expiry_idx ON customer_account_claims(status, expires_at);

ALTER TABLE form_assignments ADD COLUMN IF NOT EXISTS public_reference uuid DEFAULT gen_random_uuid();
UPDATE form_assignments SET public_reference = gen_random_uuid() WHERE public_reference IS NULL;
ALTER TABLE form_assignments ALTER COLUMN public_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS form_assignments_public_reference_unique ON form_assignments(public_reference);

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_client_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_account_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_accounts, customer_client_links, customer_account_claims FROM anon, authenticated;
