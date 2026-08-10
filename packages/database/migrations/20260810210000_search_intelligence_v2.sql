BEGIN;

ALTER TABLE template_layouts
  DROP CONSTRAINT IF EXISTS template_layouts_detected_page_type_check,
  DROP CONSTRAINT IF EXISTS template_layouts_recommended_page_type_check;

ALTER TABLE template_layouts
  ADD CONSTRAINT template_layouts_detected_page_type_check
  CHECK (detected_page_type IN (
    'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
    'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
    'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','GUIDE','HOW_TO',
    'ARTICLE','BLOG_POST','FAQ_RESOURCE','TUTORIAL','DEFINITION','TROUBLESHOOTING',
    'COMPARISON','CASE_STUDY','BOOKING','PORTFOLIO','SHOP','PRODUCT_DETAIL',
    'CAREERS','BLOG_ARCHIVE','BLOG_ARTICLE','COMING_SOON','ERROR_PAGE',
    'UTILITY_PAGE','UNKNOWN'
  )),
  ADD CONSTRAINT template_layouts_recommended_page_type_check
  CHECK (
    recommended_page_type IS NULL OR recommended_page_type IN (
      'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
      'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
      'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','GUIDE','HOW_TO',
      'ARTICLE','BLOG_POST','FAQ_RESOURCE','TUTORIAL','DEFINITION','TROUBLESHOOTING',
      'COMPARISON','CASE_STUDY','BOOKING'
    )
  );

ALTER TABLE template_layout_page_types
  DROP CONSTRAINT IF EXISTS template_layout_page_types_page_type_check;
ALTER TABLE template_layout_page_types
  ADD CONSTRAINT template_layout_page_types_page_type_check CHECK (page_type IN (
    'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
    'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
    'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','GUIDE','HOW_TO',
    'ARTICLE','BLOG_POST','FAQ_RESOURCE','TUTORIAL','DEFINITION','TROUBLESHOOTING',
    'COMPARISON','CASE_STUDY','BOOKING'
  ));

ALTER TABLE site_blueprint_pages DROP CONSTRAINT IF EXISTS site_blueprint_pages_page_type_check;
ALTER TABLE site_blueprint_pages ADD CONSTRAINT site_blueprint_pages_page_type_check CHECK (page_type IN (
  'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
  'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
  'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','GUIDE','HOW_TO',
  'ARTICLE','BLOG_POST','FAQ_RESOURCE','TUTORIAL','DEFINITION','TROUBLESHOOTING',
  'COMPARISON','CASE_STUDY','BOOKING'
));

ALTER TABLE site_pages DROP CONSTRAINT IF EXISTS site_pages_page_type_check;
ALTER TABLE site_pages ADD CONSTRAINT site_pages_page_type_check CHECK (page_type IN (
  'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
  'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
  'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','GUIDE','HOW_TO',
  'ARTICLE','BLOG_POST','FAQ_RESOURCE','TUTORIAL','DEFINITION','TROUBLESHOOTING',
  'COMPARISON','CASE_STUDY','BOOKING'
));

ALTER TABLE knowledge_rule_page_types
  DROP CONSTRAINT IF EXISTS knowledge_rule_page_types_value_check;
ALTER TABLE knowledge_rule_page_types
  ADD CONSTRAINT knowledge_rule_page_types_value_check CHECK (page_type IN (
    'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
    'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
    'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','GUIDE','HOW_TO',
    'ARTICLE','BLOG_POST','FAQ_RESOURCE','TUTORIAL','DEFINITION','TROUBLESHOOTING',
    'COMPARISON','CASE_STUDY','BOOKING'
  ));

ALTER TABLE knowledge_page_playbooks
  DROP CONSTRAINT IF EXISTS knowledge_page_playbooks_page_type_check;
