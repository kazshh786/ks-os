-- Preserve immutable generation provenance while allowing a stranded run to
-- record a terminal failure after its pinned knowledge pack is superseded.
-- New runs still require the pack to be ACTIVE, and non-terminal updates on a
-- superseded or retired pack remain blocked.

CREATE OR REPLACE FUNCTION ks_validate_site_generation_run_ownership()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  pinned_pack_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sites
    WHERE id = NEW.site_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Site-generation site ownership mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.site_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_versions
    WHERE id = NEW.site_version_id AND site_id = NEW.site_id
      AND tenant_id = NEW.tenant_id AND status = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Site-generation requires an owned draft version' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM site_blueprints
    WHERE id = NEW.blueprint_id AND site_id = NEW.site_id
      AND tenant_id = NEW.tenant_id AND status = 'APPROVED'
      AND revision = NEW.blueprint_revision
      AND template_version_id = NEW.template_version_id
  ) THEN
    RAISE EXCEPTION 'Site-generation blueprint ownership or approval mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM template_versions
    WHERE id = NEW.template_version_id AND status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Site-generation template version is not approved' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO pinned_pack_status
  FROM knowledge_packs
  WHERE id = NEW.knowledge_pack_id
    AND intended_scope = 'PUBLIC_SITE'
    AND semantic_version = NEW.knowledge_pack_semantic_version;
  IF pinned_pack_status IS NULL
    OR (TG_OP = 'INSERT' AND pinned_pack_status <> 'ACTIVE')
    OR (
      TG_OP = 'UPDATE'
      AND pinned_pack_status <> 'ACTIVE'
      AND NEW.status NOT IN ('FAILED', 'CANCELLED')
    )
  THEN
    RAISE EXCEPTION 'Site-generation active knowledge-pack mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.site_version_id IS DISTINCT FROM OLD.site_version_id
    OR NEW.blueprint_id IS DISTINCT FROM OLD.blueprint_id
    OR NEW.blueprint_revision IS DISTINCT FROM OLD.blueprint_revision
    OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
    OR NEW.knowledge_pack_id IS DISTINCT FROM OLD.knowledge_pack_id
    OR NEW.knowledge_pack_semantic_version IS DISTINCT FROM OLD.knowledge_pack_semantic_version
    OR NEW.generation_reason IS DISTINCT FROM OLD.generation_reason
    OR NEW.generator_version IS DISTINCT FROM OLD.generator_version
    OR NEW.provider_key IS DISTINCT FROM OLD.provider_key
    OR NEW.model_key IS DISTINCT FROM OLD.model_key
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.source_data_digest_sha256 IS DISTINCT FROM OLD.source_data_digest_sha256
    OR NEW.prompt_template_version IS DISTINCT FROM OLD.prompt_template_version
    OR NEW.requested_by_agency_user_id IS DISTINCT FROM OLD.requested_by_agency_user_id
  ) THEN
    RAISE EXCEPTION 'Site-generation pinned provenance is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ks_validate_site_generation_run_ownership() IS
  'Enforces owned immutable generation provenance; creation requires active knowledge, while superseded knowledge permits terminal failure persistence only.';
