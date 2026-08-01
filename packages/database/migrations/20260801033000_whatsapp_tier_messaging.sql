ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_service_window_expires_at timestamptz;

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

ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_marketing_consents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON whatsapp_message_templates, whatsapp_marketing_consents FROM anon, authenticated;