ALTER TABLE knowledge_page_playbooks
  ADD CONSTRAINT knowledge_page_playbooks_page_type_check CHECK (page_type IN (
    'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
    'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
    'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','GUIDE','HOW_TO',
    'ARTICLE','BLOG_POST','FAQ_RESOURCE','TUTORIAL','DEFINITION','TROUBLESHOOTING',
    'COMPARISON','CASE_STUDY','BOOKING'
  ));

-- V2 is already approved and immutable. Preserve it for existing blueprints,
-- then clone its governed capability graph into V3 before adding the ten new
-- editorial page mappings. Approval remains the final write.
DO $$
DECLARE
  v_actor_id uuid;
  v_source_id uuid;
  v_v2_id uuid;
  v_v3_id uuid;
  v_v3_reference uuid;
  v_analysis_run_id uuid;
  v_new_layout_id uuid;
  layout_item record;
BEGIN
  SELECT id INTO v_actor_id
  FROM agency_users
  WHERE status = 'ACTIVE'
  ORDER BY CASE WHEN role = 'PLATFORM_OWNER' THEN 0 ELSE 1 END, created_at
  LIMIT 1;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V3_REQUIRES_ACTIVE_AGENCY_USER'; END IF;

  SELECT id INTO v_source_id
  FROM template_sources
  WHERE source_reference = 'ks-native-component-system'
  LIMIT 1;
  IF v_source_id IS NULL THEN RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V3_REQUIRES_NATIVE_SOURCE'; END IF;

  SELECT id INTO v_v2_id
  FROM template_versions
  WHERE template_source_id = v_source_id
    AND version_number = 2
    AND status = 'APPROVED'
    AND analysis_status = 'APPROVED'
  LIMIT 1;
  IF v_v2_id IS NULL THEN RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V3_REQUIRES_APPROVED_V2'; END IF;

  INSERT INTO template_versions (
    public_reference, template_source_id, version_number, status, manifest_json,
    checksum_sha256, analysis_status, artifact_digest_sha256, artifact_reference,
    analyser_version
  )
  SELECT
    'e054818e-c185-44fd-b453-010000000005'::uuid,
    v_source_id,
    3,
    'DRAFT',
    jsonb_build_object(
      'name', 'KS Native Component System V3',
      'kind', 'CONTROLLED_COMPONENT_REGISTRY',
      'schemaVersion', 2,
      'componentRegistryVersion', 2,
      'rendererRegistryVersion', 1,
      'designLibraryVersion', 2,
      'generationPipelineVersion', 2,
      'searchIntelligenceVersion', 2,
      'selectionPolicy', 'REGISTRY_COMPATIBLE_ONLY'
    ),
    repeat('e', 64),
    'PENDING',
    repeat('f', 64),
    'internal://ks-native-component-system/v3-search-intelligence',
    'ks-native-registry-3'
  WHERE NOT EXISTS (
    SELECT 1 FROM template_versions
    WHERE template_source_id = v_source_id AND version_number = 3
  );

  SELECT id, public_reference INTO v_v3_id, v_v3_reference
  FROM template_versions
  WHERE template_source_id = v_source_id AND version_number = 3
  LIMIT 1;
  IF v_v3_reference <> 'e054818e-c185-44fd-b453-010000000005'::uuid THEN
    RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V3_VERSION_IDENTITY_CONFLICT';
  END IF;

  IF EXISTS (SELECT 1 FROM template_versions WHERE id = v_v3_id AND status = 'APPROVED') THEN
    IF NOT EXISTS (SELECT 1 FROM template_versions WHERE id = v_v3_id AND analysis_status = 'APPROVED')
      OR (SELECT count(*) FROM template_layouts WHERE template_version_id = v_v3_id AND status = 'APPROVED') <> 13
      OR (SELECT count(DISTINCT mapping.page_type)
          FROM template_layout_page_types mapping
          INNER JOIN template_layouts layout_row ON layout_row.id = mapping.template_layout_id
          WHERE layout_row.template_version_id = v_v3_id) <> 26
    THEN
      RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V3_APPROVED_GRAPH_INVALID';
    END IF;
    RETURN;
  END IF;

  INSERT INTO template_analysis_runs (
    public_reference, template_version_id, status, analyser_version,
    artifact_digest_sha256, started_at, completed_at, attempt_count,
    summary_json, created_by_agency_user_id
  )
  SELECT
    'e054818e-c185-44fd-b453-010000000006'::uuid,
    v_v3_id,
    'APPROVED',
    'ks-native-registry-3',
    repeat('f', 64),
    now(), now(), 1,
    jsonb_build_object(
      'analysisKind', 'OWNED_COMPILE_TIME_REGISTRY',
      'layoutCount', 13,
      'pageTypeCount', 26,
      'componentRegistryVersion', 2,
      'searchIntelligenceVersion', 2,
      'executableTemplateFiles', 0,
      'blockingFindings', 0
    ),
    v_actor_id
  WHERE NOT EXISTS (
    SELECT 1 FROM template_analysis_runs
    WHERE template_version_id = v_v3_id
      AND artifact_digest_sha256 = repeat('f', 64)
      AND analyser_version = 'ks-native-registry-3'
  );

  SELECT id INTO v_analysis_run_id
  FROM template_analysis_runs
  WHERE template_version_id = v_v3_id
    AND artifact_digest_sha256 = repeat('f', 64)
    AND analyser_version = 'ks-native-registry-3'
  LIMIT 1;

  FOR layout_item IN
    SELECT * FROM template_layouts WHERE template_version_id = v_v2_id ORDER BY semantic_key
  LOOP
    INSERT INTO template_layouts (
      template_version_id, name, semantic_key, status, section_manifest_json,
      source_file_path, detected_page_type, recommended_page_type,
      conversion_role, classification_confidence_bp, classification_evidence_json,
      requires_agency_review, disabled_at, agency_notes, analysis_run_id
    )
    SELECT
      v_v3_id,
      replace(layout_item.name, ' V2', ' V3'),
      layout_item.semantic_key,
      'APPROVED',
      layout_item.section_manifest_json,
      replace(layout_item.source_file_path, '/v2/', '/v3/'),
      layout_item.detected_page_type,
      layout_item.recommended_page_type,
      layout_item.conversion_role,
      layout_item.classification_confidence_bp,
      layout_item.classification_evidence_json || jsonb_build_array('Search Intelligence V2 editorial capability extension.'),
      false,
      NULL,
      'Immutable KS-native V3 layout cloned from approved V2 with governed editorial compatibility.',
      v_analysis_run_id
    WHERE NOT EXISTS (
      SELECT 1 FROM template_layouts
      WHERE template_version_id = v_v3_id AND semantic_key = layout_item.semantic_key
    );

    SELECT id INTO v_new_layout_id
    FROM template_layouts
    WHERE template_version_id = v_v3_id AND semantic_key = layout_item.semantic_key
    LIMIT 1;

    INSERT INTO template_layout_page_types (
      template_layout_id, page_type, approved_by_agency_user_id, approved_at
    )
    SELECT v_new_layout_id, old_mapping.page_type, v_actor_id, now()
    FROM template_layout_page_types old_mapping
    WHERE old_mapping.template_layout_id = layout_item.id
    ON CONFLICT (template_layout_id, page_type) DO NOTHING;

    IF layout_item.semantic_key = 'native-guide' THEN
      INSERT INTO template_layout_page_types (
        template_layout_id, page_type, approved_by_agency_user_id, approved_at
      )
      SELECT v_new_layout_id, page_type_value, v_actor_id, now()
      FROM unnest(ARRAY[
        'GUIDE','HOW_TO','ARTICLE','BLOG_POST','FAQ_RESOURCE','TUTORIAL',
        'DEFINITION','TROUBLESHOOTING','COMPARISON','CASE_STUDY'
      ]) AS page_type_value
      ON CONFLICT (template_layout_id, page_type) DO NOTHING;
    END IF;

    INSERT INTO template_layout_renderers (
      template_layout_id, renderer_key, renderer_status, renderer_version,
      renderer_mapped_at, renderer_mapped_by_agency_user_id
    )
    SELECT
      v_new_layout_id, renderer_key, renderer_status, renderer_version,
      now(), v_actor_id
    FROM template_layout_renderers
    WHERE template_layout_id = layout_item.id
    ON CONFLICT (template_layout_id) DO NOTHING;

    INSERT INTO template_layout_sections (
      analysis_run_id, layout_id, section_type, confidence_bp, dom_order,
      structural_reference, required_for_recommended_page_type,
      contains_booking_action, requires_agency_review, agency_confirmed_at,
      agency_confirmed_by_agency_user_id
    )
    SELECT
      v_analysis_run_id,
      v_new_layout_id,
      section_type,
      confidence_bp,
      dom_order,
      replace(structural_reference, 'native-', 'native-v3-'),
      required_for_recommended_page_type,
      contains_booking_action,
      false,
      now(),
      v_actor_id
    FROM template_layout_sections
    WHERE layout_id = layout_item.id
    ON CONFLICT (layout_id, dom_order) DO NOTHING;
  END LOOP;

  IF (SELECT count(*) FROM template_layouts WHERE template_version_id = v_v3_id AND status = 'APPROVED') <> 13
    OR (SELECT count(*)
        FROM template_layout_renderers renderer
        INNER JOIN template_layouts layout_row ON layout_row.id = renderer.template_layout_id
        WHERE layout_row.template_version_id = v_v3_id AND renderer.renderer_status = 'READY') <> 13
    OR EXISTS (
      SELECT 1 FROM template_layouts layout_row
      WHERE layout_row.template_version_id = v_v3_id
        AND NOT EXISTS (SELECT 1 FROM template_layout_sections section_row WHERE section_row.layout_id = layout_row.id)
    )
    OR (SELECT count(DISTINCT mapping.page_type)
        FROM template_layout_page_types mapping
        INNER JOIN template_layouts layout_row ON layout_row.id = mapping.template_layout_id
        WHERE layout_row.template_version_id = v_v3_id) <> 26
  THEN
    RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V3_GRAPH_INVALID';
  END IF;

  UPDATE template_versions
  SET status = 'APPROVED',
      analysis_status = 'APPROVED',
      approved_by_agency_user_id = v_actor_id,
      approved_at = now(),
      analyser_version = 'ks-native-registry-3'
  WHERE id = v_v3_id;
