-- Reconcile the Phase 15.6C polymorphic ownership trigger. The historical
-- function dereferenced fields that are not present on every bound table, so
-- PostgreSQL could reject a valid insert before TG_TABLE_NAME short-circuiting.
-- This replacement reads NEW through jsonb and retains the pinned run, tenant,
-- site, version, blueprint, template, and parent-child ownership checks.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preconditions$
DECLARE
  ownership_function oid;
  binding_count integer;
BEGIN
  SELECT function_data.oid
  INTO ownership_function
  FROM pg_catalog.pg_proc AS function_data
  JOIN pg_catalog.pg_namespace AS function_namespace
    ON function_namespace.oid = function_data.pronamespace
  WHERE function_namespace.nspname = 'public'
    AND function_data.proname = 'ks_validate_site_generation_ownership'
    AND pg_catalog.pg_get_function_identity_arguments(function_data.oid) = ''
    AND function_data.prorettype = 'trigger'::regtype;

  IF ownership_function IS NULL THEN
    RAISE EXCEPTION
      'public.ks_validate_site_generation_ownership() must exist before reconciliation';
  END IF;

  SELECT count(*)
  INTO binding_count
  FROM pg_catalog.pg_trigger AS trigger_data
  WHERE trigger_data.tgfoid = ownership_function
    AND NOT trigger_data.tgisinternal;

  IF binding_count <> 5 THEN
    RAISE EXCEPTION
      'Expected 5 Phase 15.6C ownership trigger bindings, found %',
      binding_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('site_generation_page_runs', 'site_generation_page_runs_ownership_guard'),
        ('site_generation_section_runs', 'site_generation_section_runs_ownership_guard'),
        ('site_generation_findings', 'site_generation_findings_ownership_guard'),
        ('site_generation_claims', 'site_generation_claims_ownership_guard'),
        ('site_generation_contexts', 'site_generation_contexts_ownership_guard')
    ) AS expected(table_name, trigger_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_data
      JOIN pg_catalog.pg_class AS table_data
        ON table_data.oid = trigger_data.tgrelid
      JOIN pg_catalog.pg_namespace AS table_namespace
        ON table_namespace.oid = table_data.relnamespace
      WHERE trigger_data.tgfoid = ownership_function
        AND NOT trigger_data.tgisinternal
        AND table_namespace.nspname = 'public'
        AND table_data.relname = expected.table_name
        AND trigger_data.tgname = expected.trigger_name
    )
  ) THEN
    RAISE EXCEPTION
      'The Phase 15.6C ownership trigger binding set is incomplete';
  END IF;
END
$preconditions$;

CREATE OR REPLACE FUNCTION public.ks_validate_site_generation_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  row_data jsonb;
  child_generation_run_id uuid;
  child_tenant_id uuid;
  expected_tenant_id uuid;
  expected_site_id uuid;
  expected_version_id uuid;
  expected_blueprint_id uuid;
  expected_template_version_id uuid;
