SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE site_assets
  ADD COLUMN IF NOT EXISTS source_fact_finding_upload_id uuid;

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

ALTER TABLE site_assets
  VALIDATE CONSTRAINT site_assets_source_fact_finding_upload_fk;

CREATE UNIQUE INDEX IF NOT EXISTS site_assets_site_source_upload_unique
  ON site_assets(site_id, source_fact_finding_upload_id);

CREATE INDEX IF NOT EXISTS site_assets_source_upload_idx
  ON site_assets(source_fact_finding_upload_id);

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
