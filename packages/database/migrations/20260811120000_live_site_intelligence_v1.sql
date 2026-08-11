BEGIN;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS public_price_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waitlist_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS temporary_unavailable_until timestamptz;

CREATE TABLE site_location_operating_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  interval_number integer NOT NULL DEFAULT 1 CHECK (interval_number BETWEEN 1 AND 4),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_location_operating_hours_range_check CHECK (opens_at < closes_at),
  CONSTRAINT site_location_operating_hours_location_day_unique
    UNIQUE (location_id, day_of_week, interval_number)
);
CREATE INDEX site_location_operating_hours_tenant_location_idx
  ON site_location_operating_hours (tenant_id, location_id, day_of_week);

CREATE TABLE site_location_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  public_label varchar(120) NOT NULL DEFAULT 'Temporarily closed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_location_closures_range_check CHECK (starts_at < ends_at),
  CONSTRAINT site_location_closures_label_check CHECK (btrim(public_label) <> '')
);
CREATE INDEX site_location_closures_active_idx
  ON site_location_closures (tenant_id, location_id, starts_at, ends_at);

CREATE TABLE site_live_availability_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE CASCADE,
  state varchar(30) NOT NULL CHECK (state IN ('NEXT_AVAILABLE','AVAILABLE_THIS_WEEK','UNAVAILABLE','UNKNOWN')),
  public_message varchar(160) NOT NULL CHECK (btrim(public_message) <> ''),
  next_available_at timestamptz,
  computed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_live_availability_summaries_window_check CHECK (computed_at < expires_at),
  CONSTRAINT site_live_availability_summaries_next_check CHECK (
    state <> 'NEXT_AVAILABLE' OR next_available_at IS NOT NULL
  )
);
CREATE UNIQUE INDEX site_live_availability_summaries_scope_unique
  ON site_live_availability_summaries (site_id, service_id, staff_user_id, location_id) NULLS NOT DISTINCT;
CREATE INDEX site_live_availability_summaries_site_expiry_idx
  ON site_live_availability_summaries (tenant_id, site_id, expires_at);
CREATE INDEX site_live_availability_summaries_service_idx
  ON site_live_availability_summaries (service_id, expires_at);
CREATE INDEX site_live_availability_summaries_staff_idx
  ON site_live_availability_summaries (staff_user_id) WHERE staff_user_id IS NOT NULL;
CREATE INDEX site_live_availability_summaries_location_idx
  ON site_live_availability_summaries (location_id) WHERE location_id IS NOT NULL;

CREATE TABLE site_live_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED','ARCHIVED')),
  audience varchar(20) NOT NULL DEFAULT 'PUBLIC' CHECK (audience = 'PUBLIC'),
  message varchar(240) NOT NULL CHECK (
    btrim(message) <> ''
    AND lower(message) !~ '\m(only[[:space:]]+[0-9]+|slots?[[:space:]]+left|last[[:space:]]+chance|hurry)\M'
  ),
  placement varchar(30) NOT NULL CHECK (placement IN ('ANNOUNCEMENT','HERO','PAGE_BODY','PAGE_END')),
  action_label varchar(80) NOT NULL CHECK (btrim(action_label) <> ''),
  service_reference uuid,
  location_reference uuid,
  staff_reference uuid,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_live_campaigns_window_check CHECK (starts_at < ends_at),
  CONSTRAINT site_live_campaigns_approval_check CHECK (
    status <> 'APPROVED' OR (approved_by_agency_user_id IS NOT NULL AND approved_at IS NOT NULL)
  )
);
CREATE INDEX site_live_campaigns_active_idx
  ON site_live_campaigns (tenant_id, site_id, starts_at, ends_at)
  WHERE status = 'APPROVED';
CREATE INDEX site_live_campaigns_created_by_idx ON site_live_campaigns (created_by_agency_user_id);
CREATE INDEX site_live_campaigns_approved_by_idx
  ON site_live_campaigns (approved_by_agency_user_id) WHERE approved_by_agency_user_id IS NOT NULL;

CREATE TABLE site_operational_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  entity_type varchar(30) NOT NULL CHECK (entity_type IN ('SERVICE','STAFF','LOCATION','CAMPAIGN','AUTHORITY')),
  entity_reference uuid NOT NULL,
  change_kind varchar(50) NOT NULL CHECK (change_kind IN (
    'PRICE_CHANGED','BOOKABILITY_CHANGED','SERVICE_DISABLED','SERVICE_DESCRIPTION_CHANGED',
    'STAFF_BOOKABILITY_CHANGED','STAFF_DEACTIVATED','LOCATION_TEMPORARILY_CLOSED',
    'LOCATION_CLOSED','LOCATION_ADDRESS_CHANGED','LOCATION_PHONE_CHANGED',
    'OPENING_HOURS_CHANGED','LOCATION_ADDED','AUTHORITY_DATA_CHANGED','CAMPAIGN_SCHEDULE_CHANGED'
  )),
  changed_fields text[] NOT NULL CHECK (cardinality(changed_fields) BETWEEN 1 AND 50),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX site_operational_change_events_pending_idx
  ON site_operational_change_events (tenant_id, site_id, occurred_at)
  WHERE processed_at IS NULL;

