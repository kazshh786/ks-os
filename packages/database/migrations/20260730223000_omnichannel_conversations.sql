BEGIN;

ALTER TABLE integration_connections DROP CONSTRAINT IF EXISTS integration_kind_check;
ALTER TABLE integration_connections
  ADD CONSTRAINT integration_kind_check
  CHECK (kind IN ('CALENDAR','ACCOUNTING','AUTOMATION','HARDWARE','COMMUNICATION'));

CREATE TABLE IF NOT EXISTS communication_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_type varchar(20) NOT NULL CHECK (channel_type IN ('EMAIL','SMS','WHATSAPP','INSTAGRAM','FACEBOOK')),
  provider varchar(30) NOT NULL,
  display_name varchar(255) NOT NULL,
  external_account_id varchar(255),
  status varchar(20) NOT NULL DEFAULT 'DISCONNECTED' CHECK (status IN ('CONNECTED','ATTENTION','DISCONNECTED')),
  capabilities text[] NOT NULL DEFAULT '{}',
  credentials_reference uuid REFERENCES integration_connections(id) ON DELETE SET NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_at timestamptz,
  last_health_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_channels_tenant_type_account_unique
  ON communication_channels(tenant_id, channel_type, external_account_id);
CREATE INDEX IF NOT EXISTS communication_channels_tenant_status_idx
  ON communication_channels(tenant_id, status);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  related_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  primary_channel varchar(20) NOT NULL CHECK (primary_channel IN ('EMAIL','SMS','WHATSAPP','INSTAGRAM','FACEBOOK')),
  subject varchar(500),
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PENDING','RESOLVED')),
  priority varchar(20) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  customer_display_name varchar(255) NOT NULL,
  customer_email varchar(255),
  customer_phone varchar(30),
  last_message_preview text NOT NULL DEFAULT '',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  tags text[] NOT NULL DEFAULT '{}',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_tenant_last_message_idx
  ON conversations(tenant_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_tenant_status_idx
  ON conversations(tenant_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_tenant_assignment_idx
  ON conversations(tenant_id, assigned_to_user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_tenant_client_idx
  ON conversations(tenant_id, client_id);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES communication_channels(id) ON DELETE SET NULL,
  channel_type varchar(20) NOT NULL CHECK (channel_type IN ('EMAIL','SMS','WHATSAPP','INSTAGRAM','FACEBOOK')),
  direction varchar(20) NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND','INTERNAL')),
  sender_type varchar(20) NOT NULL CHECK (sender_type IN ('CUSTOMER','STAFF','AUTOMATION','SYSTEM')),
  sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  sender_name varchar(255) NOT NULL,
  body text NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('RECEIVED','QUEUED','SENT','DELIVERED','READ','FAILED')),
  reply_to_message_id uuid REFERENCES conversation_messages(id) ON DELETE SET NULL,
  external_message_id varchar(255),
  error_code varchar(120),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_messages_conversation_created_idx
  ON conversation_messages(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_tenant_channel_external_unique
  ON conversation_messages(tenant_id, channel_type, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  file_name varchar(500) NOT NULL,
  mime_type varchar(255) NOT NULL,
  file_size_bytes integer NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  storage_key varchar(1000) NOT NULL,
  is_safe boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_attachments_message_idx
  ON conversation_attachments(message_id);

ALTER TABLE communication_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_attachments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON communication_channels, conversations, conversation_messages, conversation_attachments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON communication_channels, conversations, conversation_messages, conversation_attachments TO service_role;

COMMENT ON COLUMN communication_channels.credentials_reference IS 'References an integration_connections row whose encrypted token material is never returned by conversation APIs.';
COMMENT ON COLUMN conversation_attachments.storage_key IS 'Private object-store key; download access must be mediated by an authenticated tenant-scoped API.';

COMMIT;