BEGIN
  row_data := to_jsonb(NEW);

  IF TG_TABLE_SCHEMA <> 'public'
    OR TG_TABLE_NAME NOT IN (
      'site_generation_page_runs',
      'site_generation_section_runs',
      'site_generation_findings',
      'site_generation_claims',
      'site_generation_contexts'
    )
  THEN
    RAISE EXCEPTION
      'SITE_GENERATION_OWNERSHIP_BINDING_INVALID: %.%',
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME;
  END IF;

  IF row_data ->> 'generation_run_id' IS NULL
    OR row_data ->> 'tenant_id' IS NULL
  THEN
    RAISE EXCEPTION
      'SITE_GENERATION_OWNERSHIP_REQUIRED_FIELD_MISSING: %.%',
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME;
  END IF;

  child_generation_run_id := (row_data ->> 'generation_run_id')::uuid;
  child_tenant_id := (row_data ->> 'tenant_id')::uuid;

  SELECT
    generation_run.tenant_id,
    generation_run.site_id,
    generation_run.site_version_id,
    generation_run.blueprint_id,
    generation_run.template_version_id
  INTO
    expected_tenant_id,
    expected_site_id,
    expected_version_id,
    expected_blueprint_id,
    expected_template_version_id
  FROM public.site_generation_runs AS generation_run
  WHERE generation_run.id = child_generation_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_GENERATION_RUN_NOT_FOUND';
  END IF;

  IF child_tenant_id IS DISTINCT FROM expected_tenant_id THEN
    RAISE EXCEPTION 'Site-generation tenant ownership mismatch'
      USING ERRCODE = '23514';
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'site_generation_page_runs' THEN
      IF row_data ->> 'site_id' IS NULL
        OR row_data ->> 'site_version_id' IS NULL
        OR row_data ->> 'blueprint_page_id' IS NULL
        OR row_data ->> 'template_layout_id' IS NULL
      THEN
        RAISE EXCEPTION 'SITE_GENERATION_PAGE_REQUIRED_FIELD_MISSING';
      END IF;

      IF (row_data ->> 'site_id')::uuid IS DISTINCT FROM expected_site_id THEN
        RAISE EXCEPTION 'Site-generation site ownership mismatch'
          USING ERRCODE = '23514';
      END IF;

      IF (row_data ->> 'site_version_id')::uuid
          IS DISTINCT FROM expected_version_id
        OR NOT EXISTS (
          SELECT 1
          FROM public.site_blueprint_pages AS blueprint_page
          WHERE blueprint_page.id =
              (row_data ->> 'blueprint_page_id')::uuid
            AND blueprint_page.blueprint_id = expected_blueprint_id
            AND blueprint_page.tenant_id = expected_tenant_id
        )
        OR NOT EXISTS (
          SELECT 1
          FROM public.template_layouts AS template_layout
          WHERE template_layout.id =
              (row_data ->> 'template_layout_id')::uuid
            AND template_layout.template_version_id =
              expected_template_version_id
            AND template_layout.status = 'APPROVED'
        )
      THEN
        RAISE EXCEPTION 'Site-generation page provenance mismatch'
          USING ERRCODE = '23514';
      END IF;

    WHEN 'site_generation_section_runs' THEN
      IF row_data ->> 'page_run_id' IS NULL THEN
        RAISE EXCEPTION 'SITE_GENERATION_SECTION_REQUIRED_FIELD_MISSING';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.site_generation_page_runs AS page_run
        WHERE page_run.id = (row_data ->> 'page_run_id')::uuid
          AND page_run.generation_run_id = child_generation_run_id
          AND page_run.tenant_id = expected_tenant_id
      ) THEN
        RAISE EXCEPTION 'Site-generation section ownership mismatch'
          USING ERRCODE = '23514';
      END IF;

    WHEN 'site_generation_findings', 'site_generation_claims' THEN
      IF row_data ->> 'page_run_id' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.site_generation_page_runs AS page_run
          WHERE page_run.id = (row_data ->> 'page_run_id')::uuid
            AND page_run.generation_run_id = child_generation_run_id
            AND page_run.tenant_id = expected_tenant_id
        )
      THEN
        RAISE EXCEPTION
          'Site-generation finding or claim page mismatch'
          USING ERRCODE = '23514';
      END IF;

      IF row_data ->> 'section_run_id' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.site_generation_section_runs AS section_run
          WHERE section_run.id = (row_data ->> 'section_run_id')::uuid
            AND section_run.generation_run_id = child_generation_run_id
            AND section_run.tenant_id = expected_tenant_id
        )
      THEN
        RAISE EXCEPTION
          'Site-generation finding or claim section mismatch'
          USING ERRCODE = '23514';
      END IF;

    WHEN 'site_generation_contexts' THEN
      IF row_data ->> 'page_run_id' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.site_generation_page_runs AS page_run
          WHERE page_run.id = (row_data ->> 'page_run_id')::uuid
            AND page_run.generation_run_id = child_generation_run_id
            AND page_run.tenant_id = expected_tenant_id
        )
      THEN
        RAISE EXCEPTION 'Site-generation context page mismatch'
          USING ERRCODE = '23514';
      END IF;

    ELSE
      RAISE EXCEPTION
        'SITE_GENERATION_OWNERSHIP_BINDING_INVALID: %.%',
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME;
  END CASE;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE
ON FUNCTION public.ks_validate_site_generation_ownership()
FROM PUBLIC, anon, authenticated;

DO $postconditions$
DECLARE
  ownership_function oid;
  function_definition text;
BEGIN
  SELECT
    function_data.oid,
    pg_catalog.pg_get_functiondef(function_data.oid)
  INTO
    ownership_function,
    function_definition
  FROM pg_catalog.pg_proc AS function_data
  JOIN pg_catalog.pg_namespace AS function_namespace
    ON function_namespace.oid = function_data.pronamespace
  WHERE function_namespace.nspname = 'public'
    AND function_data.proname = 'ks_validate_site_generation_ownership'
    AND pg_catalog.pg_get_function_identity_arguments(function_data.oid) = ''
    AND function_data.prorettype = 'trigger'::regtype;

  IF ownership_function IS NULL
    OR function_definition NOT LIKE '%row_data := to_jsonb(NEW)%'
    OR function_definition ~* 'NEW\.[A-Za-z_][A-Za-z0-9_]*'
  THEN
    RAISE EXCEPTION
      'The reconciled ownership function still has an unsafe row-field assumption';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger_data
    WHERE trigger_data.tgfoid = ownership_function
      AND NOT trigger_data.tgisinternal
  ) <> 5 THEN
    RAISE EXCEPTION
      'The reconciled ownership function does not retain all 5 bindings';
  END IF;
END
$postconditions$;
