BEGIN;

-- Production reconciliation for a historical ledger entry that was recorded with
-- zero execution time even though none of the Phase 13 integration tables exist.
-- This migration is deliberately forward-only and idempotent: it does not alter
-- ks_os_schema_migrations or rerun the historical non-idempotent migration.

CREATE TABLE IF NOT EXISTS integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connected_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  kind varchar(30) NOT NULL,
  provider varchar(40) NOT NULL,
  external_account_id varchar(255),
  external_resource_id varchar(255),
  external_resource_name varchar(255),
  token_ciphertext text,
  token_expires_at timestamptz,
  granted_scopes text[] NOT NULL DEFAULT '{}',
  status varchar(40) NOT NULL DEFAULT 'NOT_CONNECTED',
  sync_direction varchar(20) NOT NULL DEFAULT 'OUTBOUND',
  settings jsonb NOT NULL DEFAULT '{}',
  provider_metadata jsonb NOT NULL DEFAULT '{}',
  last_successful_sync_at timestamptz,
  last_attempted_sync_at timestamptz,
  last_sync_error varchar(500),
  webhook_id varchar(255),
  webhook_expires_at timestamptz,
  connected_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_kind_check CHECK (kind IN ('CALENDAR','ACCOUNTING','AUTOMATION','HARDWARE')),
  CONSTRAINT integration_status_check CHECK (status IN ('NOT_CONNECTED','CONNECTING','CONNECTED','DEGRADED','REAUTHORISATION_REQUIRED','DISABLED','FAILED','DISCONNECTED')),
  CONSTRAINT integration_direction_check CHECK (sync_direction IN ('OUTBOUND','INBOUND','TWO_WAY'))
);
CREATE INDEX IF NOT EXISTS integration_connections_tenant_kind_idx
  ON integration_connections(tenant_id, kind, provider, status);

CREATE TABLE IF NOT EXISTS integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES integration_connections(id) ON DELETE SET NULL,
  provider varchar(40) NOT NULL,
  direction varchar(20) NOT NULL,
  local_entity_type varchar(50) NOT NULL,
  local_entity_id varchar(255) NOT NULL,
  external_entity_type varchar(50),
  external_entity_id varchar(255),
  operation varchar(40) NOT NULL,
  status varchar(25) NOT NULL DEFAULT 'QUEUED',
  attempt_count integer NOT NULL DEFAULT 0,
  idempotency_key varchar(255) NOT NULL,
  request_id varchar(100),
  started_at timestamptz,
  completed_at timestamptz,
  next_retry_at timestamptz,
  error_code varchar(100),
  safe_error_message varchar(500),
  provider_metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, idempotency_key),
  CONSTRAINT integration_event_status_check CHECK (status IN ('QUEUED','PROCESSING','SUCCEEDED','RETRYING','FAILED','DEAD_LETTER','REQUIRES_MAPPING','MANUAL_REVIEW'))
);
CREATE INDEX IF NOT EXISTS integration_events_queue_idx
  ON integration_events(status, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS integration_events_entity_idx
  ON integration_events(tenant_id, local_entity_type, local_entity_id);

CREATE TABLE IF NOT EXISTS calendar_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope varchar(20) NOT NULL,
  staff_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  booking_statuses text[] NOT NULL DEFAULT ARRAY['CONFIRMED','CHECKED_IN','IN_SERVICE','AWAITING_PAYMENT','COMPLETED'],
  privacy_level varchar(20) NOT NULL DEFAULT 'BUSY_ONLY',
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT calendar_feed_scope_check CHECK (scope IN ('BUSINESS','STAFF','LOCATION')),
  CONSTRAINT calendar_feed_privacy_check CHECK (privacy_level IN ('BUSY_ONLY','BOOKING_SUMMARY'))
);

CREATE TABLE IF NOT EXISTS accounting_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES integration_connections(id) ON DELETE CASCADE,
  mapping_type varchar(40) NOT NULL,
  local_id varchar(255) NOT NULL,
  external_id varchar(255) NOT NULL,
  external_code varchar(100),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, integration_id, mapping_type, local_id)
);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  target_url varchar(2048) NOT NULL,
  secret_ciphertext text NOT NULL,
  previous_secret_ciphertext text,
  previous_secret_valid_until timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  event_types text[] NOT NULL,
  api_version varchar(20) NOT NULL DEFAULT '2026-07-01',
  description varchar(500),
  custom_headers_ciphertext text,
  allowed_host varchar(255) NOT NULL,
  environment varchar(20) NOT NULL DEFAULT 'live',
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_successful_delivery_at timestamptz,
  last_failed_delivery_at timestamptz,
  consecutive_failure_count integer NOT NULL DEFAULT 0,
  disabled_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_subscriptions_tenant_idx
  ON webhook_subscriptions(tenant_id, enabled);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type varchar(100) NOT NULL,
  resource_type varchar(50) NOT NULL,
  resource_id varchar(255) NOT NULL,
  idempotency_key varchar(255) NOT NULL,
  payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'QUEUED',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status_code integer,
  last_duration_ms integer,
  last_response_excerpt varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(subscription_id, idempotency_key),
  CONSTRAINT webhook_delivery_status_check CHECK (status IN ('QUEUED','PROCESSING','RETRYING','SUCCEEDED','DEAD_LETTER'))
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_queue_idx
  ON webhook_deliveries(status, next_attempt_at, id);

CREATE TABLE IF NOT EXISTS api_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  key_hash varchar(64) NOT NULL UNIQUE,
  key_prefix varchar(16) NOT NULL,
  scopes text[] NOT NULL,
  environment varchar(20) NOT NULL DEFAULT 'live',
  ip_restrictions inet[] NOT NULL DEFAULT '{}',
  rate_limit_tier varchar(20) NOT NULL DEFAULT 'STANDARD',
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_credentials_lookup_idx
  ON api_credentials(key_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS hardware_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  provider varchar(40) NOT NULL,
  device_type varchar(40) NOT NULL,
  external_device_id varchar(255),
  device_label varchar(120) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'OFFLINE',
  connection_type varchar(30) NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}',
  last_online_at timestamptz,
  last_successful_action_at timestamptz,
  last_error varchar(500),
  enabled boolean NOT NULL DEFAULT true,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider, external_device_id)
);

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_integrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON integration_connections, integration_events, calendar_feeds, accounting_mappings,
  webhook_subscriptions, webhook_deliveries, api_credentials, hardware_integrations
  FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON integration_connections, integration_events, calendar_feeds,
  accounting_mappings, webhook_subscriptions, webhook_deliveries, api_credentials, hardware_integrations
  TO service_role;

COMMENT ON COLUMN integration_connections.token_ciphertext IS 'AES-256-GCM envelope; never returned by APIs.';
COMMENT ON COLUMN api_credentials.key_hash IS 'SHA-256 hash; plaintext key is returned once only.';

COMMIT;