END
$$;

CREATE TABLE site_search_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  blueprint_id uuid NOT NULL REFERENCES site_blueprints(id) ON DELETE RESTRICT,
  blueprint_revision integer NOT NULL CHECK (blueprint_revision > 0),
  strategy_version integer NOT NULL CHECK (strategy_version > 0),
  status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','APPROVED','SUPERSEDED','REJECTED')),
  strategy_json jsonb NOT NULL CHECK (jsonb_typeof(strategy_json) = 'object'),
  input_digest_sha256 varchar(64) NOT NULL CHECK (input_digest_sha256 ~ '^[0-9a-f]{64}$'),
  research_digest_sha256 varchar(64) NOT NULL CHECK (research_digest_sha256 ~ '^[0-9a-f]{64}$'),
  output_digest_sha256 varchar(64) NOT NULL CHECK (output_digest_sha256 ~ '^[0-9a-f]{64}$'),
  provider_key varchar(80) NOT NULL,
  model_key varchar(160) NOT NULL,
  generated_at timestamptz NOT NULL,
  generated_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  approved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_search_strategies_approval_check CHECK (
    (status = 'APPROVED' AND approved_at IS NOT NULL AND approved_by_agency_user_id IS NOT NULL)
    OR (status <> 'APPROVED')
  ),
  CONSTRAINT site_search_strategies_version_unique UNIQUE (blueprint_id, strategy_version)
);

