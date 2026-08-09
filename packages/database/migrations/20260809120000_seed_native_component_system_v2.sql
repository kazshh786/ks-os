-- Seed KS Native Component System V2 without mutating the approved V1 template.
--
-- This is a governed data migration, not a schema expansion. The only constraint
-- reconciliation extends the historical template-analysis vocabulary with the
-- controlled CONTACT and RICH_TEXT renderer types without invalidating legacy
-- analysis records. The version remains mutable until its
-- analysis evidence, layouts, capabilities, page mappings and renderers exist;
-- approval is deliberately the final write.

-- V2 distinguishes deterministic design completion from browser-backed human
-- review readiness. Existing V1 READY_FOR_REVIEW rows remain valid.
ALTER TABLE site_generation_runs
  DROP CONSTRAINT IF EXISTS site_generation_runs_status_check;

ALTER TABLE site_generation_runs
  ADD CONSTRAINT site_generation_runs_status_check CHECK (status IN (
    'PENDING','PREPARING_CONTEXT','GENERATING','VALIDATING','REPAIRING',
    'DESIGN_COMPLETE','READY_FOR_REVIEW','FAILED','CANCEL_REQUESTED',
    'CANCELLED','SUPERSEDED'
  ));

ALTER TABLE site_versions
  DROP CONSTRAINT IF EXISTS site_versions_generation_status_check;

ALTER TABLE site_versions
  ADD CONSTRAINT site_versions_generation_status_check CHECK (
    generation_status IS NULL OR generation_status IN (
      'INCOMPLETE','GENERATING','VALIDATING','COMPLETE','DESIGN_COMPLETE',
      'READY_FOR_REVIEW','FAILED','CANCELLED'
    )
  );

