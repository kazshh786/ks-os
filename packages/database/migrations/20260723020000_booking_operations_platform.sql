-- Booking operations platform: public pages, temporary slot holds, source
-- attribution, operational audit and privacy-safe conversion analytics.

CREATE TABLE IF NOT EXISTS booking_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  public_slug varchar(63) NOT NULL UNIQUE,
  title varchar(160) NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  published boolean NOT NULL DEFAULT true,
  logo_url varchar(1000),
  cover_image_url varchar(1000),
  layout varchar(20) NOT NULL DEFAULT 'STANDARD',
  theme_json jsonb NOT NULL DEFAULT '{"primaryColor":"#0f172a","secondaryColor":"#475569","accentColor":"#4f46e5","surfaceColor":"#ffffff","textColor":"#0f172a","fontFamily":"system","borderRadius":"rounded","mode":"light"}'::jsonb,
  default_language varchar(12) NOT NULL DEFAULT 'en-GB',
  supported_languages text[] NOT NULL DEFAULT ARRAY['en-GB']::text[],
  default_location_id uuid,
  allowed_location_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  allowed_service_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  allowed_staff_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  booking_rules jsonb NOT NULL DEFAULT '{"minimumNoticeMinutes":60,"maximumFutureDays":90,"slotIntervalMinutes":30,"allowAnyStaff":true,"allowGuestBooking":true,"customerNotesEnabled":true}'::jsonb,
  payment_settings jsonb NOT NULL DEFAULT '{"mode":"PAY_LATER","depositPercentage":0,"promotionCodesEnabled":false,"giftCardsEnabled":false}'::jsonb,
  intake_form_settings jsonb NOT NULL DEFAULT '{"requiredBeforeConfirmation":false,"allowCompleteAfterBooking":true,"showEstimatedTime":true}'::jsonb,
  confirmation_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancellation_settings jsonb NOT NULL DEFAULT '{"customerCancellationEnabled":true,"customerReschedulingEnabled":true,"minimumNoticeMinutes":1440,"policyText":""}'::jsonb,
  seo_settings jsonb NOT NULL DEFAULT '{"title":"","description":"","socialTitle":"","socialDescription":"","socialImageUrl":null,"allowIndexing":true,"canonicalUrl":null}'::jsonb,
  social_sharing_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  analytics_settings jsonb NOT NULL DEFAULT '{"enabled":true}'::jsonb,
  custom_domain varchar(255),
  custom_domain_status varchar(20) NOT NULL DEFAULT 'NOT_CONFIGURED',
  custom_domain_verification_token_hash varchar(64),
  canonical_domain varchar(255),
  published_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_pages_slug_format_check CHECK (public_slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  CONSTRAINT booking_pages_layout_check CHECK (layout IN ('STANDARD','COMPACT','EDITORIAL')),
  CONSTRAINT booking_pages_domain_status_check CHECK (custom_domain_status IN ('NOT_CONFIGURED','PENDING','VERIFIED','FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_pages_custom_domain_unique
  ON booking_pages(lower(custom_domain)) WHERE custom_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS booking_pages_public_resolution_idx
  ON booking_pages(public_slug, enabled, published);

CREATE TABLE IF NOT EXISTS booking_page_slug_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_page_id uuid NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  previous_slug varchar(63) NOT NULL UNIQUE,
  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  redirect_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_page_slug_history_lookup_idx
  ON booking_page_slug_history(previous_slug, redirect_until);

CREATE TABLE IF NOT EXISTS booking_page_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_page_id uuid NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES services(id) ON DELETE CASCADE,
  staff_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE CASCADE,
  completion_stage varchar(30) NOT NULL DEFAULT 'AFTER_BOOKING',
  required boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_page_forms_stage_check CHECK (completion_stage IN ('BEFORE_CONFIRMATION','AFTER_BOOKING','BEFORE_APPOINTMENT'))
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_page_forms_scope_unique
  ON booking_page_forms(
    booking_page_id,
    form_id,
    COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(staff_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE TABLE IF NOT EXISTS booking_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_page_id uuid NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE CASCADE,
  resource_id uuid REFERENCES resources(id) ON DELETE CASCADE,
  customer_session_hash varchar(64) NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  idempotency_key uuid NOT NULL,
  consumed_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  released_at timestamptz,
  CONSTRAINT booking_holds_time_check CHECK (end_time > start_time),
  CONSTRAINT booking_holds_status_check CHECK (status IN ('ACTIVE','CONSUMED','RELEASED','EXPIRED')),
  UNIQUE (booking_page_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS booking_holds_availability_idx
  ON booking_holds(tenant_id, staff_user_id, start_time, end_time, expires_at)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS booking_holds_expiry_idx
  ON booking_holds(status, expires_at) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS booking_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_page_id uuid NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  session_hash varchar(64) NOT NULL,
  event_type varchar(40) NOT NULL,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  staff_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  booking_source varchar(40),
  source_medium varchar(80),
  source_campaign varchar(120),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_analytics_event_check CHECK (event_type IN ('PAGE_VIEW','BOOKING_STARTED','SERVICE_SELECTED','STAFF_SELECTED','DATE_SELECTED','TIME_SELECTED','CHECKOUT_STARTED','BOOKING_COMPLETED','BOOKING_ABANDONED'))
);

CREATE INDEX IF NOT EXISTS booking_analytics_page_event_time_idx
  ON booking_analytics_events(booking_page_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS booking_analytics_tenant_time_idx
  ON booking_analytics_events(tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS booking_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  acting_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(50) NOT NULL,
  previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  request_id varchar(120),
  booking_source varchar(40),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_audit_events_appointment_time_idx
  ON booking_audit_events(tenant_id, appointment_id, created_at DESC);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_source varchar(40) NOT NULL DEFAULT 'STAFF_CREATED';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source_medium varchar(80);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source_campaign varchar(120);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source_referrer_host varchar(255);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_page_id uuid;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_hold_id uuid;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS intake_status varchar(20) NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS attention_reason varchar(120);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS customer_notes text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_booking_page_fk') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_booking_page_fk FOREIGN KEY (booking_page_id) REFERENCES booking_pages(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_booking_hold_fk') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_booking_hold_fk FOREIGN KEY (booking_hold_id) REFERENCES booking_holds(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_location_fk') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_location_fk FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS appointments_tenant_start_idx ON appointments(tenant_id, start_time);
CREATE INDEX IF NOT EXISTS appointments_tenant_end_idx ON appointments(tenant_id, end_time);
CREATE INDEX IF NOT EXISTS appointments_staff_start_idx ON appointments(tenant_id, user_id, start_time);
CREATE INDEX IF NOT EXISTS appointments_location_start_idx ON appointments(tenant_id, location_id, start_time);
CREATE INDEX IF NOT EXISTS appointments_client_start_idx ON appointments(tenant_id, client_id, start_time);
CREATE INDEX IF NOT EXISTS appointments_status_start_idx ON appointments(tenant_id, status, start_time);
CREATE INDEX IF NOT EXISTS appointments_payment_start_idx ON appointments(tenant_id, payment_status, start_time);
CREATE INDEX IF NOT EXISTS appointments_source_created_idx ON appointments(tenant_id, booking_source, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_tenant_idempotency_unique
  ON appointments(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION ks_normalise_booking_slug(raw_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT trim(both '-' FROM regexp_replace(lower(coalesce(raw_value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

CREATE OR REPLACE FUNCTION ks_ensure_default_booking_page(
  input_tenant_id uuid,
  input_name text,
  input_subdomain text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  candidate text;
  base_candidate text;
  suffix integer := 1;
  page_id uuid;
  reserved text[] := ARRAY['admin','api','app','assets','auth','book','booking','calendar','customer','help','login','manage','settings','staff','status','support','www'];
BEGIN
  SELECT id INTO page_id FROM booking_pages WHERE tenant_id = input_tenant_id;
  IF page_id IS NOT NULL THEN RETURN page_id; END IF;

  candidate := left(ks_normalise_booking_slug(coalesce(nullif(input_subdomain, ''), input_name)), 63);
  IF length(candidate) < 2 THEN candidate := 'business'; END IF;
  IF candidate = ANY(reserved) THEN candidate := left('book-' || candidate, 63); END IF;
  base_candidate := candidate;

  WHILE EXISTS (SELECT 1 FROM booking_pages WHERE public_slug = candidate) LOOP
    suffix := suffix + 1;
    candidate := left(base_candidate, 63 - length(suffix::text) - 1) || '-' || suffix::text;
  END LOOP;

  INSERT INTO booking_pages (tenant_id, public_slug, title, description)
  VALUES (input_tenant_id, candidate, coalesce(nullif(input_name, ''), 'Book an appointment'), '')
  RETURNING id INTO page_id;
  RETURN page_id;
END;
$$;

CREATE OR REPLACE FUNCTION ks_create_booking_page_after_tenant_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM ks_ensure_default_booking_page(NEW.id, NEW.name, NEW.subdomain);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_create_booking_page ON tenants;
CREATE TRIGGER tenants_create_booking_page
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION ks_create_booking_page_after_tenant_insert();

DO $$
DECLARE tenant_record record;
BEGIN
  FOR tenant_record IN SELECT id, name, subdomain FROM tenants LOOP
    PERFORM ks_ensure_default_booking_page(tenant_record.id, tenant_record.name, tenant_record.subdomain);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION ks_normalise_booking_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ks_ensure_default_booking_page(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ks_create_booking_page_after_tenant_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ks_normalise_booking_slug(text) TO service_role;
GRANT EXECUTE ON FUNCTION ks_ensure_default_booking_page(uuid,text,text) TO service_role;

ALTER TABLE booking_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_page_slug_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_page_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON booking_pages, booking_page_slug_history, booking_page_forms, booking_holds, booking_analytics_events, booking_audit_events FROM anon, authenticated;
GRANT ALL ON booking_pages, booking_page_slug_history, booking_page_forms, booking_holds, booking_analytics_events, booking_audit_events TO service_role;

COMMENT ON INDEX appointments_tenant_start_idx IS 'Calendar range queries are tenant scoped and ordered by appointment start.';
COMMENT ON INDEX appointments_staff_start_idx IS 'Staff schedule and overlap checks filter by tenant, staff and start time.';
COMMENT ON INDEX booking_holds_availability_idx IS 'Availability revalidation checks only active, unexpired holds for the selected staff and interval.';
COMMENT ON TABLE booking_analytics_events IS 'Conversion analytics intentionally excludes customer names, email addresses, phone numbers, notes and arbitrary URL parameters.';
