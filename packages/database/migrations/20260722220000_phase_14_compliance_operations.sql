-- Phase 14: additive compliance, privacy and retention foundations.
-- Forward-only: creates new tables/columns and does not delete customer data.

ALTER TABLE platform_audit_events ADD COLUMN IF NOT EXISTS event_category varchar(50) NOT NULL DEFAULT 'ADMINISTRATION';
ALTER TABLE platform_audit_events ADD COLUMN IF NOT EXISTS description varchar(1000);
ALTER TABLE platform_audit_events ADD COLUMN IF NOT EXISTS actor_role varchar(50);
ALTER TABLE platform_audit_events ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE platform_audit_events ADD COLUMN IF NOT EXISTS user_agent varchar(500);
ALTER TABLE platform_audit_events ADD COLUMN IF NOT EXISTS previous_values jsonb;
ALTER TABLE platform_audit_events ADD COLUMN IF NOT EXISTS new_values jsonb;
ALTER TABLE platform_audit_events ADD COLUMN IF NOT EXISTS environment varchar(30) NOT NULL DEFAULT 'production';
ALTER TABLE platform_audit_events ADD COLUMN IF NOT EXISTS source_component varchar(120) NOT NULL DEFAULT 'api';
ALTER TABLE platform_audit_events ADD COLUMN IF NOT EXISTS contains_redactions boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS platform_audit_category_occurred_idx ON platform_audit_events(event_category,occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_target_occurred_idx ON platform_audit_events(target_type,target_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_outcome_occurred_idx ON platform_audit_events(outcome,occurred_at DESC);

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  auth_user_id uuid, client_id uuid REFERENCES clients(id) ON DELETE RESTRICT,
  consent_type varchar(80) NOT NULL, consent_version varchar(40) NOT NULL,
  policy_reference varchar(500), wording_snapshot text NOT NULL, status varchar(20) NOT NULL,
  collection_source varchar(80) NOT NULL, ip_hash varchar(64), user_agent varchar(500), evidence_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  supersedes_consent_id uuid REFERENCES consent_records(id) ON DELETE RESTRICT,
  granted_at timestamptz, withdrawn_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_records_status_check CHECK (status IN ('GRANTED','WITHDRAWN')),
  CONSTRAINT consent_records_subject_check CHECK (auth_user_id IS NOT NULL OR client_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS consent_records_subject_idx ON consent_records(tenant_id,auth_user_id,client_id,consent_type,created_at DESC);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT, request_type varchar(20) NOT NULL,
  subject_auth_user_id uuid, subject_client_id uuid REFERENCES clients(id) ON DELETE RESTRICT,
  subject_email_hash varchar(64), status varchar(50) NOT NULL DEFAULT 'RECEIVED', identity_verification_status varchar(30) NOT NULL DEFAULT 'REQUIRED',
  assigned_agency_user_id uuid REFERENCES agency_users(id) ON DELETE SET NULL, request_notes text,
  due_at timestamptz NOT NULL, completed_at timestamptz, failure_reason varchar(500), decision_reason varchar(1000),
  deletion_strategy varchar(30), scheduled_for timestamptz, legal_hold_checked_at timestamptz, retention_exception jsonb,
  created_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT privacy_requests_type_check CHECK (request_type IN ('ACCESS','DELETION')),
  CONSTRAINT privacy_requests_status_check CHECK (status IN ('RECEIVED','IDENTITY_VERIFICATION_REQUIRED','IN_REVIEW','PROCESSING','READY_FOR_DOWNLOAD','APPROVED','SCHEDULED','COMPLETED','REJECTED','CANCELLED','FAILED')),
  CONSTRAINT privacy_requests_strategy_check CHECK (deletion_strategy IS NULL OR deletion_strategy IN ('DEACTIVATE','SOFT_DELETE','HARD_DELETE','ANONYMISE','PSEUDONYMISE','RETAIN')),
  CONSTRAINT privacy_requests_subject_check CHECK (subject_auth_user_id IS NOT NULL OR subject_client_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS privacy_requests_queue_idx ON privacy_requests(status,due_at,id);
CREATE INDEX IF NOT EXISTS privacy_requests_subject_idx ON privacy_requests(tenant_id,subject_auth_user_id,subject_client_id,created_at DESC);

CREATE TABLE IF NOT EXISTS privacy_export_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE REFERENCES privacy_requests(id) ON DELETE CASCADE,
  storage_path varchar(1000) NOT NULL, format varchar(20) NOT NULL, byte_size integer NOT NULL,
  checksum_sha256 varchar(64) NOT NULL, expires_at timestamptz NOT NULL, downloaded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT privacy_export_format_check CHECK (format IN ('JSON','ZIP'))
);
CREATE INDEX IF NOT EXISTS privacy_export_expiry_idx ON privacy_export_artifacts(expires_at);

CREATE TABLE IF NOT EXISTS legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  subject_auth_user_id uuid, subject_client_id uuid REFERENCES clients(id) ON DELETE RESTRICT,
  reason varchar(1000) NOT NULL, legal_basis varchar(500) NOT NULL, status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, released_at timestamptz,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  released_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_holds_status_check CHECK (status IN ('ACTIVE','RELEASED')),
  CONSTRAINT legal_holds_subject_check CHECK (tenant_id IS NOT NULL OR subject_auth_user_id IS NOT NULL OR subject_client_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS legal_holds_active_subject_idx ON legal_holds(status,tenant_id,subject_auth_user_id,subject_client_id) WHERE status='ACTIVE';

CREATE TABLE IF NOT EXISTS retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT, data_category varchar(100) NOT NULL,
  retention_days integer NOT NULL, retention_trigger varchar(80) NOT NULL, expiry_action varchar(30) NOT NULL,
  legal_basis varchar(500) NOT NULL, jurisdiction varchar(80), enabled boolean NOT NULL DEFAULT false, dry_run boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  last_executed_at timestamptz, next_execution_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_days_check CHECK (retention_days BETWEEN 1 AND 36500),
  CONSTRAINT retention_action_check CHECK (expiry_action IN ('DELETE','ANONYMISE','ARCHIVE','REVIEW_MANUALLY','RETAIN_LEGAL_HOLD')),
  CONSTRAINT retention_policy_scope_unique UNIQUE(tenant_id,data_category,version)
);
CREATE INDEX IF NOT EXISTS retention_policies_due_idx ON retention_policies(enabled,next_execution_at) WHERE enabled=true;

CREATE TABLE IF NOT EXISTS retention_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_id uuid NOT NULL REFERENCES retention_policies(id) ON DELETE RESTRICT,
  version integer NOT NULL, snapshot jsonb NOT NULL, approved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT retention_policy_version_unique UNIQUE(policy_id,version)
);

CREATE TABLE IF NOT EXISTS retention_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_id uuid NOT NULL REFERENCES retention_policies(id) ON DELETE RESTRICT,
  idempotency_key varchar(160) NOT NULL UNIQUE, status varchar(20) NOT NULL DEFAULT 'QUEUED', dry_run boolean NOT NULL,
  scanned_count integer NOT NULL DEFAULT 0, affected_count integer NOT NULL DEFAULT 0, skipped_legal_hold_count integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}'::jsonb, failure_code varchar(100), started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_run_status_check CHECK (status IN ('QUEUED','PROCESSING','SUCCEEDED','FAILED'))
);
CREATE INDEX IF NOT EXISTS retention_runs_queue_idx ON retention_runs(status,created_at,id);

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_export_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON consent_records,privacy_requests,privacy_export_artifacts,legal_holds,retention_policies,retention_policy_versions,retention_runs FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON consent_records,privacy_requests,privacy_export_artifacts,legal_holds,retention_policies,retention_policy_versions,retention_runs TO service_role;

CREATE OR REPLACE FUNCTION prevent_compliance_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; create a new version instead', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS consent_records_append_only ON consent_records;
CREATE TRIGGER consent_records_append_only
BEFORE UPDATE OR DELETE ON consent_records
FOR EACH ROW EXECUTE FUNCTION prevent_compliance_history_mutation();

DROP TRIGGER IF EXISTS retention_policy_versions_append_only ON retention_policy_versions;
CREATE TRIGGER retention_policy_versions_append_only
BEFORE UPDATE OR DELETE ON retention_policy_versions
FOR EACH ROW EXECUTE FUNCTION prevent_compliance_history_mutation();

COMMENT ON TABLE consent_records IS 'Append-only consent evidence. Withdrawals create new records; history is never overwritten.';
COMMENT ON TABLE privacy_requests IS 'Audited subject-access and deletion workflow; contains identifiers, never export payloads.';
COMMENT ON TABLE legal_holds IS 'Active holds block privacy deletion and retention processing.';
