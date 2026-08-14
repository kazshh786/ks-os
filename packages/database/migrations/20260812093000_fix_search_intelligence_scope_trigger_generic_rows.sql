BEGIN;

-- ks_validate_search_intelligence_scope is attached to several record types.
-- PostgreSQL resolves direct NEW field access for the trigger's concrete table even when
-- that reference appears in a branch that will not run. Extract every
-- table-specific field from the generic JSON record before branching.
CREATE OR REPLACE FUNCTION ks_validate_search_intelligence_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  target_tenant uuid := (row_json ->> 'tenant_id')::uuid;
  target_site uuid := (row_json ->> 'site_id')::uuid;
  target_strategy uuid := NULLIF(row_json ->> 'strategy_id', '')::uuid;
  target_blueprint uuid := NULLIF(row_json ->> 'blueprint_id', '')::uuid;
  target_blueprint_page uuid := NULLIF(row_json ->> 'blueprint_page_id', '')::uuid;
  target_blueprint_revision integer := NULLIF(row_json ->> 'blueprint_revision', '')::integer;
BEGIN
  IF TG_TABLE_NAME = 'site_search_strategies' THEN
    IF NOT EXISTS (
      SELECT 1 FROM site_blueprints blueprint
      WHERE blueprint.id = target_blueprint
        AND blueprint.tenant_id = target_tenant
        AND blueprint.site_id = target_site
        AND blueprint.revision = target_blueprint_revision
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
    JOIN site_search_strategies strategy ON strategy.id = target_strategy
    WHERE page.id = target_blueprint_page
      AND page.tenant_id = target_tenant
      AND page.blueprint_id = target_blueprint
      AND strategy.blueprint_id = target_blueprint
  ) THEN RAISE EXCEPTION 'PAGE_SEO_BRIEF_BLUEPRINT_SCOPE_INVALID'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM sites site WHERE site.id = target_site AND site.tenant_id = target_tenant
  ) THEN RAISE EXCEPTION 'SEARCH_INTELLIGENCE_SITE_SCOPE_INVALID'; END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION ks_validate_search_intelligence_scope() FROM PUBLIC, anon, authenticated;

COMMIT;
