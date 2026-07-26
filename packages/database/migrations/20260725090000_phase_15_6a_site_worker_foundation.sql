BEGIN;

-- Phase 15.6A extends the existing Phase 15 site_jobs queue. It deliberately
-- keeps ownership-critical references relational and stores only validated
-- structured payload/result documents in JSONB.
ALTER TABLE site_jobs
  ADD COLUMN IF NOT EXISTS blueprint_id uuid REFERENCES site_blueprints(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_reference varchar(255),
  ADD COLUMN IF NOT EXISTS source_digest_sha256 varchar(64),
  ADD COLUMN IF NOT EXISTS payload_schema_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_owner varchar(255),
  ADD COLUMN IF NOT EXISTS lease_token_digest varchar(64),
  ADD COLUMN IF NOT EXISTS leased_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS progress_current integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_total integer,
  ADD COLUMN IF NOT EXISTS progress_message varchar(300),
  ADD COLUMN IF NOT EXISTS failure_message varchar(500),
  ADD COLUMN IF NOT EXISTS retryable boolean,
  ADD COLUMN IF NOT EXISTS created_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cancelled_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

UPDATE site_jobs
SET scheduled_for = available_at
WHERE scheduled_for IS NULL;

CREATE TABLE IF NOT EXISTS site_job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES site_jobs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL,
  worker_id varchar(255) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome varchar(30) NOT NULL DEFAULT 'PROCESSING',
  failure_code varchar(100),
  retryable boolean,
  duration_ms integer,
  safe_result_summary varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_job_attempts_job_attempt_unique
    UNIQUE(job_id, attempt_number),
  CONSTRAINT site_job_attempts_attempt_positive
    CHECK(attempt_number > 0),
  CONSTRAINT site_job_attempts_duration_nonnegative
    CHECK(duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT site_job_attempts_outcome_valid
    CHECK(outcome IN (
      'PROCESSING', 'COMPLETED', 'RETRY_SCHEDULED',
      'FAILED', 'CANCELLED', 'LEASE_EXPIRED'
    ))
);

CREATE TABLE IF NOT EXISTS site_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES site_jobs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type varchar(50) NOT NULL,
  status_from varchar(20),
  status_to varchar(20),
  attempt_number integer,
  worker_id varchar(255),
  failure_code varchar(100),
  safe_message varchar(500),
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_job_events_attempt_positive
    CHECK(attempt_number IS NULL OR attempt_number > 0),
  CONSTRAINT site_job_events_metadata_object
    CHECK(jsonb_typeof(safe_metadata_json) = 'object'),
  CONSTRAINT site_job_events_type_valid
    CHECK(event_type IN (
      'JOB_CREATED', 'JOB_SCHEDULED', 'JOB_LEASED', 'JOB_STARTED',
      'JOB_PROGRESS_UPDATED', 'JOB_HEARTBEAT', 'JOB_RETRY_SCHEDULED',
      'JOB_COMPLETED', 'JOB_FAILED', 'JOB_CANCEL_REQUESTED',
      'JOB_CANCELLED', 'JOB_RETRIED_MANUALLY', 'JOB_LEASE_EXPIRED',
      'JOB_MOVED_TO_DEAD_LETTER'
    ))
);

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_jobs_status_valid'
      AND conrelid = 'site_jobs'::regclass
  ) THEN
    ALTER TABLE site_jobs
      ADD CONSTRAINT site_jobs_status_valid CHECK(status IN (
        'PENDING', 'SCHEDULED', 'LEASED', 'PROCESSING', 'RETRY_DELAY',
        'COMPLETED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'DEAD_LETTER'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_jobs_type_valid'
      AND conrelid = 'site_jobs'::regclass
  ) THEN
    ALTER TABLE site_jobs
      ADD CONSTRAINT site_jobs_type_valid CHECK(job_type IN (
        'IMPORT_TEMPLATE', 'CLASSIFY_TEMPLATE', 'CREATE_BLUEPRINT',
        'GENERATE_SITE', 'GENERATE_PAGE', 'REGENERATE_SECTION',
        'GENERATE_METADATA', 'GENERATE_STRUCTURED_DATA', 'OPTIMISE_IMAGE',
        'RUN_SEO_AUDIT', 'RUN_UX_AUDIT', 'RUN_ACCESSIBILITY_AUDIT',
        'RUN_CONVERSION_AUDIT', 'CREATE_SITE_SNAPSHOT',
        'PREPARE_PUBLICATION', 'VERIFY_DOMAIN', 'SYNC_ANALYTICS',
        'CHECK_BOOKING_LINKS', 'GENERATE_MONTHLY_PAGE_OPPORTUNITIES',
        'GENERATE_MONTHLY_PAGE', 'TEST_SUCCEED',
        'TEST_RETRYABLE_FAILURE', 'TEST_TERMINAL_FAILURE',
        'TEST_LONG_RUNNING', 'TEST_CANCELLABLE'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_jobs_payload_object'
      AND conrelid = 'site_jobs'::regclass
  ) THEN
    ALTER TABLE site_jobs
      ADD CONSTRAINT site_jobs_payload_object
      CHECK(jsonb_typeof(payload_json) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_jobs_result_object'
      AND conrelid = 'site_jobs'::regclass
  ) THEN
    ALTER TABLE site_jobs
      ADD CONSTRAINT site_jobs_result_object
      CHECK(jsonb_typeof(result_json) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_jobs_retry_progress_valid'
      AND conrelid = 'site_jobs'::regclass
  ) THEN
    ALTER TABLE site_jobs
      ADD CONSTRAINT site_jobs_retry_progress_valid CHECK(
        payload_schema_version > 0
        AND priority BETWEEN 0 AND 1000
        AND attempt_count >= 0
        AND max_attempts BETWEEN 1 AND 25
        AND progress_current >= 0
        AND (progress_total IS NULL OR (
          progress_total > 0 AND progress_current <= progress_total
        ))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_jobs_digest_valid'
      AND conrelid = 'site_jobs'::regclass
  ) THEN
    ALTER TABLE site_jobs
      ADD CONSTRAINT site_jobs_digest_valid CHECK(
        (source_digest_sha256 IS NULL
          OR source_digest_sha256 ~ '^[a-f0-9]{64}$')
        AND (lease_token_digest IS NULL
          OR lease_token_digest ~ '^[a-f0-9]{64}$')
      );
  END IF;
END
$constraints$;

-- The partial queue index mirrors the worker's eligibility predicate and stays
-- small after jobs reach terminal states.
CREATE INDEX IF NOT EXISTS site_jobs_worker_queue_idx
  ON site_jobs(priority DESC, available_at, created_at, id)
  WHERE status IN ('PENDING', 'SCHEDULED', 'RETRY_DELAY');

CREATE INDEX IF NOT EXISTS site_jobs_expired_lease_idx
  ON site_jobs(lease_expires_at, created_at, id)
  WHERE status IN ('LEASED', 'PROCESSING', 'CANCEL_REQUESTED');

CREATE INDEX IF NOT EXISTS site_jobs_tenant_active_idx
  ON site_jobs(tenant_id, status, lease_expires_at)
  WHERE status IN ('LEASED', 'PROCESSING', 'CANCEL_REQUESTED');

CREATE INDEX IF NOT EXISTS site_jobs_type_status_available_idx
  ON site_jobs(job_type, status, available_at);
CREATE INDEX IF NOT EXISTS site_jobs_blueprint_idx ON site_jobs(blueprint_id);
CREATE INDEX IF NOT EXISTS site_jobs_created_by_idx
  ON site_jobs(created_by_agency_user_id);
CREATE INDEX IF NOT EXISTS site_jobs_cancelled_by_idx
  ON site_jobs(cancelled_by_agency_user_id);
CREATE INDEX IF NOT EXISTS site_job_attempts_tenant_started_idx
  ON site_job_attempts(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS site_job_attempts_worker_started_idx
  ON site_job_attempts(worker_id, started_at DESC);
CREATE INDEX IF NOT EXISTS site_job_events_job_occurred_idx
  ON site_job_events(job_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS site_job_events_tenant_occurred_idx
  ON site_job_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS site_job_events_type_occurred_idx
  ON site_job_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS site_job_events_created_by_idx
  ON site_job_events(created_by_agency_user_id);

CREATE OR REPLACE FUNCTION validate_site_job_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sites
    WHERE id = NEW.site_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Site job site ownership mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_versions
    WHERE id = NEW.version_id
      AND site_id = NEW.site_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Site job version ownership mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.blueprint_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_blueprints
    WHERE id = NEW.blueprint_id
      AND site_id = NEW.site_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Site job blueprint ownership mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.version_id IS DISTINCT FROM OLD.version_id
    OR NEW.blueprint_id IS DISTINCT FROM OLD.blueprint_id
    OR NEW.job_type IS DISTINCT FROM OLD.job_type
    OR NEW.payload_json IS DISTINCT FROM OLD.payload_json
    OR NEW.payload_schema_version IS DISTINCT FROM OLD.payload_schema_version
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
    OR NEW.source_digest_sha256 IS DISTINCT FROM OLD.source_digest_sha256
  ) THEN
    RAISE EXCEPTION 'Site job identity and payload fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION enforce_site_job_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  allowed boolean := false;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'PENDING' THEN NEW.status IN ('LEASED', 'CANCELLED')
    WHEN 'SCHEDULED' THEN NEW.status IN ('LEASED', 'CANCELLED')
    WHEN 'LEASED' THEN NEW.status IN (
      'PROCESSING', 'RETRY_DELAY', 'FAILED', 'CANCEL_REQUESTED',
      'CANCELLED', 'DEAD_LETTER'
    )
    WHEN 'PROCESSING' THEN NEW.status IN (
      'LEASED', 'COMPLETED', 'RETRY_DELAY', 'FAILED',
      'CANCEL_REQUESTED', 'CANCELLED', 'DEAD_LETTER'
    )
    WHEN 'RETRY_DELAY' THEN NEW.status IN ('LEASED', 'CANCELLED')
    WHEN 'FAILED' THEN NEW.status = 'PENDING'
    WHEN 'CANCEL_REQUESTED' THEN NEW.status IN (
      'LEASED', 'CANCELLED', 'COMPLETED', 'FAILED', 'DEAD_LETTER'
    )
    WHEN 'DEAD_LETTER' THEN NEW.status = 'PENDING'
    ELSE false
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid site job transition: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION validate_site_job_child_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM site_jobs
    WHERE id = NEW.job_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Site job history ownership mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
  ) THEN
    RAISE EXCEPTION 'Site job attempt ownership is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION prevent_site_job_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'Site job events are append-only'
    USING ERRCODE = '23514';
END
$function$;

DROP TRIGGER IF EXISTS site_jobs_validate_ownership ON site_jobs;
CREATE TRIGGER site_jobs_validate_ownership
  BEFORE INSERT OR UPDATE ON site_jobs
  FOR EACH ROW EXECUTE FUNCTION validate_site_job_ownership();

DROP TRIGGER IF EXISTS site_jobs_enforce_status_transition ON site_jobs;
CREATE TRIGGER site_jobs_enforce_status_transition
  BEFORE UPDATE OF status ON site_jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_site_job_status_transition();

DROP TRIGGER IF EXISTS site_job_attempts_validate_ownership
  ON site_job_attempts;
CREATE TRIGGER site_job_attempts_validate_ownership
  BEFORE INSERT OR UPDATE ON site_job_attempts
  FOR EACH ROW EXECUTE FUNCTION validate_site_job_child_ownership();

DROP TRIGGER IF EXISTS site_job_events_validate_ownership
  ON site_job_events;
CREATE TRIGGER site_job_events_validate_ownership
  BEFORE INSERT ON site_job_events
  FOR EACH ROW EXECUTE FUNCTION validate_site_job_child_ownership();

DROP TRIGGER IF EXISTS site_job_events_prevent_update
  ON site_job_events;
CREATE TRIGGER site_job_events_prevent_update
  BEFORE UPDATE ON site_job_events
  FOR EACH ROW EXECUTE FUNCTION prevent_site_job_event_mutation();

DROP TRIGGER IF EXISTS site_job_events_prevent_delete
  ON site_job_events;
CREATE TRIGGER site_job_events_prevent_delete
  BEFORE DELETE ON site_job_events
  FOR EACH ROW EXECUTE FUNCTION prevent_site_job_event_mutation();

ALTER TABLE site_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_job_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE site_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE site_job_attempts FROM anon, authenticated;
REVOKE ALL ON TABLE site_job_events FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE site_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE site_job_attempts TO service_role;
GRANT SELECT, INSERT ON TABLE site_job_events TO service_role;

REVOKE EXECUTE ON FUNCTION validate_site_job_ownership()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION enforce_site_job_status_transition()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION validate_site_job_child_ownership()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION prevent_site_job_event_mutation()
  FROM PUBLIC, anon, authenticated;

COMMIT;
