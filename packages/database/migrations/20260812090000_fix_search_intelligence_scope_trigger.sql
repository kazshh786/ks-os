BEGIN;

-- This trigger function is shared by several Search Intelligence tables.
-- Refer only to fields extracted from to_jsonb(NEW), because PostgreSQL
-- validates NEW.<field> against each trigger table's record type when the
-- function executes. site_search_strategies has no strategy_id column.
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
    JOIN site_search_strategies strategy ON strategy.id = target_strategy
    WHERE page.id = NEW.blueprint_page_id
      AND page.tenant_id = NEW.tenant_id
      AND page.blueprint_id = NEW.blueprint_id
      AND strategy.blueprint_id = NEW.blueprint_id
  ) THEN RAISE EXCEPTION 'PAGE_SEO_BRIEF_BLUEPRINT_SCOPE_INVALID'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM sites site WHERE site.id = target_site AND site.tenant_id = target_tenant
  ) THEN RAISE EXCEPTION 'SEARCH_INTELLIGENCE_SITE_SCOPE_INVALID'; END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION ks_validate_search_intelligence_scope() FROM PUBLIC, anon, authenticated;

COMMIT;
