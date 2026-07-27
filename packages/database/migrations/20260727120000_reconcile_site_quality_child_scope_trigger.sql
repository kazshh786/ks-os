-- Reconcile the Phase 15.8 polymorphic child-scope trigger. The original
-- function directly referenced fields that are not present on every bound
-- table, so PostgreSQL could compile an invalid NEW.field expression before
-- TG_TABLE_NAME short-circuiting. This replacement reads NEW through jsonb,
-- rejects unknown bindings, and retains strict run, tenant, site, version,
-- digest, and parent-child validation for every compatible table.
--
-- The KS OS migration runner executes this file and its ledger insert in one
-- transaction.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preconditions$
DECLARE
  child_scope_function oid;
  binding_count integer;
BEGIN
  SELECT function_data.oid
  INTO child_scope_function
  FROM pg_catalog.pg_proc AS function_data
  JOIN pg_catalog.pg_namespace AS function_namespace
    ON function_namespace.oid = function_data.pronamespace
  WHERE function_namespace.nspname = 'public'
    AND function_data.proname = 'ks_validate_site_quality_child_scope'
    AND pg_catalog.pg_get_function_identity_arguments(function_data.oid) = ''
    AND function_data.prorettype = 'trigger'::regtype;

  IF child_scope_function IS NULL THEN
    RAISE EXCEPTION
      'public.ks_validate_site_quality_child_scope() must exist before reconciliation';
  END IF;

  SELECT count(*)
  INTO binding_count
  FROM pg_catalog.pg_trigger AS trigger_data
  WHERE trigger_data.tgfoid = child_scope_function
    AND NOT trigger_data.tgisinternal;

  IF binding_count <> 8 THEN
    RAISE EXCEPTION
      'Expected 8 Phase 15.8 child-scope trigger bindings, found %',
      binding_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('site_quality_page_runs', 'site_quality_page_runs_scope'),
        ('site_quality_checks', 'site_quality_checks_scope'),
        ('site_quality_findings', 'site_quality_findings_scope'),
        ('site_quality_evidence', 'site_quality_evidence_scope'),
        ('site_quality_waivers', 'site_quality_waivers_scope'),
        ('site_quality_human_reviews', 'site_quality_human_reviews_scope'),
        ('site_quality_remediation_events', 'site_quality_remediation_events_scope'),
        ('site_quality_audit_sessions', 'site_quality_audit_sessions_scope')
    ) AS expected(table_name, trigger_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_data
      JOIN pg_catalog.pg_class AS table_data
        ON table_data.oid = trigger_data.tgrelid
      JOIN pg_catalog.pg_namespace AS table_namespace
        ON table_namespace.oid = table_data.relnamespace
      WHERE trigger_data.tgfoid = child_scope_function
        AND NOT trigger_data.tgisinternal
        AND table_namespace.nspname = 'public'
        AND table_data.relname = expected.table_name
        AND trigger_data.tgname = expected.trigger_name
    )
  ) THEN
    RAISE EXCEPTION
      'The Phase 15.8 child-scope trigger binding set is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('site_quality_page_runs', 'quality_run_id'),
        ('site_quality_page_runs', 'tenant_id'),
        ('site_quality_page_runs', 'site_id'),
        ('site_quality_page_runs', 'site_version_id'),
        ('site_quality_page_runs', 'page_id'),
        ('site_quality_checks', 'quality_run_id'),
        ('site_quality_checks', 'tenant_id'),
        ('site_quality_checks', 'page_run_id'),
        ('site_quality_findings', 'quality_run_id'),
        ('site_quality_findings', 'tenant_id'),
        ('site_quality_findings', 'site_id'),
        ('site_quality_findings', 'site_version_id'),
        ('site_quality_findings', 'content_digest_sha256'),
        ('site_quality_findings', 'quality_check_id'),
        ('site_quality_findings', 'check_id'),
        ('site_quality_findings', 'page_id'),
        ('site_quality_findings', 'section_id'),
        ('site_quality_evidence', 'quality_run_id'),
        ('site_quality_evidence', 'tenant_id'),
        ('site_quality_evidence', 'content_digest_sha256'),
        ('site_quality_evidence', 'quality_check_id'),
        ('site_quality_evidence', 'finding_id'),
        ('site_quality_evidence', 'page_id'),
        ('site_quality_waivers', 'quality_run_id'),
        ('site_quality_waivers', 'tenant_id'),
        ('site_quality_waivers', 'site_id'),
        ('site_quality_waivers', 'site_version_id'),
        ('site_quality_waivers', 'content_digest_sha256'),
        ('site_quality_human_reviews', 'quality_run_id'),
        ('site_quality_human_reviews', 'tenant_id'),
        ('site_quality_human_reviews', 'site_version_id'),
        ('site_quality_human_reviews', 'content_digest_sha256'),
        ('site_quality_human_reviews', 'quality_check_id'),
        ('site_quality_remediation_events', 'quality_run_id'),
        ('site_quality_remediation_events', 'tenant_id'),
        ('site_quality_remediation_events', 'finding_id'),
        ('site_quality_audit_sessions', 'quality_run_id'),
        ('site_quality_audit_sessions', 'tenant_id'),
        ('site_quality_audit_sessions', 'site_id'),
        ('site_quality_audit_sessions', 'site_version_id'),
        ('site_quality_audit_sessions', 'content_digest_sha256')
    ) AS required(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_data
      WHERE column_data.table_schema = 'public'
        AND column_data.table_name = required.table_name
        AND column_data.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION
      'A Phase 15.8 child-scope trigger binding has an incompatible schema';
  END IF;
END
$preconditions$;

CREATE OR REPLACE FUNCTION public.ks_validate_site_quality_child_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  row_data jsonb;
  child_quality_run_id uuid;
  child_tenant_id uuid;
  run_tenant_id uuid;
  run_site_id uuid;
  run_site_version_id uuid;
  run_content_digest_sha256 varchar(64);
BEGIN
  row_data := to_jsonb(NEW);

  IF TG_TABLE_SCHEMA <> 'public'
    OR TG_TABLE_NAME NOT IN (
      'site_quality_page_runs',
      'site_quality_checks',
      'site_quality_findings',
      'site_quality_evidence',
      'site_quality_waivers',
      'site_quality_human_reviews',
      'site_quality_remediation_events',
      'site_quality_audit_sessions'
    )
  THEN
    RAISE EXCEPTION
      'SITE_QUALITY_CHILD_SCOPE_BINDING_INVALID: %.%',
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME;
  END IF;

  IF row_data ->> 'quality_run_id' IS NULL
    OR row_data ->> 'tenant_id' IS NULL
  THEN
    RAISE EXCEPTION
      'SITE_QUALITY_CHILD_SCOPE_REQUIRED_FIELD_MISSING: %.%',
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME;
  END IF;

  child_quality_run_id := (row_data ->> 'quality_run_id')::uuid;
  child_tenant_id := (row_data ->> 'tenant_id')::uuid;

  SELECT
    quality_run.tenant_id,
    quality_run.site_id,
    quality_run.site_version_id,
    quality_run.site_version_digest_sha256
  INTO
    run_tenant_id,
    run_site_id,
    run_site_version_id,
    run_content_digest_sha256
  FROM public.site_quality_runs AS quality_run
  WHERE quality_run.id = child_quality_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_QUALITY_RUN_NOT_FOUND';
  END IF;

  IF child_tenant_id IS DISTINCT FROM run_tenant_id THEN
    RAISE EXCEPTION 'SITE_QUALITY_TENANT_SCOPE_INVALID';
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'site_quality_page_runs' THEN
      IF row_data ->> 'site_id' IS NULL
        OR row_data ->> 'site_version_id' IS NULL
        OR row_data ->> 'page_id' IS NULL
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_PAGE_RUN_REQUIRED_FIELD_MISSING';
      END IF;

      IF (row_data ->> 'site_id')::uuid IS DISTINCT FROM run_site_id
        OR (row_data ->> 'site_version_id')::uuid
          IS DISTINCT FROM run_site_version_id
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_SITE_VERSION_SCOPE_INVALID';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.site_pages AS page
        WHERE page.id = (row_data ->> 'page_id')::uuid
          AND page.tenant_id = run_tenant_id
          AND page.site_id = run_site_id
          AND page.version_id = run_site_version_id
      ) THEN
        RAISE EXCEPTION 'SITE_QUALITY_PAGE_SCOPE_INVALID';
      END IF;

    WHEN 'site_quality_checks' THEN
      IF row_data ->> 'page_run_id' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.site_quality_page_runs AS page_run
          WHERE page_run.id = (row_data ->> 'page_run_id')::uuid
            AND page_run.quality_run_id = child_quality_run_id
            AND page_run.tenant_id = run_tenant_id
            AND page_run.site_id = run_site_id
            AND page_run.site_version_id = run_site_version_id
        )
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_CHECK_PAGE_RUN_SCOPE_INVALID';
      END IF;

    WHEN 'site_quality_findings' THEN
      IF row_data ->> 'site_id' IS NULL
        OR row_data ->> 'site_version_id' IS NULL
        OR row_data ->> 'content_digest_sha256' IS NULL
        OR row_data ->> 'quality_check_id' IS NULL
        OR row_data ->> 'check_id' IS NULL
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_FINDING_REQUIRED_FIELD_MISSING';
      END IF;

      IF (row_data ->> 'site_id')::uuid IS DISTINCT FROM run_site_id
        OR (row_data ->> 'site_version_id')::uuid
          IS DISTINCT FROM run_site_version_id
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_SITE_VERSION_SCOPE_INVALID';
      END IF;

      IF row_data ->> 'content_digest_sha256'
        IS DISTINCT FROM run_content_digest_sha256
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_CONTENT_DIGEST_SCOPE_INVALID';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.site_quality_checks AS quality_check
        WHERE quality_check.id = (row_data ->> 'quality_check_id')::uuid
          AND quality_check.quality_run_id = child_quality_run_id
          AND quality_check.tenant_id = run_tenant_id
          AND quality_check.check_id = row_data ->> 'check_id'
      ) THEN
        RAISE EXCEPTION 'SITE_QUALITY_FINDING_CHECK_SCOPE_INVALID';
      END IF;

      IF row_data ->> 'page_id' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.site_pages AS page
          WHERE page.id = (row_data ->> 'page_id')::uuid
            AND page.tenant_id = run_tenant_id
            AND page.site_id = run_site_id
            AND page.version_id = run_site_version_id
        )
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_FINDING_PAGE_SCOPE_INVALID';
      END IF;

      IF row_data ->> 'section_id' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.site_sections AS section
          WHERE section.id = (row_data ->> 'section_id')::uuid
            AND section.tenant_id = run_tenant_id
            AND section.site_id = run_site_id
            AND section.version_id = run_site_version_id
            AND (
              row_data ->> 'page_id' IS NULL
              OR section.page_id = (row_data ->> 'page_id')::uuid
            )
        )
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_FINDING_SECTION_SCOPE_INVALID';
      END IF;

    WHEN 'site_quality_evidence' THEN
      IF row_data ->> 'content_digest_sha256' IS NULL THEN
        RAISE EXCEPTION 'SITE_QUALITY_EVIDENCE_REQUIRED_FIELD_MISSING';
      END IF;

      IF row_data ->> 'content_digest_sha256'
        IS DISTINCT FROM run_content_digest_sha256
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_CONTENT_DIGEST_SCOPE_INVALID';
      END IF;

      IF row_data ->> 'quality_check_id' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.site_quality_checks AS quality_check
          WHERE quality_check.id = (row_data ->> 'quality_check_id')::uuid
            AND quality_check.quality_run_id = child_quality_run_id
            AND quality_check.tenant_id = run_tenant_id
        )
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_EVIDENCE_CHECK_SCOPE_INVALID';
      END IF;

      IF row_data ->> 'finding_id' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.site_quality_findings AS finding
          WHERE finding.id = (row_data ->> 'finding_id')::uuid
            AND finding.quality_run_id = child_quality_run_id
            AND finding.tenant_id = run_tenant_id
            AND (
              row_data ->> 'quality_check_id' IS NULL
              OR finding.quality_check_id =
                (row_data ->> 'quality_check_id')::uuid
            )
        )
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_EVIDENCE_FINDING_SCOPE_INVALID';
      END IF;

      IF row_data ->> 'page_id' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.site_pages AS page
          WHERE page.id = (row_data ->> 'page_id')::uuid
            AND page.tenant_id = run_tenant_id
            AND page.site_id = run_site_id
            AND page.version_id = run_site_version_id
        )
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_EVIDENCE_PAGE_SCOPE_INVALID';
      END IF;

    WHEN 'site_quality_waivers' THEN
      IF row_data ->> 'site_id' IS NULL
        OR row_data ->> 'site_version_id' IS NULL
        OR row_data ->> 'content_digest_sha256' IS NULL
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_WAIVER_REQUIRED_FIELD_MISSING';
      END IF;

      IF (row_data ->> 'site_id')::uuid IS DISTINCT FROM run_site_id
        OR (row_data ->> 'site_version_id')::uuid
          IS DISTINCT FROM run_site_version_id
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_SITE_VERSION_SCOPE_INVALID';
      END IF;

      IF row_data ->> 'content_digest_sha256'
        IS DISTINCT FROM run_content_digest_sha256
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_CONTENT_DIGEST_SCOPE_INVALID';
      END IF;

    WHEN 'site_quality_human_reviews' THEN
      IF row_data ->> 'site_version_id' IS NULL
        OR row_data ->> 'content_digest_sha256' IS NULL
        OR row_data ->> 'quality_check_id' IS NULL
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_HUMAN_REVIEW_REQUIRED_FIELD_MISSING';
      END IF;

      IF (row_data ->> 'site_version_id')::uuid
        IS DISTINCT FROM run_site_version_id
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_SITE_VERSION_SCOPE_INVALID';
      END IF;

      IF row_data ->> 'content_digest_sha256'
        IS DISTINCT FROM run_content_digest_sha256
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_CONTENT_DIGEST_SCOPE_INVALID';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.site_quality_checks AS quality_check
        WHERE quality_check.id = (row_data ->> 'quality_check_id')::uuid
          AND quality_check.quality_run_id = child_quality_run_id
          AND quality_check.tenant_id = run_tenant_id
          AND quality_check.validation_method = 'HUMAN_REVIEW'
      ) THEN
        RAISE EXCEPTION 'SITE_QUALITY_HUMAN_REVIEW_CHECK_SCOPE_INVALID';
      END IF;

    WHEN 'site_quality_remediation_events' THEN
      IF row_data ->> 'finding_id' IS NULL THEN
        RAISE EXCEPTION 'SITE_QUALITY_REMEDIATION_REQUIRED_FIELD_MISSING';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.site_quality_findings AS finding
        WHERE finding.id = (row_data ->> 'finding_id')::uuid
          AND finding.quality_run_id = child_quality_run_id
          AND finding.tenant_id = run_tenant_id
          AND finding.site_id = run_site_id
          AND finding.site_version_id = run_site_version_id
          AND finding.content_digest_sha256 = run_content_digest_sha256
      ) THEN
        RAISE EXCEPTION 'SITE_QUALITY_REMEDIATION_FINDING_SCOPE_INVALID';
      END IF;

    WHEN 'site_quality_audit_sessions' THEN
      IF row_data ->> 'site_id' IS NULL
        OR row_data ->> 'site_version_id' IS NULL
        OR row_data ->> 'content_digest_sha256' IS NULL
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_AUDIT_SESSION_REQUIRED_FIELD_MISSING';
      END IF;

      IF (row_data ->> 'site_id')::uuid IS DISTINCT FROM run_site_id
        OR (row_data ->> 'site_version_id')::uuid
          IS DISTINCT FROM run_site_version_id
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_SITE_VERSION_SCOPE_INVALID';
      END IF;

      IF row_data ->> 'content_digest_sha256'
        IS DISTINCT FROM run_content_digest_sha256
      THEN
        RAISE EXCEPTION 'SITE_QUALITY_CONTENT_DIGEST_SCOPE_INVALID';
      END IF;

    ELSE
      RAISE EXCEPTION
        'SITE_QUALITY_CHILD_SCOPE_BINDING_INVALID: %.%',
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME;
  END CASE;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE
