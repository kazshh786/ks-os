BEGIN;

-- Extend the canonical attachment table. Legacy inbox attachments remain unchanged.
ALTER TABLE conversation_attachments ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE conversation_attachments
 ADD COLUMN conversation_id uuid,
 ADD COLUMN uploaded_by uuid REFERENCES users(id),
 ADD COLUMN status varchar(20) NOT NULL DEFAULT 'LEGACY',
 ADD COLUMN thumbnail_key text,
 ADD COLUMN scan_status varchar(30) NOT NULL DEFAULT 'NOT_SCANNED',
 ADD COLUMN deleted_at timestamptz,
 ADD COLUMN expires_at timestamptz,
 ADD CONSTRAINT chat_attachment_scope FOREIGN KEY(tenant_id,conversation_id,message_id)
 REFERENCES conversation_messages(tenant_id,conversation_id,id),
 ADD CONSTRAINT chat_attachment_conversation FOREIGN KEY(tenant_id,conversation_id)
 REFERENCES conversations(tenant_id,id),
 ADD CONSTRAINT chat_attachment_state CHECK(status IN ('LEGACY','PENDING','VALIDATING','AVAILABLE','QUARANTINED','REJECTED','DELETED')),
 ADD CONSTRAINT chat_attachment_identity CHECK(status='LEGACY' OR (conversation_id IS NOT NULL AND uploaded_by IS NOT NULL));
CREATE INDEX chat_attachment_files_idx ON conversation_attachments(tenant_id,conversation_id,id) WHERE status='AVAILABLE' AND message_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX chat_attachment_cleanup_idx ON conversation_attachments(expires_at) WHERE status<>'LEGACY';
CREATE INDEX chat_attachment_uploader_idx ON conversation_attachments(tenant_id,uploaded_by,created_at) WHERE status<>'LEGACY';

-- Explicit text configuration keeps the GIN expression and query equivalent.
CREATE INDEX native_message_search_idx ON conversation_messages USING gin(to_tsvector('english',body))
 WHERE channel_type='NATIVE' AND deleted_at IS NULL;
CREATE INDEX native_message_sender_search_idx ON conversation_messages(tenant_id,sender_user_id,native_position DESC) WHERE channel_type='NATIVE' AND deleted_at IS NULL;

ALTER TABLE internal_notifications
 ADD COLUMN chat_conversation_id uuid,
 ADD COLUMN chat_message_id uuid,
 ADD CONSTRAINT chat_notification_conversation FOREIGN KEY(tenant_id,chat_conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE,
 ADD CONSTRAINT chat_notification_message FOREIGN KEY(tenant_id,chat_conversation_id,chat_message_id) REFERENCES conversation_messages(tenant_id,conversation_id,id) ON DELETE CASCADE;
CREATE UNIQUE INDEX chat_notification_once_idx ON internal_notifications(recipient_user_id,source_type,source_id) WHERE source_type='CHAT';
CREATE INDEX chat_notification_recipient_idx ON internal_notifications(tenant_id,recipient_user_id,created_at DESC,id DESC) WHERE source_type='CHAT';
CREATE TABLE communication_preferences(
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 browser boolean NOT NULL DEFAULT false,
 in_app boolean NOT NULL DEFAULT true,
 sound boolean NOT NULL DEFAULT false,
 dnd boolean NOT NULL DEFAULT false,
 direct_messages boolean NOT NULL DEFAULT true
);
ALTER TABLE communication_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON communication_preferences FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON communication_preferences TO service_role;
ALTER TABLE communication_events ADD COLUMN recipient_user_id uuid REFERENCES users(id) ON DELETE CASCADE;
-- Guard the dedicated bucket even if another feature has broad permissive Storage policies.
-- The bucket is provisioned privately by an operator at release, never by a migration/request.
DO $$
BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
  EXECUTE 'CREATE POLICY chat_private_bucket_guard ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING (bucket_id <> ''private-chat'') WITH CHECK (bucket_id <> ''private-chat'')';
 END IF;
END $$;
COMMIT;
