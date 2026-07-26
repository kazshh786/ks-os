-- Phase 15.6C: controlled structured AI website generation.
-- Additive, agency-controlled and draft-only. No provider secrets or raw prompts.

BEGIN;

CREATE TABLE site_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid REFERENCES site_versions(id) ON DELETE RESTRICT,
  blueprint_id uuid NOT NULL REFERENCES site_blueprints(id) ON DELETE RESTRICT,
  blueprint_revision integer NOT NULL,
  template_version_id uuid NOT NULL REFERENCES template_versions(id) ON DELETE RESTRICT,
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  knowledge_pack_semantic_version text NOT NULL,
  site_job_id uuid REFERENCES site_jobs(id) ON DELETE RESTRICT,
  generation_reason text NOT NULL,
  generator_version text NOT NULL,
  provider_key text NOT NULL,
  model_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  idempotency_key text NOT NULL,
  source_data_digest_sha256 text NOT NULL,
  generation_context_digest_sha256 text,
  prompt_template_version text NOT NULL,
  output_content_digest_sha256 text,
  page_count_planned integer NOT NULL DEFAULT 0,
  page_count_completed integer NOT NULL DEFAULT 0,
  section_count_planned integer NOT NULL DEFAULT 0,
  section_count_completed integer NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  repair_attempt_count integer NOT NULL DEFAULT 0,
  failure_code text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  requested_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_generation_runs_status_check CHECK (status IN (
    'PENDING', 'PREPARING_CONTEXT', 'GENERATING', 'VALIDATING', 'REPAIRING',
    'READY_FOR_REVIEW', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'SUPERSEDED'
  )),
  CONSTRAINT site_generation_runs_reason_check CHECK (
    generation_reason IN ('INITIAL_SITE', 'BLUEPRINT_REVISION', 'PAGE_REGENERATION',
      'SECTION_REGENERATION', 'METADATA_GENERATION', 'STRUCTURED_DATA_GENERATION')
  ),
  CONSTRAINT site_generation_runs_digest_check CHECK (
    source_data_digest_sha256 ~ '^[a-f0-9]{64}$'
    AND (generation_context_digest_sha256 IS NULL OR generation_context_digest_sha256 ~ '^[a-f0-9]{64}$')
    AND (output_content_digest_sha256 IS NULL OR output_content_digest_sha256 ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT site_generation_runs_counts_check CHECK (
    blueprint_revision > 0 AND page_count_planned >= 0 AND page_count_completed >= 0
    AND section_count_planned >= 0 AND section_count_completed >= 0
    AND page_count_completed <= page_count_planned
    AND section_count_completed <= section_count_planned
    AND attempt_count >= 0 AND repair_attempt_count >= 0
  ),
  CONSTRAINT site_generation_runs_identity_unique UNIQUE (tenant_id, idempotency_key)
);

CREATE UNIQUE INDEX site_generation_runs_one_active_site_idx
  ON site_generation_runs (site_id)
  WHERE status IN ('PENDING', 'PREPARING_CONTEXT', 'GENERATING', 'VALIDATING',
    'REPAIRING', 'CANCEL_REQUESTED');
CREATE INDEX site_generation_runs_site_created_idx
  ON site_generation_runs (tenant_id, site_id, created_at DESC, id);
CREATE INDEX site_generation_runs_status_created_idx
  ON site_generation_runs (status, created_at, id);
CREATE INDEX site_generation_runs_version_idx ON site_generation_runs (site_version_id);
CREATE INDEX site_generation_runs_blueprint_idx ON site_generation_runs (blueprint_id);
CREATE INDEX site_generation_runs_template_idx ON site_generation_runs (template_version_id);
CREATE INDEX site_generation_runs_knowledge_idx ON site_generation_runs (knowledge_pack_id);

ALTER TABLE site_versions
  ADD COLUMN generation_run_id uuid REFERENCES site_generation_runs(id) ON DELETE RESTRICT,
  ADD COLUMN generation_status text,
  ADD COLUMN generation_provenance_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN generation_content_digest_sha256 text,
  ADD COLUMN generation_completed_at timestamptz,
  ADD CONSTRAINT site_versions_generation_status_check CHECK (
    generation_status IS NULL OR generation_status IN (
      'INCOMPLETE', 'GENERATING', 'VALIDATING', 'READY_FOR_REVIEW', 'FAILED', 'CANCELLED'
    )
  ),
  ADD CONSTRAINT site_versions_generation_digest_check CHECK (
    generation_content_digest_sha256 IS NULL
    OR generation_content_digest_sha256 ~ '^[a-f0-9]{64}$'
  );
CREATE UNIQUE INDEX site_versions_generation_run_unique
  ON site_versions (generation_run_id) WHERE generation_run_id IS NOT NULL;

CREATE TABLE site_generation_page_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  generation_run_id uuid NOT NULL REFERENCES site_generation_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  site_page_id uuid REFERENCES site_pages(id) ON DELETE RESTRICT,
  planned_page_reference uuid NOT NULL DEFAULT gen_random_uuid(),
  blueprint_page_id uuid NOT NULL REFERENCES site_blueprint_pages(id) ON DELETE RESTRICT,
  template_layout_id uuid NOT NULL REFERENCES template_layouts(id) ON DELETE RESTRICT,
  renderer_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  repair_attempt_count integer NOT NULL DEFAULT 0,
  generation_context_digest_sha256 text,
  output_content_digest_sha256 text,
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_generation_page_runs_status_check CHECK (status IN (
    'PENDING', 'GENERATING', 'VALIDATING', 'REPAIRING', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  CONSTRAINT site_generation_page_runs_counts_check CHECK (
    attempt_count >= 0 AND repair_attempt_count >= 0
  ),
  CONSTRAINT site_generation_page_runs_digest_check CHECK (
    generation_context_digest_sha256 IS NULL OR generation_context_digest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT site_generation_page_runs_output_digest_check CHECK (
    output_content_digest_sha256 IS NULL OR output_content_digest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT site_generation_page_runs_blueprint_unique UNIQUE (
    generation_run_id, blueprint_page_id
  ),
  CONSTRAINT site_generation_page_runs_planned_reference_unique UNIQUE (
    generation_run_id, planned_page_reference
  )
);
CREATE INDEX site_generation_page_runs_run_status_idx
  ON site_generation_page_runs (generation_run_id, status, created_at, id);
CREATE INDEX site_generation_page_runs_page_idx ON site_generation_page_runs (site_page_id);

CREATE TABLE site_generation_section_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  generation_run_id uuid NOT NULL REFERENCES site_generation_runs(id) ON DELETE RESTRICT,
  page_run_id uuid NOT NULL REFERENCES site_generation_page_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_section_id uuid REFERENCES site_sections(id) ON DELETE RESTRICT,
  previous_site_section_id uuid REFERENCES site_sections(id) ON DELETE RESTRICT,
  previous_content_json jsonb,
  previous_actions_json jsonb,
  section_type text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  regeneration_instruction_digest_sha256 text,
  output_content_digest_sha256 text,
  attempt_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_generation_section_runs_status_check CHECK (
    status IN ('PENDING', 'GENERATING', 'VALIDATING', 'COMPLETED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT site_generation_section_runs_digest_check CHECK (
    (regeneration_instruction_digest_sha256 IS NULL OR regeneration_instruction_digest_sha256 ~ '^[a-f0-9]{64}$')
    AND (output_content_digest_sha256 IS NULL OR output_content_digest_sha256 ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT site_generation_section_runs_attempt_check CHECK (attempt_count >= 0)
);
CREATE INDEX site_generation_section_runs_page_idx
  ON site_generation_section_runs (page_run_id, status, created_at, id);
CREATE INDEX site_generation_section_runs_section_idx ON site_generation_section_runs (site_section_id);

CREATE TABLE site_generation_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  generation_run_id uuid NOT NULL REFERENCES site_generation_runs(id) ON DELETE RESTRICT,
  page_run_id uuid REFERENCES site_generation_page_runs(id) ON DELETE RESTRICT,
  section_run_id uuid REFERENCES site_generation_section_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  severity text NOT NULL,
  category text NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  current boolean NOT NULL DEFAULT true,
  resolved_at timestamptz,
  resolved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_generation_findings_severity_check CHECK (severity IN ('ERROR', 'WARNING', 'REVIEW')),
  CONSTRAINT site_generation_findings_message_check CHECK (char_length(message) BETWEEN 1 AND 1000)
);
CREATE INDEX site_generation_findings_run_current_idx
  ON site_generation_findings (generation_run_id, current, severity, created_at, id);
CREATE INDEX site_generation_findings_tenant_created_idx
  ON site_generation_findings (tenant_id, created_at DESC, id);

CREATE TABLE site_generation_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  generation_run_id uuid NOT NULL REFERENCES site_generation_runs(id) ON DELETE RESTRICT,
  page_run_id uuid REFERENCES site_generation_page_runs(id) ON DELETE RESTRICT,
  section_run_id uuid REFERENCES site_generation_section_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  claim_type text NOT NULL,
  claim_status text NOT NULL,
  claim_text_digest_sha256 text NOT NULL,
  fact_keys_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  safe_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_generation_claims_status_check CHECK (
    claim_status IN ('GROUNDED', 'REQUIRES_REVIEW', 'UNSUPPORTED', 'PROHIBITED', 'NOT_APPLICABLE')
  ),
  CONSTRAINT site_generation_claims_digest_check CHECK (claim_text_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT site_generation_claims_fact_keys_check CHECK (jsonb_typeof(fact_keys_json) = 'array')
);
CREATE INDEX site_generation_claims_run_status_idx
  ON site_generation_claims (generation_run_id, claim_status, created_at, id);

CREATE TABLE site_generation_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  generation_run_id uuid NOT NULL REFERENCES site_generation_runs(id) ON DELETE RESTRICT,
  page_run_id uuid REFERENCES site_generation_page_runs(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  context_digest_sha256 text NOT NULL,
  prompt_template_version text NOT NULL,
  selected_rule_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_business_data_keys_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  safe_context_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_character_estimate integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_generation_contexts_digest_check CHECK (context_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT site_generation_contexts_arrays_check CHECK (
    jsonb_typeof(selected_rule_ids_json) = 'array'
    AND jsonb_typeof(missing_business_data_keys_json) = 'array'
  ),
  CONSTRAINT site_generation_contexts_size_check CHECK (input_character_estimate >= 0),
  CONSTRAINT site_generation_contexts_page_unique UNIQUE NULLS NOT DISTINCT (
    generation_run_id, page_run_id
  )
);
CREATE INDEX site_generation_contexts_run_idx
  ON site_generation_contexts (generation_run_id, created_at, id);

CREATE OR REPLACE FUNCTION ks_validate_site_generation_run_ownership()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sites
    WHERE id = NEW.site_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Site-generation site ownership mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.site_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_versions
    WHERE id = NEW.site_version_id AND site_id = NEW.site_id
      AND tenant_id = NEW.tenant_id AND status = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Site-generation requires an owned draft version' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM site_blueprints
    WHERE id = NEW.blueprint_id AND site_id = NEW.site_id
      AND tenant_id = NEW.tenant_id AND status = 'APPROVED'
      AND revision = NEW.blueprint_revision
      AND template_version_id = NEW.template_version_id
  ) THEN
    RAISE EXCEPTION 'Site-generation blueprint ownership or approval mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM template_versions
    WHERE id = NEW.template_version_id AND status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Site-generation template version is not approved' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM knowledge_packs
    WHERE id = NEW.knowledge_pack_id AND intended_scope = 'PUBLIC_SITE'
      AND status = 'ACTIVE'
      AND semantic_version = NEW.knowledge_pack_semantic_version
  ) THEN
    RAISE EXCEPTION 'Site-generation active knowledge-pack mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.site_version_id IS DISTINCT FROM OLD.site_version_id
    OR NEW.blueprint_id IS DISTINCT FROM OLD.blueprint_id
    OR NEW.blueprint_revision IS DISTINCT FROM OLD.blueprint_revision
    OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
    OR NEW.knowledge_pack_id IS DISTINCT FROM OLD.knowledge_pack_id
    OR NEW.knowledge_pack_semantic_version IS DISTINCT FROM OLD.knowledge_pack_semantic_version
    OR NEW.generation_reason IS DISTINCT FROM OLD.generation_reason
    OR NEW.generator_version IS DISTINCT FROM OLD.generator_version
    OR NEW.provider_key IS DISTINCT FROM OLD.provider_key
    OR NEW.model_key IS DISTINCT FROM OLD.model_key
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.source_data_digest_sha256 IS DISTINCT FROM OLD.source_data_digest_sha256
    OR NEW.prompt_template_version IS DISTINCT FROM OLD.prompt_template_version
    OR NEW.requested_by_agency_user_id IS DISTINCT FROM OLD.requested_by_agency_user_id
  ) THEN
    RAISE EXCEPTION 'Site-generation pinned provenance is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ks_validate_site_generation_ownership()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  expected_tenant_id uuid;
  expected_site_id uuid;
  expected_version_id uuid;
  expected_blueprint_id uuid;
  expected_template_version_id uuid;
BEGIN
  SELECT tenant_id, site_id, site_version_id, blueprint_id, template_version_id
    INTO expected_tenant_id, expected_site_id, expected_version_id,
      expected_blueprint_id, expected_template_version_id
  FROM site_generation_runs WHERE id = NEW.generation_run_id;
  IF expected_tenant_id IS NULL OR NEW.tenant_id IS DISTINCT FROM expected_tenant_id THEN
    RAISE EXCEPTION 'Site-generation tenant ownership mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'site_generation_page_runs'
    AND NEW.site_id IS DISTINCT FROM expected_site_id THEN
    RAISE EXCEPTION 'Site-generation site ownership mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'site_generation_page_runs' AND (
    NEW.site_version_id IS DISTINCT FROM expected_version_id
    OR NOT EXISTS (
      SELECT 1 FROM site_blueprint_pages
      WHERE id = NEW.blueprint_page_id AND blueprint_id = expected_blueprint_id
        AND tenant_id = expected_tenant_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM template_layouts
      WHERE id = NEW.template_layout_id
        AND template_version_id = expected_template_version_id
        AND status = 'APPROVED'
    )
  ) THEN
    RAISE EXCEPTION 'Site-generation page provenance mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'site_generation_section_runs' AND NOT EXISTS (
    SELECT 1 FROM site_generation_page_runs
    WHERE id = NEW.page_run_id AND generation_run_id = NEW.generation_run_id
      AND tenant_id = expected_tenant_id
  ) THEN
    RAISE EXCEPTION 'Site-generation section ownership mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME IN ('site_generation_findings', 'site_generation_claims') THEN
    IF NEW.page_run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM site_generation_page_runs
      WHERE id = NEW.page_run_id AND generation_run_id = NEW.generation_run_id
    ) THEN
      RAISE EXCEPTION 'Site-generation finding or claim page mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.section_run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM site_generation_section_runs
      WHERE id = NEW.section_run_id AND generation_run_id = NEW.generation_run_id
    ) THEN
      RAISE EXCEPTION 'Site-generation finding or claim section mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'site_generation_contexts' AND NEW.page_run_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM site_generation_page_runs
      WHERE id = NEW.page_run_id AND generation_run_id = NEW.generation_run_id
    ) THEN
    RAISE EXCEPTION 'Site-generation context page mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ks_validate_site_generation_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.status = OLD.status THEN NEW.updated_at := now(); RETURN NEW; END IF;
  allowed := CASE OLD.status
    WHEN 'PENDING' THEN NEW.status IN ('PREPARING_CONTEXT', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED')
    WHEN 'PREPARING_CONTEXT' THEN NEW.status IN ('GENERATING', 'CANCEL_REQUESTED', 'FAILED')
    WHEN 'GENERATING' THEN NEW.status IN ('VALIDATING', 'CANCEL_REQUESTED', 'FAILED')
    WHEN 'VALIDATING' THEN NEW.status IN ('REPAIRING', 'READY_FOR_REVIEW', 'CANCEL_REQUESTED', 'FAILED')
    WHEN 'REPAIRING' THEN NEW.status IN ('GENERATING', 'VALIDATING', 'CANCEL_REQUESTED', 'FAILED')
    WHEN 'READY_FOR_REVIEW' THEN NEW.status = 'SUPERSEDED'
    WHEN 'FAILED' THEN NEW.status IN ('PENDING', 'SUPERSEDED')
    WHEN 'CANCEL_REQUESTED' THEN NEW.status IN ('CANCELLED', 'FAILED')
    WHEN 'CANCELLED' THEN NEW.status IN ('PENDING', 'SUPERSEDED')
    ELSE false
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid site-generation transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_generation_runs_transition_guard
  BEFORE UPDATE OF status ON site_generation_runs
  FOR EACH ROW EXECUTE FUNCTION ks_validate_site_generation_transition();
CREATE TRIGGER site_generation_runs_ownership_guard
  BEFORE INSERT OR UPDATE ON site_generation_runs
  FOR EACH ROW EXECUTE FUNCTION ks_validate_site_generation_run_ownership();

CREATE TRIGGER site_generation_page_runs_ownership_guard
  BEFORE INSERT OR UPDATE ON site_generation_page_runs
  FOR EACH ROW EXECUTE FUNCTION ks_validate_site_generation_ownership();
CREATE TRIGGER site_generation_section_runs_ownership_guard
  BEFORE INSERT OR UPDATE ON site_generation_section_runs
  FOR EACH ROW EXECUTE FUNCTION ks_validate_site_generation_ownership();
CREATE TRIGGER site_generation_findings_ownership_guard
  BEFORE INSERT OR UPDATE ON site_generation_findings
  FOR EACH ROW EXECUTE FUNCTION ks_validate_site_generation_ownership();
CREATE TRIGGER site_generation_claims_ownership_guard
  BEFORE INSERT OR UPDATE ON site_generation_claims
  FOR EACH ROW EXECUTE FUNCTION ks_validate_site_generation_ownership();
CREATE TRIGGER site_generation_contexts_ownership_guard
  BEFORE INSERT OR UPDATE ON site_generation_contexts
  FOR EACH ROW EXECUTE FUNCTION ks_validate_site_generation_ownership();

ALTER TABLE site_generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_generation_page_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_generation_section_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_generation_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_generation_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_generation_contexts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  site_generation_runs, site_generation_page_runs, site_generation_section_runs,
  site_generation_findings, site_generation_claims, site_generation_contexts
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  site_generation_runs, site_generation_page_runs, site_generation_section_runs,
  site_generation_findings, site_generation_claims, site_generation_contexts
TO service_role;

REVOKE EXECUTE ON FUNCTION ks_validate_site_generation_ownership()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_validate_site_generation_run_ownership()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_validate_site_generation_transition()
  FROM PUBLIC, anon, authenticated;

COMMIT;
