-- Search Research Inbox
-- Private, tenant-scoped source files and deterministic extraction previews.
-- Sources remain separate from fact-finding assets and never enter production
-- briefs. Only an explicit apply action may attach extracted evidence to a
-- DRAFT Search Intelligence strategy.

CREATE TABLE IF NOT EXISTS public.site_search_research_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  uploaded_by_agency_user_id uuid NOT NULL REFERENCES public.agency_users(id) ON DELETE RESTRICT,
  storage_bucket varchar(100) NOT NULL,
  storage_path varchar(1000) NOT NULL,
  safe_filename varchar(255) NOT NULL,
  mime_type varchar(120) NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  digest_sha256 varchar(64) NOT NULL CHECK (digest_sha256 ~ '^[a-f0-9]{64}$'),
  provider_hint varchar(80) NOT NULL,
  market varchar(80) NOT NULL,
  locale varchar(35) NOT NULL,
  search_location varchar(160) NOT NULL,
  language varchar(35) NOT NULL,
  device varchar(20) NOT NULL CHECK (device IN ('DESKTOP','MOBILE')),
  captured_at timestamptz NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'PENDING_UPLOAD'
    CHECK (status IN ('PENDING_UPLOAD','EXTRACTED','APPLIED','REJECTED','QUARANTINED')),
  extracted_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(extracted_json) = 'object'),
  extracted_at timestamptz,
  applied_strategy_id uuid REFERENCES public.site_search_strategies(id) ON DELETE RESTRICT,
  applied_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(storage_bucket, storage_path),
  CHECK (status <> 'EXTRACTED' OR extracted_at IS NOT NULL),
  CHECK (status <> 'APPLIED' OR (applied_strategy_id IS NOT NULL AND applied_at IS NOT NULL)),
  CHECK (status <> 'REJECTED' OR rejected_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS site_search_research_sources_site_status_idx
  ON public.site_search_research_sources(tenant_id, site_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS site_search_research_sources_strategy_idx
  ON public.site_search_research_sources(applied_strategy_id, applied_at DESC)
  WHERE applied_strategy_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ks_validate_search_research_source_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.sites site
    WHERE site.id = NEW.site_id
      AND site.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Search research source site scope mismatch';
  END IF;

  IF NEW.applied_strategy_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.site_search_strategies strategy
    WHERE strategy.id = NEW.applied_strategy_id
      AND strategy.site_id = NEW.site_id
      AND strategy.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Search research source strategy scope mismatch';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_search_research_sources_scope_guard ON public.site_search_research_sources;
CREATE TRIGGER site_search_research_sources_scope_guard
BEFORE INSERT OR UPDATE ON public.site_search_research_sources
FOR EACH ROW EXECUTE FUNCTION public.ks_validate_search_research_source_scope();

ALTER TABLE public.site_search_research_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_search_research_sources FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.site_search_research_sources FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_search_research_sources TO service_role;

REVOKE ALL ON FUNCTION public.ks_validate_search_research_source_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ks_validate_search_research_source_scope() TO service_role;