CREATE UNIQUE INDEX site_search_strategies_approved_unique
  ON site_search_strategies(site_id, blueprint_id, blueprint_revision)
  WHERE status = 'APPROVED';
CREATE INDEX site_search_strategies_site_status_idx
  ON site_search_strategies(tenant_id, site_id, status, created_at);
CREATE INDEX site_search_strategies_blueprint_idx
  ON site_search_strategies(blueprint_id, blueprint_revision);

CREATE TABLE site_search_research_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  strategy_id uuid REFERENCES site_search_strategies(id) ON DELETE RESTRICT,
  provider_key varchar(80) NOT NULL,
  query varchar(240) NOT NULL,
  market varchar(80) NOT NULL,
  locale varchar(35) NOT NULL,
  search_location varchar(160) NOT NULL,
  language varchar(35) NOT NULL,
  device varchar(20) NOT NULL CHECK (device IN ('DESKTOP','MOBILE')),
  captured_at timestamptz NOT NULL,
  expires_at timestamptz,
  source_url varchar(2000),
  source_digest_sha256 varchar(64) NOT NULL CHECK (source_digest_sha256 ~ '^[0-9a-f]{64}$'),
  payload_digest_sha256 varchar(64) NOT NULL CHECK (payload_digest_sha256 ~ '^[0-9a-f]{64}$'),
  notes_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(notes_json) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > captured_at)
);
CREATE INDEX site_search_research_evidence_strategy_idx
  ON site_search_research_evidence(strategy_id, captured_at);
