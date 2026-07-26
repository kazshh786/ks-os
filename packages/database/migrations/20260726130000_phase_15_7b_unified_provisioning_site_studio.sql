-- Phase 15.7B: agency-controlled fact finding, production briefs, unified
-- workspace provisioning, and Site Studio read models.
-- Additive only. This migration does not publish sites, configure domains,
-- invoke providers, or expose questionnaire data to browser database roles.

CREATE TABLE IF NOT EXISTS fact_finding_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  template_key varchar(80) NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name varchar(200) NOT NULL,
  description text,
  business_categories_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  plan_keys_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  activated_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_key, version),
  CHECK (jsonb_typeof(business_categories_json) = 'array'),
  CHECK (jsonb_typeof(plan_keys_json) = 'array')
);
CREATE INDEX IF NOT EXISTS fact_finding_templates_status_key_idx
  ON fact_finding_templates(status, template_key, version DESC);
CREATE INDEX IF NOT EXISTS fact_finding_templates_created_by_idx
  ON fact_finding_templates(created_by_agency_user_id);

CREATE TABLE IF NOT EXISTS fact_finding_template_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES fact_finding_templates(id) ON DELETE RESTRICT,
  section_key varchar(80) NOT NULL,
  title varchar(200) NOT NULL,
  description text,
  display_order integer NOT NULL CHECK (display_order >= 0),
  optional boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_id, section_key),
  UNIQUE(template_id, display_order)
);
CREATE INDEX IF NOT EXISTS fact_finding_template_sections_template_order_idx
  ON fact_finding_template_sections(template_id, display_order, id);

