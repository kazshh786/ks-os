-- Phase 8: provider-backed mobile sessions. No refresh token is stored by KSOS.
ALTER TABLE application_sessions ADD COLUMN hard_expires_at timestamptz;
-- Old sessions are initialized by the auth guard using their original creation
-- time and configured context limit. Background jobs fail closed until then.
CREATE FUNCTION preserve_application_session_hard_expiry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.hard_expires_at IS NOT NULL AND NEW.hard_expires_at IS DISTINCT FROM OLD.hard_expires_at THEN
    RAISE EXCEPTION 'application session hard expiry is immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION preserve_application_session_hard_expiry() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER application_session_hard_expiry BEFORE UPDATE ON application_sessions
FOR EACH ROW EXECUTE FUNCTION preserve_application_session_hard_expiry();

CREATE TABLE mobile_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL,
  auth_session_id uuid NOT NULL UNIQUE,
  platform varchar(10) NOT NULL CHECK(platform IN ('IOS','ANDROID')),
  application_id varchar(255) NOT NULL,
  environment varchar(20) NOT NULL CHECK(environment IN ('SANDBOX','PRODUCTION')),
  installation_hash varchar(64) NOT NULL CHECK(installation_hash ~ '^[a-f0-9]{64}$'),
  device_name varchar(80),
  auth_issued_at timestamptz NOT NULL,
  last_authenticated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason varchar(120),
  UNIQUE(id,auth_user_id)
);
CREATE INDEX mobile_devices_owner_active ON mobile_devices(auth_user_id,created_at DESC,id DESC) WHERE revoked_at IS NULL;
CREATE INDEX mobile_devices_installation ON mobile_devices(auth_user_id,application_id,environment,installation_hash);
CREATE FUNCTION preserve_mobile_device_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.auth_user_id,NEW.auth_session_id,NEW.platform,NEW.application_id,NEW.environment,NEW.installation_hash,NEW.auth_issued_at,NEW.created_at)
     IS DISTINCT FROM (OLD.id,OLD.auth_user_id,OLD.auth_session_id,OLD.platform,OLD.application_id,OLD.environment,OLD.installation_hash,OLD.auth_issued_at,OLD.created_at)
     OR OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'mobile device identity and revocation are immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION preserve_mobile_device_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER mobile_device_identity BEFORE UPDATE ON mobile_devices FOR EACH ROW EXECUTE FUNCTION preserve_mobile_device_identity();
ALTER TABLE mobile_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mobile_devices FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON mobile_devices TO service_role;

-- A narrow API-only provider adapter, with no provider records exposed to clients.
CREATE FUNCTION mobile_provider_session(p_session_id uuid,p_auth_user_id uuid)
RETURNS TABLE(started_at timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT s.created_at::timestamptz FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
  WHERE s.id=p_session_id AND s.user_id=p_auth_user_id
    AND (s.not_after IS NULL OR s.not_after>now()) AND u.email_confirmed_at IS NOT NULL
    AND coalesce(u.is_anonymous,false)=false AND (u.banned_until IS NULL OR u.banned_until<now())
$$;
REVOKE ALL ON FUNCTION mobile_provider_session(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mobile_provider_session(uuid,uuid) TO service_role;

-- Supabase's LogoutSession removes auth.sessions; provider refresh credentials
-- cannot renew a removed session. Retain our revoked history for replay denial.
-- Resolve the exact owned mobile binding before touching provider state.
CREATE FUNCTION revoke_mobile_device(p_device_id uuid,p_auth_user_id uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.mobile_devices%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.mobile_devices WHERE id=p_device_id AND auth_user_id=p_auth_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM auth.sessions WHERE id=d.auth_session_id AND user_id=d.auth_user_id;
  UPDATE public.application_sessions SET revoked_at=coalesce(revoked_at,now()),revoke_reason=coalesce(revoke_reason,left(p_reason,120))
    WHERE auth_session_id=d.auth_session_id AND auth_user_id=d.auth_user_id;
  UPDATE public.mobile_devices SET revoked_at=coalesce(revoked_at,now()),revoke_reason=coalesce(revoke_reason,left(p_reason,120)),updated_at=now() WHERE id=d.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION revoke_mobile_device(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION revoke_mobile_device(uuid,uuid,text) TO service_role;
