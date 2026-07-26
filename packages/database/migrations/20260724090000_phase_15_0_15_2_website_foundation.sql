-- Phase 15.0-15.2: managed website architecture, site domain model,
-- plan entitlements and native KS OS booking-reference foundation.
-- This migration is additive and performs no provider or deployment work.

ALTER TABLE services ADD COLUMN IF NOT EXISTS public_reference uuid;
UPDATE services SET public_reference = gen_random_uuid() WHERE public_reference IS NULL;
ALTER TABLE services ALTER COLUMN public_reference SET DEFAULT gen_random_uuid();
ALTER TABLE services ALTER COLUMN public_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS services_public_reference_unique
  ON services(public_reference);
CREATE INDEX IF NOT EXISTS services_tenant_public_reference_idx
  ON services(tenant_id, public_reference);

ALTER TABLE locations ADD COLUMN IF NOT EXISTS public_reference uuid;
UPDATE locations SET public_reference = gen_random_uuid() WHERE public_reference IS NULL;
ALTER TABLE locations ALTER COLUMN public_reference SET DEFAULT gen_random_uuid();
ALTER TABLE locations ALTER COLUMN public_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS locations_public_reference_unique
  ON locations(public_reference);
CREATE INDEX IF NOT EXISTS locations_tenant_public_reference_idx
  ON locations(tenant_id, public_reference);

CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  display_name varchar(160) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'SETUP_REQUIRED'
    CHECK (status IN (
      'SETUP_REQUIRED','DRAFT','GENERATING','INTERNAL_REVIEW','CLIENT_REVIEW',
      'APPROVED','PUBLISHING','LIVE','PUBLISH_FAILED','SUSPENDED','ARCHIVED'
    )),
  creation_idempotency_key varchar(120),
  published_version_id uuid,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sites_tenant_status_idx ON sites(tenant_id, status);
CREATE INDEX IF NOT EXISTS sites_created_by_idx ON sites(created_by_agency_user_id);

CREATE TABLE IF NOT EXISTS site_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  based_on_version_id uuid REFERENCES site_versions(id) ON DELETE SET NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT','INTERNAL_REVIEW','CLIENT_REVIEW','APPROVED','PUBLISHED',
      'SUPERSEDED','REJECTED','ARCHIVED'
    )),
  change_summary varchar(500),
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, version_number)
);
CREATE INDEX IF NOT EXISTS site_versions_tenant_site_status_idx
  ON site_versions(tenant_id, site_id, status);
CREATE INDEX IF NOT EXISTS site_versions_based_on_idx ON site_versions(based_on_version_id);
CREATE INDEX IF NOT EXISTS site_versions_created_by_idx ON site_versions(created_by_agency_user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sites_published_version_id_fkey'
      AND conrelid = 'sites'::regclass
  ) THEN
    ALTER TABLE sites
      ADD CONSTRAINT sites_published_version_id_fkey
      FOREIGN KEY (published_version_id) REFERENCES site_versions(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sites_published_version_idx ON sites(published_version_id);

CREATE TABLE IF NOT EXISTS template_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_type varchar(30) NOT NULL
    CHECK (source_type IN ('ENVATO_HTML','GOOGLE_STITCH','INTERNAL')),
  name varchar(160) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','INTERNAL_REVIEW','APPROVED','RETIRED')),
  source_reference varchar(500),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata_json) = 'object')
);
CREATE INDEX IF NOT EXISTS template_sources_type_status_idx
  ON template_sources(source_type, status);
CREATE INDEX IF NOT EXISTS template_sources_created_by_idx
  ON template_sources(created_by_agency_user_id);