CREATE TABLE IF NOT EXISTS fact_finding_template_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES fact_finding_templates(id) ON DELETE RESTRICT,
  section_id uuid NOT NULL REFERENCES fact_finding_template_sections(id) ON DELETE RESTRICT,
  question_key varchar(80) NOT NULL,
  label varchar(300) NOT NULL,
  guidance text,
  question_type varchar(40) NOT NULL CHECK (question_type IN (
    'SHORT_TEXT','LONG_TEXT','RICH_TEXT_SAFE','NUMBER','MONEY','DURATION','DATE',
    'BOOLEAN','SINGLE_SELECT','MULTI_SELECT','ADDRESS','PHONE','EMAIL','URL',
    'OPENING_HOURS','SERVICE_LIST','STAFF_LIST','LOCATION_LIST','POLICY',
    'FILE_UPLOAD','IMAGE_UPLOAD','REPEATING_GROUP'
  )),
  field_mapping varchar(100),
  required boolean NOT NULL DEFAULT false,
  system_required boolean NOT NULL DEFAULT false,
  evidence_required boolean NOT NULL DEFAULT false,
  public_use_allowed boolean NOT NULL DEFAULT false,
  booking_use_allowed boolean NOT NULL DEFAULT false,
  generation_use_allowed boolean NOT NULL DEFAULT false,
  agency_verification_required boolean NOT NULL DEFAULT false,
  conditions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order integer NOT NULL CHECK (display_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_id, question_key),
  UNIQUE(section_id, display_order),
  CHECK (NOT system_required OR required),
  CHECK (jsonb_typeof(conditions_json) = 'array'),
  CHECK (jsonb_typeof(validation_json) = 'object'),
  CHECK (jsonb_typeof(options_json) = 'array'),
  CHECK (
    NOT (public_use_allowed OR booking_use_allowed OR generation_use_allowed)
    OR field_mapping IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS fact_finding_template_questions_template_section_idx
  ON fact_finding_template_questions(template_id, section_id, display_order, id);
CREATE INDEX IF NOT EXISTS fact_finding_template_questions_mapping_idx
  ON fact_finding_template_questions(field_mapping)
  WHERE field_mapping IS NOT NULL;

CREATE TABLE IF NOT EXISTS fact_finding_questionnaires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES fact_finding_templates(id) ON DELETE RESTRICT,
  questionnaire_version integer NOT NULL DEFAULT 1 CHECK (questionnaire_version > 0),
  response_version integer NOT NULL DEFAULT 0 CHECK (response_version >= 0),
  status varchar(40) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','PREQUALIFIED','INVITED','IN_PROGRESS','SUBMITTED','AGENCY_REVIEW',
    'CLARIFICATION_REQUIRED','APPROVED','CANCELLED','SUPERSEDED'
  )),
  assigned_reviewer_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  due_at timestamptz,
  prequalified_at timestamptz,
  invited_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  cancelled_at timestamptz,
  superseded_at timestamptz,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, questionnaire_version)
);
CREATE INDEX IF NOT EXISTS fact_finding_questionnaires_tenant_status_idx
  ON fact_finding_questionnaires(tenant_id, status, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS fact_finding_questionnaires_template_idx
  ON fact_finding_questionnaires(template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fact_finding_questionnaires_reviewer_idx
  ON fact_finding_questionnaires(assigned_reviewer_agency_user_id, status, due_at);

CREATE TABLE IF NOT EXISTS fact_finding_questionnaire_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_template_question_id uuid REFERENCES fact_finding_template_questions(id) ON DELETE RESTRICT,
  section_reference uuid NOT NULL,
  question_key varchar(80) NOT NULL,
  label varchar(300) NOT NULL,
  guidance text,
  question_type varchar(40) NOT NULL,
  field_mapping varchar(100),
  included boolean NOT NULL DEFAULT true,
  required boolean NOT NULL DEFAULT false,
  system_required boolean NOT NULL DEFAULT false,
  evidence_required boolean NOT NULL DEFAULT false,
  public_use_allowed boolean NOT NULL DEFAULT false,
  booking_use_allowed boolean NOT NULL DEFAULT false,
  generation_use_allowed boolean NOT NULL DEFAULT false,
  agency_verification_required boolean NOT NULL DEFAULT false,
  conditions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order integer NOT NULL CHECK (display_order >= 0),
  prefilled_answer_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(questionnaire_id, question_key),
  UNIQUE(questionnaire_id, display_order),
  CHECK (NOT system_required OR (included AND required)),
  CHECK (jsonb_typeof(conditions_json) = 'array'),
  CHECK (jsonb_typeof(validation_json) = 'object'),
  CHECK (jsonb_typeof(options_json) = 'array')
);
CREATE INDEX IF NOT EXISTS fact_finding_questionnaire_questions_questionnaire_order_idx
  ON fact_finding_questionnaire_questions(questionnaire_id, included, display_order, id);
CREATE INDEX IF NOT EXISTS fact_finding_questionnaire_questions_tenant_mapping_idx
  ON fact_finding_questionnaire_questions(tenant_id, field_mapping)
  WHERE included AND field_mapping IS NOT NULL;

CREATE TABLE IF NOT EXISTS fact_finding_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  tenant_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  display_name varchar(200) NOT NULL,
  email_normalized varchar(320) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED','ACTIVE','REVOKED','COMPLETED')),
  invited_at timestamptz,
  accepted_at timestamptz,
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(questionnaire_id, email_normalized)
);
CREATE INDEX IF NOT EXISTS fact_finding_participants_questionnaire_status_idx
  ON fact_finding_participants(questionnaire_id, status, created_at);
CREATE INDEX IF NOT EXISTS fact_finding_participants_tenant_user_idx
  ON fact_finding_participants(tenant_id, tenant_user_id)
  WHERE tenant_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fact_finding_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES fact_finding_participants(id) ON DELETE RESTRICT,
  questionnaire_version integer NOT NULL CHECK (questionnaire_version > 0),
  token_digest_sha256 varchar(64) NOT NULL UNIQUE,
  status varchar(30) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SENT','ACCEPTED','REVOKED','EXPIRED','FAILED')),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (token_digest_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS fact_finding_invitations_active_revision_unique
  ON fact_finding_invitations(questionnaire_id, participant_id, questionnaire_version)
  WHERE status IN ('PENDING','SENT','ACCEPTED');
