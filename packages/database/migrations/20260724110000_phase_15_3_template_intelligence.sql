-- Phase 15.3: deterministic, agency-controlled Template Intelligence.
-- No archive extraction, template execution, rendering, provider calls or publication.

ALTER TABLE template_versions
  ADD COLUMN IF NOT EXISTS analysis_status varchar(30) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS artifact_digest_sha256 varchar(64),
  ADD COLUMN IF NOT EXISTS artifact_reference varchar(1000),
  ADD COLUMN IF NOT EXISTS analyser_version varchar(80);

UPDATE template_versions
SET analysis_status = CASE
  WHEN status = 'APPROVED' THEN 'APPROVED'
  WHEN status = 'RETIRED' THEN 'SUPERSEDED'
  ELSE 'PENDING'
END
WHERE analysis_status = 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_versions_analysis_status_check'
      AND conrelid = 'template_versions'::regclass
  ) THEN
    ALTER TABLE template_versions
      ADD CONSTRAINT template_versions_analysis_status_check
      CHECK (analysis_status IN (
        'PENDING','ANALYSING','REVIEW_REQUIRED','READY_FOR_APPROVAL',
        'APPROVED','REJECTED','FAILED','SUPERSEDED'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_versions_artifact_digest_check'
      AND conrelid = 'template_versions'::regclass
  ) THEN
    ALTER TABLE template_versions
      ADD CONSTRAINT template_versions_artifact_digest_check
      CHECK (
        artifact_digest_sha256 IS NULL
        OR artifact_digest_sha256 ~ '^[0-9a-f]{64}$'
      );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS template_versions_analysis_status_idx
  ON template_versions(analysis_status, created_at);

CREATE TABLE IF NOT EXISTS template_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  template_version_id uuid NOT NULL
    REFERENCES template_versions(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING','ANALYSING','REVIEW_REQUIRED','READY_FOR_APPROVAL',
      'APPROVED','REJECTED','FAILED','SUPERSEDED'
    )),
  analyser_version varchar(80) NOT NULL,
  artifact_digest_sha256 varchar(64) NOT NULL
    CHECK (artifact_digest_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_code varchar(100),
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_agency_user_id uuid NOT NULL
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_analysis_runs_version_digest_analyser_unique
    UNIQUE(template_version_id, artifact_digest_sha256, analyser_version),
  CHECK (jsonb_typeof(summary_json) = 'object'),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX IF NOT EXISTS template_analysis_runs_status_created_idx
  ON template_analysis_runs(status, created_at);
CREATE INDEX IF NOT EXISTS template_analysis_runs_created_by_idx
  ON template_analysis_runs(created_by_agency_user_id);

ALTER TABLE template_layouts
  ADD COLUMN IF NOT EXISTS source_file_path varchar(1000),
  ADD COLUMN IF NOT EXISTS detected_page_type varchar(40) NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS recommended_page_type varchar(40),
  ADD COLUMN IF NOT EXISTS conversion_role varchar(40) NOT NULL DEFAULT 'TRUST_BUILDING',
  ADD COLUMN IF NOT EXISTS classification_confidence_bp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS classification_evidence_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS requires_agency_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS agency_notes text,
  ADD COLUMN IF NOT EXISTS analysis_run_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_layouts_analysis_run_id_fkey'
      AND conrelid = 'template_layouts'::regclass
  ) THEN
    ALTER TABLE template_layouts
      ADD CONSTRAINT template_layouts_analysis_run_id_fkey
      FOREIGN KEY (analysis_run_id)
      REFERENCES template_analysis_runs(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_layouts_detected_page_type_check'
      AND conrelid = 'template_layouts'::regclass
  ) THEN
    ALTER TABLE template_layouts
      ADD CONSTRAINT template_layouts_detected_page_type_check
      CHECK (detected_page_type IN (
        'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
        'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
        'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','BOOKING',
        'PORTFOLIO','SHOP','PRODUCT_DETAIL','CAREERS','BLOG_ARCHIVE',
        'BLOG_ARTICLE','CASE_STUDY','COMING_SOON','ERROR_PAGE','UTILITY_PAGE',
        'UNKNOWN'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_layouts_recommended_page_type_check'
      AND conrelid = 'template_layouts'::regclass
  ) THEN
    ALTER TABLE template_layouts
      ADD CONSTRAINT template_layouts_recommended_page_type_check
      CHECK (
        recommended_page_type IS NULL
        OR recommended_page_type IN (
          'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
          'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
          'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','BOOKING'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_layouts_conversion_role_check'
      AND conrelid = 'template_layouts'::regclass
  ) THEN
    ALTER TABLE template_layouts
      ADD CONSTRAINT template_layouts_conversion_role_check
      CHECK (conversion_role IN (
        'PRIMARY_LANDING','SERVICE_CONVERSION','LOCAL_DISCOVERY',
        'TRUST_BUILDING','OBJECTION_HANDLING','BOOKING'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_layouts_confidence_check'
      AND conrelid = 'template_layouts'::regclass
  ) THEN
    ALTER TABLE template_layouts
      ADD CONSTRAINT template_layouts_confidence_check
      CHECK (classification_confidence_bp BETWEEN 0 AND 10000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_layouts_evidence_json_check'
      AND conrelid = 'template_layouts'::regclass
  ) THEN
    ALTER TABLE template_layouts
      ADD CONSTRAINT template_layouts_evidence_json_check
      CHECK (jsonb_typeof(classification_evidence_json) = 'array');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_layouts_source_path_check'
      AND conrelid = 'template_layouts'::regclass
  ) THEN
    ALTER TABLE template_layouts
      ADD CONSTRAINT template_layouts_source_path_check
      CHECK (
        source_file_path IS NULL
        OR (
          source_file_path !~ '(^/|^[A-Za-z]:[\\/]|(^|/)\.\.(/|$))'
          AND position(E'\\' IN source_file_path) = 0
        )
      );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS template_layouts_analysis_run_idx
  ON template_layouts(analysis_run_id);
CREATE INDEX IF NOT EXISTS template_layouts_version_enabled_status_idx
  ON template_layouts(template_version_id, status)
  WHERE disabled_at IS NULL;

ALTER TABLE template_layout_page_types
  ADD COLUMN IF NOT EXISTS approved_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS template_layout_page_types_approved_by_idx
  ON template_layout_page_types(approved_by_agency_user_id);
CREATE INDEX IF NOT EXISTS template_layout_page_types_approved_idx
  ON template_layout_page_types(template_layout_id, page_type)
  WHERE approved_at IS NOT NULL;

ALTER TABLE template_licenses
  ADD COLUMN IF NOT EXISTS template_version_id uuid
    REFERENCES template_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS envato_item_reference varchar(255),
  ADD COLUMN IF NOT EXISTS project_registration_reference varchar(255),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS template_licenses_version_idx
  ON template_licenses(template_version_id);
CREATE INDEX IF NOT EXISTS template_licenses_verified_by_idx
  ON template_licenses(verified_by_agency_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS template_licenses_site_version_active_unique
  ON template_licenses(site_id, template_version_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS template_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  analysis_run_id uuid NOT NULL
    REFERENCES template_analysis_runs(id) ON DELETE CASCADE,
  relative_path varchar(1000) NOT NULL,
  category varchar(30) NOT NULL
    CHECK (category IN (
      'HTML','CSS','JAVASCRIPT','IMAGE','FONT','SVG','JSON',
      'DOCUMENTATION','BUILD_CONFIG','UNKNOWN'
    )),
  extension varchar(30) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  checksum_sha256 varchar(64)
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  likely_page_candidate boolean NOT NULL DEFAULT false,
  referenced_by_analysed_file boolean NOT NULL DEFAULT false,
  contains_executable_code boolean NOT NULL DEFAULT false,
  safe_for_public_use boolean NOT NULL DEFAULT false,
  requires_agency_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_files_run_path_unique UNIQUE(analysis_run_id, relative_path),
  CHECK (
    relative_path !~ '(^/|^[A-Za-z]:[\\/]|(^|/)\.\.(/|$))'
    AND position(E'\\' IN relative_path) = 0
  )
);
CREATE INDEX IF NOT EXISTS template_files_run_category_idx
  ON template_files(analysis_run_id, category);
CREATE INDEX IF NOT EXISTS template_files_review_idx
  ON template_files(analysis_run_id, category)
  WHERE requires_agency_review;

CREATE TABLE IF NOT EXISTS template_analysis_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  analysis_run_id uuid NOT NULL
    REFERENCES template_analysis_runs(id) ON DELETE CASCADE,
  severity varchar(20) NOT NULL
    CHECK (severity IN ('BLOCKING','WARNING','INFO')),
  category varchar(40) NOT NULL
    CHECK (category IN (
      'SECURITY','STRUCTURE','CLASSIFICATION','RESPONSIVE','ACCESSIBILITY',
      'BOOKING_CONVERSION','DESIGN_SYSTEM','LICENSING'
    )),
  code varchar(100) NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]+$'),
  file_path varchar(1000),
  layout_id uuid REFERENCES template_layouts(id) ON DELETE RESTRICT,
  message varchar(1000) NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  agency_note varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata_json) = 'object'),
  CHECK (
    file_path IS NULL
    OR (
      file_path !~ '(^/|^[A-Za-z]:[\\/]|(^|/)\.\.(/|$))'
      AND position(E'\\' IN file_path) = 0
    )
  ),
  CHECK (
    (resolved_at IS NULL AND resolved_by_agency_user_id IS NULL)
    OR (resolved_at IS NOT NULL AND resolved_by_agency_user_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS template_analysis_findings_run_severity_resolved_idx
  ON template_analysis_findings(analysis_run_id, severity, resolved_at);
CREATE INDEX IF NOT EXISTS template_analysis_findings_layout_idx
  ON template_analysis_findings(layout_id);
CREATE INDEX IF NOT EXISTS template_analysis_findings_resolved_by_idx
  ON template_analysis_findings(resolved_by_agency_user_id);
CREATE INDEX IF NOT EXISTS template_analysis_findings_open_blocking_idx
  ON template_analysis_findings(analysis_run_id, created_at)
  WHERE severity = 'BLOCKING' AND resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS template_layout_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  analysis_run_id uuid NOT NULL
    REFERENCES template_analysis_runs(id) ON DELETE CASCADE,
  layout_id uuid NOT NULL REFERENCES template_layouts(id) ON DELETE CASCADE,
  section_type varchar(40) NOT NULL
    CHECK (section_type IN (
      'HEADER','NAVIGATION','ANNOUNCEMENT_BAR','HERO','INTRODUCTION',
      'FEATURED_SERVICES','SERVICE_GRID','SERVICE_DETAILS','BENEFITS','PROCESS',
      'PRICING','TEAM','STAFF_PROFILE','GALLERY','RESULTS','TESTIMONIALS',
      'REVIEW_SUMMARY','TRUST_INDICATORS','FAQ','LOCATION','OPENING_HOURS',
      'MAP','CONTACT_FORM','NEWSLETTER','POLICIES','BOOKING_CTA','FINAL_CTA',
      'FOOTER','UNKNOWN'
    )),
  confidence_bp integer NOT NULL CHECK (confidence_bp BETWEEN 0 AND 10000),
  dom_order integer NOT NULL CHECK (dom_order >= 0),
  structural_reference varchar(300) NOT NULL,
  required_for_recommended_page_type boolean NOT NULL DEFAULT false,
  contains_booking_action boolean NOT NULL DEFAULT false,
  requires_agency_review boolean NOT NULL DEFAULT false,
  agency_confirmed_at timestamptz,
  agency_confirmed_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_layout_sections_layout_order_unique
    UNIQUE(layout_id, dom_order),
  CHECK (
    (agency_confirmed_at IS NULL AND agency_confirmed_by_agency_user_id IS NULL)
    OR (
      agency_confirmed_at IS NOT NULL
      AND agency_confirmed_by_agency_user_id IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS template_layout_sections_run_section_idx
  ON template_layout_sections(analysis_run_id, section_type);
CREATE INDEX IF NOT EXISTS template_layout_sections_confirmed_by_idx
  ON template_layout_sections(agency_confirmed_by_agency_user_id);

-- Approved manifests and layout classifications are immutable. A new template
-- version is the only supported path for subsequent changes.
CREATE OR REPLACE FUNCTION ks_assert_template_version_mutable(target_version_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  lifecycle_status varchar(30);
  review_status varchar(30);
BEGIN
  SELECT status, analysis_status
  INTO lifecycle_status, review_status
  FROM template_versions
  WHERE id = target_version_id;

  IF lifecycle_status IS NULL THEN
    RAISE EXCEPTION 'Template version does not exist'
      USING ERRCODE = '23503';
  END IF;
  IF lifecycle_status = 'APPROVED' OR review_status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved template versions are immutable'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ks_prevent_approved_template_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'APPROVED' OR OLD.analysis_status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved template versions are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION ks_prevent_approved_template_layout_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_version_id uuid;
BEGIN
  target_version_id := (
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END
    ->> 'template_version_id'
  )::uuid;
  PERFORM ks_assert_template_version_mutable(target_version_id);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION ks_prevent_approved_template_layout_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_layout_id uuid;
  target_version_id uuid;
BEGIN
  target_layout_id := (
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END
    ->> 'layout_id'
  )::uuid;
  IF target_layout_id IS NULL THEN
    target_layout_id := (
      CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END
      ->> 'template_layout_id'
    )::uuid;
  END IF;
  SELECT template_version_id INTO target_version_id
  FROM template_layouts WHERE id = target_layout_id;
  PERFORM ks_assert_template_version_mutable(target_version_id);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION ks_prevent_approved_template_analysis_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  row_json jsonb;
  target_run_id uuid;
  target_version_id uuid;
BEGIN
  row_json := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME = 'template_analysis_runs' THEN
    target_version_id := (row_json ->> 'template_version_id')::uuid;
  ELSE
    target_run_id := (row_json ->> 'analysis_run_id')::uuid;
    SELECT template_version_id INTO target_version_id
    FROM template_analysis_runs WHERE id = target_run_id;
  END IF;
  PERFORM ks_assert_template_version_mutable(target_version_id);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS template_versions_prevent_approved_mutation
  ON template_versions;
CREATE TRIGGER template_versions_prevent_approved_mutation
  BEFORE UPDATE OR DELETE ON template_versions
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_template_version_mutation();

DROP TRIGGER IF EXISTS template_layouts_prevent_approved_mutation
  ON template_layouts;
CREATE TRIGGER template_layouts_prevent_approved_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON template_layouts
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_template_layout_mutation();

DROP TRIGGER IF EXISTS template_layout_page_types_prevent_approved_mutation
  ON template_layout_page_types;
CREATE TRIGGER template_layout_page_types_prevent_approved_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON template_layout_page_types
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_template_layout_child_mutation();

DROP TRIGGER IF EXISTS template_layout_sections_prevent_approved_mutation
  ON template_layout_sections;
CREATE TRIGGER template_layout_sections_prevent_approved_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON template_layout_sections
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_template_layout_child_mutation();

DROP TRIGGER IF EXISTS template_analysis_runs_prevent_approved_mutation
  ON template_analysis_runs;
CREATE TRIGGER template_analysis_runs_prevent_approved_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON template_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_template_analysis_mutation();

DROP TRIGGER IF EXISTS template_files_prevent_approved_mutation
  ON template_files;
CREATE TRIGGER template_files_prevent_approved_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON template_files
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_template_analysis_mutation();

DROP TRIGGER IF EXISTS template_analysis_findings_prevent_approved_mutation
  ON template_analysis_findings;
CREATE TRIGGER template_analysis_findings_prevent_approved_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON template_analysis_findings
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_template_analysis_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'template_analysis_runs',
    'template_files',
    'template_analysis_findings',
    'template_layout_sections'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'REVOKE ALL ON TABLE %I FROM anon, authenticated',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO service_role',
      table_name
    );
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION ks_assert_template_version_mutable(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_prevent_approved_template_version_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_prevent_approved_template_layout_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_prevent_approved_template_layout_child_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_prevent_approved_template_analysis_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ks_assert_template_version_mutable(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION ks_prevent_approved_template_version_mutation()
  TO service_role;
GRANT EXECUTE ON FUNCTION ks_prevent_approved_template_layout_mutation()
  TO service_role;
GRANT EXECUTE ON FUNCTION ks_prevent_approved_template_layout_child_mutation()
  TO service_role;
GRANT EXECUTE ON FUNCTION ks_prevent_approved_template_analysis_mutation()
  TO service_role;