CREATE TABLE site_impact_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  change_event_id uuid NOT NULL UNIQUE REFERENCES site_operational_change_events(id) ON DELETE RESTRICT,
  classification varchar(30) NOT NULL CHECK (classification IN ('AUTO_APPLY_LIVE','REQUIRE_SITE_REVIEW')),
  assessment_json jsonb NOT NULL CHECK (jsonb_typeof(assessment_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_impact_assessments_site_idx
  ON site_impact_assessments (tenant_id, site_id, created_at DESC);

CREATE TABLE site_change_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL UNIQUE REFERENCES site_impact_assessments(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED','APPLIED')),
  summary varchar(500) NOT NULL CHECK (btrim(summary) <> ''),
  affected_page_references_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(affected_page_references_json) = 'array'),
  recommendations_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(recommendations_json) = 'array'),
  requires_human_approval boolean NOT NULL DEFAULT true CHECK (requires_human_approval),
  reviewed_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_change_proposals_review_check CHECK (
    status NOT IN ('APPROVED','REJECTED','APPLIED')
    OR (reviewed_by_agency_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX site_change_proposals_review_queue_idx
  ON site_change_proposals (tenant_id, site_id, created_at DESC)
  WHERE status IN ('DRAFT','IN_REVIEW');
CREATE INDEX site_change_proposals_reviewer_idx
  ON site_change_proposals (reviewed_by_agency_user_id) WHERE reviewed_by_agency_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION ks_validate_live_site_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entity_tenant uuid;
  site_tenant uuid;
  parent_site uuid;
BEGIN
  IF TG_TABLE_NAME IN ('site_location_operating_hours','site_location_closures') THEN
    SELECT tenant_id INTO entity_tenant FROM locations WHERE id = NEW.location_id;
    IF entity_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'LIVE_SITE_LOCATION_SCOPE_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'site_live_availability_summaries' THEN
    SELECT tenant_id INTO site_tenant FROM sites WHERE id = NEW.site_id;
    SELECT tenant_id INTO entity_tenant FROM services WHERE id = NEW.service_id;
    IF site_tenant IS DISTINCT FROM NEW.tenant_id OR entity_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'LIVE_SITE_AVAILABILITY_SCOPE_MISMATCH';
    END IF;
    IF NEW.staff_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users WHERE id = NEW.staff_user_id AND tenant_id = NEW.tenant_id
    ) THEN RAISE EXCEPTION 'LIVE_SITE_AVAILABILITY_STAFF_SCOPE_MISMATCH'; END IF;
    IF NEW.location_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM locations WHERE id = NEW.location_id AND tenant_id = NEW.tenant_id
    ) THEN RAISE EXCEPTION 'LIVE_SITE_AVAILABILITY_LOCATION_SCOPE_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'site_live_campaigns' THEN
    SELECT tenant_id INTO site_tenant FROM sites WHERE id = NEW.site_id;
    IF site_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'LIVE_SITE_CAMPAIGN_SCOPE_MISMATCH'; END IF;
    IF NEW.service_reference IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM services WHERE public_reference = NEW.service_reference AND tenant_id = NEW.tenant_id
    ) THEN RAISE EXCEPTION 'LIVE_SITE_CAMPAIGN_SERVICE_SCOPE_MISMATCH'; END IF;
    IF NEW.location_reference IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM locations WHERE public_reference = NEW.location_reference AND tenant_id = NEW.tenant_id
    ) THEN RAISE EXCEPTION 'LIVE_SITE_CAMPAIGN_LOCATION_SCOPE_MISMATCH'; END IF;
    IF NEW.staff_reference IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users WHERE public_reference = NEW.staff_reference AND tenant_id = NEW.tenant_id
    ) THEN RAISE EXCEPTION 'LIVE_SITE_CAMPAIGN_STAFF_SCOPE_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'site_operational_change_events' THEN
    SELECT tenant_id INTO site_tenant FROM sites WHERE id = NEW.site_id;
    IF site_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'LIVE_SITE_EVENT_SCOPE_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'site_impact_assessments' THEN
    SELECT tenant_id INTO site_tenant FROM sites WHERE id = NEW.site_id;
    SELECT tenant_id, site_id INTO entity_tenant, parent_site
      FROM site_operational_change_events WHERE id = NEW.change_event_id;
    IF site_tenant IS DISTINCT FROM NEW.tenant_id
      OR entity_tenant IS DISTINCT FROM NEW.tenant_id
      OR parent_site IS DISTINCT FROM NEW.site_id THEN
      RAISE EXCEPTION 'LIVE_SITE_ASSESSMENT_SCOPE_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'site_change_proposals' THEN
    SELECT tenant_id INTO site_tenant FROM sites WHERE id = NEW.site_id;
    SELECT tenant_id, site_id INTO entity_tenant, parent_site
      FROM site_impact_assessments WHERE id = NEW.assessment_id;
    IF site_tenant IS DISTINCT FROM NEW.tenant_id
      OR entity_tenant IS DISTINCT FROM NEW.tenant_id
      OR parent_site IS DISTINCT FROM NEW.site_id THEN
      RAISE EXCEPTION 'LIVE_SITE_PROPOSAL_SCOPE_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ks_emit_site_operational_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_tenant uuid;
  target_site uuid;
  target_reference uuid;
  target_type varchar(30);
  target_kind varchar(50);
  fields text[] := ARRAY[]::text[];
