ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_service_window_expires_at timestamptz;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS whatsapp_marketing_monthly_message_limit integer NOT NULL DEFAULT 500;

CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES communication_channels(id) ON DELETE CASCADE,
  provider_template_id varchar(255),
  name varchar(512) NOT NULL,
  language varchar(35) NOT NULL,
  category varchar(20) NOT NULL,
  status varchar(30) NOT NULL,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_score varchar(30),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_message_templates_category_check
    CHECK (category IN ('UTILITY', 'MARKETING', 'AUTHENTICATION'))
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_message_templates_tenant_channel_name_language_unique
  ON whatsapp_message_templates(tenant_id, channel_id, name, language);
CREATE INDEX IF NOT EXISTS whatsapp_message_templates_tenant_category_status_idx
  ON whatsapp_message_templates(tenant_id, category, status, name);

CREATE TABLE IF NOT EXISTS whatsapp_marketing_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  recipient_phone varchar(30) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'UNKNOWN',
  source varchar(80),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  consented_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_marketing_consents_status_check
    CHECK (status IN ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT'))
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_marketing_consents_tenant_phone_unique
  ON whatsapp_marketing_consents(tenant_id, recipient_phone);
CREATE INDEX IF NOT EXISTS whatsapp_marketing_consents_tenant_status_idx
  ON whatsapp_marketing_consents(tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES communication_channels(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES whatsapp_message_templates(id) ON DELETE RESTRICT,
  name varchar(255) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'SCHEDULED',
  audience_type varchar(40) NOT NULL DEFAULT 'ALL_OPTED_IN',
  template_parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at timestamptz NOT NULL,
  recipient_limit integer NOT NULL DEFAULT 500,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at timestamptz,
  dispatched_at timestamptz,
  cancelled_at timestamptz,
  failure_code varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_marketing_campaigns_status_check
    CHECK (status IN ('SCHEDULED', 'PROCESSING', 'DISPATCHED', 'CANCELLED', 'FAILED')),
  CONSTRAINT whatsapp_marketing_campaigns_audience_check
    CHECK (audience_type IN ('ALL_OPTED_IN', 'UPCOMING_BOOKING_30_DAYS', 'LAPSED_90_DAYS')),
  CONSTRAINT whatsapp_marketing_campaigns_recipient_limit_check
    CHECK (recipient_limit > 0 AND recipient_limit <= 1000)
);

CREATE INDEX IF NOT EXISTS whatsapp_marketing_campaigns_due_idx
  ON whatsapp_marketing_campaigns(status, scheduled_at, created_at);
CREATE INDEX IF NOT EXISTS whatsapp_marketing_campaigns_tenant_created_idx
  ON whatsapp_marketing_campaigns(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_marketing_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES whatsapp_marketing_campaigns(id) ON DELETE CASCADE,
  consent_id uuid REFERENCES whatsapp_marketing_consents(id) ON DELETE SET NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  recipient_phone varchar(30) NOT NULL,
  customer_name varchar(255) NOT NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES conversation_messages(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'QUEUED',
  skip_reason varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_marketing_campaign_recipients_status_check
    CHECK (status IN ('QUEUED', 'SKIPPED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_marketing_campaign_recipients_campaign_phone_unique
  ON whatsapp_marketing_campaign_recipients(campaign_id, recipient_phone);
CREATE INDEX IF NOT EXISTS whatsapp_marketing_campaign_recipients_tenant_created_idx
  ON whatsapp_marketing_campaign_recipients(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_marketing_campaign_recipients_message_idx
  ON whatsapp_marketing_campaign_recipients(message_id);

ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_marketing_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_marketing_campaign_recipients ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON whatsapp_message_templates, whatsapp_marketing_consents,
  whatsapp_marketing_campaigns, whatsapp_marketing_campaign_recipients FROM anon, authenticated;
