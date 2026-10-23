BEGIN;
ALTER TABLE conversation_messages ADD COLUMN client_message_id uuid;
CREATE UNIQUE INDEX conversation_messages_native_retry_unique ON conversation_messages(conversation_id,sender_user_id,client_message_id) WHERE client_message_id IS NOT NULL;
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_scope_unique UNIQUE(tenant_id,conversation_id,id);

CREATE TABLE communication_reactions (
  tenant_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('👍','❤️','🎉','😄','👀','✅')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,user_id,emoji),
  FOREIGN KEY(tenant_id,conversation_id,message_id) REFERENCES conversation_messages(tenant_id,conversation_id,id) ON DELETE CASCADE
);
CREATE TABLE communication_mentions (
  tenant_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_offset integer NOT NULL CHECK(start_offset >= 0),
  end_offset integer NOT NULL CHECK(end_offset > start_offset),
  display_name text NOT NULL,
  PRIMARY KEY(message_id,start_offset),
  FOREIGN KEY(tenant_id,conversation_id,message_id) REFERENCES conversation_messages(tenant_id,conversation_id,id) ON DELETE CASCADE
);
CREATE INDEX communication_mentions_recipient_idx ON communication_mentions(tenant_id,user_id,message_id);
CREATE INDEX communication_reactions_user_idx ON communication_reactions(user_id);
-- All new content remains behind the authenticated API, including privileged writes.
CREATE FUNCTION check_communication_annotation_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM conversation_messages WHERE id=NEW.message_id AND conversation_id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND channel_type='NATIVE' AND deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM conversation_members m JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id WHERE m.conversation_id=NEW.conversation_id AND m.tenant_id=NEW.tenant_id AND m.user_id=NEW.user_id AND m.left_at IS NULL AND u.account_status='ACTIVE') THEN
    RAISE EXCEPTION 'COMMUNICATION_ANNOTATION_SCOPE_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communication_reactions_scope BEFORE INSERT OR UPDATE ON communication_reactions FOR EACH ROW EXECUTE FUNCTION check_communication_annotation_scope();
CREATE TRIGGER communication_mentions_scope BEFORE INSERT OR UPDATE ON communication_mentions FOR EACH ROW EXECUTE FUNCTION check_communication_annotation_scope();
REVOKE ALL ON FUNCTION check_communication_annotation_scope() FROM PUBLIC;
ALTER TABLE communication_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_mentions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON communication_reactions,communication_mentions FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON communication_reactions,communication_mentions TO service_role;
-- A NULL conversation binds a single-use ticket to the actor's authorized workspace feed.
ALTER TABLE communication_tickets ALTER COLUMN conversation_id DROP NOT NULL;
CREATE INDEX communication_events_workspace_replay_idx ON communication_events(tenant_id,id);
COMMIT;
