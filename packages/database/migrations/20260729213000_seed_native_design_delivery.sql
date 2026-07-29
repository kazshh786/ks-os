-- Seed the owned KS Native Component System used behind the reusable design library.
--
-- The visual choice remains the PR #44 design preset. These records provide the
-- approved technical layouts and compile-time renderer mappings required by the
-- existing immutable blueprint, generation, preview and publication pipeline.

DO $$
DECLARE
  actor_id uuid;
  source_id uuid;
  version_id uuid;
  layout_id uuid;
  item record;
  page_type_value text;
BEGIN
  SELECT id INTO actor_id
  FROM agency_users
  WHERE status = 'ACTIVE'
  ORDER BY CASE WHEN role = 'PLATFORM_OWNER' THEN 0 ELSE 1 END, created_at
  LIMIT 1;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'KS_NATIVE_TEMPLATE_REQUIRES_ACTIVE_AGENCY_USER';
  END IF;

  INSERT INTO template_sources (
    public_reference,
    source_type,
    name,
    status,
    source_reference,
    metadata_json,
    created_by_agency_user_id
  )
  SELECT
    'e054818e-c185-44fd-b453-010000000001'::uuid,
    'INTERNAL',
    'KS Native Component System',
    'APPROVED',
    'ks-native-component-system',
    jsonb_build_object(
      'systemKey', 'KS_NATIVE_COMPONENT_SYSTEM',
      'ownedBy', 'KS_OS',
      'visualSource', 'KS_DESIGN_LIBRARY',
      'licenceRequired', false
    ),
    actor_id
  WHERE NOT EXISTS (
    SELECT 1 FROM template_sources WHERE source_reference = 'ks-native-component-system'
  );

  SELECT id INTO source_id
  FROM template_sources
  WHERE source_reference = 'ks-native-component-system'
  LIMIT 1;

  UPDATE template_sources
  SET name = 'KS Native Component System',
      source_type = 'INTERNAL',
      status = 'APPROVED',
      metadata_json = jsonb_build_object(
        'systemKey', 'KS_NATIVE_COMPONENT_SYSTEM',
        'ownedBy', 'KS_OS',
        'visualSource', 'KS_DESIGN_LIBRARY',
        'licenceRequired', false
      ),
      updated_at = now()
  WHERE id = source_id;

  INSERT INTO template_versions (
    public_reference,
    template_source_id,
    version_number,
    status,
    manifest_json,
    checksum_sha256,
    approved_by_agency_user_id,
    approved_at,
    analysis_status,
    artifact_digest_sha256,
    artifact_reference,
    analyser_version
  )
  SELECT
    'e054818e-c185-44fd-b453-010000000002'::uuid,
    source_id,
    1,
    'APPROVED',
    jsonb_build_object(
      'name', 'KS Native Component System',
      'kind', 'CONTROLLED_COMPONENT_REGISTRY',
      'rendererRegistryVersion', 1,
      'designLibraryVersion', 1
    ),
    repeat('a', 64),
    actor_id,
    now(),
    'APPROVED',
    repeat('b', 64),
    'internal://ks-native-component-system/v1',
    'ks-native-registry-1'
  WHERE NOT EXISTS (
    SELECT 1 FROM template_versions
    WHERE template_source_id = source_id AND version_number = 1
  );

  SELECT id INTO version_id
  FROM template_versions
  WHERE template_source_id = source_id AND version_number = 1
  LIMIT 1;

  UPDATE template_versions
  SET status = 'APPROVED',
      analysis_status = 'APPROVED',
      approved_by_agency_user_id = COALESCE(approved_by_agency_user_id, actor_id),
      approved_at = COALESCE(approved_at, now()),
      analyser_version = 'ks-native-registry-1'
  WHERE id = version_id;

  FOR item IN
    SELECT * FROM jsonb_to_recordset(
      '[
        {"name":"Native home","semantic_key":"native-home","page_types":["HOME"],"recommended":"HOME","role":"PRIMARY_LANDING","renderer":"home-editorial-v1"},
        {"name":"Native service hub","semantic_key":"native-service-hub","page_types":["SERVICE_HUB"],"recommended":"SERVICE_HUB","role":"SERVICE_CONVERSION","renderer":"service-hub-grid-v1"},
        {"name":"Native service detail","semantic_key":"native-service-detail","page_types":["SERVICE_DETAIL"],"recommended":"SERVICE_DETAIL","role":"SERVICE_CONVERSION","renderer":"service-detail-editorial-v1"},
        {"name":"Native about","semantic_key":"native-about","page_types":["ABOUT"],"recommended":"ABOUT","role":"TRUST_BUILDING","renderer":"about-editorial-v1"},
        {"name":"Native team hub","semantic_key":"native-team-hub","page_types":["TEAM_HUB"],"recommended":"TEAM_HUB","role":"TRUST_BUILDING","renderer":"team-grid-v1"},
        {"name":"Native team detail","semantic_key":"native-team-detail","page_types":["TEAM_DETAIL"],"recommended":"TEAM_DETAIL","role":"TRUST_BUILDING","renderer":"team-detail-v1"},
        {"name":"Native location detail","semantic_key":"native-location-detail","page_types":["LOCATION_DETAIL"],"recommended":"LOCATION_DETAIL","role":"LOCAL_DISCOVERY","renderer":"location-detail-v1"},
        {"name":"Native contact","semantic_key":"native-contact","page_types":["CONTACT"],"recommended":"CONTACT","role":"LOCAL_DISCOVERY","renderer":"contact-v1"},
        {"name":"Native FAQ","semantic_key":"native-faq","page_types":["FAQ"],"recommended":"FAQ","role":"OBJECTION_HANDLING","renderer":"faq-v1"},
        {"name":"Native results","semantic_key":"native-results","page_types":["RESULTS"],"recommended":"RESULTS","role":"TRUST_BUILDING","renderer":"results-grid-v1"},
        {"name":"Native guide","semantic_key":"native-guide","page_types":["NEW_CLIENT_GUIDE","AFTERCARE_GUIDE","CONSULTATION_GUIDE"],"recommended":"NEW_CLIENT_GUIDE","role":"OBJECTION_HANDLING","renderer":"guide-editorial-v1"},
        {"name":"Native policies","semantic_key":"native-policies","page_types":["POLICIES"],"recommended":"POLICIES","role":"OBJECTION_HANDLING","renderer":"policies-v1"},
        {"name":"Native booking","semantic_key":"native-booking","page_types":["BOOKING"],"recommended":"BOOKING","role":"BOOKING","renderer":"booking-v1"}
      ]'::jsonb
    ) AS rows(
      name text,
      semantic_key text,
      page_types jsonb,
      recommended text,
      role text,
      renderer text
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
      agency_notes
    )
    SELECT
      version_id,
      item.name,
      item.semantic_key,
      'APPROVED',
      '[]'::jsonb,
      'internal://ks-native/' || item.semantic_key,
      item.recommended,
      item.recommended,
      item.role,
      10000,
      jsonb_build_array('Owned KS component registry mapping.'),
      false,
      'Canonical KS-native technical layout. Visual styling is selected separately.'
    WHERE NOT EXISTS (
      SELECT 1 FROM template_layouts
      WHERE template_version_id = version_id AND semantic_key = item.semantic_key
    );

    SELECT id INTO layout_id
    FROM template_layouts
    WHERE template_version_id = version_id AND semantic_key = item.semantic_key
    LIMIT 1;

    UPDATE template_layouts
    SET status = 'APPROVED',
        disabled_at = NULL,
        requires_agency_review = false,
        recommended_page_type = item.recommended,
        conversion_role = item.role,
        classification_confidence_bp = 10000
    WHERE id = layout_id;

    FOR page_type_value IN
      SELECT value FROM jsonb_array_elements_text(item.page_types)
    LOOP
      INSERT INTO template_layout_page_types (
        template_layout_id,
        page_type,
        approved_by_agency_user_id,
        approved_at
      )
      SELECT layout_id, page_type_value, actor_id, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM template_layout_page_types
        WHERE template_layout_id = layout_id AND page_type = page_type_value
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
    SELECT layout_id, item.renderer, 'READY', 1, now(), actor_id
    WHERE NOT EXISTS (
      SELECT 1 FROM template_layout_renderers WHERE template_layout_id = layout_id
    );

    UPDATE template_layout_renderers
    SET renderer_key = item.renderer,
        renderer_status = 'READY',
        renderer_version = 1,
        renderer_mapped_at = now(),
        renderer_mapped_by_agency_user_id = actor_id,
        updated_at = now()
    WHERE template_layout_id = layout_id;
  END LOOP;
END
$$;
