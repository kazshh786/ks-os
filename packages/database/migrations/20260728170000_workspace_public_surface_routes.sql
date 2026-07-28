-- Stable workspace-hosted public booking and form surfaces.
-- Booking pages resolve from tenants.subdomain. Published forms receive a
-- deterministic, tenant-scoped public slug used at /form/:formSlug.

CREATE OR REPLACE FUNCTION public.ks_normalise_public_form_slug(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT left(
    trim(both '-' from regexp_replace(lower(trim(value)), '[^a-z0-9]+', '-', 'g')),
    120
  );
$$;

CREATE OR REPLACE FUNCTION public.ks_assign_public_form_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  base_slug text;
  candidate text;
  suffix integer := 1;
BEGIN
  base_slug := public.ks_normalise_public_form_slug(
    COALESCE(NULLIF(NEW.public_slug, ''), NEW.title, 'form')
  );
  IF base_slug = '' THEN base_slug := 'form'; END IF;

  candidate := base_slug;
  WHILE EXISTS (
    SELECT 1
    FROM public.forms existing
    WHERE existing.tenant_id = NEW.tenant_id
      AND existing.public_slug = candidate
      AND existing.id <> NEW.id
  ) LOOP
    suffix := suffix + 1;
    candidate := left(base_slug, greatest(1, 120 - length(suffix::text) - 1)) || '-' || suffix::text;
  END LOOP;

  NEW.public_slug := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS forms_assign_public_slug ON public.forms;
CREATE TRIGGER forms_assign_public_slug
BEFORE INSERT OR UPDATE OF title, public_slug, tenant_id
ON public.forms
FOR EACH ROW
EXECUTE FUNCTION public.ks_assign_public_form_slug();

-- Backfill existing forms through the same trigger logic.
UPDATE public.forms
SET public_slug = COALESCE(public_slug, title)
WHERE public_slug IS NULL OR public_slug = '';

CREATE OR REPLACE FUNCTION public.ks_set_published_form_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.forms
  SET published_version_id = NEW.id,
      status = 'PUBLISHED',
      updated_at = now()
  WHERE id = NEW.form_id
    AND tenant_id = NEW.tenant_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS form_versions_set_published_pointer ON public.form_versions;
CREATE TRIGGER form_versions_set_published_pointer
AFTER INSERT ON public.form_versions
FOR EACH ROW
EXECUTE FUNCTION public.ks_set_published_form_version();

UPDATE public.forms form
SET published_version_id = (
  SELECT version.id
  FROM public.form_versions version
  WHERE version.form_id = form.id
    AND version.tenant_id = form.tenant_id
  ORDER BY version.version_number DESC
  LIMIT 1
)
WHERE form.status = 'PUBLISHED'
  AND form.published_version_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.form_versions version
    WHERE version.form_id = form.id
      AND version.tenant_id = form.tenant_id
  );

REVOKE ALL ON FUNCTION public.ks_normalise_public_form_slug(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ks_assign_public_form_slug() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ks_set_published_form_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ks_normalise_public_form_slug(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ks_assign_public_form_slug() TO service_role;
GRANT EXECUTE ON FUNCTION public.ks_set_published_form_version() TO service_role;