ON FUNCTION public.ks_validate_site_quality_child_scope()
FROM PUBLIC, anon, authenticated;

DO $postconditions$
DECLARE
  child_scope_function oid;
  function_definition text;
BEGIN
  SELECT
    function_data.oid,
    pg_catalog.pg_get_functiondef(function_data.oid)
  INTO
    child_scope_function,
    function_definition
  FROM pg_catalog.pg_proc AS function_data
  JOIN pg_catalog.pg_namespace AS function_namespace
    ON function_namespace.oid = function_data.pronamespace
  WHERE function_namespace.nspname = 'public'
    AND function_data.proname = 'ks_validate_site_quality_child_scope'
    AND pg_catalog.pg_get_function_identity_arguments(function_data.oid) = ''
    AND function_data.prorettype = 'trigger'::regtype;

  IF child_scope_function IS NULL
    OR function_definition NOT LIKE '%row_data := to_jsonb(NEW)%'
    OR function_definition ~* 'NEW\.[A-Za-z_][A-Za-z0-9_]*'
  THEN
    RAISE EXCEPTION
      'The reconciled child-scope function still has an unsafe row-field assumption';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger_data
    WHERE trigger_data.tgfoid = child_scope_function
      AND NOT trigger_data.tgisinternal
  ) <> 8 THEN
    RAISE EXCEPTION
      'The reconciled child-scope function does not retain all 8 bindings';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_data
    WHERE trigger_data.tgrelid = 'public.site_quality_evidence'::regclass
      AND trigger_data.tgname = 'site_quality_evidence_append_only'
      AND NOT trigger_data.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_data
    WHERE trigger_data.tgrelid =
      'public.site_quality_remediation_events'::regclass
      AND trigger_data.tgname = 'site_quality_remediation_events_append_only'
      AND NOT trigger_data.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_data
    WHERE trigger_data.tgrelid =
      'public.site_quality_run_comparisons'::regclass
      AND trigger_data.tgname = 'site_quality_run_comparisons_append_only'
      AND NOT trigger_data.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'A Phase 15.8 append-only trigger is missing after reconciliation';
  END IF;
END
$postconditions$;
