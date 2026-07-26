-- Phase 15.4: deterministic, agency-controlled site blueprint revisions.
-- This migration extends the Phase 15.1 tables; it does not create site versions,
-- generated content, renderable pages, publication records, or provider links.

ALTER TABLE site_blueprints
  ADD COLUMN IF NOT EXISTS template_version_id uuid
    REFERENCES template_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS plan_assignment_id uuid
    REFERENCES tenant_plan_assignments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_data_digest varchar(64),
  ADD COLUMN IF NOT EXISTS engine_version varchar(80),
  ADD COLUMN IF NOT EXISTS proposed_marketing_page_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entitlement_marketing_page_limit integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS functional_page_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_legal_page_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unused_marketing_page_allowance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entitlement_override_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS readiness_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS generated_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason varchar(1000);

UPDATE site_blueprints
SET status = CASE status
  WHEN 'INTERNAL_REVIEW' THEN 'REVIEW_REQUIRED'
  WHEN 'ARCHIVED' THEN 'SUPERSEDED'
  ELSE status
END
WHERE status IN ('INTERNAL_REVIEW', 'ARCHIVED');

ALTER TABLE site_blueprints
  DROP CONSTRAINT IF EXISTS site_blueprints_status_check;
ALTER TABLE site_blueprints
  DROP CONSTRAINT IF EXISTS site_blueprints_phase_15_4_status_check;
ALTER TABLE site_blueprints
  ADD CONSTRAINT site_blueprints_phase_15_4_status_check
  CHECK (status IN (
    'DRAFT','GENERATING','REVIEW_REQUIRED','READY_FOR_APPROVAL',
    'APPROVED','SUPERSEDED','REJECTED'
  ));

ALTER TABLE site_blueprints
  ADD CONSTRAINT site_blueprints_phase_15_4_counts_check
  CHECK (
    proposed_marketing_page_count >= 0
    AND entitlement_marketing_page_limit >= 0
    AND functional_page_count >= 0
    AND required_legal_page_count >= 0
    AND unused_marketing_page_allowance >= 0
    AND proposed_marketing_page_count <= entitlement_marketing_page_limit
    AND unused_marketing_page_allowance =
      entitlement_marketing_page_limit - proposed_marketing_page_count
  );
ALTER TABLE site_blueprints
  ADD CONSTRAINT site_blueprints_phase_15_4_digest_check
  CHECK (source_data_digest IS NULL OR source_data_digest ~ '^[a-f0-9]{64}$');
ALTER TABLE site_blueprints
  ADD CONSTRAINT site_blueprints_phase_15_4_readiness_json_check
  CHECK (jsonb_typeof(readiness_json) = 'array');
ALTER TABLE site_blueprints
  ADD CONSTRAINT site_blueprints_phase_15_4_generation_metadata_check
  CHECK (
    engine_version IS NULL
    OR (
      template_version_id IS NOT NULL
      AND plan_assignment_id IS NOT NULL
      AND source_data_digest IS NOT NULL
      AND engine_version IS NOT NULL
      AND generated_at IS NOT NULL
      AND generated_by_agency_user_id IS NOT NULL
    )
  );
ALTER TABLE site_blueprints
  ADD CONSTRAINT site_blueprints_phase_15_4_rejection_check
  CHECK (
    (status = 'REJECTED' AND rejected_at IS NOT NULL AND rejection_reason IS NOT NULL)
    OR status <> 'REJECTED'
  );

CREATE UNIQUE INDEX IF NOT EXISTS site_blueprints_site_revision_unique
  ON site_blueprints(site_id, revision);
CREATE INDEX IF NOT EXISTS site_blueprints_site_digest_engine_idx
  ON site_blueprints(site_id, source_data_digest, engine_version);
CREATE INDEX IF NOT EXISTS site_blueprints_template_version_idx
  ON site_blueprints(template_version_id);