CREATE INDEX IF NOT EXISTS fact_finding_invitations_expiry_idx
  ON fact_finding_invitations(status, expires_at);
CREATE INDEX IF NOT EXISTS fact_finding_invitations_tenant_questionnaire_idx
  ON fact_finding_invitations(tenant_id, questionnaire_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fact_finding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES fact_finding_participants(id) ON DELETE RESTRICT,
  invitation_id uuid REFERENCES fact_finding_invitations(id) ON DELETE RESTRICT,
  token_digest_sha256 varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (token_digest_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS fact_finding_sessions_active_digest_idx
  ON fact_finding_sessions(token_digest_sha256, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS fact_finding_sessions_questionnaire_participant_idx
  ON fact_finding_sessions(questionnaire_id, participant_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS fact_finding_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  question_id uuid NOT NULL REFERENCES fact_finding_questionnaire_questions(id) ON DELETE RESTRICT,
  participant_id uuid REFERENCES fact_finding_participants(id) ON DELETE RESTRICT,
  field_mapping varchar(100),
  answer_type varchar(40) NOT NULL,
  answer_json jsonb NOT NULL,
  source varchar(30) NOT NULL CHECK (source IN ('CLIENT_PROVIDED','AGENCY_PROVIDED')),
  value_digest_sha256 varchar(64) NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'ANSWERED' CHECK (status IN (
    'NOT_STARTED','IN_PROGRESS','ANSWERED','SUBMITTED','CLARIFICATION_REQUIRED',
    'CLIENT_CONFIRMED','AGENCY_REVIEW_REQUIRED','AGENCY_APPROVED','AGENCY_REJECTED',
    'SUPERSEDED','NOT_APPLICABLE'
  )),
  response_version integer NOT NULL DEFAULT 1 CHECK (response_version > 0),
  public_use_eligible boolean NOT NULL DEFAULT false,
  booking_use_eligible boolean NOT NULL DEFAULT false,
  generation_use_eligible boolean NOT NULL DEFAULT false,
  evidence_required boolean NOT NULL DEFAULT false,
  agency_reviewer_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_value_json jsonb,
  rejection_reason text,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(questionnaire_id, question_id),
  CHECK (value_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (status <> 'AGENCY_APPROVED' OR (agency_reviewer_id IS NOT NULL AND approved_value_json IS NOT NULL)),
  CHECK (status <> 'AGENCY_REJECTED' OR rejection_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS fact_finding_responses_questionnaire_status_idx
  ON fact_finding_responses(questionnaire_id, status, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS fact_finding_responses_tenant_mapping_idx
  ON fact_finding_responses(tenant_id, field_mapping, status)
  WHERE field_mapping IS NOT NULL;
CREATE INDEX IF NOT EXISTS fact_finding_responses_participant_idx
  ON fact_finding_responses(participant_id, updated_at DESC)
  WHERE participant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fact_finding_response_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES fact_finding_responses(id) ON DELETE RESTRICT,
  questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  participant_id uuid REFERENCES fact_finding_participants(id) ON DELETE RESTRICT,
  response_version integer NOT NULL CHECK (response_version > 0),
  answer_json jsonb NOT NULL,
  source varchar(30) NOT NULL,
  value_digest_sha256 varchar(64) NOT NULL,
  status varchar(40) NOT NULL,
  created_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(response_id, response_version),
  CHECK (value_digest_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS fact_finding_response_versions_questionnaire_idx
  ON fact_finding_response_versions(questionnaire_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS fact_finding_clarifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  response_id uuid NOT NULL REFERENCES fact_finding_responses(id) ON DELETE RESTRICT,
  question_id uuid NOT NULL REFERENCES fact_finding_questionnaire_questions(id) ON DELETE RESTRICT,
  requested_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  agency_message text NOT NULL,
  required_response_type varchar(40) NOT NULL,
  evidence_requested boolean NOT NULL DEFAULT false,
  due_at timestamptz,
  status varchar(30) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CLIENT_RESPONDED','RESOLVED','WITHDRAWN')),
  client_response_json jsonb,
  resolution text,
  responded_at timestamptz,
  resolved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_finding_clarifications_questionnaire_status_idx
  ON fact_finding_clarifications(questionnaire_id, status, due_at, created_at);
CREATE INDEX IF NOT EXISTS fact_finding_clarifications_response_idx
  ON fact_finding_clarifications(response_id, status, created_at);

CREATE TABLE IF NOT EXISTS fact_finding_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  participant_id uuid REFERENCES fact_finding_participants(id) ON DELETE RESTRICT,
  question_id uuid REFERENCES fact_finding_questionnaire_questions(id) ON DELETE RESTRICT,
  storage_bucket varchar(100) NOT NULL,
  storage_path varchar(1000) NOT NULL UNIQUE,
  safe_filename varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  digest_sha256 varchar(64) NOT NULL,
  upload_status varchar(30) NOT NULL DEFAULT 'PENDING_UPLOAD'
    CHECK (upload_status IN ('PENDING_UPLOAD','UPLOADED','REJECTED','QUARANTINED','DELETED')),
  malware_scan_status varchar(30) NOT NULL DEFAULT 'NOT_AVAILABLE'
    CHECK (malware_scan_status IN ('NOT_AVAILABLE','PENDING','CLEAN','INFECTED','FAILED')),
  asset_category varchar(50) NOT NULL,
  public_use_permission boolean NOT NULL DEFAULT false,
  ai_use_permission boolean NOT NULL DEFAULT false,
  copyright_confirmed boolean NOT NULL,
  consent_status varchar(30) NOT NULL CHECK (consent_status IN ('NOT_APPLICABLE','CONFIRMED','REQUIRED')),
  agency_review_status varchar(30) NOT NULL DEFAULT 'PENDING'
    CHECK (agency_review_status IN ('PENDING','APPROVED','REJECTED')),
  reviewed_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (copyright_confirmed),
  CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/avif','application/pdf','text/plain'))
);
CREATE INDEX IF NOT EXISTS fact_finding_uploads_questionnaire_review_idx
  ON fact_finding_uploads(questionnaire_id, agency_review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS fact_finding_uploads_tenant_status_idx
  ON fact_finding_uploads(tenant_id, upload_status, malware_scan_status, created_at DESC);
CREATE INDEX IF NOT EXISTS fact_finding_uploads_participant_idx
  ON fact_finding_uploads(participant_id, created_at DESC)
  WHERE participant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS production_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  questionnaire_version integer NOT NULL CHECK (questionnaire_version > 0),
  response_version integer NOT NULL CHECK (response_version > 0),
  brief_version integer NOT NULL CHECK (brief_version > 0),
  status varchar(40) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','BUILDING','REVIEW_REQUIRED','APPROVED','LOCKED_FOR_PROVISIONING','SUPERSEDED')),
  brief_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_digest_sha256 varchar(64) NOT NULL,
  approved_fact_set_digest_sha256 varchar(64) NOT NULL,
  approved_asset_set_digest_sha256 varchar(64) NOT NULL,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  locked_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  locked_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(questionnaire_id, brief_version),
  CHECK (jsonb_typeof(brief_json) = 'object'),
  CHECK (jsonb_typeof(readiness_json) = 'object'),
  CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (approved_fact_set_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (approved_asset_set_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (status NOT IN ('APPROVED','LOCKED_FOR_PROVISIONING') OR (approved_by_agency_user_id IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'LOCKED_FOR_PROVISIONING' OR (locked_by_agency_user_id IS NOT NULL AND locked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS production_briefs_tenant_status_idx
  ON production_briefs(tenant_id, status, created_at DESC, id);
CREATE INDEX IF NOT EXISTS production_briefs_questionnaire_version_idx
  ON production_briefs(questionnaire_id, brief_version DESC);

CREATE TABLE IF NOT EXISTS production_brief_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  production_brief_id uuid NOT NULL REFERENCES production_briefs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  source_question_id uuid NOT NULL REFERENCES fact_finding_questionnaire_questions(id) ON DELETE RESTRICT,
  source_response_id uuid NOT NULL REFERENCES fact_finding_responses(id) ON DELETE RESTRICT,
  source_response_version integer NOT NULL CHECK (source_response_version > 0),
  field_mapping varchar(100) NOT NULL,
  approved_value_json jsonb NOT NULL,
  value_digest_sha256 varchar(64) NOT NULL,
  submitted_by_participant_id uuid REFERENCES fact_finding_participants(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL,
  reviewed_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  verification_status varchar(40) NOT NULL DEFAULT 'AGENCY_APPROVED',
  public_use_eligible boolean NOT NULL DEFAULT false,
  booking_use_eligible boolean NOT NULL DEFAULT false,
  generation_use_eligible boolean NOT NULL DEFAULT false,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(production_brief_id, source_response_id),
  CHECK (value_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (public_use_eligible OR booking_use_eligible OR generation_use_eligible)
);
CREATE INDEX IF NOT EXISTS production_brief_facts_brief_mapping_idx
  ON production_brief_facts(production_brief_id, field_mapping, id);
CREATE INDEX IF NOT EXISTS production_brief_facts_tenant_mapping_idx
  ON production_brief_facts(tenant_id, field_mapping, approved_at DESC);

CREATE TABLE IF NOT EXISTS provisioning_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  production_brief_id uuid NOT NULL REFERENCES production_briefs(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES template_versions(id) ON DELETE RESTRICT,
  status varchar(40) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','VALIDATING','READY_TO_PROVISION','PROVISIONING','COMPLETED','CANCELLED','SUPERSEDED')),
  draft_version integer NOT NULL DEFAULT 1 CHECK (draft_version > 0),
  workspace_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  page_plan_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_preference_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  validated_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, draft_version),
  CHECK (jsonb_typeof(workspace_json) = 'object'),
  CHECK (jsonb_typeof(page_plan_json) = 'object'),
  CHECK (jsonb_typeof(payment_preference_json) = 'object'),
  CHECK (jsonb_typeof(validation_json) = 'object')
);
CREATE INDEX IF NOT EXISTS provisioning_drafts_tenant_status_idx
  ON provisioning_drafts(tenant_id, status, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS provisioning_drafts_brief_idx
  ON provisioning_drafts(production_brief_id, status);
CREATE INDEX IF NOT EXISTS provisioning_drafts_plan_template_idx
  ON provisioning_drafts(plan_version_id, template_version_id);

CREATE TABLE IF NOT EXISTS provisioning_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  provisioning_draft_id uuid NOT NULL REFERENCES provisioning_drafts(id) ON DELETE RESTRICT,
  questionnaire_id uuid NOT NULL REFERENCES fact_finding_questionnaires(id) ON DELETE RESTRICT,
  questionnaire_version integer NOT NULL CHECK (questionnaire_version > 0),
  response_version integer NOT NULL CHECK (response_version > 0),
  production_brief_id uuid NOT NULL REFERENCES production_briefs(id) ON DELETE RESTRICT,
  production_brief_version integer NOT NULL CHECK (production_brief_version > 0),
  production_brief_digest_sha256 varchar(64) NOT NULL,
  approved_fact_set_digest_sha256 varchar(64) NOT NULL,
  approved_asset_set_digest_sha256 varchar(64) NOT NULL,
  plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES template_versions(id) ON DELETE RESTRICT,
  site_id uuid REFERENCES sites(id) ON DELETE RESTRICT,
  blueprint_id uuid REFERENCES site_blueprints(id) ON DELETE RESTRICT,
  generation_run_id uuid REFERENCES site_generation_runs(id) ON DELETE RESTRICT,
  review_cycle_id uuid REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  preview_session_id uuid REFERENCES site_review_sessions(id) ON DELETE RESTRICT,
  site_job_id uuid REFERENCES site_jobs(id) ON DELETE RESTRICT,
  status varchar(50) NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
    'QUEUED','PROVISIONING_TENANT','PROVISIONING_BUSINESS','PROVISIONING_SERVICES',
    'PROVISIONING_STAFF','PROVISIONING_AVAILABILITY','PROVISIONING_BOOKING',
    'PROVISIONING_FORMS','PROVISIONING_PAYMENTS','PLANNING_SITE','GENERATING_SITE',
    'VALIDATING_SITE','CREATING_REVIEW','READY','ACTION_REQUIRED','PARTIALLY_FAILED',
    'FAILED','CANCEL_REQUESTED','CANCELLED'
  )),
  idempotency_key varchar(160) NOT NULL,
  identity_digest_sha256 varchar(64) NOT NULL,
  current_step varchar(80),
  completion_percentage integer NOT NULL DEFAULT 0 CHECK (completion_percentage BETWEEN 0 AND 100),
  failure_code varchar(100),
  failure_message varchar(500),
  retryable boolean,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  requested_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  cancelled_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, idempotency_key),
  UNIQUE(identity_digest_sha256),
  CHECK (production_brief_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (approved_fact_set_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (approved_asset_set_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (identity_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (status <> 'READY' OR (site_id IS NOT NULL AND blueprint_id IS NOT NULL AND generation_run_id IS NOT NULL AND review_cycle_id IS NOT NULL AND preview_session_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS provisioning_runs_tenant_status_idx
  ON provisioning_runs(tenant_id, status, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS provisioning_runs_draft_idx
  ON provisioning_runs(provisioning_draft_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provisioning_runs_brief_idx
  ON provisioning_runs(production_brief_id, production_brief_version);
CREATE INDEX IF NOT EXISTS provisioning_runs_job_idx
  ON provisioning_runs(site_job_id)
  WHERE site_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS provisioning_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  provisioning_run_id uuid NOT NULL REFERENCES provisioning_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  step_key varchar(80) NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  status varchar(30) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','WARNING','ACTION_REQUIRED','FAILED','SKIPPED')),
  idempotency_key varchar(200) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  safe_message varchar(500),
  failure_code varchar(100),
  output_references_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provisioning_run_id, step_key),
  UNIQUE(idempotency_key),
  UNIQUE(provisioning_run_id, sequence),
  CHECK (jsonb_typeof(output_references_json) = 'array')
);
CREATE INDEX IF NOT EXISTS provisioning_run_steps_run_sequence_idx
  ON provisioning_run_steps(provisioning_run_id, sequence, id);
CREATE INDEX IF NOT EXISTS provisioning_run_steps_tenant_status_idx
  ON provisioning_run_steps(tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS provisioning_record_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  provisioning_run_id uuid NOT NULL REFERENCES provisioning_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  step_key varchar(80) NOT NULL,
  record_type varchar(80) NOT NULL,
  record_public_reference uuid NOT NULL,
  source_fact_reference uuid,
  source_value_digest_sha256 varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provisioning_run_id, record_type, record_public_reference),
  CHECK (source_value_digest_sha256 IS NULL OR source_value_digest_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS provisioning_record_links_run_step_idx
  ON provisioning_record_links(provisioning_run_id, step_key, record_type);
CREATE INDEX IF NOT EXISTS provisioning_record_links_tenant_record_idx
  ON provisioning_record_links(tenant_id, record_type, record_public_reference);

CREATE TABLE IF NOT EXISTS provisioning_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  provisioning_run_id uuid NOT NULL REFERENCES provisioning_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type varchar(100) NOT NULL,
  status_from varchar(50),
  status_to varchar(50),
  step_key varchar(80),
  safe_message varchar(500),
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(safe_metadata_json) = 'object')
);
CREATE INDEX IF NOT EXISTS provisioning_activity_run_occurred_idx
  ON provisioning_activity(provisioning_run_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS provisioning_activity_tenant_type_idx
  ON provisioning_activity(tenant_id, event_type, occurred_at DESC);

ALTER TABLE site_blueprints
  ADD COLUMN IF NOT EXISTS provisioning_run_id uuid REFERENCES provisioning_runs(id) ON DELETE RESTRICT;
ALTER TABLE site_generation_runs
  ADD COLUMN IF NOT EXISTS provisioning_run_id uuid REFERENCES provisioning_runs(id) ON DELETE RESTRICT;
ALTER TABLE site_review_cycles
  ADD COLUMN IF NOT EXISTS provisioning_run_id uuid REFERENCES provisioning_runs(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS site_blueprints_provisioning_run_idx ON site_blueprints(provisioning_run_id);
CREATE INDEX IF NOT EXISTS site_generation_runs_provisioning_run_idx ON site_generation_runs(provisioning_run_id);
CREATE INDEX IF NOT EXISTS site_review_cycles_provisioning_run_idx ON site_review_cycles(provisioning_run_id);

CREATE OR REPLACE FUNCTION ks_validate_fact_finding_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  questionnaire_tenant uuid;
BEGIN
  SELECT tenant_id INTO questionnaire_tenant
  FROM fact_finding_questionnaires
  WHERE id = NEW.questionnaire_id;
  IF questionnaire_tenant IS NULL OR questionnaire_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'fact-finding tenant ownership mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fact_finding_questions_validate_ownership
BEFORE INSERT OR UPDATE ON fact_finding_questionnaire_questions
FOR EACH ROW EXECUTE FUNCTION ks_validate_fact_finding_ownership();
CREATE TRIGGER fact_finding_participants_validate_ownership
BEFORE INSERT OR UPDATE ON fact_finding_participants
FOR EACH ROW EXECUTE FUNCTION ks_validate_fact_finding_ownership();
CREATE TRIGGER fact_finding_invitations_validate_ownership
BEFORE INSERT OR UPDATE ON fact_finding_invitations
FOR EACH ROW EXECUTE FUNCTION ks_validate_fact_finding_ownership();
CREATE TRIGGER fact_finding_sessions_validate_ownership
BEFORE INSERT OR UPDATE ON fact_finding_sessions
FOR EACH ROW EXECUTE FUNCTION ks_validate_fact_finding_ownership();
CREATE TRIGGER fact_finding_responses_validate_ownership
BEFORE INSERT OR UPDATE ON fact_finding_responses
FOR EACH ROW EXECUTE FUNCTION ks_validate_fact_finding_ownership();
CREATE TRIGGER fact_finding_clarifications_validate_ownership
BEFORE INSERT OR UPDATE ON fact_finding_clarifications
FOR EACH ROW EXECUTE FUNCTION ks_validate_fact_finding_ownership();
CREATE TRIGGER fact_finding_uploads_validate_ownership
BEFORE INSERT OR UPDATE ON fact_finding_uploads
FOR EACH ROW EXECUTE FUNCTION ks_validate_fact_finding_ownership();

CREATE OR REPLACE FUNCTION ks_prevent_locked_production_brief_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'LOCKED_FOR_PROVISIONING' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'locked production briefs are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER production_briefs_locked_immutable
BEFORE UPDATE ON production_briefs
FOR EACH ROW EXECUTE FUNCTION ks_prevent_locked_production_brief_mutation();

CREATE OR REPLACE FUNCTION ks_validate_provisioning_brief_pin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  brief_row production_briefs%ROWTYPE;
BEGIN
  SELECT * INTO brief_row FROM production_briefs WHERE id = NEW.production_brief_id;
  IF brief_row.id IS NULL
     OR brief_row.tenant_id <> NEW.tenant_id
     OR brief_row.status <> 'LOCKED_FOR_PROVISIONING'
     OR brief_row.brief_version <> NEW.production_brief_version
     OR brief_row.content_digest_sha256 <> NEW.production_brief_digest_sha256
     OR brief_row.approved_fact_set_digest_sha256 <> NEW.approved_fact_set_digest_sha256
     OR brief_row.approved_asset_set_digest_sha256 <> NEW.approved_asset_set_digest_sha256 THEN
    RAISE EXCEPTION 'provisioning run must pin the exact locked production brief';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER provisioning_runs_validate_brief_pin
BEFORE INSERT ON provisioning_runs
FOR EACH ROW EXECUTE FUNCTION ks_validate_provisioning_brief_pin();

CREATE OR REPLACE FUNCTION ks_revoke_fact_finding_access()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('APPROVED','CANCELLED','SUPERSEDED')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE fact_finding_invitations
      SET status = 'REVOKED', revoked_at = now()
    WHERE questionnaire_id = NEW.id
      AND status IN ('PENDING','SENT','ACCEPTED');
    UPDATE fact_finding_sessions
      SET revoked_at = now()
    WHERE questionnaire_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fact_finding_questionnaires_revoke_access
AFTER UPDATE OF status ON fact_finding_questionnaires
FOR EACH ROW EXECUTE FUNCTION ks_revoke_fact_finding_access();

CREATE OR REPLACE FUNCTION ks_phase_15_7b_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER fact_finding_response_versions_append_only
BEFORE UPDATE OR DELETE ON fact_finding_response_versions
FOR EACH ROW EXECUTE FUNCTION ks_phase_15_7b_append_only();
CREATE TRIGGER production_brief_facts_append_only
BEFORE UPDATE OR DELETE ON production_brief_facts
FOR EACH ROW EXECUTE FUNCTION ks_phase_15_7b_append_only();
CREATE TRIGGER provisioning_record_links_append_only
BEFORE UPDATE OR DELETE ON provisioning_record_links
FOR EACH ROW EXECUTE FUNCTION ks_phase_15_7b_append_only();
CREATE TRIGGER provisioning_activity_append_only
BEFORE UPDATE OR DELETE ON provisioning_activity
FOR EACH ROW EXECUTE FUNCTION ks_phase_15_7b_append_only();

ALTER TABLE fact_finding_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_template_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_template_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_questionnaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_questionnaire_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_response_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_clarifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_finding_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_brief_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_record_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_activity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  fact_finding_templates,
  fact_finding_template_sections,
  fact_finding_template_questions,
  fact_finding_questionnaires,
  fact_finding_questionnaire_questions,
  fact_finding_participants,
  fact_finding_invitations,
  fact_finding_sessions,
  fact_finding_responses,
  fact_finding_response_versions,
  fact_finding_clarifications,
  fact_finding_uploads,
  production_briefs,
  production_brief_facts,
  provisioning_drafts,
  provisioning_runs,
  provisioning_run_steps,
  provisioning_record_links,
  provisioning_activity
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  fact_finding_templates,
  fact_finding_template_sections,
  fact_finding_template_questions,
  fact_finding_questionnaires,
  fact_finding_questionnaire_questions,
  fact_finding_participants,
  fact_finding_invitations,
  fact_finding_sessions,
  fact_finding_responses,
  fact_finding_clarifications,
  fact_finding_uploads,
  production_briefs,
  provisioning_drafts,
  provisioning_runs,
  provisioning_run_steps
TO service_role;

GRANT SELECT, INSERT ON TABLE
  fact_finding_response_versions,
  production_brief_facts,
  provisioning_record_links,
  provisioning_activity
TO service_role;

COMMENT ON TABLE production_briefs IS
  'Versioned, approved, public-safe production input. Locked briefs are immutable and are the only source consumed by provisioning.';
COMMENT ON TABLE provisioning_runs IS
  'Durable idempotent workspace provisioning runs pinned to one locked brief version and digest. READY never means published.';
COMMENT ON COLUMN fact_finding_invitations.token_digest_sha256 IS
  'SHA-256 digest only. The raw invitation token is never stored.';
COMMENT ON COLUMN fact_finding_sessions.token_digest_sha256 IS
  'SHA-256 digest only. The raw session token is never stored.';
