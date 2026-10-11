BEGIN;

-- Extend the canonical inbox entities; existing rows retain INBOX authorization.
ALTER TABLE conversations
  ADD COLUMN access_mode varchar(20) NOT NULL DEFAULT 'INBOX' CHECK (access_mode IN ('INBOX','MEMBERS')),
  ADD COLUMN conversation_type varchar(20) NOT NULL DEFAULT 'CLIENT' CHECK (conversation_type IN ('CHANNEL','PRIVATE_CHANNEL','DIRECT','GROUP_DIRECT','PROJECT','CLIENT')),
  ADD COLUMN name varchar(255),
  ADD COLUMN slug varchar(100),
  ADD COLUMN description text,
  ADD COLUMN created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN archived_at timestamptz;
ALTER TABLE conversations DROP CONSTRAINT conversations_primary_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_primary_channel_check
  CHECK (primary_channel IN ('EMAIL','SMS','WHATSAPP','INSTAGRAM','FACEBOOK','NATIVE'));
ALTER TABLE conversations ADD CONSTRAINT conversations_native_access_check
  CHECK ((access_mode = 'MEMBERS') = (primary_channel = 'NATIVE'));
CREATE UNIQUE INDEX conversations_tenant_id_unique ON conversations(tenant_id,id);
CREATE UNIQUE INDEX conversations_native_slug_unique ON conversations(tenant_id,slug) WHERE access_mode='MEMBERS';
CREATE INDEX conversations_native_list_idx ON conversations(tenant_id,id) WHERE access_mode='MEMBERS' AND archived_at IS NULL;

CREATE SEQUENCE native_message_position_seq AS bigint;
ALTER TABLE conversation_messages
  ADD COLUMN native_position bigint,
  ADD COLUMN message_type varchar(30) NOT NULL DEFAULT 'TEXT',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN edited_at timestamptz,
  ADD COLUMN deleted_at timestamptz;
ALTER TABLE conversation_messages DROP CONSTRAINT conversation_messages_channel_type_check;
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_channel_type_check
  CHECK (channel_type IN ('EMAIL','SMS','WHATSAPP','INSTAGRAM','FACEBOOK','NATIVE'));
CREATE UNIQUE INDEX conversation_messages_native_position_unique ON conversation_messages(conversation_id,native_position);
CREATE INDEX conversation_messages_native_thread_idx ON conversation_messages(conversation_id,reply_to_message_id,native_position DESC) WHERE native_position IS NOT NULL;

CREATE TABLE conversation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  customer_link_id uuid REFERENCES customer_client_links(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER','EXTERNAL','GUEST')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  last_read_position bigint NOT NULL DEFAULT 0 CHECK (last_read_position >= 0),
  last_read_at timestamptz,
  notification_preference varchar(20) NOT NULL DEFAULT 'ALL' CHECK (notification_preference IN ('ALL','MENTIONS','NONE')),
  FOREIGN KEY (tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE,
  CHECK (num_nonnulls(user_id,customer_link_id)=1),
  UNIQUE (conversation_id,user_id),
  UNIQUE (conversation_id,customer_link_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members(tenant_id,user_id,conversation_id) WHERE left_at IS NULL;
CREATE INDEX conversation_members_customer_idx ON conversation_members(tenant_id,customer_link_id,conversation_id) WHERE left_at IS NULL;

CREATE TABLE communication_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  type varchar(60) NOT NULL,
  resource_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX communication_events_replay_idx ON communication_events(tenant_id,conversation_id,id);
CREATE TABLE communication_tickets (
  token_hash varchar(64) PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  actor jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX communication_tickets_expiry_idx ON communication_tickets(expires_at);

-- Enforce tenant and thread scope even for privileged server writes.
CREATE FUNCTION check_communication_scope() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'conversation_members' THEN
    IF NOT EXISTS (SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND access_mode='MEMBERS')
      OR (NEW.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND tenant_id=NEW.tenant_id))
      OR (NEW.customer_link_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customer_client_links WHERE id=NEW.customer_link_id AND tenant_id=NEW.tenant_id)) THEN
      RAISE EXCEPTION 'COMMUNICATION_SCOPE_INVALID' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.channel_type='NATIVE' THEN
    IF NEW.native_position IS NULL OR NOT EXISTS (SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND access_mode='MEMBERS')
      OR (NEW.sender_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.sender_user_id AND tenant_id=NEW.tenant_id))
      OR (NEW.reply_to_message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM conversation_messages WHERE id=NEW.reply_to_message_id AND conversation_id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND reply_to_message_id IS NULL AND channel_type='NATIVE')) THEN
      RAISE EXCEPTION 'COMMUNICATION_SCOPE_INVALID' USING ERRCODE='23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND access_mode='MEMBERS') THEN
    RAISE EXCEPTION 'COMMUNICATION_SCOPE_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversation_members_scope BEFORE INSERT OR UPDATE ON conversation_members FOR EACH ROW EXECUTE FUNCTION check_communication_scope();
CREATE TRIGGER conversation_messages_native_scope BEFORE INSERT OR UPDATE ON conversation_messages FOR EACH ROW EXECUTE FUNCTION check_communication_scope();
REVOKE ALL ON FUNCTION check_communication_scope() FROM PUBLIC;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON conversation_members,communication_events,communication_tickets FROM anon,authenticated;
REVOKE ALL ON SEQUENCE native_message_position_seq,communication_events_id_seq FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON conversation_members,communication_events,communication_tickets TO service_role;
GRANT USAGE,SELECT ON SEQUENCE native_message_position_seq,communication_events_id_seq TO service_role;
COMMIT;
