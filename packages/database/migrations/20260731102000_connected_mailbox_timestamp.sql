BEGIN;

ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS connected_at timestamptz;

UPDATE integration_connections
SET connected_at = COALESCE(connected_at, updated_at, created_at)
WHERE connected_at IS NULL
  AND status = 'CONNECTED';

CREATE INDEX IF NOT EXISTS integration_connections_mailbox_sync_idx
  ON integration_connections(status, last_attempted_sync_at, connected_at)
  WHERE kind = 'COMMUNICATION'
    AND provider IN ('GOOGLE_MAIL', 'ZOHO_MAIL');

COMMENT ON COLUMN integration_connections.connected_at IS
  'Most recent successful provider authorization time; no OAuth token material is stored in this column.';

COMMIT;
