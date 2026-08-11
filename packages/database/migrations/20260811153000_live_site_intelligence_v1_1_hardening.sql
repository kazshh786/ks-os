-- Live Site Intelligence V1.1 hardening. Migration 71 is already applied in
-- production, so its invoker trigger function is hardened additively here.
ALTER FUNCTION public.ks_validate_live_site_scope()
  SET search_path = public, pg_temp;