BEGIN
  IF TG_TABLE_NAME = 'services' THEN
    target_tenant := NEW.tenant_id; target_reference := NEW.public_reference; target_type := 'SERVICE';
    IF OLD.price IS DISTINCT FROM NEW.price OR OLD.discount IS DISTINCT FROM NEW.discount
      OR OLD.public_price_enabled IS DISTINCT FROM NEW.public_price_enabled THEN
      fields := fields || ARRAY['price']; target_kind := 'PRICE_CHANGED';
    END IF;
    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      fields := fields || ARRAY['is_active']; target_kind := CASE WHEN NOT NEW.is_active THEN 'SERVICE_DISABLED' ELSE 'BOOKABILITY_CHANGED' END;
    END IF;
    IF OLD.temporary_unavailable_until IS DISTINCT FROM NEW.temporary_unavailable_until
      OR OLD.waitlist_enabled IS DISTINCT FROM NEW.waitlist_enabled THEN
      fields := fields || ARRAY['booking_state']; target_kind := COALESCE(target_kind, 'BOOKABILITY_CHANGED');
    END IF;
    IF OLD.description IS DISTINCT FROM NEW.description THEN
      fields := fields || ARRAY['description']; target_kind := 'SERVICE_DESCRIPTION_CHANGED';
    END IF;
  ELSIF TG_TABLE_NAME = 'users' THEN
    target_tenant := NEW.tenant_id; target_reference := NEW.public_reference; target_type := 'STAFF';
    IF OLD.account_status IS DISTINCT FROM NEW.account_status THEN
      fields := fields || ARRAY['account_status'];
      target_kind := CASE WHEN NEW.account_status <> 'ACTIVE' THEN 'STAFF_DEACTIVATED' ELSE 'STAFF_BOOKABILITY_CHANGED' END;
    END IF;
    IF OLD.booking_enabled IS DISTINCT FROM NEW.booking_enabled THEN
      fields := fields || ARRAY['booking_enabled']; target_kind := COALESCE(target_kind, 'STAFF_BOOKABILITY_CHANGED');
    END IF;
  ELSIF TG_TABLE_NAME = 'locations' THEN
    target_tenant := NEW.tenant_id; target_reference := NEW.public_reference; target_type := 'LOCATION';
    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      fields := fields || ARRAY['is_active']; target_kind := CASE WHEN NOT NEW.is_active THEN 'LOCATION_CLOSED' ELSE 'LOCATION_ADDED' END;
    END IF;
    IF OLD.address IS DISTINCT FROM NEW.address OR OLD.postcode IS DISTINCT FROM NEW.postcode THEN
      fields := fields || ARRAY['address']; target_kind := 'LOCATION_ADDRESS_CHANGED';
    END IF;
    IF OLD.phone IS DISTINCT FROM NEW.phone THEN fields := fields || ARRAY['phone']; target_kind := 'LOCATION_PHONE_CHANGED'; END IF;
  ELSIF TG_TABLE_NAME = 'site_location_operating_hours' THEN
    target_tenant := NEW.tenant_id; target_type := 'LOCATION'; target_kind := 'OPENING_HOURS_CHANGED';
    SELECT public_reference INTO target_reference FROM locations WHERE id = NEW.location_id;
    fields := ARRAY['opening_hours'];
  ELSIF TG_TABLE_NAME = 'site_location_closures' THEN
    target_tenant := NEW.tenant_id; target_type := 'LOCATION'; target_kind := 'LOCATION_TEMPORARILY_CLOSED';
    SELECT public_reference INTO target_reference FROM locations WHERE id = NEW.location_id;
    fields := ARRAY['temporary_closure'];
  ELSIF TG_TABLE_NAME = 'site_live_campaigns' THEN
    target_tenant := NEW.tenant_id; target_site := NEW.site_id; target_reference := NEW.public_reference;
    target_type := 'CAMPAIGN'; target_kind := 'CAMPAIGN_SCHEDULE_CHANGED'; fields := ARRAY['campaign_state'];
  END IF;
  IF target_kind IS NULL OR cardinality(fields) = 0 THEN RETURN NEW; END IF;
  IF target_site IS NULL THEN SELECT id INTO target_site FROM sites WHERE tenant_id = target_tenant; END IF;
  IF target_site IS NULL OR target_reference IS NULL THEN RETURN NEW; END IF;
  INSERT INTO site_operational_change_events
    (tenant_id, site_id, entity_type, entity_reference, change_kind, changed_fields)
  VALUES (target_tenant, target_site, target_type, target_reference, target_kind, ARRAY(SELECT DISTINCT unnest(fields)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_location_operating_hours_scope
  BEFORE INSERT OR UPDATE ON site_location_operating_hours FOR EACH ROW EXECUTE FUNCTION ks_validate_live_site_scope();
CREATE TRIGGER site_location_closures_scope
  BEFORE INSERT OR UPDATE ON site_location_closures FOR EACH ROW EXECUTE FUNCTION ks_validate_live_site_scope();
CREATE TRIGGER site_live_availability_summaries_scope
  BEFORE INSERT OR UPDATE ON site_live_availability_summaries FOR EACH ROW EXECUTE FUNCTION ks_validate_live_site_scope();
CREATE TRIGGER site_live_campaigns_scope
  BEFORE INSERT OR UPDATE ON site_live_campaigns FOR EACH ROW EXECUTE FUNCTION ks_validate_live_site_scope();
CREATE TRIGGER site_operational_change_events_scope
  BEFORE INSERT OR UPDATE ON site_operational_change_events FOR EACH ROW EXECUTE FUNCTION ks_validate_live_site_scope();
CREATE TRIGGER site_impact_assessments_scope
  BEFORE INSERT OR UPDATE ON site_impact_assessments FOR EACH ROW EXECUTE FUNCTION ks_validate_live_site_scope();
CREATE TRIGGER site_change_proposals_scope
  BEFORE INSERT OR UPDATE ON site_change_proposals FOR EACH ROW EXECUTE FUNCTION ks_validate_live_site_scope();

CREATE TRIGGER services_live_site_change AFTER UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION ks_emit_site_operational_change();
CREATE TRIGGER users_live_site_change AFTER UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION ks_emit_site_operational_change();
CREATE TRIGGER locations_live_site_change AFTER UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION ks_emit_site_operational_change();
CREATE TRIGGER site_location_operating_hours_change AFTER INSERT OR UPDATE ON site_location_operating_hours
  FOR EACH ROW EXECUTE FUNCTION ks_emit_site_operational_change();
CREATE TRIGGER site_location_closures_change AFTER INSERT OR UPDATE ON site_location_closures
  FOR EACH ROW EXECUTE FUNCTION ks_emit_site_operational_change();
CREATE TRIGGER site_live_campaigns_change AFTER INSERT OR UPDATE ON site_live_campaigns
  FOR EACH ROW EXECUTE FUNCTION ks_emit_site_operational_change();

ALTER TABLE site_location_operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_location_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_live_availability_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_live_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_operational_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_impact_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_change_proposals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  site_location_operating_hours, site_location_closures, site_live_availability_summaries,
  site_live_campaigns, site_operational_change_events, site_impact_assessments,
  site_change_proposals
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  site_location_operating_hours, site_location_closures, site_live_campaigns
TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE site_live_availability_summaries TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE
  site_operational_change_events, site_impact_assessments, site_change_proposals
TO service_role;

REVOKE EXECUTE ON FUNCTION ks_validate_live_site_scope() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_emit_site_operational_change() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE site_live_availability_summaries IS
  'Anonymous-safe precomputed availability summaries only; never stores occupancy, customer or private slot details.';
COMMENT ON TABLE site_live_campaigns IS
  'Human-approved public campaign copy and controlled KS OS booking context; cannot modify canonical SEO state.';
COMMENT ON TABLE site_operational_change_events IS
  'Privacy-minimised canonical change lineage containing field names and public entity references, never changed values.';
COMMENT ON TABLE site_change_proposals IS
  'Governed material site-change proposals that always require an explicit agency review before published-state mutation.';

COMMIT;