CREATE INDEX site_search_research_evidence_freshness_idx
  ON site_search_research_evidence(tenant_id, site_id, expires_at);

CREATE TABLE site_page_seo_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  blueprint_id uuid NOT NULL REFERENCES site_blueprints(id) ON DELETE RESTRICT,
  blueprint_page_id uuid NOT NULL REFERENCES site_blueprint_pages(id) ON DELETE RESTRICT,
  strategy_id uuid NOT NULL REFERENCES site_search_strategies(id) ON DELETE RESTRICT,
  page_reference uuid NOT NULL,
  brief_version integer NOT NULL CHECK (brief_version > 0),
  status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','APPROVED','SUPERSEDED')),
  brief_json jsonb NOT NULL CHECK (jsonb_typeof(brief_json) = 'object'),
  output_digest_sha256 varchar(64) NOT NULL CHECK (output_digest_sha256 ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz,
  approved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_page_seo_briefs_approval_check CHECK (
    (status = 'APPROVED' AND approved_at IS NOT NULL AND approved_by_agency_user_id IS NOT NULL)
    OR (status <> 'APPROVED')
  ),
  CONSTRAINT site_page_seo_briefs_version_unique
    UNIQUE (strategy_id, blueprint_page_id, brief_version)
);
CREATE UNIQUE INDEX site_page_seo_briefs_approved_unique
  ON site_page_seo_briefs(strategy_id, blueprint_page_id)
  WHERE status = 'APPROVED';
CREATE UNIQUE INDEX site_page_seo_briefs_page_reference_unique
  ON site_page_seo_briefs(strategy_id, page_reference);
CREATE INDEX site_page_seo_briefs_page_status_idx
  ON site_page_seo_briefs(tenant_id, site_id, page_reference, status);
CREATE INDEX site_page_seo_briefs_strategy_status_idx
  ON site_page_seo_briefs(strategy_id, status);

CREATE TABLE site_search_topic_ownership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  strategy_id uuid NOT NULL REFERENCES site_search_strategies(id) ON DELETE CASCADE,
  topic_cluster_key varchar(120) NOT NULL,
  page_reference uuid NOT NULL,
  primary_keyword varchar(240) NOT NULL,
  intentional_overlap boolean NOT NULL DEFAULT false,
  cannibalization_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_search_topic_ownership_unique
    UNIQUE (strategy_id, topic_cluster_key, page_reference),
  CHECK (NOT intentional_overlap OR cannibalization_notes IS NOT NULL)
);
CREATE INDEX site_search_topic_ownership_keyword_idx
  ON site_search_topic_ownership(strategy_id, lower(primary_keyword));