CREATE OR REPLACE FUNCTION ks_validate_site_generation_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.status = OLD.status THEN NEW.updated_at := now(); RETURN NEW; END IF;
  allowed := CASE OLD.status
    WHEN 'PENDING' THEN NEW.status IN ('PREPARING_CONTEXT', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED')
    WHEN 'PREPARING_CONTEXT' THEN NEW.status IN ('GENERATING', 'CANCEL_REQUESTED', 'FAILED')
    WHEN 'GENERATING' THEN NEW.status IN ('VALIDATING', 'CANCEL_REQUESTED', 'FAILED')
    WHEN 'VALIDATING' THEN NEW.status IN ('REPAIRING', 'DESIGN_COMPLETE', 'READY_FOR_REVIEW', 'CANCEL_REQUESTED', 'FAILED')
    WHEN 'REPAIRING' THEN NEW.status IN ('GENERATING', 'VALIDATING', 'CANCEL_REQUESTED', 'FAILED')
    WHEN 'DESIGN_COMPLETE' THEN NEW.status IN ('READY_FOR_REVIEW', 'SUPERSEDED')
    WHEN 'READY_FOR_REVIEW' THEN NEW.status IN ('DESIGN_COMPLETE', 'SUPERSEDED')
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

ALTER TABLE template_layout_sections
  DROP CONSTRAINT IF EXISTS template_layout_sections_section_type_check;

ALTER TABLE template_layout_sections
  ADD CONSTRAINT template_layout_sections_section_type_check
  CHECK (section_type IN (
    'HEADER','NAVIGATION','ANNOUNCEMENT_BAR','HERO','INTRODUCTION','FEATURED_SERVICES',
    'SERVICE_GRID','SERVICE_DETAILS','BENEFITS','PROCESS','PRICING','TEAM',
    'STAFF_PROFILE','GALLERY','RESULTS','TESTIMONIALS','REVIEW_SUMMARY',
    'TRUST_INDICATORS','FAQ','LOCATION','OPENING_HOURS','MAP','CONTACT_FORM',
    'CONTACT','NEWSLETTER','POLICIES','BOOKING_CTA','FINAL_CTA','FOOTER',
    'RICH_TEXT','UNKNOWN'
  ));

DO $$
DECLARE
  v_actor_id uuid;
  v_source_id uuid;
  v_version_id uuid;
  v_analysis_run_id uuid;
  v_layout_id uuid;
  item record;
  section_item record;
  page_type_value text;
BEGIN
  SELECT id INTO v_actor_id
  FROM agency_users
  WHERE status = 'ACTIVE'
  ORDER BY CASE WHEN role = 'PLATFORM_OWNER' THEN 0 ELSE 1 END, created_at
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V2_REQUIRES_ACTIVE_AGENCY_USER';
  END IF;

  SELECT id INTO v_source_id
  FROM template_sources
  WHERE source_reference = 'ks-native-component-system'
  LIMIT 1;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V2_REQUIRES_V1_SOURCE';
  END IF;

  INSERT INTO template_versions (
    public_reference,
    template_source_id,
    version_number,
    status,
    manifest_json,
    checksum_sha256,
    analysis_status,
    artifact_digest_sha256,
    artifact_reference,
    analyser_version
  )
  SELECT
    'e054818e-c185-44fd-b453-010000000003'::uuid,
    v_source_id,
    2,
    'DRAFT',
    jsonb_build_object(
      'name', 'KS Native Component System V2',
      'kind', 'CONTROLLED_COMPONENT_REGISTRY',
      'schemaVersion', 2,
      'componentRegistryVersion', 2,
      'rendererRegistryVersion', 1,
      'designLibraryVersion', 2,
      'generationPipelineVersion', 2,
      'selectionPolicy', 'REGISTRY_COMPATIBLE_ONLY'
    ),
    repeat('c', 64),
    'PENDING',
    repeat('d', 64),
    'internal://ks-native-component-system/v2',
    'ks-native-registry-2'
  WHERE NOT EXISTS (
    SELECT 1 FROM template_versions
    WHERE template_source_id = v_source_id AND version_number = 2
  );

  SELECT id INTO v_version_id
  FROM template_versions
  WHERE template_source_id = v_source_id AND version_number = 2
  LIMIT 1;

  -- A completed seed is immutable and is intentionally left untouched.
  IF EXISTS (
    SELECT 1 FROM template_versions
    WHERE id = v_version_id
      AND (status = 'APPROVED' OR analysis_status = 'APPROVED')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO template_analysis_runs (
    public_reference,
    template_version_id,
    status,
    analyser_version,
    artifact_digest_sha256,
    started_at,
    completed_at,
    attempt_count,
    summary_json,
    created_by_agency_user_id
  )
  SELECT
    'e054818e-c185-44fd-b453-010000000004'::uuid,
    v_version_id,
    'APPROVED',
    'ks-native-registry-2',
    repeat('d', 64),
    now(),
    now(),
    1,
    jsonb_build_object(
      'analysisKind', 'OWNED_COMPILE_TIME_REGISTRY',
      'layoutCount', 13,
      'componentRegistryVersion', 2,
      'executableTemplateFiles', 0,
      'blockingFindings', 0
    ),
    v_actor_id
  WHERE NOT EXISTS (
    SELECT 1 FROM template_analysis_runs
    WHERE template_version_id = v_version_id
      AND artifact_digest_sha256 = repeat('d', 64)
      AND analyser_version = 'ks-native-registry-2'
  );

  SELECT id INTO v_analysis_run_id
  FROM template_analysis_runs
  WHERE template_version_id = v_version_id
    AND artifact_digest_sha256 = repeat('d', 64)
    AND analyser_version = 'ks-native-registry-2'
  LIMIT 1;

  FOR item IN
    SELECT * FROM jsonb_to_recordset(
      '[
        {"name":"Native home V2","semantic_key":"native-home","page_types":["HOME"],"recommended":"HOME","role":"PRIMARY_LANDING","renderer":"home-editorial-v1","required":["HEADER","HERO","INTRODUCTION","FEATURED_SERVICES","BENEFITS","TRUST_INDICATORS","FINAL_CTA","FOOTER"],"supported":["HEADER","ANNOUNCEMENT_BAR","HERO","INTRODUCTION","FEATURED_SERVICES","SERVICE_GRID","BENEFITS","PROCESS","TEAM","GALLERY","RESULTS","TESTIMONIALS","TRUST_INDICATORS","FAQ","LOCATION","OPENING_HOURS","CONTACT","BOOKING_CTA","FINAL_CTA","FOOTER"]},
        {"name":"Native service hub V2","semantic_key":"native-service-hub","page_types":["SERVICE_HUB"],"recommended":"SERVICE_HUB","role":"SERVICE_CONVERSION","renderer":"service-hub-grid-v1","required":["HEADER","HERO","SERVICE_GRID","FINAL_CTA","FOOTER"],"supported":["HEADER","HERO","INTRODUCTION","FEATURED_SERVICES","SERVICE_GRID","BENEFITS","PROCESS","PRICING","TRUST_INDICATORS","FAQ","RICH_TEXT","FINAL_CTA","FOOTER"]},
        {"name":"Native service detail V2","semantic_key":"native-service-detail","page_types":["SERVICE_DETAIL"],"recommended":"SERVICE_DETAIL","role":"SERVICE_CONVERSION","renderer":"service-detail-editorial-v1","required":["HEADER","HERO","SERVICE_DETAILS","BENEFITS","BOOKING_CTA","FOOTER"],"supported":["HEADER","HERO","INTRODUCTION","SERVICE_DETAILS","BENEFITS","PROCESS","PRICING","TEAM","STAFF_PROFILE","GALLERY","RESULTS","TESTIMONIALS","TRUST_INDICATORS","FAQ","FEATURED_SERVICES","RICH_TEXT","BOOKING_CTA","FINAL_CTA","FOOTER"]},
        {"name":"Native about V2","semantic_key":"native-about","page_types":["ABOUT"],"recommended":"ABOUT","role":"TRUST_BUILDING","renderer":"about-editorial-v1","required":["HEADER","HERO","INTRODUCTION","TEAM","FINAL_CTA","FOOTER"],"supported":["HEADER","HERO","INTRODUCTION","BENEFITS","PROCESS","TEAM","GALLERY","TESTIMONIALS","TRUST_INDICATORS","RICH_TEXT","FINAL_CTA","FOOTER"]},
        {"name":"Native team hub V2","semantic_key":"native-team-hub","page_types":["TEAM_HUB"],"recommended":"TEAM_HUB","role":"TRUST_BUILDING","renderer":"team-grid-v1","required":["HEADER","HERO","TEAM","FINAL_CTA","FOOTER"],"supported":["HEADER","HERO","INTRODUCTION","TEAM","BENEFITS","GALLERY","TRUST_INDICATORS","RICH_TEXT","FINAL_CTA","FOOTER"]},
        {"name":"Native team detail V2","semantic_key":"native-team-detail","page_types":["TEAM_DETAIL"],"recommended":"TEAM_DETAIL","role":"TRUST_BUILDING","renderer":"team-detail-v1","required":["HEADER","HERO","STAFF_PROFILE","BOOKING_CTA","FOOTER"],"supported":["HEADER","HERO","STAFF_PROFILE","INTRODUCTION","FEATURED_SERVICES","SERVICE_GRID","BENEFITS","TRUST_INDICATORS","RICH_TEXT","BOOKING_CTA","FOOTER"]},
        {"name":"Native location detail V2","semantic_key":"native-location-detail","page_types":["LOCATION_DETAIL"],"recommended":"LOCATION_DETAIL","role":"LOCAL_DISCOVERY","renderer":"location-detail-v1","required":["HEADER","HERO","LOCATION","OPENING_HOURS","CONTACT","BOOKING_CTA","FOOTER"],"supported":["HEADER","HERO","INTRODUCTION","LOCATION","OPENING_HOURS","CONTACT","GALLERY","FEATURED_SERVICES","TEAM","FAQ","BOOKING_CTA","FINAL_CTA","FOOTER"]},
        {"name":"Native contact V2","semantic_key":"native-contact","page_types":["CONTACT"],"recommended":"CONTACT","role":"LOCAL_DISCOVERY","renderer":"contact-v1","required":["HEADER","HERO","CONTACT","LOCATION","OPENING_HOURS","BOOKING_CTA","FOOTER"],"supported":["HEADER","HERO","INTRODUCTION","CONTACT","LOCATION","OPENING_HOURS","FAQ","RICH_TEXT","BOOKING_CTA","FINAL_CTA","FOOTER"]},
        {"name":"Native FAQ V2","semantic_key":"native-faq","page_types":["FAQ"],"recommended":"FAQ","role":"OBJECTION_HANDLING","renderer":"faq-v1","required":["HEADER","HERO","FAQ","FINAL_CTA","FOOTER"],"supported":["HEADER","HERO","INTRODUCTION","FAQ","CONTACT","RICH_TEXT","FINAL_CTA","FOOTER"]},
        {"name":"Native results V2","semantic_key":"native-results","page_types":["RESULTS"],"recommended":"RESULTS","role":"TRUST_BUILDING","renderer":"results-grid-v1","required":["HEADER","HERO","RESULTS","FINAL_CTA","FOOTER"],"supported":["HEADER","HERO","INTRODUCTION","RESULTS","GALLERY","TESTIMONIALS","TRUST_INDICATORS","FAQ","RICH_TEXT","FINAL_CTA","FOOTER"]},
        {"name":"Native guide V2","semantic_key":"native-guide","page_types":["NEW_CLIENT_GUIDE","AFTERCARE_GUIDE","CONSULTATION_GUIDE"],"recommended":"NEW_CLIENT_GUIDE","role":"OBJECTION_HANDLING","renderer":"guide-editorial-v1","required":["HEADER","HERO","RICH_TEXT","FINAL_CTA","FOOTER"],"supported":["HEADER","HERO","INTRODUCTION","PROCESS","BENEFITS","RICH_TEXT","FAQ","LOCATION","OPENING_HOURS","CONTACT","BOOKING_CTA","FINAL_CTA","FOOTER"]},
        {"name":"Native policies V2","semantic_key":"native-policies","page_types":["POLICIES"],"recommended":"POLICIES","role":"OBJECTION_HANDLING","renderer":"policies-v1","required":["HEADER","RICH_TEXT","FINAL_CTA","FOOTER"],"supported":["HEADER","INTRODUCTION","RICH_TEXT","CONTACT","FAQ","FINAL_CTA","FOOTER"]},
        {"name":"Native booking V2","semantic_key":"native-booking","page_types":["BOOKING"],"recommended":"BOOKING","role":"BOOKING","renderer":"booking-v1","required":["HEADER","INTRODUCTION","BOOKING_CTA","FOOTER"],"supported":["HEADER","INTRODUCTION","TRUST_INDICATORS","FAQ","CONTACT","BOOKING_CTA","FOOTER"]}
      ]'::jsonb
    ) AS rows(
      name text,
      semantic_key text,
      page_types jsonb,
      recommended text,
      role text,
      renderer text,
      required jsonb,
      supported jsonb
    )
  LOOP
    INSERT INTO template_layouts (
      template_version_id,
      name,
      semantic_key,
      status,
      section_manifest_json,
      source_file_path,
      detected_page_type,
      recommended_page_type,
      conversion_role,
      classification_confidence_bp,
      classification_evidence_json,
      requires_agency_review,
      agency_notes,
      analysis_run_id
    )
    SELECT
      v_version_id,
      item.name,
      item.semantic_key,
      'APPROVED',
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'sectionType', section_type,
            'required', item.required ? section_type,
            'componentRegistryVersion', 2,
            'componentSelection', 'REGISTRY_COMPATIBLE_ONLY'
          ) ORDER BY ordinal
        )
        FROM jsonb_array_elements_text(item.supported)
          WITH ORDINALITY AS supported_section(section_type, ordinal)
      ),
      'internal://ks-native/v2/' || item.semantic_key,
      item.recommended,
      item.recommended,
      item.role,
      10000,
      jsonb_build_array(
        'Owned KS component registry mapping.',
        'Capabilities confirmed against component registry version 2.'
      ),
      false,
      'Canonical KS-native V2 capability layout. Component choice is registry-governed.',
      v_analysis_run_id
    WHERE NOT EXISTS (
      SELECT 1 FROM template_layouts
      WHERE template_version_id = v_version_id AND semantic_key = item.semantic_key
    );

    SELECT id INTO v_layout_id
    FROM template_layouts
    WHERE template_version_id = v_version_id AND semantic_key = item.semantic_key
    LIMIT 1;

    FOR page_type_value IN
      SELECT value FROM jsonb_array_elements_text(item.page_types)
    LOOP
      INSERT INTO template_layout_page_types (
        template_layout_id,
        page_type,
        approved_by_agency_user_id,
        approved_at
      )
      SELECT v_layout_id, page_type_value, v_actor_id, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM template_layout_page_types
        WHERE template_layout_id = v_layout_id AND page_type = page_type_value
      );
    END LOOP;

    INSERT INTO template_layout_renderers (
      template_layout_id,
      renderer_key,
      renderer_status,
      renderer_version,
      renderer_mapped_at,
      renderer_mapped_by_agency_user_id
    )
    SELECT v_layout_id, item.renderer, 'READY', 1, now(), v_actor_id
    WHERE NOT EXISTS (
      SELECT 1 FROM template_layout_renderers WHERE template_layout_id = v_layout_id
    );

    FOR section_item IN
      SELECT value AS section_type, (ordinality - 1)::integer AS dom_order
      FROM jsonb_array_elements_text(item.supported) WITH ORDINALITY
    LOOP
      INSERT INTO template_layout_sections (
        analysis_run_id,
        layout_id,
        section_type,
        confidence_bp,
        dom_order,
        structural_reference,
        required_for_recommended_page_type,
        contains_booking_action,
        requires_agency_review,
        agency_confirmed_at,
        agency_confirmed_by_agency_user_id
      )
      SELECT
        v_analysis_run_id,
        v_layout_id,
        section_item.section_type,
        10000,
        section_item.dom_order,
        item.semantic_key || ':' || section_item.section_type,
        item.required ? section_item.section_type,
        section_item.section_type IN ('BOOKING_CTA', 'FINAL_CTA'),
        false,
        now(),
        v_actor_id
      WHERE NOT EXISTS (
        SELECT 1 FROM template_layout_sections
        WHERE template_layout_sections.layout_id = v_layout_id
          AND template_layout_sections.dom_order = section_item.dom_order
      );
    END LOOP;
  END LOOP;

  IF (SELECT count(*) FROM template_layouts WHERE template_version_id = v_version_id) <> 13 THEN
    RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V2_LAYOUT_COUNT_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM template_layouts
    WHERE template_version_id = v_version_id
      AND jsonb_array_length(section_manifest_json) = 0
  ) THEN
    RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V2_EMPTY_LAYOUT_MANIFEST';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM template_layout_sections section_row
    INNER JOIN template_layouts layout_row ON layout_row.id = section_row.layout_id
    WHERE layout_row.template_version_id = v_version_id
  ) THEN
    RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_V2_MISSING_SECTION_CAPABILITIES';
  END IF;

  -- Approval is the final write. All V2 template records are immutable after it.
  UPDATE template_versions
  SET status = 'APPROVED',
      analysis_status = 'APPROVED',
      approved_by_agency_user_id = v_actor_id,
      approved_at = now(),
      analyser_version = 'ks-native-registry-2'
  WHERE id = v_version_id;
END
$$;
