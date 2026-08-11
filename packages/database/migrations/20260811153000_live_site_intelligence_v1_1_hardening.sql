-- Live Site Intelligence V1.1 hardening. Migration 71 is already applied in
-- production, so its invoker trigger function is hardened additively here.
ALTER FUNCTION public.ks_validate_live_site_scope()
  SET search_path = public, pg_temp;

-- The legacy `waitlist` table has diverged across early installations and has
-- no safe public-site idempotency or site/context boundary. Keep that internal
-- table untouched and add one canonical PERSONAL-data store for governed
-- website requests.
CREATE TABLE public.site_waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  staff_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  campaign_reference varchar(64),
  client_name varchar(120) NOT NULL,
  client_email varchar(255) NOT NULL,
  client_phone varchar(30),
  preferred_date date,
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','CONTACTED','INVITED','FULFILLED','CANCELLED','EXPIRED')),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_waitlist_entries_name_check CHECK (btrim(client_name) <> ''),
  CONSTRAINT site_waitlist_entries_email_check CHECK (
    client_email = lower(btrim(client_email))
    AND position('@' IN client_email) > 1
  ),
  CONSTRAINT site_waitlist_entries_phone_check CHECK (
    client_phone IS NULL OR btrim(client_phone) <> ''
  ),
  CONSTRAINT site_waitlist_entries_campaign_check CHECK (
    campaign_reference IS NULL
    OR campaign_reference ~ '^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$'
  ),
  CONSTRAINT site_waitlist_entries_tenant_idempotency_unique
    UNIQUE (tenant_id, idempotency_key)
);

CREATE UNIQUE INDEX site_waitlist_entries_active_request_unique
  ON public.site_waitlist_entries (
    tenant_id,
    site_id,
    service_id,
    client_email,
    location_id,
    staff_user_id,
    preferred_date
  ) NULLS NOT DISTINCT
  WHERE status = 'PENDING';
CREATE INDEX site_waitlist_entries_site_status_created_idx
  ON public.site_waitlist_entries (tenant_id, site_id, status, created_at DESC);
CREATE INDEX site_waitlist_entries_service_status_idx
  ON public.site_waitlist_entries (service_id, status, created_at DESC);
CREATE INDEX site_waitlist_entries_location_idx
  ON public.site_waitlist_entries (location_id) WHERE location_id IS NOT NULL;
CREATE INDEX site_waitlist_entries_staff_idx
  ON public.site_waitlist_entries (staff_user_id) WHERE staff_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ks_validate_site_waitlist_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sites
    WHERE id = NEW.site_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'SITE_WAITLIST_SITE_SCOPE_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.services
    WHERE id = NEW.service_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'SITE_WAITLIST_SERVICE_SCOPE_MISMATCH';
  END IF;
  IF NEW.location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations
    WHERE id = NEW.location_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'SITE_WAITLIST_LOCATION_SCOPE_MISMATCH';
  END IF;
  IF NEW.staff_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = NEW.staff_user_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'SITE_WAITLIST_STAFF_SCOPE_MISMATCH';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_waitlist_entries_scope
  BEFORE INSERT OR UPDATE ON public.site_waitlist_entries
  FOR EACH ROW EXECUTE FUNCTION public.ks_validate_site_waitlist_scope();

ALTER TABLE public.site_waitlist_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_waitlist_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_waitlist_entries TO service_role;
REVOKE EXECUTE ON FUNCTION public.ks_validate_site_waitlist_scope()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.site_waitlist_entries IS
  'PERSONAL operational waitlist requests. Never exposed through PublicLiveSiteData, snapshots, structured data, shared caches or Search Intelligence.';
