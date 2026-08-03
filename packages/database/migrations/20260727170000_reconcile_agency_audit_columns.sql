-- Reconcile the agency audit table with the current application schema.
-- These columns are written by AgencyAuditService and are required for
-- launch checks, support sessions, tenant creation, and other audited actions.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.platform_audit_events
  ADD COLUMN IF NOT EXISTS event_category varchar(80) NOT NULL DEFAULT 'ADMINISTRATION',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS actor_role varchar(80),
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS user_agent varchar(500),
  ADD COLUMN IF NOT EXISTS previous_values jsonb,
  ADD COLUMN IF NOT EXISTS new_values jsonb,
  ADD COLUMN IF NOT EXISTS environment varchar(40) NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS source_component varchar(120) NOT NULL DEFAULT 'agency-api',
  ADD COLUMN IF NOT EXISTS contains_redactions boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS platform_audit_events_category_occurred_idx
  ON public.platform_audit_events(event_category, occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_events_session_idx
  ON public.platform_audit_events(session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.platform_audit_events.contains_redactions IS
  'True when protected values were removed before this append-only audit event was written.';
