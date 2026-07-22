CREATE TABLE IF NOT EXISTS operations_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category varchar(30) NOT NULL, issue_type varchar(60) NOT NULL, severity varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
  title varchar(180) NOT NULL, message text NOT NULL, source_type varchar(60) NOT NULL, source_id varchar(255) NOT NULL,
  related_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL, deduplication_key varchar(255) NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0), metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_deadline timestamptz, assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL, resolved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(), last_occurred_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz,
  resolved_at timestamptz, dismissed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operations_issues_tenant_dedup_unique UNIQUE (tenant_id, deduplication_key)
);
CREATE INDEX IF NOT EXISTS operations_issues_tenant_status_severity_idx ON operations_issues (tenant_id,status,severity,last_occurred_at DESC);
CREATE INDEX IF NOT EXISTS operations_issues_tenant_assignee_idx ON operations_issues (tenant_id,assigned_to_user_id,status);
REVOKE ALL ON TABLE operations_issues FROM anon, authenticated;
ALTER TABLE operations_issues ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE operations_issues IS 'Private server-only tenant operations inbox; service-role access only.';
