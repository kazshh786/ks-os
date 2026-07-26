-- Phase 15.6C runtime persistence. Additive only: retain the complete validated
-- structured page envelope needed for deterministic regeneration and preview.

ALTER TABLE site_pages
  ADD COLUMN navigation_label varchar(80),
  ADD COLUMN seo_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN internal_links_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN structured_data_inputs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN asset_requirements_json jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE site_pages
  ADD CONSTRAINT site_pages_seo_json_object_check
    CHECK (jsonb_typeof(seo_json) = 'object'),
  ADD CONSTRAINT site_pages_internal_links_array_check
    CHECK (jsonb_typeof(internal_links_json) = 'array'),
  ADD CONSTRAINT site_pages_structured_data_inputs_array_check
    CHECK (jsonb_typeof(structured_data_inputs_json) = 'array'),
  ADD CONSTRAINT site_pages_asset_requirements_array_check
    CHECK (jsonb_typeof(asset_requirements_json) = 'array');

COMMENT ON COLUMN site_pages.seo_json IS
  'Validated Phase 15.6C SiteSeoMetadata; never raw provider output.';
COMMENT ON COLUMN site_pages.internal_links_json IS
  'Validated public page references and anchor text only.';
COMMENT ON COLUMN site_pages.structured_data_inputs_json IS
  'Validated structured-data inputs; never raw JSON-LD or scripts.';
COMMENT ON COLUMN site_pages.asset_requirements_json IS
  'Non-executable asset requirements for later agency fulfilment.';