CREATE INDEX IF NOT EXISTS site_blueprints_plan_assignment_idx
  ON site_blueprints(plan_assignment_id);
CREATE INDEX IF NOT EXISTS site_blueprints_generated_by_idx
  ON site_blueprints(generated_by_agency_user_id);

ALTER TABLE site_blueprint_pages
  ADD COLUMN IF NOT EXISTS service_id uuid
    REFERENCES services(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS location_id uuid
    REFERENCES locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS staff_user_id uuid
    REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS navigation_group varchar(30) NOT NULL DEFAULT 'CONTEXTUAL',
  ADD COLUMN IF NOT EXISTS navigation_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consumes_marketing_entitlement boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS generation_priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selection_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selection_reasons_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS booking_requirements_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS layout_selection_reason varchar(500),
  ADD COLUMN IF NOT EXISTS agency_notes text;

-- Historical Phase 15.1 blueprints used slug segments. Phase 15.4 plans canonical
-- root-relative paths; preserve the semantic route while upgrading old records.
UPDATE site_blueprint_pages
SET proposed_slug = CASE
  WHEN page_type = 'HOME' THEN '/'
  WHEN page_type = 'BOOKING' THEN '/book'
  WHEN proposed_slug LIKE '/%' THEN proposed_slug
  WHEN page_type = 'SERVICE_DETAIL' THEN '/services/' || proposed_slug
  WHEN page_type = 'LOCATION_DETAIL' THEN '/locations/' || proposed_slug
  WHEN page_type = 'TEAM_DETAIL' THEN '/team/' || proposed_slug
  ELSE '/' || proposed_slug
END
WHERE proposed_slug NOT LIKE '/%' OR page_type IN ('HOME', 'BOOKING');

UPDATE site_blueprint_pages
SET consumes_marketing_entitlement = (entitlement_kind = 'MARKETING');

ALTER TABLE site_blueprint_pages
  DROP CONSTRAINT IF EXISTS site_blueprint_pages_proposed_slug_check;
ALTER TABLE site_blueprint_pages
  DROP CONSTRAINT IF EXISTS site_blueprint_pages_phase_15_4_path_check;
ALTER TABLE site_blueprint_pages
  ADD CONSTRAINT site_blueprint_pages_phase_15_4_path_check
  CHECK (
    proposed_slug = '/'
    OR proposed_slug ~ '^/([a-z0-9]+([a-z0-9/-]*[a-z0-9])?)?$'
  );
ALTER TABLE site_blueprint_pages
  ADD CONSTRAINT site_blueprint_pages_phase_15_4_path_safety_check
  CHECK (
    proposed_slug !~ '(^|/)\.\.(/|$)'
    AND proposed_slug NOT LIKE '%//%'
    AND proposed_slug NOT LIKE '%?%'
    AND proposed_slug NOT LIKE '%#%'
    AND position(chr(92) IN proposed_slug) = 0
  );
ALTER TABLE site_blueprint_pages
  ADD CONSTRAINT site_blueprint_pages_phase_15_4_navigation_check
  CHECK (
    navigation_group IN ('PRIMARY','SECONDARY','CONTEXTUAL','FUNCTIONAL')
    AND navigation_order >= 0
    AND generation_priority >= 0
  );
ALTER TABLE site_blueprint_pages
  ADD CONSTRAINT site_blueprint_pages_phase_15_4_json_check
  CHECK (
    jsonb_typeof(selection_reasons_json) = 'array'
    AND jsonb_typeof(booking_requirements_json) = 'array'
  );
ALTER TABLE site_blueprint_pages
  ADD CONSTRAINT site_blueprint_pages_phase_15_4_mapping_check
  CHECK (
    (page_type = 'SERVICE_DETAIL'
      AND service_id IS NOT NULL AND location_id IS NULL AND staff_user_id IS NULL)
    OR
    (page_type = 'LOCATION_DETAIL'
      AND service_id IS NULL AND location_id IS NOT NULL AND staff_user_id IS NULL)
    OR
    (page_type = 'TEAM_DETAIL'
      AND service_id IS NULL AND location_id IS NULL AND staff_user_id IS NOT NULL)
    OR
    (page_type NOT IN ('SERVICE_DETAIL','LOCATION_DETAIL','TEAM_DETAIL')
      AND service_id IS NULL AND location_id IS NULL AND staff_user_id IS NULL)
    OR
    (service_id IS NULL AND location_id IS NULL AND staff_user_id IS NULL)
  );
ALTER TABLE site_blueprint_pages
  ADD CONSTRAINT site_blueprint_pages_phase_15_4_entitlement_check
  CHECK (
    consumes_marketing_entitlement = (entitlement_kind = 'MARKETING')
    AND (
      page_type <> 'BOOKING'
      OR (
        entitlement_kind = 'FUNCTIONAL'
        AND consumes_marketing_entitlement = false
        AND proposed_slug = '/book'
      )
    )
  );

CREATE INDEX IF NOT EXISTS site_blueprint_pages_service_idx
  ON site_blueprint_pages(service_id);
CREATE INDEX IF NOT EXISTS site_blueprint_pages_location_idx
  ON site_blueprint_pages(location_id);
CREATE INDEX IF NOT EXISTS site_blueprint_pages_staff_idx
  ON site_blueprint_pages(staff_user_id);
CREATE INDEX IF NOT EXISTS site_blueprint_pages_navigation_idx
  ON site_blueprint_pages(blueprint_id, navigation_group, navigation_order);
CREATE UNIQUE INDEX IF NOT EXISTS site_blueprint_pages_blueprint_service_unique
  ON site_blueprint_pages(blueprint_id, service_id)
  WHERE service_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS site_blueprint_pages_blueprint_location_unique
  ON site_blueprint_pages(blueprint_id, location_id)
  WHERE location_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS site_blueprint_pages_blueprint_staff_unique
  ON site_blueprint_pages(blueprint_id, staff_user_id)
  WHERE staff_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_blueprint_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  blueprint_id uuid NOT NULL REFERENCES site_blueprints(id) ON DELETE CASCADE,
  blueprint_page_id uuid REFERENCES site_blueprint_pages(id) ON DELETE CASCADE,
  category varchar(40) NOT NULL
    CHECK (category IN (
      'BUSINESS_PROFILE','SERVICE_DATA','LOCATION_DATA','STAFF_DATA',
      'TEMPLATE','LICENCE','LAYOUT','BOOKING','BRAND','CONTENT',
      'ASSET','ENTITLEMENT'
    )),
  severity varchar(20) NOT NULL CHECK (severity IN ('INFO','WARNING','BLOCKING')),
  status varchar(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','RESOLVED')),
  code varchar(100) NOT NULL CHECK (code ~ '^[A-Z0-9_]+$'),
  message varchar(1000) NOT NULL,
  subject_public_reference uuid,
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  resolution_note varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(safe_metadata_json) = 'object'),
  CHECK (
    (status = 'OPEN'
      AND resolved_at IS NULL
      AND resolved_by_agency_user_id IS NULL
      AND resolution_note IS NULL)
    OR
    (status = 'RESOLVED'
      AND resolved_at IS NOT NULL
      AND resolved_by_agency_user_id IS NOT NULL
      AND resolution_note IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS site_blueprint_action_items_blueprint_status_idx
  ON site_blueprint_action_items(blueprint_id, status, severity);
CREATE INDEX IF NOT EXISTS site_blueprint_action_items_tenant_blueprint_idx
  ON site_blueprint_action_items(tenant_id, blueprint_id);
CREATE INDEX IF NOT EXISTS site_blueprint_action_items_page_idx
  ON site_blueprint_action_items(blueprint_page_id);

CREATE TABLE IF NOT EXISTS site_blueprint_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  blueprint_id uuid REFERENCES site_blueprints(id) ON DELETE SET NULL,
  template_version_id uuid NOT NULL REFERENCES template_versions(id) ON DELETE RESTRICT,
  plan_assignment_id uuid NOT NULL REFERENCES tenant_plan_assignments(id) ON DELETE RESTRICT,
  source_data_digest varchar(64) NOT NULL
    CHECK (source_data_digest ~ '^[a-f0-9]{64}$'),
  engine_version varchar(80) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'STARTED'
    CHECK (status IN ('STARTED','COMPLETED','FAILED')),
  idempotent_replay boolean NOT NULL DEFAULT false,
  requested_by_agency_user_id uuid NOT NULL
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  failure_code varchar(100),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (
    (status = 'STARTED' AND completed_at IS NULL AND failure_code IS NULL)
    OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND failure_code IS NULL)
    OR (status = 'FAILED' AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS site_blueprint_generation_runs_site_digest_idx
  ON site_blueprint_generation_runs(site_id, source_data_digest, engine_version);
CREATE INDEX IF NOT EXISTS site_blueprint_generation_runs_tenant_started_idx
  ON site_blueprint_generation_runs(tenant_id, started_at);
CREATE INDEX IF NOT EXISTS site_blueprint_generation_runs_blueprint_idx
  ON site_blueprint_generation_runs(blueprint_id);
CREATE INDEX IF NOT EXISTS site_blueprint_generation_runs_template_version_idx
  ON site_blueprint_generation_runs(template_version_id);
CREATE INDEX IF NOT EXISTS site_blueprint_generation_runs_plan_assignment_idx
  ON site_blueprint_generation_runs(plan_assignment_id);

CREATE OR REPLACE FUNCTION ks_prevent_approved_site_blueprint_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status NOT IN ('APPROVED', 'SUPERSEDED') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.status = 'APPROVED'
    AND NEW.status = 'SUPERSEDED'
    AND NEW.superseded_at IS NOT NULL
    AND (
      to_jsonb(NEW) - 'status' - 'superseded_at' - 'updated_at'
      =
      to_jsonb(OLD) - 'status' - 'superseded_at' - 'updated_at'
    )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Approved site blueprints are immutable'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS site_blueprints_prevent_approved_mutation
  ON site_blueprints;
CREATE TRIGGER site_blueprints_prevent_approved_mutation
  BEFORE UPDATE OR DELETE ON site_blueprints
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_site_blueprint_mutation();

CREATE OR REPLACE FUNCTION ks_prevent_approved_site_blueprint_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_blueprint_id uuid;
  target_status varchar(30);
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_blueprint_id := OLD.blueprint_id;
  ELSE
    target_blueprint_id := NEW.blueprint_id;
  END IF;
  SELECT status INTO target_status
  FROM site_blueprints
  WHERE id = target_blueprint_id;
  IF target_status IN ('APPROVED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'Approved site blueprint architecture is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_blueprint_pages_prevent_approved_mutation
  ON site_blueprint_pages;
CREATE TRIGGER site_blueprint_pages_prevent_approved_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON site_blueprint_pages
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_site_blueprint_child_mutation();

DROP TRIGGER IF EXISTS site_blueprint_action_items_prevent_approved_mutation
  ON site_blueprint_action_items;
CREATE TRIGGER site_blueprint_action_items_prevent_approved_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON site_blueprint_action_items
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_site_blueprint_child_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'site_blueprint_action_items',
    'site_blueprint_generation_runs'
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

REVOKE EXECUTE ON FUNCTION ks_prevent_approved_site_blueprint_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_prevent_approved_site_blueprint_child_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ks_prevent_approved_site_blueprint_mutation()
  TO service_role;
GRANT EXECUTE ON FUNCTION ks_prevent_approved_site_blueprint_child_mutation()
  TO service_role;