CREATE TABLE IF NOT EXISTS template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  template_source_id uuid NOT NULL REFERENCES template_sources(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','INTERNAL_REVIEW','APPROVED','RETIRED')),
  manifest_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum_sha256 varchar(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_source_id, version_number),
  CHECK (jsonb_typeof(manifest_json) = 'object'),
  CHECK ((status <> 'APPROVED') OR (approved_by_agency_user_id IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS template_versions_source_status_idx
  ON template_versions(template_source_id, status);
CREATE INDEX IF NOT EXISTS template_versions_approved_by_idx
  ON template_versions(approved_by_agency_user_id);

CREATE TABLE IF NOT EXISTS template_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  template_version_id uuid NOT NULL REFERENCES template_versions(id) ON DELETE RESTRICT,
  name varchar(160) NOT NULL,
  semantic_key varchar(120) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','APPROVED','RETIRED')),
  section_manifest_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_version_id, semantic_key),
  CHECK (semantic_key ~ '^[a-z][a-z0-9_-]{1,119}$'),
  CHECK (jsonb_typeof(section_manifest_json) = 'array')
);
CREATE INDEX IF NOT EXISTS template_layouts_version_status_idx
  ON template_layouts(template_version_id, status);

CREATE TABLE IF NOT EXISTS template_layout_page_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_layout_id uuid NOT NULL REFERENCES template_layouts(id) ON DELETE CASCADE,
  page_type varchar(40) NOT NULL
    CHECK (page_type IN (
      'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
      'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
      'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','BOOKING'
    )),
  UNIQUE(template_layout_id, page_type)
);
CREATE INDEX IF NOT EXISTS template_layout_page_types_page_type_idx
  ON template_layout_page_types(page_type, template_layout_id);

