-- Phase 15.5: provider-neutral public renderer mappings, immutable render
-- snapshots and preview-token revocation records.
-- No publication workflow, provider integration or DNS operation is included.

CREATE TABLE IF NOT EXISTS template_layout_renderers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  template_layout_id uuid NOT NULL UNIQUE
    REFERENCES template_layouts(id) ON DELETE RESTRICT,
  renderer_key varchar(120),
  renderer_status varchar(30) NOT NULL DEFAULT 'UNMAPPED'
    CHECK (renderer_status IN (
      'UNMAPPED','MAPPED','READY','DISABLED','REQUIRES_REVIEW'
    )),
  renderer_version integer,
  renderer_mapped_at timestamptz,
  renderer_mapped_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      renderer_status = 'UNMAPPED'
      AND renderer_key IS NULL
      AND renderer_version IS NULL
      AND renderer_mapped_at IS NULL
      AND renderer_mapped_by_agency_user_id IS NULL
    )
    OR
    (
      renderer_status <> 'UNMAPPED'
      AND renderer_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      AND renderer_version > 0
      AND renderer_mapped_at IS NOT NULL
      AND renderer_mapped_by_agency_user_id IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS template_layout_renderers_status_key_idx
  ON template_layout_renderers(renderer_status, renderer_key);
CREATE INDEX IF NOT EXISTS template_layout_renderers_mapped_by_idx
  ON template_layout_renderers(renderer_mapped_by_agency_user_id);

CREATE TABLE IF NOT EXISTS site_render_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES template_versions(id) ON DELETE RESTRICT,
  snapshot_kind varchar(20) NOT NULL
    CHECK (snapshot_kind IN ('PREVIEW','PUBLISHED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  hostname_configuration_version integer NOT NULL DEFAULT 1
    CHECK (hostname_configuration_version > 0),
  content_json jsonb NOT NULL CHECK (jsonb_typeof(content_json) = 'object'),
  content_digest_sha256 varchar(64) NOT NULL
    CHECK (content_digest_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK (
    (snapshot_kind = 'PUBLISHED' AND published_at IS NOT NULL)
    OR
    (snapshot_kind = 'PREVIEW' AND published_at IS NULL)
  ),
  UNIQUE(site_version_id, snapshot_kind, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS site_render_snapshots_published_version_unique
  ON site_render_snapshots(site_version_id)
  WHERE snapshot_kind = 'PUBLISHED';
CREATE INDEX IF NOT EXISTS site_render_snapshots_site_kind_created_idx
  ON site_render_snapshots(site_id, snapshot_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS site_render_snapshots_tenant_site_kind_idx
  ON site_render_snapshots(tenant_id, site_id, snapshot_kind);
CREATE INDEX IF NOT EXISTS site_render_snapshots_template_version_idx
  ON site_render_snapshots(template_version_id);
CREATE INDEX IF NOT EXISTS site_render_snapshots_created_by_idx
  ON site_render_snapshots(created_by_agency_user_id);

CREATE TABLE IF NOT EXISTS site_preview_token_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_jti uuid NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  reason_code varchar(80) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,79}$')
);
CREATE INDEX IF NOT EXISTS site_preview_token_revocations_site_version_idx
  ON site_preview_token_revocations(site_id, site_version_id);
CREATE INDEX IF NOT EXISTS site_preview_token_revocations_expiry_idx
  ON site_preview_token_revocations(expires_at);
CREATE INDEX IF NOT EXISTS site_preview_token_revocations_revoked_by_idx
  ON site_preview_token_revocations(revoked_by_agency_user_id);

CREATE OR REPLACE FUNCTION ks_validate_site_render_snapshot_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_tenant_id uuid;
  version_site_id uuid;
  version_status varchar(30);
  template_status varchar(30);
BEGIN
  SELECT tenant_id, site_id, status
  INTO version_tenant_id, version_site_id, version_status
  FROM site_versions
  WHERE id = NEW.site_version_id;

  IF version_tenant_id IS NULL
    OR version_tenant_id <> NEW.tenant_id
    OR version_site_id <> NEW.site_id THEN
    RAISE EXCEPTION 'Render snapshot ownership does not match its site version'
      USING ERRCODE = '23514';
  END IF;

  SELECT status INTO template_status
  FROM template_versions
  WHERE id = NEW.template_version_id;

  IF template_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Render snapshots require an approved template version'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.snapshot_kind = 'PUBLISHED' AND version_status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published render snapshots require a published site version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ks_prevent_site_render_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Site render snapshots are immutable'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS site_render_snapshots_validate_insert
  ON site_render_snapshots;
CREATE TRIGGER site_render_snapshots_validate_insert
  BEFORE INSERT ON site_render_snapshots
  FOR EACH ROW EXECUTE FUNCTION ks_validate_site_render_snapshot_insert();

DROP TRIGGER IF EXISTS site_render_snapshots_prevent_mutation
  ON site_render_snapshots;
CREATE TRIGGER site_render_snapshots_prevent_mutation
  BEFORE UPDATE OR DELETE ON site_render_snapshots
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_site_render_snapshot_mutation();

CREATE OR REPLACE FUNCTION ks_prevent_preview_token_revocation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Preview token revocations are append-only'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS site_preview_token_revocations_append_only
  ON site_preview_token_revocations;
CREATE TRIGGER site_preview_token_revocations_append_only
  BEFORE UPDATE OR DELETE ON site_preview_token_revocations
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_preview_token_revocation_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'template_layout_renderers',
    'site_render_snapshots',
    'site_preview_token_revocations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'REVOKE ALL ON TABLE %I FROM anon, authenticated',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT ON TABLE %I TO service_role',
      table_name
    );
  END LOOP;
END $$;

GRANT UPDATE ON TABLE template_layout_renderers TO service_role;

REVOKE EXECUTE ON FUNCTION ks_validate_site_render_snapshot_insert()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_prevent_site_render_snapshot_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_prevent_preview_token_revocation_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ks_validate_site_render_snapshot_insert()
  TO service_role;
GRANT EXECUTE ON FUNCTION ks_prevent_site_render_snapshot_mutation()
  TO service_role;
GRANT EXECUTE ON FUNCTION ks_prevent_preview_token_revocation_mutation()
  TO service_role;
