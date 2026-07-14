-- Phase 6 extension: separate in-shop and mobile booking schedules.

CREATE TABLE IF NOT EXISTS public.booking_channel_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  booking_channel text NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_schedules_channel_values CHECK (booking_channel IN ('in_shop','mobile')),
  CONSTRAINT booking_channel_schedules_valid_times CHECK (start_time < end_time),
  CONSTRAINT booking_channel_schedules_one_window UNIQUE (tenant_id,user_id,booking_channel,day_of_week)
);

-- Existing hours remain the in-shop schedule after this migration.
INSERT INTO public.booking_channel_schedules(tenant_id,user_id,booking_channel,day_of_week,start_time,end_time)
SELECT tenant_id,user_id,'in_shop',day_of_week,min(start_time::time),max(end_time::time)
FROM public.staff_schedules
GROUP BY tenant_id,user_id,day_of_week
ON CONFLICT (tenant_id,user_id,booking_channel,day_of_week) DO NOTHING;

ALTER TABLE public.booking_channel_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_channel_schedules FROM PUBLIC,anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.booking_channel_schedules FROM authenticated;
GRANT SELECT ON public.booking_channel_schedules TO authenticated,service_role;
DROP POLICY IF EXISTS booking_channel_schedules_select ON public.booking_channel_schedules;
DROP POLICY IF EXISTS booking_channel_schedules_manage ON public.booking_channel_schedules;
CREATE POLICY booking_channel_schedules_select ON public.booking_channel_schedules FOR SELECT USING (
  tenant_id=public.get_auth_tenant_id()
  OR public.get_auth_tenant_id()='00000000-0000-0000-0000-000000000000'
);
CREATE POLICY booking_channel_schedules_manage ON public.booking_channel_schedules FOR ALL USING (
  (tenant_id=public.get_auth_tenant_id() AND public.get_auth_user_role()='owner')
  OR public.get_auth_tenant_id()='00000000-0000-0000-0000-000000000000'
) WITH CHECK (
  (tenant_id=public.get_auth_tenant_id() AND public.get_auth_user_role()='owner')
  OR public.get_auth_tenant_id()='00000000-0000-0000-0000-000000000000'
);

