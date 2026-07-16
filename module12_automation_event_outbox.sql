-- Prompt 9: signed, transactional automation events for booking lifecycle changes.

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS agency_workspace_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_agency_workspace_uidx ON public.tenants(agency_workspace_id) WHERE agency_workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.automation_event_outbox(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK(event_type IN('booking.created','booking.cancelled','appointment.completed')),
  subject_id text NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 200),
  safe_payload jsonb NOT NULL CHECK(jsonb_typeof(safe_payload)='object' AND octet_length(safe_payload::text)<=8192),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','delivering','delivered','dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,lease_until timestamptz,delivered_at timestamptz,last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(appointment_id,event_type)
);
CREATE INDEX IF NOT EXISTS automation_event_outbox_claim_idx ON public.automation_event_outbox(status,next_attempt_at,lease_until);
ALTER TABLE public.automation_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_event_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.automation_event_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_booking_automation_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_type text;v_currency text;
BEGIN
  IF TG_OP='INSERT' THEN v_type:='booking.created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='CANCELLED' THEN v_type:='booking.cancelled';
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='COMPLETED' THEN v_type:='appointment.completed';
  ELSE RETURN NEW;END IF;
  SELECT currency::text INTO v_currency FROM public.tenants WHERE id=NEW.tenant_id;
  INSERT INTO public.automation_event_outbox(tenant_id,appointment_id,event_type,subject_id,safe_payload,occurred_at)
  VALUES(NEW.tenant_id,NEW.id,v_type,NEW.public_reference::text,jsonb_strip_nulls(jsonb_build_object(
    'bookingReference',NEW.public_reference::text,'status',NEW.status,'startTime',NEW.start_time,
    'endTime',NEW.end_time,'bookingChannel',NEW.booking_channel,'amountMinor',NEW.quoted_amount,
    'currency',v_currency,'contactId',NEW.client_id::text
  )),now()) ON CONFLICT(appointment_id,event_type)DO NOTHING;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS trg_enqueue_booking_automation_event ON public.appointments;
CREATE TRIGGER trg_enqueue_booking_automation_event AFTER INSERT OR UPDATE OF status ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.enqueue_booking_automation_event();

CREATE OR REPLACE FUNCTION public.claim_automation_outbox_events(p_limit integer DEFAULT 20,p_lease_seconds integer DEFAULT 60)
RETURNS TABLE(id uuid,tenant_id uuid,agency_workspace_id uuid,event_type text,subject_id text,safe_payload jsonb,occurred_at timestamptz,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 50 OR p_lease_seconds NOT BETWEEN 15 AND 300 THEN RAISE EXCEPTION 'Invalid claim parameters';END IF;
  RETURN QUERY WITH candidates AS(
    SELECT o.id FROM public.automation_event_outbox o JOIN public.tenants t ON t.id=o.tenant_id
    WHERE o.status IN('pending','delivering') AND o.next_attempt_at<=now() AND (o.lease_until IS NULL OR o.lease_until<now())
      AND t.agency_workspace_id IS NOT NULL ORDER BY o.next_attempt_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT p_limit
  ),claimed AS(
    UPDATE public.automation_event_outbox o SET status='delivering',attempt_count=attempt_count+1,
      lease_token=gen_random_uuid(),lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
    FROM candidates c WHERE o.id=c.id RETURNING o.*
  ) SELECT c.id,c.tenant_id,t.agency_workspace_id,c.event_type,c.subject_id,c.safe_payload,c.occurred_at,c.lease_token
    FROM claimed c JOIN public.tenants t ON t.id=c.tenant_id;
END;$$;

CREATE OR REPLACE FUNCTION public.complete_automation_outbox_event(p_id uuid,p_lease_token uuid,p_delivered boolean,p_error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_attempt integer;v_changed integer;
BEGIN
  SELECT attempt_count INTO v_attempt FROM public.automation_event_outbox WHERE id=p_id AND lease_token=p_lease_token AND status='delivering' FOR UPDATE;
  IF v_attempt IS NULL THEN RETURN false;END IF;
  UPDATE public.automation_event_outbox SET status=CASE WHEN p_delivered THEN 'delivered' WHEN v_attempt>=8 THEN 'dead' ELSE 'pending' END,
    delivered_at=CASE WHEN p_delivered THEN now() ELSE delivered_at END,
    next_attempt_at=CASE WHEN p_delivered OR v_attempt>=8 THEN next_attempt_at ELSE now()+make_interval(secs=>least(3600,60*power(2,v_attempt-1)::integer)) END,
    last_error_code=CASE WHEN p_delivered THEN NULL ELSE left(coalesce(p_error_code,'DELIVERY_FAILED'),80) END,
    lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=p_id AND lease_token=p_lease_token;GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN v_changed=1;
END;$$;

REVOKE ALL ON FUNCTION public.claim_automation_outbox_events(integer,integer),public.complete_automation_outbox_event(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_outbox_events(integer,integer),public.complete_automation_outbox_event(uuid,uuid,boolean,text) TO service_role;
