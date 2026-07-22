-- Phase 10.6: provider-hosted reviews and neutral invitation automation.
-- These API-only tables intentionally have no browser policies. The application
-- database role performs all tenant checks before access.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS review_invitation_excluded boolean NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS review_invitation_exclusion_reason varchar(80);

CREATE TABLE IF NOT EXISTS review_provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider varchar(20) NOT NULL CHECK (provider IN ('GOOGLE','TRUSTPILOT')),
  connection_type varchar(20) NOT NULL CHECK (connection_type IN ('MANUAL_LINK','OAUTH','API')),
  status varchar(20) NOT NULL DEFAULT 'CONFIGURED' CHECK (status IN ('CONFIGURED','CONNECTED','ERROR','DISCONNECTED')),
  provider_business_id varchar(255), provider_location_id varchar(255),
  location_id uuid REFERENCES locations(id) ON DELETE RESTRICT,
  review_url varchar(2048) CHECK (review_url IS NULL OR review_url LIKE 'https://%'),
  business_display_name varchar(160) NOT NULL,
  profile_domain varchar(255), encrypted_credentials_reference text,
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  configured_at timestamptz NOT NULL DEFAULT now(), connected_at timestamptz,
  last_verified_at timestamptz, last_sync_at timestamptz, last_error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((connection_type = 'MANUAL_LINK' AND review_url IS NOT NULL AND encrypted_credentials_reference IS NULL)
      OR (connection_type IN ('OAUTH','API')))
);
CREATE INDEX IF NOT EXISTS review_provider_connections_tenant_provider_idx ON review_provider_connections(tenant_id, provider);
CREATE INDEX IF NOT EXISTS review_provider_connections_tenant_location_idx ON review_provider_connections(tenant_id, location_id);
CREATE INDEX IF NOT EXISTS review_provider_connections_connected_by_idx ON review_provider_connections(connected_by_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS review_connections_location_unique ON review_provider_connections(tenant_id, provider, connection_type, location_id) WHERE location_id IS NOT NULL AND status <> 'DISCONNECTED';
CREATE UNIQUE INDEX IF NOT EXISTS review_connections_tenant_fallback_unique ON review_provider_connections(tenant_id, provider, connection_type) WHERE location_id IS NULL AND status <> 'DISCONNECTED';

CREATE TABLE IF NOT EXISTS review_provider_location_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES review_provider_connections(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  provider_business_id varchar(255), provider_location_id varchar(255), review_url varchar(2048),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id, location_id), CHECK (review_url IS NULL OR review_url LIKE 'https://%')
);
CREATE INDEX IF NOT EXISTS review_provider_location_mappings_tenant_location_idx ON review_provider_location_mappings(tenant_id, location_id);

CREATE TABLE IF NOT EXISTS review_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider varchar(20) NOT NULL CHECK (provider = 'GOOGLE'),
  token_hash varchar(64) NOT NULL UNIQUE, status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','USED','EXPIRED')),
  expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_oauth_states_tenant_expiry_idx ON review_oauth_states(tenant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS review_oauth_states_user_idx ON review_oauth_states(user_id);

CREATE TABLE IF NOT EXISTS review_invitation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL, status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED')),
  provider_mode varchar(20) NOT NULL CHECK (provider_mode IN ('GOOGLE','TRUSTPILOT','BOTH')),
  channel varchar(30) NOT NULL CHECK (channel IN ('EMAIL','SMS','CUSTOMER_PORTAL')),
  delay_minutes integer NOT NULL DEFAULT 1440 CHECK (delay_minutes IN (0,120,360,1440,2880,4320,10080)),
  location_id uuid REFERENCES locations(id) ON DELETE RESTRICT, message_template text NOT NULL,
  private_contact_enabled boolean NOT NULL DEFAULT true, rule_version integer NOT NULL DEFAULT 1 CHECK (rule_version > 0),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_invitation_rules_tenant_status_idx ON review_invitation_rules(tenant_id, status);
CREATE INDEX IF NOT EXISTS review_invitation_rules_location_idx ON review_invitation_rules(location_id);
CREATE UNIQUE INDEX IF NOT EXISTS review_invitation_rules_active_location_unique ON review_invitation_rules(tenant_id, location_id) WHERE status='ACTIVE' AND location_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS review_invitation_rules_active_tenant_unique ON review_invitation_rules(tenant_id) WHERE status='ACTIVE' AND location_id IS NULL;

CREATE TABLE IF NOT EXISTS review_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES locations(id) ON DELETE RESTRICT,
  rule_id uuid NOT NULL REFERENCES review_invitation_rules(id) ON DELETE RESTRICT,
  provider varchar(20) NOT NULL CHECK (provider IN ('GOOGLE','TRUSTPILOT','BOTH')),
  channel varchar(30) NOT NULL CHECK (channel IN ('EMAIL','SMS','CUSTOMER_PORTAL')),
  status varchar(30) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','QUEUED','SENT','DELIVERED','OPENED','PROVIDER_CLICKED','CONFIRMED_REVIEW','FAILED','CANCELLED','EXPIRED','SUPPRESSED')),
  token_hash varchar(64) UNIQUE, provider_invitation_id varchar(255), provider_reference_id varchar(255) NOT NULL,
  provider_destinations_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for timestamptz NOT NULL, next_attempt_at timestamptz NOT NULL, attempt_count integer NOT NULL DEFAULT 0,
  queued_at timestamptz, sent_at timestamptz, delivered_at timestamptz,
  opened_at timestamptz, clicked_at timestamptz, google_clicked_at timestamptz, trustpilot_clicked_at timestamptz,
  confirmed_review_at timestamptz, expires_at timestamptz NOT NULL, failure_code varchar(80),
  idempotency_key varchar(255) NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_invitations_tenant_scheduled_idx ON review_invitations(tenant_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS review_invitations_appointment_idx ON review_invitations(appointment_id);
CREATE INDEX IF NOT EXISTS review_invitations_client_idx ON review_invitations(client_id);
CREATE INDEX IF NOT EXISTS review_invitations_rule_idx ON review_invitations(rule_id);
CREATE INDEX IF NOT EXISTS review_invitations_location_idx ON review_invitations(location_id);
CREATE UNIQUE INDEX IF NOT EXISTS review_invitations_one_experience_unique ON review_invitations(tenant_id, appointment_id, provider);

CREATE TABLE IF NOT EXISTS external_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider varchar(20) NOT NULL CHECK (provider IN ('GOOGLE','TRUSTPILOT')), provider_review_id varchar(255) NOT NULL,
  provider_business_id varchar(255) NOT NULL, provider_location_id varchar(255), location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5), title varchar(500), review_text text, reviewer_display_name varchar(255),
  review_created_at timestamptz NOT NULL, review_updated_at timestamptz, verification_level varchar(80),
  business_reply_text text, business_reply_created_at timestamptz, source_url varchar(2048), last_synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider, provider_review_id), CHECK (source_url IS NULL OR source_url LIKE 'https://%')
);
CREATE INDEX IF NOT EXISTS external_reviews_tenant_provider_created_idx ON external_reviews(tenant_id, provider, review_created_at DESC);
CREATE INDEX IF NOT EXISTS external_reviews_location_idx ON external_reviews(location_id);

ALTER TABLE review_provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_provider_location_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_invitation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON review_provider_connections, review_provider_location_mappings, review_oauth_states,
  review_invitation_rules, review_invitations, external_reviews FROM anon, authenticated;
GRANT ALL ON review_provider_connections, review_provider_location_mappings, review_oauth_states,
  review_invitation_rules, review_invitations, external_reviews TO service_role;