CREATE TABLE site_search_internal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  strategy_id uuid NOT NULL REFERENCES site_search_strategies(id) ON DELETE CASCADE,
  source_page_reference uuid NOT NULL,
  target_page_reference uuid NOT NULL,
  anchor_text varchar(120) NOT NULL,
  purpose varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_search_internal_links_unique
    UNIQUE (strategy_id, source_page_reference, target_page_reference, anchor_text),
  CHECK (source_page_reference <> target_page_reference)
);
CREATE INDEX site_search_internal_links_target_idx
  ON site_search_internal_links(strategy_id, target_page_reference);

CREATE TABLE site_path_redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  source_path varchar(120) NOT NULL,
  target_path varchar(120) NOT NULL,
  status_code integer NOT NULL DEFAULT 308 CHECK (status_code = 308),
  active boolean NOT NULL DEFAULT true,
  reason varchar(500) NOT NULL,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CONSTRAINT site_path_redirects_source_unique UNIQUE (site_id, source_path),
  CHECK (source_path ~ '^/(?:[a-z0-9](?:[a-z0-9/-]*[a-z0-9])?)?$'),
  CHECK (target_path ~ '^/(?:[a-z0-9](?:[a-z0-9/-]*[a-z0-9])?)?$'),
  CHECK (source_path <> target_path),
  CHECK ((active AND retired_at IS NULL) OR (NOT active AND retired_at IS NOT NULL))
);
CREATE INDEX site_path_redirects_active_idx
  ON site_path_redirects(tenant_id, site_id, active);

CREATE TABLE site_page_language_alternates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  page_reference uuid NOT NULL,
  language_code varchar(35) NOT NULL,
  alternate_page_reference uuid NOT NULL,
  alternate_path varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_page_language_alternates_unique
    UNIQUE (site_id, page_reference, language_code),
  CHECK (language_code ~ '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$'),
  CHECK (alternate_path ~ '^/(?:[a-z0-9](?:[a-z0-9/-]*[a-z0-9])?)?$'),
  CHECK (page_reference <> alternate_page_reference)
);
CREATE INDEX site_page_language_alternates_alternate_idx
  ON site_page_language_alternates(site_id, alternate_page_reference);

ALTER TABLE site_generation_runs
  ADD COLUMN search_strategy_id uuid REFERENCES site_search_strategies(id) ON DELETE RESTRICT,
  ADD COLUMN search_strategy_version integer,
  ADD COLUMN search_strategy_digest_sha256 varchar(64),
  ADD CONSTRAINT site_generation_runs_search_strategy_pin_check CHECK (
    (search_strategy_id IS NULL AND search_strategy_version IS NULL AND search_strategy_digest_sha256 IS NULL)
    OR (
      search_strategy_id IS NOT NULL
      AND search_strategy_version > 0
      AND search_strategy_digest_sha256 ~ '^[0-9a-f]{64}$'
    )
  );
CREATE INDEX site_generation_runs_search_strategy_idx
  ON site_generation_runs(search_strategy_id);

CREATE OR REPLACE FUNCTION ks_validate_search_intelligence_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  target_tenant uuid := (row_json ->> 'tenant_id')::uuid;
  target_site uuid := (row_json ->> 'site_id')::uuid;
  target_strategy uuid := NULLIF(row_json ->> 'strategy_id', '')::uuid;
