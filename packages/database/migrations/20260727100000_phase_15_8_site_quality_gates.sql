-- Phase 15.8: exact-version SEO, UX, accessibility, conversion, booking,
-- content, asset and publication-readiness quality gates.
-- Additive only. This migration does not publish, deploy, configure domains,
-- invoke providers, or expose quality/security evidence to browser roles.

ALTER TABLE site_jobs DROP CONSTRAINT IF EXISTS site_jobs_type_valid;
ALTER TABLE site_jobs
  ADD CONSTRAINT site_jobs_type_valid CHECK(job_type IN (
    'PROVISION_WORKSPACE','IMPORT_TEMPLATE','CLASSIFY_TEMPLATE',
    'CREATE_BLUEPRINT','GENERATE_SITE','GENERATE_PAGE',
    'REGENERATE_SECTION','GENERATE_METADATA','GENERATE_STRUCTURED_DATA',
    'OPTIMISE_IMAGE','RUN_SEO_AUDIT','RUN_UX_AUDIT',
    'RUN_ACCESSIBILITY_AUDIT','RUN_CONVERSION_AUDIT',
    'RUN_FULL_SITE_QUALITY_AUDIT','RUN_TECHNICAL_SEO_AUDIT',
    'RUN_RESPONSIVE_UX_AUDIT','RUN_BOOKING_INTEGRITY_AUDIT',
    'RUN_PERFORMANCE_AUDIT','RUN_CONTENT_INTEGRITY_AUDIT',
    'RUN_ASSET_READINESS_AUDIT','EVALUATE_PUBLICATION_READINESS',
    'CREATE_SITE_SNAPSHOT','PREPARE_PUBLICATION','VERIFY_DOMAIN',
    'SYNC_ANALYTICS','CHECK_BOOKING_LINKS',
    'GENERATE_MONTHLY_PAGE_OPPORTUNITIES','GENERATE_MONTHLY_PAGE',
    'TEST_SUCCEED','TEST_RETRYABLE_FAILURE','TEST_TERMINAL_FAILURE',
    'TEST_LONG_RUNNING','TEST_CANCELLABLE'
  ));