CREATE OR REPLACE FUNCTION public.replace_staff_booking_channel_schedule(
  p_tenant_id uuid,p_staff_id uuid,p_booking_channel text,p_hours jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_day jsonb;v_day_number integer;v_start time;v_end time;
BEGIN
  IF p_booking_channel NOT IN ('in_shop','mobile') OR jsonb_typeof(p_hours)<>'array' THEN RAISE EXCEPTION 'Invalid schedule'; END IF;
  IF NOT (
    (p_tenant_id=public.get_auth_tenant_id() AND public.get_auth_user_role()='owner')
    OR public.get_auth_tenant_id()='00000000-0000-0000-0000-000000000000'
  ) THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_staff_id AND tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  DELETE FROM public.booking_channel_schedules WHERE tenant_id=p_tenant_id AND user_id=p_staff_id AND booking_channel=p_booking_channel;
  FOR v_day IN SELECT value FROM jsonb_array_elements(p_hours) LOOP
    IF coalesce((v_day->>'enabled')::boolean,false) THEN
      v_day_number:=(v_day->>'dayOfWeek')::integer;
      v_start:=(v_day->>'startTime')::time;
      v_end:=(v_day->>'endTime')::time;
      IF v_day_number NOT BETWEEN 0 AND 6 OR v_start>=v_end THEN RAISE EXCEPTION 'Invalid schedule window'; END IF;
      INSERT INTO public.booking_channel_schedules(tenant_id,user_id,booking_channel,day_of_week,start_time,end_time)
      VALUES(p_tenant_id,p_staff_id,p_booking_channel,v_day_number,v_start,v_end);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_staff_booking_channel_schedule(uuid,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_staff_booking_channel_schedule(uuid,uuid,text,jsonb) TO authenticated;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS booking_channel text NOT NULL DEFAULT 'in_shop',
  ADD COLUMN IF NOT EXISTS mobile_address jsonb;
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_booking_channel_values;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_booking_channel_values CHECK (booking_channel IN ('in_shop','mobile'));
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_mobile_address_required;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_mobile_address_required CHECK (
  booking_channel<>'mobile' OR (mobile_address IS NOT NULL AND jsonb_typeof(mobile_address)='object')
);

DROP FUNCTION IF EXISTS public.create_public_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,uuid);
CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_tenant_id uuid,p_service_id uuid,p_staff_id uuid,p_start_time timestamptz,
  p_client_name text,p_client_email text,p_client_phone text,p_payment_mode text,
  p_pay_now boolean,p_idempotency_key uuid,p_booking_channel text,p_mobile_address jsonb DEFAULT NULL
) RETURNS TABLE(
  appointment_id uuid,booking_reference uuid,appointment_status text,amount_due integer,
  currency text,start_time timestamptz,end_time timestamptz,booking_channel text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_service public.services;v_tenant public.tenants;v_client_id uuid;v_appointment public.appointments;
  v_end_time timestamptz;v_amount integer;v_local_start timestamp;v_day integer;v_address jsonb;
BEGIN
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key required'; END IF;
  IF p_booking_channel NOT IN ('in_shop','mobile') THEN RAISE EXCEPTION 'Invalid booking channel'; END IF;
  IF p_payment_mode NOT IN ('no_payment','pay_later','deposit','full_payment','customer_choice') THEN RAISE EXCEPTION 'Invalid payment mode'; END IF;
  IF length(trim(p_client_name)) NOT BETWEEN 2 AND 120
     OR lower(trim(p_client_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR length(trim(p_client_phone)) NOT BETWEEN 7 AND 30 THEN RAISE EXCEPTION 'Invalid customer details'; END IF;
  IF p_booking_channel='mobile' THEN
    IF jsonb_typeof(p_mobile_address)<>'object'
       OR length(trim(coalesce(p_mobile_address->>'line1',''))) NOT BETWEEN 3 AND 160
       OR length(trim(coalesce(p_mobile_address->>'city',''))) NOT BETWEEN 2 AND 100
       OR length(trim(coalesce(p_mobile_address->>'postcode',''))) NOT BETWEEN 2 AND 20 THEN RAISE EXCEPTION 'Invalid mobile address'; END IF;
    v_address:=jsonb_strip_nulls(jsonb_build_object(
      'line1',left(trim(p_mobile_address->>'line1'),160),'line2',nullif(left(trim(coalesce(p_mobile_address->>'line2','')),160),''),
      'city',left(trim(p_mobile_address->>'city'),100),'postcode',left(trim(p_mobile_address->>'postcode'),20),
      'accessNotes',nullif(left(trim(coalesce(p_mobile_address->>'accessNotes','')),300),'')
    ));
  ELSE v_address:=NULL; END IF;

  SELECT * INTO v_appointment FROM public.appointments WHERE tenant_id=p_tenant_id AND idempotency_key=p_idempotency_key;
  IF v_appointment.id IS NOT NULL THEN
    RETURN QUERY SELECT v_appointment.id,v_appointment.public_reference,v_appointment.status,v_appointment.quoted_amount,
      (SELECT t.currency::text FROM public.tenants t WHERE t.id=p_tenant_id),v_appointment.start_time,v_appointment.end_time,v_appointment.booking_channel;
    RETURN;
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id=p_tenant_id;
  SELECT * INTO v_service FROM public.services WHERE id=p_service_id AND tenant_id=p_tenant_id AND is_active=true;
  IF v_tenant.id IS NULL OR v_service.id IS NULL THEN RAISE EXCEPTION 'Tenant or service not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_staff_id AND tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  IF p_start_time<now()+interval '5 minutes' OR p_start_time>now()+interval '180 days' THEN RAISE EXCEPTION 'Invalid booking time'; END IF;
  v_end_time:=p_start_time+make_interval(mins=>v_service.duration);v_local_start:=p_start_time AT TIME ZONE v_tenant.timezone;v_day:=extract(dow from v_local_start)::integer;
  IF NOT EXISTS(
    SELECT 1 FROM public.booking_channel_schedules s WHERE s.tenant_id=p_tenant_id AND s.user_id=p_staff_id
      AND s.booking_channel=p_booking_channel AND s.day_of_week=v_day AND v_local_start::time>=s.start_time
      AND (v_end_time AT TIME ZONE v_tenant.timezone)::time<=s.end_time
  ) THEN RAISE EXCEPTION 'Slot outside booking channel schedule'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_staff_id::text||p_start_time::date::text,0));
  IF EXISTS(
    SELECT 1 FROM public.appointments a WHERE a.tenant_id=p_tenant_id AND a.user_id=p_staff_id
      AND a.status NOT IN ('CANCELLED','NO_SHOW')
      AND NOT(a.status='PENDING' AND a.payment_status='PENDING' AND a.hold_expires_at<now())
      AND p_start_time<a.end_time AND v_end_time>a.start_time
  ) THEN RAISE EXCEPTION 'Slot is no longer available'; END IF;

  SELECT id INTO v_client_id FROM public.clients WHERE tenant_id=p_tenant_id AND lower(email)=lower(trim(p_client_email)) ORDER BY created_at LIMIT 1;
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients(tenant_id,name,email,phone) VALUES(p_tenant_id,trim(p_client_name),lower(trim(p_client_email)),trim(p_client_phone)) RETURNING id INTO v_client_id;
  ELSE UPDATE public.clients SET name=trim(p_client_name),phone=trim(p_client_phone),updated_at=now() WHERE id=v_client_id; END IF;

  v_amount:=CASE WHEN p_payment_mode='deposit' THEN greatest(1,round(greatest(0,v_service.price-v_service.discount)*0.30)::integer)
    WHEN p_payment_mode='full_payment' THEN greatest(0,v_service.price-v_service.discount)
    WHEN p_payment_mode='customer_choice' AND p_pay_now THEN greatest(0,v_service.price-v_service.discount) ELSE 0 END;
  INSERT INTO public.appointments(
    tenant_id,user_id,client_id,client_name,service_id,start_time,end_time,status,public_reference,idempotency_key,
    payment_mode,payment_status,quoted_amount,hold_expires_at,booking_channel,mobile_address
  ) VALUES(
    p_tenant_id,p_staff_id,v_client_id,trim(p_client_name),p_service_id,p_start_time,v_end_time,
    CASE WHEN v_amount>0 THEN 'PENDING' ELSE 'CONFIRMED' END,gen_random_uuid(),p_idempotency_key,p_payment_mode,
    CASE WHEN v_amount>0 THEN 'PENDING' ELSE 'NOT_REQUIRED' END,v_amount,
    CASE WHEN v_amount>0 THEN now()+interval '15 minutes' ELSE NULL END,p_booking_channel,v_address
  ) RETURNING * INTO v_appointment;
  RETURN QUERY SELECT v_appointment.id,v_appointment.public_reference,v_appointment.status,v_amount,v_tenant.currency::text,
    v_appointment.start_time,v_appointment.end_time,v_appointment.booking_channel;
END;
$$;
REVOKE ALL ON FUNCTION public.create_public_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,uuid,text,jsonb) TO service_role;