CREATE TABLE IF NOT EXISTS site_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  name varchar(160) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','INTERNAL_REVIEW','APPROVED','ARCHIVED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  approved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status <> 'APPROVED') OR (approved_by_agency_user_id IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS site_blueprints_tenant_site_status_idx
  ON site_blueprints(tenant_id, site_id, status);
CREATE INDEX IF NOT EXISTS site_blueprints_site_idx ON site_blueprints(site_id);
CREATE INDEX IF NOT EXISTS site_blueprints_approved_by_idx
  ON site_blueprints(approved_by_agency_user_id);

CREATE TABLE IF NOT EXISTS site_blueprint_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  blueprint_id uuid NOT NULL REFERENCES site_blueprints(id) ON DELETE CASCADE,
  page_type varchar(40) NOT NULL
    CHECK (page_type IN (
      'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
      'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
      'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','BOOKING'
    )),
  conversion_role varchar(40) NOT NULL
    CHECK (conversion_role IN (
      'PRIMARY_LANDING','SERVICE_CONVERSION','LOCAL_DISCOVERY',
      'TRUST_BUILDING','OBJECTION_HANDLING','BOOKING'
    )),
  entitlement_kind varchar(30) NOT NULL
    CHECK (entitlement_kind IN ('MARKETING','FUNCTIONAL','REQUIRED_LEGAL')),
  allocation varchar(20) NOT NULL DEFAULT 'INITIAL'
    CHECK (allocation IN ('INITIAL','MONTHLY')),
  title varchar(160) NOT NULL,
  proposed_slug varchar(120) NOT NULL,
  template_layout_id uuid REFERENCES template_layouts(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  rationale varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(blueprint_id, sort_order),
  UNIQUE(blueprint_id, proposed_slug),
  CHECK (proposed_slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'),
  CHECK (
    (page_type = 'BOOKING' AND entitlement_kind = 'FUNCTIONAL') OR
    (page_type = 'POLICIES' AND entitlement_kind = 'REQUIRED_LEGAL') OR
    (page_type NOT IN ('BOOKING','POLICIES') AND entitlement_kind = 'MARKETING')
  )
);
CREATE INDEX IF NOT EXISTS site_blueprint_pages_tenant_blueprint_idx
  ON site_blueprint_pages(tenant_id, blueprint_id);
CREATE INDEX IF NOT EXISTS site_blueprint_pages_layout_idx
  ON site_blueprint_pages(template_layout_id);

CREATE TABLE IF NOT EXISTS monthly_page_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  plan_assignment_id uuid NOT NULL REFERENCES tenant_plan_assignments(id) ON DELETE RESTRICT,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  allowance integer NOT NULL CHECK (allowance >= 0),
  status varchar(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','EXHAUSTED','CLOSED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, period_start),
  CHECK (period_end > period_start)
);
CREATE INDEX IF NOT EXISTS monthly_page_entitlements_tenant_status_period_idx
  ON monthly_page_entitlements(tenant_id, status, period_start);
CREATE INDEX IF NOT EXISTS monthly_page_entitlements_plan_assignment_idx
  ON monthly_page_entitlements(plan_assignment_id);

CREATE TABLE IF NOT EXISTS monthly_page_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  monthly_entitlement_id uuid NOT NULL REFERENCES monthly_page_entitlements(id) ON DELETE RESTRICT,
  site_page_id uuid,
  status varchar(30) NOT NULL DEFAULT 'IDENTIFIED'
    CHECK (status IN (
      'IDENTIFIED','PLANNED','IN_PROGRESS','INTERNAL_REVIEW','APPROVED',
      'COMPLETED','REJECTED','CANCELLED'
    )),
  topic varchar(240) NOT NULL,
  source varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS monthly_page_opportunities_entitlement_status_idx
  ON monthly_page_opportunities(monthly_entitlement_id, status);
CREATE INDEX IF NOT EXISTS monthly_page_opportunities_tenant_site_status_idx
  ON monthly_page_opportunities(tenant_id, site_id, status);

CREATE TABLE IF NOT EXISTS site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  page_type varchar(40) NOT NULL
    CHECK (page_type IN (
      'HOME','SERVICE_HUB','SERVICE_DETAIL','LOCATION_HUB','LOCATION_DETAIL',
      'ABOUT','TEAM_HUB','TEAM_DETAIL','CONTACT','FAQ','POLICIES','RESULTS',
      'NEW_CLIENT_GUIDE','AFTERCARE_GUIDE','CONSULTATION_GUIDE','BOOKING'
    )),
  conversion_role varchar(40) NOT NULL
    CHECK (conversion_role IN (
      'PRIMARY_LANDING','SERVICE_CONVERSION','LOCAL_DISCOVERY',
      'TRUST_BUILDING','OBJECTION_HANDLING','BOOKING'
    )),
  entitlement_kind varchar(30) NOT NULL
    CHECK (entitlement_kind IN ('MARKETING','FUNCTIONAL','REQUIRED_LEGAL')),
  allocation varchar(20) NOT NULL DEFAULT 'INITIAL'
    CHECK (allocation IN ('INITIAL','MONTHLY')),
  monthly_opportunity_id uuid REFERENCES monthly_page_opportunities(id) ON DELETE RESTRICT,
  template_layout_id uuid REFERENCES template_layouts(id) ON DELETE RESTRICT,
  title varchar(160) NOT NULL,
  slug varchar(120) NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  seo_title varchar(70),
  seo_description varchar(170),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(version_id, slug),
  UNIQUE(version_id, sort_order),
  CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'),
  CHECK (
    (page_type = 'BOOKING' AND entitlement_kind = 'FUNCTIONAL') OR
    (page_type = 'POLICIES' AND entitlement_kind = 'REQUIRED_LEGAL') OR
    (page_type NOT IN ('BOOKING','POLICIES') AND entitlement_kind = 'MARKETING')
  ),
  CHECK (
    entitlement_kind <> 'MARKETING' OR allocation <> 'MONTHLY' OR
    monthly_opportunity_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS site_pages_tenant_site_version_idx
  ON site_pages(tenant_id, site_id, version_id);
CREATE INDEX IF NOT EXISTS site_pages_site_idx ON site_pages(site_id);
CREATE INDEX IF NOT EXISTS site_pages_entitlement_usage_idx
  ON site_pages(tenant_id, site_id, entitlement_kind, allocation)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS site_pages_monthly_opportunity_idx
  ON site_pages(monthly_opportunity_id);
CREATE INDEX IF NOT EXISTS site_pages_layout_idx ON site_pages(template_layout_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'monthly_page_opportunities_site_page_id_fkey'
      AND conrelid = 'monthly_page_opportunities'::regclass
  ) THEN
    ALTER TABLE monthly_page_opportunities
      ADD CONSTRAINT monthly_page_opportunities_site_page_id_fkey
      FOREIGN KEY (site_page_id) REFERENCES site_pages(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS monthly_page_opportunities_site_page_idx
  ON monthly_page_opportunities(site_page_id);

CREATE TABLE IF NOT EXISTS site_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  page_id uuid NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
  section_key varchar(120) NOT NULL,
  section_type varchar(80) NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(page_id, sort_order),
  UNIQUE(page_id, section_key),
  CHECK (section_key ~ '^[a-z][a-z0-9_-]{1,119}$'),
  CHECK (jsonb_typeof(content_json) = 'object'),
  CHECK (jsonb_typeof(actions_json) = 'array')
);
CREATE INDEX IF NOT EXISTS site_sections_tenant_version_page_idx
  ON site_sections(tenant_id, version_id, page_id);
CREATE INDEX IF NOT EXISTS site_sections_site_idx ON site_sections(site_id);

CREATE TABLE IF NOT EXISTS site_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  kind varchar(40) NOT NULL
    CHECK (kind IN ('IMAGE','LOGO','ICON','DOCUMENT','VIDEO_POSTER')),
  storage_path varchar(1000) NOT NULL UNIQUE,
  mime_type varchar(100) NOT NULL,
  alt_text varchar(500),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  status varchar(30) NOT NULL DEFAULT 'READY'
    CHECK (status IN ('UPLOADING','PROCESSING','READY','REJECTED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_assets_tenant_site_version_idx
  ON site_assets(tenant_id, site_id, version_id);

CREATE TABLE IF NOT EXISTS site_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','WITHDRAWN')),
  requested_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  responded_by_tenant_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  response_note varchar(1000),
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK ((status = 'PENDING') OR responded_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS site_approvals_tenant_site_status_idx
  ON site_approvals(tenant_id, site_id, status);
CREATE INDEX IF NOT EXISTS site_approvals_version_status_idx
  ON site_approvals(version_id, status);
CREATE INDEX IF NOT EXISTS site_approvals_requested_by_idx
  ON site_approvals(requested_by_agency_user_id);
CREATE INDEX IF NOT EXISTS site_approvals_responded_by_idx
  ON site_approvals(responded_by_tenant_user_id);

CREATE TABLE IF NOT EXISTS site_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  version_id uuid REFERENCES site_versions(id) ON DELETE RESTRICT,
  page_id uuid REFERENCES site_pages(id) ON DELETE RESTRICT,
  requested_by_tenant_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED','TRIAGED','IN_PROGRESS','COMPLETED','REJECTED','CANCELLED')),
  title varchar(160) NOT NULL,
  description text NOT NULL,
  resolved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  resolution_note varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (
    (status NOT IN ('COMPLETED','REJECTED','CANCELLED')) OR
    (resolved_by_agency_user_id IS NOT NULL AND resolved_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS site_change_requests_tenant_site_status_idx
  ON site_change_requests(tenant_id, site_id, status);
CREATE INDEX IF NOT EXISTS site_change_requests_version_idx
  ON site_change_requests(version_id);
CREATE INDEX IF NOT EXISTS site_change_requests_page_status_idx
  ON site_change_requests(page_id, status);
CREATE INDEX IF NOT EXISTS site_change_requests_requested_by_idx
  ON site_change_requests(requested_by_tenant_user_id);
CREATE INDEX IF NOT EXISTS site_change_requests_resolved_by_idx
  ON site_change_requests(resolved_by_agency_user_id);

CREATE TABLE IF NOT EXISTS site_publication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  previous_version_id uuid REFERENCES site_versions(id) ON DELETE RESTRICT,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('PUBLISH','ROLLBACK')),
  status varchar(20) NOT NULL CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  snapshot_checksum_sha256 varchar(64)
    CHECK (snapshot_checksum_sha256 IS NULL OR snapshot_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_manifest_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  failure_code varchar(100),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(snapshot_manifest_json) = 'object'),
  CHECK ((status <> 'COMPLETED') OR snapshot_checksum_sha256 IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS site_publication_events_tenant_site_occurred_idx
  ON site_publication_events(tenant_id, site_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS site_publication_events_version_occurred_idx
  ON site_publication_events(version_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS site_publication_events_previous_version_idx
  ON site_publication_events(previous_version_id);
CREATE INDEX IF NOT EXISTS site_publication_events_requested_by_idx
  ON site_publication_events(requested_by_agency_user_id);

CREATE TABLE IF NOT EXISTS site_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  hostname varchar(255) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'NOT_CONNECTED'
    CHECK (status IN (
      'NOT_CONNECTED','ADDING','DNS_ACTION_REQUIRED','VERIFYING','SSL_PENDING',
      'ACTIVE','MISCONFIGURED','FAILED','REMOVED'
    )),
  is_primary boolean NOT NULL DEFAULT false,
  verification_token_hash varchar(64)
    CHECK (verification_token_hash IS NULL OR verification_token_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (hostname = lower(hostname)),
  CHECK (char_length(hostname) BETWEEN 3 AND 255),
  CHECK (hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$')
);
CREATE UNIQUE INDEX IF NOT EXISTS site_domains_hostname_unique
  ON site_domains(lower(hostname));
CREATE UNIQUE INDEX IF NOT EXISTS site_domains_primary_unique
  ON site_domains(site_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS site_domains_tenant_site_status_idx
  ON site_domains(tenant_id, site_id, status);

CREATE TABLE IF NOT EXISTS site_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  version_id uuid REFERENCES site_versions(id) ON DELETE RESTRICT,
  job_type varchar(80) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','DELAYED','COMPLETED','FAILED','CANCELLED')),
  idempotency_key varchar(160) NOT NULL UNIQUE,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  failure_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(payload_json) = 'object'),
  CHECK (jsonb_typeof(result_json) = 'object')
);
CREATE INDEX IF NOT EXISTS site_jobs_queue_idx
  ON site_jobs(status, available_at, created_at)
  WHERE status IN ('PENDING','DELAYED');
CREATE INDEX IF NOT EXISTS site_jobs_tenant_site_status_idx
  ON site_jobs(tenant_id, site_id, status);
CREATE INDEX IF NOT EXISTS site_jobs_version_idx ON site_jobs(version_id);

CREATE TABLE IF NOT EXISTS template_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  template_source_id uuid NOT NULL REFERENCES template_sources(id) ON DELETE RESTRICT,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid REFERENCES sites(id) ON DELETE RESTRICT,
  provider varchar(30) NOT NULL CHECK (provider IN ('ENVATO','INTERNAL')),
  license_reference varchar(255) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  evidence_storage_path varchar(1000),
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (tenant_id IS NULL AND site_id IS NULL) OR
    (tenant_id IS NOT NULL AND site_id IS NOT NULL)
  ),
  CHECK (expires_at IS NULL OR expires_at > acquired_at)
);
CREATE INDEX IF NOT EXISTS template_licenses_source_status_idx
  ON template_licenses(template_source_id, status);
CREATE INDEX IF NOT EXISTS template_licenses_tenant_site_idx
  ON template_licenses(tenant_id, site_id);
CREATE INDEX IF NOT EXISTS template_licenses_created_by_idx
  ON template_licenses(created_by_agency_user_id);

-- Published version content cannot be mutated or hard deleted. Superseding a
-- published version changes only its lifecycle marker and updated timestamp.
CREATE OR REPLACE FUNCTION ks_prevent_published_site_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('PUBLISHED','SUPERSEDED') OR OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Published site versions cannot be deleted'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('PUBLISHED','SUPERSEDED') OR OLD.published_at IS NOT NULL THEN
    IF OLD.status = 'PUBLISHED'
      AND NEW.status = 'SUPERSEDED'
      AND (to_jsonb(NEW) - ARRAY['status','updated_at'])
        = (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Published site versions are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_versions_prevent_published_mutation ON site_versions;
CREATE TRIGGER site_versions_prevent_published_mutation
  BEFORE UPDATE OR DELETE ON site_versions
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_published_site_version_mutation();

CREATE OR REPLACE FUNCTION ks_assert_site_version_mutable(target_version_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target_status varchar(30);
  target_published_at timestamptz;
BEGIN
  SELECT status, published_at
  INTO target_status, target_published_at
  FROM site_versions
  WHERE id = target_version_id;

  IF target_status IN ('PUBLISHED','SUPERSEDED') OR target_published_at IS NOT NULL THEN
    RAISE EXCEPTION 'Published site content is immutable'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ks_prevent_published_site_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_version_id uuid;
BEGIN
  target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  PERFORM ks_assert_site_version_mutable(target_version_id);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS site_pages_prevent_published_mutation ON site_pages;
CREATE TRIGGER site_pages_prevent_published_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON site_pages
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_published_site_child_mutation();

DROP TRIGGER IF EXISTS site_sections_prevent_published_mutation ON site_sections;
CREATE TRIGGER site_sections_prevent_published_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON site_sections
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_published_site_child_mutation();

DROP TRIGGER IF EXISTS site_assets_prevent_published_mutation ON site_assets;
CREATE TRIGGER site_assets_prevent_published_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON site_assets
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_published_site_child_mutation();

CREATE OR REPLACE FUNCTION ks_prevent_site_publication_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Site publication events are append-only'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS site_publication_events_append_only ON site_publication_events;
CREATE TRIGGER site_publication_events_append_only
  BEFORE UPDATE OR DELETE ON site_publication_events
  FOR EACH ROW EXECUTE FUNCTION ks_prevent_site_publication_event_mutation();

-- Reuse the immutable commercial plan model rather than duplicating plan data.
INSERT INTO platform_plan_entitlements(
  plan_version_id, entitlement_key, name, entitlement_type, availability, value_json
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    'sites.initial_marketing_pages',
    'Initial website marketing pages',
    'QUANTITY',
    'GENERALLY_AVAILABLE',
    '{"limit":10,"period":"LIFETIME"}'::jsonb
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    'sites.monthly_marketing_pages',
    'Monthly website page opportunities',
    'USAGE',
    'GENERALLY_AVAILABLE',
    '{"limit":1,"period":"MONTH"}'::jsonb
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'sites.initial_marketing_pages',
    'Initial website marketing pages',
    'QUANTITY',
    'GENERALLY_AVAILABLE',
    '{"limit":20,"period":"LIFETIME"}'::jsonb
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'sites.monthly_marketing_pages',
    'Monthly website page opportunities',
    'USAGE',
    'GENERALLY_AVAILABLE',
    '{"limit":2,"period":"MONTH"}'::jsonb
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'sites.initial_marketing_pages',
    'Initial website marketing pages',
    'QUANTITY',
    'GENERALLY_AVAILABLE',
    '{"limit":30,"period":"LIFETIME"}'::jsonb
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'sites.monthly_marketing_pages',
    'Monthly website page opportunities',
    'USAGE',
    'GENERALLY_AVAILABLE',
    '{"limit":3,"period":"MONTH"}'::jsonb
  )
ON CONFLICT (plan_version_id, entitlement_key) DO NOTHING;

-- Control-plane tables are reachable only through the authenticated API. RLS
-- remains enabled as defense in depth, while browser roles receive no grants.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sites','site_versions','site_pages','site_sections','site_assets',
    'site_approvals','site_change_requests','site_publication_events',
    'site_domains','site_jobs','site_blueprints','site_blueprint_pages',
    'template_sources','template_versions','template_layouts',
    'template_layout_page_types','template_licenses',
    'monthly_page_entitlements','monthly_page_opportunities'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated', table_name);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO service_role',
      table_name
    );
  END LOOP;
END $$;

REVOKE UPDATE, DELETE ON site_publication_events FROM service_role;
REVOKE EXECUTE ON FUNCTION ks_prevent_published_site_version_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_assert_site_version_mutable(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_prevent_published_site_child_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_prevent_site_publication_event_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ks_prevent_published_site_version_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION ks_assert_site_version_mutable(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION ks_prevent_published_site_child_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION ks_prevent_site_publication_event_mutation() TO service_role;