BEGIN
  IF TG_TABLE_NAME = 'site_search_strategies' THEN
    IF NOT EXISTS (
      SELECT 1 FROM site_blueprints blueprint
      WHERE blueprint.id = NEW.blueprint_id
        AND blueprint.tenant_id = NEW.tenant_id
        AND blueprint.site_id = NEW.site_id
        AND blueprint.revision = NEW.blueprint_revision
        AND blueprint.status = 'APPROVED'
    ) THEN RAISE EXCEPTION 'SEARCH_STRATEGY_BLUEPRINT_SCOPE_INVALID'; END IF;
  ELSIF target_strategy IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_search_strategies strategy
    WHERE strategy.id = target_strategy
      AND strategy.tenant_id = target_tenant
      AND strategy.site_id = target_site
  ) THEN RAISE EXCEPTION 'SEARCH_INTELLIGENCE_STRATEGY_SCOPE_INVALID';
  END IF;

  IF TG_TABLE_NAME = 'site_page_seo_briefs' AND NOT EXISTS (
    SELECT 1
    FROM site_blueprint_pages page
    JOIN site_search_strategies strategy ON strategy.id = NEW.strategy_id
    WHERE page.id = NEW.blueprint_page_id
      AND page.tenant_id = NEW.tenant_id
      AND page.blueprint_id = NEW.blueprint_id
      AND strategy.blueprint_id = NEW.blueprint_id
  ) THEN RAISE EXCEPTION 'PAGE_SEO_BRIEF_BLUEPRINT_SCOPE_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM sites site WHERE site.id = target_site AND site.tenant_id = target_tenant
  ) THEN RAISE EXCEPTION 'SEARCH_INTELLIGENCE_SITE_SCOPE_INVALID'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ks_govern_search_intelligence_artifact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'APPROVED' THEN
      RAISE EXCEPTION 'APPROVED_SEARCH_ARTIFACT_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'site_page_seo_briefs' AND NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN
    SELECT status INTO parent_status FROM site_search_strategies WHERE id = NEW.strategy_id;
    IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'PAGE_SEO_BRIEF_APPROVAL_REQUIRES_DRAFT_STRATEGY'; END IF;
  END IF;

  IF OLD.status = 'APPROVED' THEN
    IF NEW.status = 'SUPERSEDED'
      AND NEW.superseded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['status','superseded_at','updated_at'])
        = (to_jsonb(OLD) - ARRAY['status','superseded_at','updated_at'])
    THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;
    IF to_jsonb(NEW) <> to_jsonb(OLD) THEN
      RAISE EXCEPTION 'APPROVED_SEARCH_ARTIFACT_IMMUTABLE';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ks_validate_search_strategy_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  planned_count integer;
  approved_brief_count integer;
BEGIN
  IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN
    SELECT count(*) INTO planned_count FROM site_blueprint_pages WHERE blueprint_id = NEW.blueprint_id;
    SELECT count(*) INTO approved_brief_count
    FROM site_page_seo_briefs
    WHERE strategy_id = NEW.id AND status = 'APPROVED';
    IF planned_count = 0 OR approved_brief_count <> planned_count THEN
      RAISE EXCEPTION 'SEARCH_STRATEGY_REQUIRES_EXACT_APPROVED_PAGE_BRIEFS';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ks_prevent_approved_search_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_strategy uuid;
BEGIN
  target_strategy := CASE WHEN TG_OP = 'DELETE' THEN OLD.strategy_id ELSE NEW.strategy_id END;
  IF EXISTS (SELECT 1 FROM site_search_strategies WHERE id = target_strategy AND status = 'APPROVED') THEN
    RAISE EXCEPTION 'APPROVED_SEARCH_STRATEGY_CHILD_IMMUTABLE';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION ks_search_evidence_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SEARCH_RESEARCH_EVIDENCE_APPEND_ONLY';
END;
$$;

CREATE TRIGGER site_search_strategies_scope
  BEFORE INSERT OR UPDATE ON site_search_strategies
  FOR EACH ROW EXECUTE FUNCTION ks_validate_search_intelligence_scope();
CREATE TRIGGER site_search_research_evidence_scope
  BEFORE INSERT ON site_search_research_evidence
  FOR EACH ROW EXECUTE FUNCTION ks_validate_search_intelligence_scope();