CREATE TABLE IF NOT EXISTS site_quality_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  site_version_digest_sha256 varchar(64) NOT NULL,
  generation_run_id uuid REFERENCES site_generation_runs(id) ON DELETE RESTRICT,
  review_cycle_id uuid REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  knowledge_pack_semantic_version varchar(40) NOT NULL,
  knowledge_pack_digest_sha256 varchar(64) NOT NULL,
  applicable_rule_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  applicable_page_playbooks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  applicable_section_playbooks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  rule_selection_digest_sha256 varchar(64) NOT NULL,
  audit_type varchar(50) NOT NULL CHECK (audit_type IN (
    'FULL_SITE_QUALITY','TECHNICAL_SEO','ON_PAGE_SEO','LOCAL_SEO',
    'STRUCTURED_DATA','ACCESSIBILITY','RESPONSIVE_UX','CONVERSION',
    'BOOKING_INTEGRITY','CONTENT_INTEGRITY','PERFORMANCE',
    'INTERNAL_LINKING','ASSET_READINESS','PUBLICATION_READINESS'
  )),
  audit_reason varchar(40) NOT NULL CHECK (audit_reason IN (
    'PRE_INTERNAL_REVIEW','PRE_CLIENT_REVIEW','PRE_PUBLICATION',
    'MANUAL_RECHECK','POST_REMEDIATION'
  )),
  status varchar(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','PREPARING','RENDERING','RUNNING_DETERMINISTIC_CHECKS',
    'RUNNING_BROWSER_CHECKS','RUNNING_AI_REVIEW','EVALUATING','READY',
    'FAILED','CANCEL_REQUESTED','CANCELLED','SUPERSEDED'
  )),
  policy_version varchar(80) NOT NULL,
  renderer_version varchar(80) NOT NULL,
  quality_engine_version varchar(80) NOT NULL,
  preview_reference uuid,
  site_job_id uuid REFERENCES site_jobs(id) ON DELETE RESTRICT,
  idempotency_key varchar(300) NOT NULL,
  page_count_planned integer NOT NULL DEFAULT 0 CHECK (page_count_planned >= 0),
  page_count_completed integer NOT NULL DEFAULT 0 CHECK (
    page_count_completed >= 0 AND page_count_completed <= page_count_planned
  ),
  check_count integer NOT NULL DEFAULT 0 CHECK (check_count >= 0),
  passed_check_count integer NOT NULL DEFAULT 0 CHECK (passed_check_count >= 0),
  warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  blocking_count integer NOT NULL DEFAULT 0 CHECK (blocking_count >= 0),
  waived_count integer NOT NULL DEFAULT 0 CHECK (waived_count >= 0),
  non_waivable_count integer NOT NULL DEFAULT 0 CHECK (non_waivable_count >= 0),
  publication_gate_status varchar(30) NOT NULL DEFAULT 'NOT_EVALUATED'
    CHECK (publication_gate_status IN (
      'NOT_EVALUATED','BLOCKED','READY_WITH_WARNINGS','READY','STALE'
    )),
  failure_code varchar(100),
  failure_message varchar(500),
  requested_by_agency_user_id uuid NOT NULL
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  cancelled_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  stale_at timestamptz,
  stale_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, idempotency_key),
  CHECK (site_version_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (knowledge_pack_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (rule_selection_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (jsonb_typeof(applicable_rule_ids_json) = 'array'),
  CHECK (jsonb_typeof(applicable_page_playbooks_json) = 'array'),
  CHECK (jsonb_typeof(applicable_section_playbooks_json) = 'array'),
  CHECK (passed_check_count <= check_count),
  CHECK (status <> 'READY' OR completed_at IS NOT NULL),
  CHECK (status <> 'FAILED' OR (failed_at IS NOT NULL AND failure_code IS NOT NULL)),
  CHECK (publication_gate_status <> 'READY' OR status = 'READY')
);
CREATE INDEX IF NOT EXISTS site_quality_runs_site_version_created_idx
  ON site_quality_runs(tenant_id, site_id, site_version_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS site_quality_runs_status_created_idx
  ON site_quality_runs(status, created_at, id);
CREATE INDEX IF NOT EXISTS site_quality_runs_pack_idx
  ON site_quality_runs(knowledge_pack_id, knowledge_pack_semantic_version);
CREATE INDEX IF NOT EXISTS site_quality_runs_review_idx
  ON site_quality_runs(review_cycle_id) WHERE review_cycle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_quality_runs_job_idx
  ON site_quality_runs(site_job_id) WHERE site_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_quality_runs_site_idx
  ON site_quality_runs(site_id);
CREATE INDEX IF NOT EXISTS site_quality_runs_version_idx
  ON site_quality_runs(site_version_id);
CREATE INDEX IF NOT EXISTS site_quality_runs_generation_idx
  ON site_quality_runs(generation_run_id) WHERE generation_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_quality_runs_requested_by_idx
  ON site_quality_runs(requested_by_agency_user_id);
CREATE INDEX IF NOT EXISTS site_quality_runs_cancelled_by_idx
  ON site_quality_runs(cancelled_by_agency_user_id)
  WHERE cancelled_by_agency_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_quality_page_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  quality_run_id uuid NOT NULL REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  page_id uuid NOT NULL REFERENCES site_pages(id) ON DELETE RESTRICT,
  page_content_digest_sha256 varchar(64) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','RENDERING','CHECKING','READY','FAILED','CANCELLED','SUPERSEDED'
  )),
  viewport_results_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  check_count integer NOT NULL DEFAULT 0 CHECK (check_count >= 0),
  blocking_count integer NOT NULL DEFAULT 0 CHECK (blocking_count >= 0),
  warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  failure_code varchar(100),
  safe_failure_message varchar(500),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(quality_run_id, page_id),
  CHECK (page_content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (jsonb_typeof(viewport_results_json) = 'object')
);
CREATE INDEX IF NOT EXISTS site_quality_page_runs_run_status_idx
  ON site_quality_page_runs(quality_run_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS site_quality_page_runs_tenant_page_idx
  ON site_quality_page_runs(tenant_id, page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_quality_page_runs_site_idx
  ON site_quality_page_runs(site_id);
CREATE INDEX IF NOT EXISTS site_quality_page_runs_version_idx
  ON site_quality_page_runs(site_version_id);
CREATE INDEX IF NOT EXISTS site_quality_page_runs_page_idx
  ON site_quality_page_runs(page_id);

CREATE TABLE IF NOT EXISTS site_quality_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  quality_run_id uuid NOT NULL REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  page_run_id uuid REFERENCES site_quality_page_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  check_id varchar(120) NOT NULL,
  category varchar(60) NOT NULL,
  validation_method varchar(30) NOT NULL CHECK (validation_method IN (
    'DETERMINISTIC','RENDERED_BROWSER','AI_REVIEW','HUMAN_REVIEW',
    'DATA_REQUIRED','MIXED'
  )),
  severity varchar(20) NOT NULL CHECK (severity IN ('INFO','WARNING','BLOCKING')),
  publication_effect varchar(20) NOT NULL CHECK (
    publication_effect IN ('BLOCK','WARNING','RECOMMENDATION')
  ),
  waivable boolean NOT NULL DEFAULT false,
  result varchar(30) NOT NULL CHECK (result IN (
    'PASS','FAIL','WARNING','NOT_APPLICABLE','DATA_REQUIRED','ERROR'
  )),
  rule_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_digest_sha256 varchar(64),
  safe_summary varchar(1000) NOT NULL,
  engine_version varchar(80) NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(quality_run_id, page_run_id, check_id),
  CHECK (check_id ~ '^KSQ_[A-Z0-9_]{3,100}$'),
  CHECK (jsonb_typeof(rule_ids_json) = 'array'),
  CHECK (evidence_digest_sha256 IS NULL OR evidence_digest_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS site_quality_checks_run_result_idx
  ON site_quality_checks(quality_run_id, result, category, check_id);
CREATE INDEX IF NOT EXISTS site_quality_checks_page_idx
  ON site_quality_checks(page_run_id, result) WHERE page_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_quality_checks_tenant_idx
  ON site_quality_checks(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS site_quality_checks_run_level_unique
  ON site_quality_checks(quality_run_id, check_id)
  WHERE page_run_id IS NULL;

CREATE TABLE IF NOT EXISTS site_quality_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  quality_run_id uuid NOT NULL REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  quality_check_id uuid NOT NULL REFERENCES site_quality_checks(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  page_id uuid REFERENCES site_pages(id) ON DELETE RESTRICT,
  section_id uuid REFERENCES site_sections(id) ON DELETE RESTRICT,
  field_path varchar(500),
  booking_action_reference uuid,
  check_id varchar(120) NOT NULL,
  category varchar(60) NOT NULL,
  severity varchar(20) NOT NULL CHECK (severity IN ('INFO','WARNING','BLOCKING')),
  publication_effect varchar(20) NOT NULL CHECK (
    publication_effect IN ('BLOCK','WARNING','RECOMMENDATION')
  ),
  waivable boolean NOT NULL DEFAULT false,
  rule_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  code varchar(120) NOT NULL,
  safe_message varchar(1000) NOT NULL,
  evidence_summary varchar(1000) NOT NULL,
  remediation_guidance varchar(1000) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN','ACKNOWLEDGED','IN_REMEDIATION','RESOLVED','WAIVED',
    'NOT_APPLICABLE','SUPERSEDED'
  )),
  content_digest_sha256 varchar(64) NOT NULL,
  evidence_digest_sha256 varchar(64),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  resolved_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  resolution_note varchar(1000),
  waived_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (check_id ~ '^KSQ_[A-Z0-9_]{3,100}$'),
  CHECK (code ~ '^[A-Z][A-Z0-9_]{2,100}$'),
  CHECK (jsonb_typeof(rule_ids_json) = 'array'),
  CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (evidence_digest_sha256 IS NULL OR evidence_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (section_id IS NULL OR page_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS site_quality_findings_run_current_idx
  ON site_quality_findings(
    quality_run_id, status, publication_effect, severity, created_at, id
  );
CREATE INDEX IF NOT EXISTS site_quality_findings_site_version_idx
  ON site_quality_findings(tenant_id, site_id, site_version_id, status, code);
CREATE INDEX IF NOT EXISTS site_quality_findings_page_idx
  ON site_quality_findings(page_id, status) WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_quality_findings_section_idx
  ON site_quality_findings(section_id, status) WHERE section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_quality_findings_check_idx
  ON site_quality_findings(quality_check_id);
CREATE INDEX IF NOT EXISTS site_quality_findings_site_idx
  ON site_quality_findings(site_id);
CREATE INDEX IF NOT EXISTS site_quality_findings_version_idx
  ON site_quality_findings(site_version_id);
CREATE INDEX IF NOT EXISTS site_quality_findings_acknowledged_by_idx
  ON site_quality_findings(acknowledged_by_agency_user_id)
  WHERE acknowledged_by_agency_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_quality_findings_resolved_by_idx
  ON site_quality_findings(resolved_by_agency_user_id)
  WHERE resolved_by_agency_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_quality_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  quality_run_id uuid NOT NULL REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  quality_check_id uuid REFERENCES site_quality_checks(id) ON DELETE RESTRICT,
  finding_id uuid REFERENCES site_quality_findings(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  page_id uuid REFERENCES site_pages(id) ON DELETE RESTRICT,
  evidence_type varchar(40) NOT NULL CHECK (evidence_type IN (
    'STRUCTURED_RESULT','BROWSER_SUMMARY','SCREENSHOT_REFERENCE',
    'ACCESSIBILITY_RESULT','PERFORMANCE_METRIC','BOOKING_RESULT',
    'HUMAN_DECISION','AI_REVIEW_RESULT'
  )),
  viewport varchar(30) CHECK (viewport IS NULL OR viewport IN (
    'SMALL_MOBILE','STANDARD_MOBILE','TABLET_PORTRAIT','DESKTOP','WIDE_DESKTOP'
  )),
  content_digest_sha256 varchar(64) NOT NULL,
  evidence_digest_sha256 varchar(64) NOT NULL,
  safe_summary varchar(1000) NOT NULL,
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_reference varchar(1000),
  tool_version varchar(120),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (evidence_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (jsonb_typeof(safe_metadata_json) = 'object')
);
CREATE INDEX IF NOT EXISTS site_quality_evidence_run_check_idx
  ON site_quality_evidence(quality_run_id, quality_check_id, captured_at, id);
CREATE INDEX IF NOT EXISTS site_quality_evidence_finding_idx
  ON site_quality_evidence(finding_id, captured_at, id) WHERE finding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_quality_evidence_page_viewport_idx
  ON site_quality_evidence(page_id, viewport, captured_at) WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_quality_evidence_check_idx
  ON site_quality_evidence(quality_check_id)
  WHERE quality_check_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_quality_evidence_tenant_idx
  ON site_quality_evidence(tenant_id);

CREATE TABLE IF NOT EXISTS site_quality_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES site_quality_findings(id) ON DELETE RESTRICT,
  quality_run_id uuid NOT NULL REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  content_digest_sha256 varchar(64) NOT NULL,
  evidence_digest_sha256 varchar(64),
  rule_id varchar(120) NOT NULL,
  policy_version varchar(80) NOT NULL,
  knowledge_pack_digest_sha256 varchar(64) NOT NULL,
  reason varchar(2000) NOT NULL,
  risk_acceptance varchar(2000) NOT NULL,
  approved_by_agency_user_id uuid NOT NULL
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  revoked_reason varchar(1000),
  invalidated_at timestamptz,
  invalidated_reason varchar(1000),
  CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (evidence_digest_sha256 IS NULL OR evidence_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (knowledge_pack_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (length(reason) >= 20),
  CHECK (length(risk_acceptance) >= 20),
  CHECK (revoked_at IS NULL OR revoked_reason IS NOT NULL),
  CHECK (invalidated_at IS NULL OR invalidated_reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS site_quality_waivers_active_finding_unique
  ON site_quality_waivers(finding_id)
  WHERE revoked_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS site_quality_waivers_run_current_idx
  ON site_quality_waivers(quality_run_id, expires_at, created_at DESC);
CREATE INDEX IF NOT EXISTS site_quality_waivers_approver_idx
  ON site_quality_waivers(approved_by_agency_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_quality_waivers_tenant_idx
  ON site_quality_waivers(tenant_id);
CREATE INDEX IF NOT EXISTS site_quality_waivers_site_idx
  ON site_quality_waivers(site_id);
CREATE INDEX IF NOT EXISTS site_quality_waivers_version_idx
  ON site_quality_waivers(site_version_id);
CREATE INDEX IF NOT EXISTS site_quality_waivers_revoked_by_idx
  ON site_quality_waivers(revoked_by_agency_user_id)
  WHERE revoked_by_agency_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_quality_human_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  quality_run_id uuid NOT NULL REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  quality_check_id uuid NOT NULL REFERENCES site_quality_checks(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  content_digest_sha256 varchar(64) NOT NULL,
  decision varchar(30) NOT NULL CHECK (decision IN ('PASS','FAIL','DATA_REQUIRED')),
  notes varchar(2000) NOT NULL,
  decided_by_agency_user_id uuid NOT NULL
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  invalidated_reason varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(quality_run_id, quality_check_id),
  CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (length(notes) >= 8),
  CHECK (invalidated_at IS NULL OR invalidated_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS site_quality_human_reviews_run_decision_idx
  ON site_quality_human_reviews(quality_run_id, decision, decided_at);
CREATE INDEX IF NOT EXISTS site_quality_human_reviews_reviewer_idx
  ON site_quality_human_reviews(decided_by_agency_user_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS site_quality_human_reviews_check_idx
  ON site_quality_human_reviews(quality_check_id);
CREATE INDEX IF NOT EXISTS site_quality_human_reviews_tenant_idx
  ON site_quality_human_reviews(tenant_id);
CREATE INDEX IF NOT EXISTS site_quality_human_reviews_version_idx
  ON site_quality_human_reviews(site_version_id);

CREATE TABLE IF NOT EXISTS site_quality_remediation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  quality_run_id uuid NOT NULL REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  finding_id uuid NOT NULL REFERENCES site_quality_findings(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type varchar(60) NOT NULL CHECK (event_type IN (
    'ACKNOWLEDGED','CHANGE_REQUEST_CREATED','REGENERATION_REQUESTED',
    'CANONICAL_DATA_CORRECTION_REQUESTED','ASSET_REPLACEMENT_REQUESTED',
    'HUMAN_REVIEW_COMPLETED','RESOLVED','REOPENED','WAIVER_CREATED',
    'WAIVER_REVOKED','WAIVER_INVALIDATED','REAUDIT_REQUESTED'
  )),
  status_from varchar(30),
  status_to varchar(30) NOT NULL,
  related_public_reference uuid,
  safe_message varchar(1000) NOT NULL,
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(safe_metadata_json) = 'object')
);
CREATE INDEX IF NOT EXISTS site_quality_remediation_events_finding_idx
  ON site_quality_remediation_events(finding_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS site_quality_remediation_events_run_idx
  ON site_quality_remediation_events(quality_run_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS site_quality_remediation_events_tenant_idx
  ON site_quality_remediation_events(tenant_id);
CREATE INDEX IF NOT EXISTS site_quality_remediation_events_actor_idx
  ON site_quality_remediation_events(agency_user_id);

CREATE TABLE IF NOT EXISTS site_quality_run_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  left_quality_run_id uuid NOT NULL REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  right_quality_run_id uuid NOT NULL REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  comparison_engine_version varchar(80) NOT NULL,
  comparison_digest_sha256 varchar(64) NOT NULL,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by_agency_user_id uuid NOT NULL
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(left_quality_run_id, right_quality_run_id, comparison_engine_version),
  CHECK (left_quality_run_id <> right_quality_run_id),
  CHECK (comparison_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (jsonb_typeof(summary_json) = 'object')
);
CREATE INDEX IF NOT EXISTS site_quality_run_comparisons_site_idx
  ON site_quality_run_comparisons(tenant_id, site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_quality_run_comparisons_site_fk_idx
  ON site_quality_run_comparisons(site_id);
CREATE INDEX IF NOT EXISTS site_quality_run_comparisons_right_run_idx
  ON site_quality_run_comparisons(right_quality_run_id);
CREATE INDEX IF NOT EXISTS site_quality_run_comparisons_requested_by_idx
  ON site_quality_run_comparisons(requested_by_agency_user_id);

CREATE TABLE IF NOT EXISTS site_quality_audit_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  quality_run_id uuid NOT NULL UNIQUE REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  token_jti uuid NOT NULL UNIQUE,
  token_digest_sha256 varchar(64) NOT NULL UNIQUE,
  content_digest_sha256 varchar(64) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','REVOKED','EXPIRED','COMPLETED')),
  expires_at timestamptz NOT NULL,
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (token_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS site_quality_audit_sessions_active_digest_idx
  ON site_quality_audit_sessions(token_digest_sha256, expires_at)
  WHERE status = 'ACTIVE' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS site_quality_audit_sessions_scope_idx
  ON site_quality_audit_sessions(tenant_id, site_id, site_version_id, expires_at);
CREATE INDEX IF NOT EXISTS site_quality_audit_sessions_site_idx
  ON site_quality_audit_sessions(site_id);
CREATE INDEX IF NOT EXISTS site_quality_audit_sessions_version_idx
  ON site_quality_audit_sessions(site_version_id);

CREATE OR REPLACE FUNCTION ks_validate_site_quality_run_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.site_version_id IS DISTINCT FROM OLD.site_version_id
    OR NEW.site_version_digest_sha256 IS DISTINCT FROM OLD.site_version_digest_sha256
    OR NEW.generation_run_id IS DISTINCT FROM OLD.generation_run_id
    OR NEW.review_cycle_id IS DISTINCT FROM OLD.review_cycle_id
    OR NEW.knowledge_pack_id IS DISTINCT FROM OLD.knowledge_pack_id
    OR NEW.knowledge_pack_semantic_version
      IS DISTINCT FROM OLD.knowledge_pack_semantic_version
    OR NEW.knowledge_pack_digest_sha256
      IS DISTINCT FROM OLD.knowledge_pack_digest_sha256
    OR NEW.applicable_rule_ids_json IS DISTINCT FROM OLD.applicable_rule_ids_json
    OR NEW.applicable_page_playbooks_json
      IS DISTINCT FROM OLD.applicable_page_playbooks_json
    OR NEW.applicable_section_playbooks_json
      IS DISTINCT FROM OLD.applicable_section_playbooks_json
    OR NEW.rule_selection_digest_sha256
      IS DISTINCT FROM OLD.rule_selection_digest_sha256
    OR NEW.audit_type IS DISTINCT FROM OLD.audit_type
    OR NEW.audit_reason IS DISTINCT FROM OLD.audit_reason
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.renderer_version IS DISTINCT FROM OLD.renderer_version
    OR NEW.quality_engine_version IS DISTINCT FROM OLD.quality_engine_version
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.requested_by_agency_user_id
      IS DISTINCT FROM OLD.requested_by_agency_user_id
  ) THEN
    RAISE EXCEPTION 'SITE_QUALITY_RUN_PINNED_SCOPE_IMMUTABLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM sites site
    JOIN site_versions version
      ON version.id = NEW.site_version_id
      AND version.site_id = site.id
      AND version.tenant_id = site.tenant_id
    WHERE site.id = NEW.site_id
      AND site.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'SITE_QUALITY_RUN_SCOPE_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM knowledge_packs pack
    WHERE pack.id = NEW.knowledge_pack_id
      AND pack.intended_scope = 'PUBLIC_SITE'
      AND (TG_OP = 'UPDATE' OR pack.status = 'ACTIVE')
      AND pack.semantic_version = NEW.knowledge_pack_semantic_version
      AND pack.content_digest_sha256 = NEW.knowledge_pack_digest_sha256
  ) THEN
    RAISE EXCEPTION 'SITE_QUALITY_KNOWLEDGE_PACK_INVALID';
  END IF;
  IF NEW.generation_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_generation_runs generation
    WHERE generation.id = NEW.generation_run_id
      AND generation.tenant_id = NEW.tenant_id
      AND generation.site_id = NEW.site_id
      AND generation.site_version_id = NEW.site_version_id
  ) THEN
    RAISE EXCEPTION 'SITE_QUALITY_GENERATION_SCOPE_INVALID';
  END IF;
  IF NEW.review_cycle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_review_cycles review
    WHERE review.id = NEW.review_cycle_id
      AND review.tenant_id = NEW.tenant_id
      AND review.site_id = NEW.site_id
      AND review.site_version_id = NEW.site_version_id
      AND review.pinned_content_digest_sha256 = NEW.site_version_digest_sha256
  ) THEN
    RAISE EXCEPTION 'SITE_QUALITY_REVIEW_SCOPE_INVALID';
  END IF;
  IF NEW.site_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_jobs job
    WHERE job.id = NEW.site_job_id
      AND job.tenant_id = NEW.tenant_id
      AND job.site_id = NEW.site_id
      AND job.version_id = NEW.site_version_id
  ) THEN
    RAISE EXCEPTION 'SITE_QUALITY_JOB_SCOPE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_quality_runs_scope
BEFORE INSERT OR UPDATE ON site_quality_runs
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_run_scope();

CREATE OR REPLACE FUNCTION ks_validate_site_quality_child_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE run_tenant uuid;
DECLARE run_site uuid;
DECLARE run_version uuid;
DECLARE run_digest varchar(64);
BEGIN
  SELECT tenant_id, site_id, site_version_id, site_version_digest_sha256
    INTO run_tenant, run_site, run_version, run_digest
  FROM site_quality_runs WHERE id = NEW.quality_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SITE_QUALITY_RUN_NOT_FOUND'; END IF;
  IF NEW.tenant_id <> run_tenant THEN
    RAISE EXCEPTION 'SITE_QUALITY_TENANT_SCOPE_INVALID';
  END IF;
  IF TG_TABLE_NAME IN (
    'site_quality_page_runs','site_quality_findings','site_quality_waivers',
    'site_quality_audit_sessions'
  ) THEN
    IF NEW.site_id <> run_site OR NEW.site_version_id <> run_version THEN
      RAISE EXCEPTION 'SITE_QUALITY_SITE_VERSION_SCOPE_INVALID';
    END IF;
  END IF;
  IF TG_TABLE_NAME IN (
    'site_quality_findings','site_quality_waivers',
    'site_quality_human_reviews','site_quality_audit_sessions'
  ) AND NEW.content_digest_sha256 <> run_digest THEN
    RAISE EXCEPTION 'SITE_QUALITY_CONTENT_DIGEST_SCOPE_INVALID';
  END IF;
  IF TG_TABLE_NAME = 'site_quality_page_runs' AND NOT EXISTS (
    SELECT 1 FROM site_pages page
    WHERE page.id = NEW.page_id
      AND page.tenant_id = run_tenant
      AND page.site_id = run_site
      AND page.version_id = run_version
  ) THEN RAISE EXCEPTION 'SITE_QUALITY_PAGE_SCOPE_INVALID'; END IF;
  IF TG_TABLE_NAME = 'site_quality_checks'
    AND NEW.page_run_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM site_quality_page_runs page_run
      WHERE page_run.id = NEW.page_run_id
        AND page_run.quality_run_id = NEW.quality_run_id
        AND page_run.tenant_id = run_tenant
    )
  THEN RAISE EXCEPTION 'SITE_QUALITY_CHECK_PAGE_RUN_SCOPE_INVALID'; END IF;
  IF TG_TABLE_NAME = 'site_quality_findings' THEN
    IF NOT EXISTS (
      SELECT 1 FROM site_quality_checks quality_check
      WHERE quality_check.id = NEW.quality_check_id
        AND quality_check.quality_run_id = NEW.quality_run_id
        AND quality_check.tenant_id = run_tenant
        AND quality_check.check_id = NEW.check_id
    ) THEN RAISE EXCEPTION 'SITE_QUALITY_FINDING_CHECK_SCOPE_INVALID'; END IF;
    IF NEW.page_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM site_pages page
      WHERE page.id = NEW.page_id
        AND page.tenant_id = run_tenant
        AND page.site_id = run_site
        AND page.version_id = run_version
    ) THEN RAISE EXCEPTION 'SITE_QUALITY_FINDING_PAGE_SCOPE_INVALID'; END IF;
    IF NEW.section_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM site_sections section
      WHERE section.id = NEW.section_id
        AND section.tenant_id = run_tenant
        AND section.site_id = run_site
        AND section.version_id = run_version
        AND (NEW.page_id IS NULL OR section.page_id = NEW.page_id)
    ) THEN RAISE EXCEPTION 'SITE_QUALITY_FINDING_SECTION_SCOPE_INVALID'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'site_quality_evidence' THEN
    IF NEW.quality_check_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM site_quality_checks quality_check
      WHERE quality_check.id = NEW.quality_check_id
        AND quality_check.quality_run_id = NEW.quality_run_id
        AND quality_check.tenant_id = run_tenant
    ) THEN RAISE EXCEPTION 'SITE_QUALITY_EVIDENCE_CHECK_SCOPE_INVALID'; END IF;
    IF NEW.finding_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM site_quality_findings finding
      WHERE finding.id = NEW.finding_id
        AND finding.quality_run_id = NEW.quality_run_id
        AND finding.tenant_id = run_tenant
        AND (
          NEW.quality_check_id IS NULL
          OR finding.quality_check_id = NEW.quality_check_id
        )
    ) THEN RAISE EXCEPTION 'SITE_QUALITY_EVIDENCE_FINDING_SCOPE_INVALID'; END IF;
    IF NEW.page_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM site_pages page
      WHERE page.id = NEW.page_id
        AND page.tenant_id = run_tenant
        AND page.site_id = run_site
        AND page.version_id = run_version
    ) THEN RAISE EXCEPTION 'SITE_QUALITY_EVIDENCE_PAGE_SCOPE_INVALID'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'site_quality_human_reviews' AND NOT EXISTS (
    SELECT 1 FROM site_quality_checks quality_check
    WHERE quality_check.id = NEW.quality_check_id
      AND quality_check.quality_run_id = NEW.quality_run_id
      AND quality_check.tenant_id = run_tenant
      AND quality_check.validation_method = 'HUMAN_REVIEW'
  ) THEN RAISE EXCEPTION 'SITE_QUALITY_HUMAN_REVIEW_CHECK_SCOPE_INVALID'; END IF;
  IF TG_TABLE_NAME = 'site_quality_remediation_events' AND NOT EXISTS (
    SELECT 1 FROM site_quality_findings finding
    WHERE finding.id = NEW.finding_id
      AND finding.quality_run_id = NEW.quality_run_id
      AND finding.tenant_id = run_tenant
  ) THEN RAISE EXCEPTION 'SITE_QUALITY_REMEDIATION_FINDING_SCOPE_INVALID'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_quality_page_runs_scope
BEFORE INSERT OR UPDATE ON site_quality_page_runs
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_child_scope();
CREATE TRIGGER site_quality_checks_scope
BEFORE INSERT OR UPDATE ON site_quality_checks
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_child_scope();
CREATE TRIGGER site_quality_findings_scope
BEFORE INSERT OR UPDATE ON site_quality_findings
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_child_scope();
CREATE TRIGGER site_quality_evidence_scope
BEFORE INSERT OR UPDATE ON site_quality_evidence
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_child_scope();
CREATE TRIGGER site_quality_waivers_scope
BEFORE INSERT OR UPDATE ON site_quality_waivers
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_child_scope();
CREATE TRIGGER site_quality_human_reviews_scope
BEFORE INSERT OR UPDATE ON site_quality_human_reviews
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_child_scope();
CREATE TRIGGER site_quality_remediation_events_scope
BEFORE INSERT OR UPDATE ON site_quality_remediation_events
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_child_scope();
CREATE TRIGGER site_quality_audit_sessions_scope
BEFORE INSERT OR UPDATE ON site_quality_audit_sessions
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_child_scope();

CREATE OR REPLACE FUNCTION ks_validate_site_quality_waiver()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM site_quality_findings finding
    JOIN site_quality_runs run ON run.id = finding.quality_run_id
    WHERE finding.id = NEW.finding_id
      AND finding.quality_run_id = NEW.quality_run_id
      AND finding.tenant_id = NEW.tenant_id
      AND finding.site_id = NEW.site_id
      AND finding.site_version_id = NEW.site_version_id
      AND finding.content_digest_sha256 = NEW.content_digest_sha256
      AND finding.waivable
      AND finding.status IN ('OPEN','ACKNOWLEDGED','IN_REMEDIATION','WAIVED')
      AND finding.code NOT IN (
        'CROSS_TENANT_REFERENCE','BROKEN_TENANT_ISOLATION',
        'INVALID_NATIVE_BOOKING','EXTERNAL_BOOKING_DESTINATION',
        'BOOKING_REFERENCE_CROSS_TENANT','MALICIOUS_EXECUTABLE_CONTENT',
        'UNSUPPORTED_ARBITRARY_HTML','MISSING_REQUIRED_PAGE',
        'MISSING_REQUIRED_SECTION','SITE_VERSION_INCOMPLETE',
        'SITE_VERSION_SUPERSEDED','INVALID_SNAPSHOT_STRUCTURE',
        'FABRICATED_PRICE','FABRICATED_LOCATION',
        'FABRICATED_STAFF_CREDENTIAL','FABRICATED_TESTIMONIAL',
        'PROHIBITED_MEDICAL_CLAIM','CRITICAL_KEYBOARD_FAILURE',
        'PRIMARY_JOURNEY_FOCUS_TRAP','UNUSABLE_BOOKING_FLOW',
        'MISSING_AGENCY_APPROVAL','STALE_APPROVAL',
        'UNRESOLVED_PROHIBITED_CLAIM',
        'MISSING_REQUIRED_LEGAL_CONFIGURATION',
        'INVALID_TEMPLATE_LICENCE','UNAPPROVED_PUBLIC_ASSET',
        'RENDER_FAILURE'
      )
      AND run.policy_version = NEW.policy_version
      AND run.knowledge_pack_digest_sha256 = NEW.knowledge_pack_digest_sha256
  ) THEN
    RAISE EXCEPTION 'SITE_QUALITY_WAIVER_NOT_PERMITTED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_quality_waivers_validate
BEFORE INSERT OR UPDATE ON site_quality_waivers
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_waiver();

CREATE OR REPLACE FUNCTION ks_validate_site_quality_comparison_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM site_quality_runs left_run
    JOIN site_quality_runs right_run
      ON right_run.id = NEW.right_quality_run_id
    WHERE left_run.id = NEW.left_quality_run_id
      AND left_run.tenant_id = NEW.tenant_id
      AND right_run.tenant_id = NEW.tenant_id
      AND left_run.site_id = NEW.site_id
      AND right_run.site_id = NEW.site_id
  ) THEN
    RAISE EXCEPTION 'SITE_QUALITY_COMPARISON_SCOPE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_quality_run_comparisons_scope
BEFORE INSERT OR UPDATE ON site_quality_run_comparisons
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_quality_comparison_scope();

CREATE OR REPLACE FUNCTION ks_site_quality_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER site_quality_evidence_append_only
BEFORE UPDATE OR DELETE ON site_quality_evidence
FOR EACH ROW EXECUTE FUNCTION ks_site_quality_append_only();
CREATE TRIGGER site_quality_remediation_events_append_only
BEFORE UPDATE OR DELETE ON site_quality_remediation_events
FOR EACH ROW EXECUTE FUNCTION ks_site_quality_append_only();
CREATE TRIGGER site_quality_run_comparisons_append_only
BEFORE UPDATE OR DELETE ON site_quality_run_comparisons
FOR EACH ROW EXECUTE FUNCTION ks_site_quality_append_only();

ALTER TABLE site_quality_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_quality_page_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_quality_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_quality_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_quality_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_quality_waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_quality_human_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_quality_remediation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_quality_run_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_quality_audit_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  site_quality_runs,
  site_quality_page_runs,
  site_quality_checks,
  site_quality_findings,
  site_quality_evidence,
  site_quality_waivers,
  site_quality_human_reviews,
  site_quality_remediation_events,
  site_quality_run_comparisons,
  site_quality_audit_sessions
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  site_quality_runs,
  site_quality_page_runs,
  site_quality_checks,
  site_quality_findings,
  site_quality_waivers,
  site_quality_human_reviews,
  site_quality_audit_sessions
TO service_role;

GRANT SELECT, INSERT ON TABLE
  site_quality_evidence,
  site_quality_remediation_events,
  site_quality_run_comparisons
TO service_role;

REVOKE EXECUTE ON FUNCTION ks_validate_site_quality_run_scope()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_validate_site_quality_child_scope()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_validate_site_quality_waiver()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_validate_site_quality_comparison_scope()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_site_quality_append_only()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE site_quality_runs IS
  'Phase 15.8 exact-version quality runs. READY never publishes a site.';
COMMENT ON TABLE site_quality_evidence IS
  'Append-only bounded evidence; full page content, raw prompts, provider responses and credentials are prohibited.';
COMMENT ON TABLE site_quality_audit_sessions IS
  'Short-lived exact-version audit preview sessions; raw bearer tokens are never stored.';
COMMENT ON TABLE site_quality_waivers IS
  'Agency-controlled waivers for policy-permitted findings only; non-waivable codes are enforced by trigger.';
