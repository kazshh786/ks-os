-- Append-only platform error evidence for authorised debugging.
-- Request bodies, credentials, raw headers, customer-form answers and payment data
-- are deliberately excluded from this ledger.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.platform_error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint varchar(64) NOT NULL,
  severity varchar(20) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  error_code varchar(120) NOT NULL,
  error_type varchar(160) NOT NULL,
  message text NOT NULL,
  stack text,
  origin_file varchar(500),
  origin_function varchar(255),
  origin_line integer CHECK (origin_line IS NULL OR origin_line > 0),
  origin_column integer CHECK (origin_column IS NULL OR origin_column > 0),
  request_id varchar(100) NOT NULL,
  correlation_id varchar(100),
  method varchar(12) NOT NULL,
  route varchar(500) NOT NULL,
  source_component varchar(120) NOT NULL DEFAULT 'ks-os-api',
  environment varchar(40) NOT NULL DEFAULT 'production',
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  tenant_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  agency_user_id uuid REFERENCES public.agency_users(id) ON DELETE RESTRICT,
  auth_user_id uuid,
  support_session_id uuid REFERENCES public.agency_support_sessions(id) ON DELETE RESTRICT,
  application_context varchar(20),
  session_id uuid,
  ip_hash varchar(64),
  user_agent varchar(500),
  retryable boolean NOT NULL DEFAULT false,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_error_events_occurred_idx
  ON public.platform_error_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_error_events_fingerprint_occurred_idx
  ON public.platform_error_events(fingerprint, occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_error_events_tenant_occurred_idx
  ON public.platform_error_events(tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_error_events_tenant_user_occurred_idx
  ON public.platform_error_events(tenant_user_id, occurred_at DESC)
  WHERE tenant_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_error_events_agency_user_occurred_idx
  ON public.platform_error_events(agency_user_id, occurred_at DESC)
  WHERE agency_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_error_events_request_idx
  ON public.platform_error_events(request_id);
CREATE INDEX IF NOT EXISTS platform_error_events_status_occurred_idx
  ON public.platform_error_events(status_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_error_events_route_occurred_idx
  ON public.platform_error_events(route, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_platform_error_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform_error_events is append-only';
END
$$;

DROP TRIGGER IF EXISTS platform_error_events_append_only ON public.platform_error_events;
CREATE TRIGGER platform_error_events_append_only
BEFORE UPDATE OR DELETE ON public.platform_error_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_error_mutation();

REVOKE EXECUTE ON FUNCTION public.prevent_platform_error_mutation() FROM PUBLIC;
ALTER TABLE public.platform_error_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_error_events FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.platform_error_events TO service_role;
REVOKE UPDATE, DELETE ON TABLE public.platform_error_events FROM service_role;

COMMENT ON TABLE public.platform_error_events IS
  'Append-only, privacy-minimised technical error evidence available only through authorised server APIs.';
COMMENT ON COLUMN public.platform_error_events.context IS
  'Safe structural context only: parameter names, query names, body field names and support-mode state. Never raw values.';
COMMENT ON COLUMN public.platform_error_events.stack IS
  'Sanitised and length-limited stack evidence. Credentials, contact details, payment strings and connection URLs are redacted before insert.';