CREATE TRIGGER site_page_seo_briefs_scope
  BEFORE INSERT OR UPDATE ON site_page_seo_briefs
  FOR EACH ROW EXECUTE FUNCTION ks_validate_search_intelligence_scope();
CREATE TRIGGER site_search_topic_ownership_scope
  BEFORE INSERT OR UPDATE ON site_search_topic_ownership
  FOR EACH ROW EXECUTE FUNCTION ks_validate_search_intelligence_scope();
CREATE TRIGGER site_search_internal_links_scope
  BEFORE INSERT OR UPDATE ON site_search_internal_links
  FOR EACH ROW EXECUTE FUNCTION ks_validate_search_intelligence_scope();
CREATE TRIGGER site_path_redirects_scope
  BEFORE INSERT OR UPDATE ON site_path_redirects
  FOR EACH ROW EXECUTE FUNCTION ks_validate_search_intelligence_scope();
CREATE TRIGGER site_page_language_alternates_scope
  BEFORE INSERT OR UPDATE ON site_page_language_alternates
  FOR EACH ROW EXECUTE FUNCTION ks_validate_search_intelligence_scope();

CREATE TRIGGER site_search_strategies_govern
  BEFORE UPDATE OR DELETE ON site_search_strategies
  FOR EACH ROW EXECUTE FUNCTION ks_govern_search_intelligence_artifact();
CREATE TRIGGER site_search_strategies_approval
  BEFORE UPDATE ON site_search_strategies
  FOR EACH ROW EXECUTE FUNCTION ks_validate_search_strategy_approval();
CREATE TRIGGER site_page_seo_briefs_govern
  BEFORE UPDATE OR DELETE ON site_page_seo_briefs
  FOR EACH ROW EXECUTE FUNCTION ks_govern_search_intelligence_artifact();
CREATE TRIGGER site_search_topic_ownership_govern
  BEFORE INSERT OR UPDATE OR DELETE ON site_search_topic_ownership
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_search_child_mutation();
CREATE TRIGGER site_search_internal_links_govern
  BEFORE INSERT OR UPDATE OR DELETE ON site_search_internal_links
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_approved_search_child_mutation();
CREATE TRIGGER site_search_research_evidence_append_only
  BEFORE UPDATE OR DELETE ON site_search_research_evidence
  FOR EACH ROW EXECUTE FUNCTION ks_search_evidence_append_only();

ALTER TABLE site_search_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_search_research_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_page_seo_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_search_topic_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_search_internal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_path_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_page_language_alternates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  site_search_strategies, site_search_research_evidence, site_page_seo_briefs,
  site_search_topic_ownership, site_search_internal_links, site_path_redirects,
  site_page_language_alternates
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  site_search_strategies, site_page_seo_briefs, site_search_topic_ownership,
  site_search_internal_links, site_path_redirects, site_page_language_alternates
TO service_role;
GRANT SELECT, INSERT ON TABLE site_search_research_evidence TO service_role;

REVOKE EXECUTE ON FUNCTION ks_validate_search_intelligence_scope() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_govern_search_intelligence_artifact() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_validate_search_strategy_approval() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_prevent_approved_search_child_mutation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_search_evidence_append_only() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE site_search_strategies IS
  'Versioned Search Intelligence V2 planning. Approval pins an immutable strategy; no live SERP scraping occurs in database code.';
COMMENT ON TABLE site_page_seo_briefs IS
  'Stable blueprint-page-bound SEO briefs that must be approved before V2 copy generation and are immutable after approval.';
COMMENT ON TABLE site_search_research_evidence IS
  'Append-only bounded research provenance. Unknown keyword metrics remain absent and credentials/raw prompts are prohibited.';
COMMENT ON TABLE site_path_redirects IS
  'Governed permanent path redirect registry; publication routing is unchanged until an active renderer consumes it.';

COMMIT;
