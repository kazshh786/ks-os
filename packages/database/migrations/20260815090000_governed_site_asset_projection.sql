SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE site_assets
  ADD COLUMN IF NOT EXISTS source_fact_finding_upload_id uuid;

ALTER TABLE fact_finding_uploads
  ADD COLUMN IF NOT EXISTS bound_staff_user_id uuid,
  ADD COLUMN IF NOT EXISTS bound_service_id uuid;

ALTER TABLE site_generation_runs
  ADD COLUMN IF NOT EXISTS asset_input_json jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'site_assets_source_fact_finding_upload_fk'
      AND conrelid = 'public.site_assets'::regclass
  ) THEN
    ALTER TABLE site_assets
      ADD CONSTRAINT site_assets_source_fact_finding_upload_fk
      FOREIGN KEY (source_fact_finding_upload_id)
      REFERENCES fact_finding_uploads(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fact_finding_uploads_bound_staff_fk'
      AND conrelid = 'public.fact_finding_uploads'::regclass
  ) THEN
    ALTER TABLE fact_finding_uploads
      ADD CONSTRAINT fact_finding_uploads_bound_staff_fk
      FOREIGN KEY (bound_staff_user_id) REFERENCES users(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fact_finding_uploads_bound_service_fk'
      AND conrelid = 'public.fact_finding_uploads'::regclass
  ) THEN
    ALTER TABLE fact_finding_uploads
      ADD CONSTRAINT fact_finding_uploads_bound_service_fk
      FOREIGN KEY (bound_service_id) REFERENCES services(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fact_finding_uploads_entity_binding_check'
      AND conrelid = 'public.fact_finding_uploads'::regclass
  ) THEN
    ALTER TABLE fact_finding_uploads
      ADD CONSTRAINT fact_finding_uploads_entity_binding_check
      CHECK (
        num_nonnulls(bound_staff_user_id, bound_service_id) <= 1
        AND (bound_staff_user_id IS NULL OR asset_category = 'TEAM_PHOTO')
        AND (bound_service_id IS NULL OR asset_category = 'SERVICE_PHOTO')
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_generation_runs_asset_input_check'
      AND conrelid = 'public.site_generation_runs'::regclass
  ) THEN
    ALTER TABLE site_generation_runs
      ADD CONSTRAINT site_generation_runs_asset_input_check
      CHECK (asset_input_json IS NULL OR jsonb_typeof(asset_input_json) = 'array')
      NOT VALID;
  END IF;
END $$;

ALTER TABLE site_assets
  VALIDATE CONSTRAINT site_assets_source_fact_finding_upload_fk;

ALTER TABLE fact_finding_uploads
  VALIDATE CONSTRAINT fact_finding_uploads_bound_staff_fk;

ALTER TABLE fact_finding_uploads
  VALIDATE CONSTRAINT fact_finding_uploads_bound_service_fk;

ALTER TABLE fact_finding_uploads
  VALIDATE CONSTRAINT fact_finding_uploads_entity_binding_check;

ALTER TABLE site_generation_runs
  VALIDATE CONSTRAINT site_generation_runs_asset_input_check;

CREATE UNIQUE INDEX IF NOT EXISTS site_assets_site_source_upload_unique
  ON site_assets(site_id, source_fact_finding_upload_id);

CREATE INDEX IF NOT EXISTS site_assets_source_upload_idx
  ON site_assets(source_fact_finding_upload_id);

CREATE INDEX IF NOT EXISTS fact_finding_uploads_bound_staff_idx
  ON fact_finding_uploads(bound_staff_user_id);

CREATE INDEX IF NOT EXISTS fact_finding_uploads_bound_service_idx
  ON fact_finding_uploads(bound_service_id);

ALTER TABLE site_assets
  DROP CONSTRAINT IF EXISTS site_assets_kind_check;

ALTER TABLE site_assets
  ADD CONSTRAINT site_assets_kind_check
  CHECK (kind IN (
    'IMAGE', 'LOGO', 'ICON', 'DOCUMENT', 'VIDEO_POSTER',
    'STAFF', 'LOCATION', 'SERVICE', 'RESULT', 'GALLERY', 'BRAND'
  ))
  NOT VALID;

ALTER TABLE site_assets
  VALIDATE CONSTRAINT site_assets_kind_check;

CREATE OR REPLACE FUNCTION public.guard_site_generation_asset_input()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.asset_input_json IS DISTINCT FROM OLD.asset_input_json THEN
    RAISE EXCEPTION 'Pinned generation asset input is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'site_generation_runs_asset_input_guard'
      AND tgrelid = 'public.site_generation_runs'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER site_generation_runs_asset_input_guard
      BEFORE UPDATE OF asset_input_json ON site_generation_runs
      FOR EACH ROW EXECUTE FUNCTION public.guard_site_generation_asset_input();
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.guard_site_generation_asset_input()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_site_generation_asset_input()
  TO service_role;
