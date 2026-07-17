-- Phase 6: private KS OS service API and atomic public booking contract.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS buffer_time integer NOT NULL DEFAULT 0;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/London',
  ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS default_payment_mode text NOT NULL DEFAULT 'customer_choice';
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_default_payment_mode_values;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_default_payment_mode_values CHECK (
  default_payment_mode IN ('no_payment','pay_later','deposit','full_payment','customer_choice')
);

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS public_reference uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'pay_later',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS quoted_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;
ALTER TABLE public.checkout_transactions
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'point_of_sale';
ALTER TABLE public.checkout_transactions DROP CONSTRAINT IF EXISTS checkout_transactions_purpose_values;
ALTER TABLE public.checkout_transactions ADD CONSTRAINT checkout_transactions_purpose_values
  CHECK (purpose IN ('point_of_sale','booking_payment'));

CREATE UNIQUE INDEX IF NOT EXISTS appointments_public_reference_uidx
  ON public.appointments(public_reference);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_tenant_idempotency_uidx
  ON public.appointments(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointments_public_availability_idx
  ON public.appointments(tenant_id, user_id, start_time, end_time);
CREATE UNIQUE INDEX IF NOT EXISTS checkout_transactions_stripe_intent_uidx
  ON public.checkout_transactions(stripe_payment_intent_id);

CREATE TABLE IF NOT EXISTS public.public_booking_rate_limits(
  key_hash text NOT NULL,bucket_start timestamptz NOT NULL,request_count integer NOT NULL DEFAULT 0 CHECK(request_count>=0),
  PRIMARY KEY(key_hash,bucket_start)
);
ALTER TABLE public.public_booking_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_booking_rate_limits FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.consume_public_booking_rate_limit(p_key_hash text,p_limit integer,p_window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_bucket timestamptz;v_count integer;
BEGIN
  IF p_key_hash !~ '^[0-9a-f]{64}$' OR p_limit NOT BETWEEN 1 AND 1000 OR p_window_seconds NOT BETWEEN 10 AND 3600 THEN RAISE EXCEPTION 'Invalid rate limit input'; END IF;
  v_bucket:=to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key_hash||v_bucket::text,0));
  INSERT INTO public.public_booking_rate_limits(key_hash,bucket_start,request_count)VALUES(p_key_hash,v_bucket,1)
  ON CONFLICT(key_hash,bucket_start)DO UPDATE SET request_count=public_booking_rate_limits.request_count+1 RETURNING request_count INTO v_count;
  DELETE FROM public.public_booking_rate_limits WHERE bucket_start<now()-interval '1 day';
  RETURN v_count<=p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_public_booking_rate_limit(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_public_booking_rate_limit(text,integer,integer) TO service_role;

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_payment_mode_values;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_payment_mode_values
  CHECK (payment_mode IN ('no_payment','pay_later','deposit','full_payment','customer_choice'));
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_payment_status_values;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_payment_status_values
  CHECK (payment_status IN ('NOT_REQUIRED','PENDING','SUCCEEDED','FAILED','REFUNDED'));
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_quoted_amount_nonnegative;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_quoted_amount_nonnegative CHECK (quoted_amount >= 0);

-- Public browsers no longer access booking tables directly. All booking writes
-- go through the service-role API and this locked transaction.
DROP POLICY IF EXISTS insert_appointments_policy ON public.appointments;
DROP POLICY IF EXISTS insert_clients_policy ON public.clients;
DROP POLICY IF EXISTS insert_submissions_policy ON public.client_form_submissions;
DROP POLICY IF EXISTS select_services_policy ON public.services;
DROP POLICY IF EXISTS select_schedules_policy ON public.staff_schedules;
DROP POLICY IF EXISTS select_forms_policy ON public.forms;
DROP POLICY IF EXISTS select_users_policy ON public.users;

CREATE POLICY select_services_policy ON public.services FOR SELECT USING (
  tenant_id = public.get_auth_tenant_id()
  OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
);
CREATE POLICY select_schedules_policy ON public.staff_schedules FOR SELECT USING (
  tenant_id = public.get_auth_tenant_id()
  OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
);
CREATE POLICY select_forms_policy ON public.forms FOR SELECT USING (
  tenant_id = public.get_auth_tenant_id()
  OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
);
CREATE POLICY select_users_policy ON public.users FOR SELECT USING (
  tenant_id = public.get_auth_tenant_id()
  OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
);

DROP FUNCTION IF EXISTS public.create_public_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,uuid);

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_tenant_id uuid,
  p_service_id uuid,
  p_staff_id uuid,
  p_start_time timestamptz,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_payment_mode text,
  p_pay_now boolean,
  p_idempotency_key uuid,
  p_resource_id uuid DEFAULT NULL
) RETURNS TABLE(
  appointment_id uuid, booking_reference uuid, appointment_status text,
  amount_due integer, currency text, start_time timestamptz, end_time timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_service public.services;
  v_tenant public.tenants;
  v_client_id uuid;
  v_appointment public.appointments;
  v_end_time timestamptz;
  v_amount integer;
  v_local_start timestamp;
  v_day integer;
BEGIN
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key required'; END IF;
  IF p_payment_mode NOT IN ('no_payment','pay_later','deposit','full_payment','customer_choice') THEN RAISE EXCEPTION 'Invalid payment mode'; END IF;
  IF length(trim(p_client_name)) NOT BETWEEN 2 AND 120
     OR lower(trim(p_client_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR length(trim(p_client_phone)) NOT BETWEEN 7 AND 30 THEN RAISE EXCEPTION 'Invalid customer details'; END IF;

  SELECT * INTO v_appointment FROM public.appointments
    WHERE tenant_id=p_tenant_id AND idempotency_key=p_idempotency_key;
  IF v_appointment.id IS NOT NULL THEN
    RETURN QUERY SELECT v_appointment.id,v_appointment.public_reference,v_appointment.status,
      v_appointment.quoted_amount,(SELECT t.currency::text FROM public.tenants t WHERE t.id=p_tenant_id),
      v_appointment.start_time,v_appointment.end_time;
    RETURN;
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id=p_tenant_id;
  SELECT * INTO v_service FROM public.services WHERE id=p_service_id AND tenant_id=p_tenant_id AND is_active=true;
  IF v_tenant.id IS NULL OR v_service.id IS NULL THEN RAISE EXCEPTION 'Tenant or service not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_staff_id AND tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  IF p_start_time < now() + interval '5 minutes' OR p_start_time > now() + interval '180 days' THEN RAISE EXCEPTION 'Invalid booking time'; END IF;

  v_end_time := p_start_time + make_interval(mins => v_service.duration + v_service.buffer_time);
  v_local_start := p_start_time AT TIME ZONE v_tenant.timezone;
  v_day := extract(dow from v_local_start)::integer;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_schedules s WHERE s.tenant_id=p_tenant_id AND s.user_id=p_staff_id
      AND s.day_of_week=v_day AND v_local_start::time >= s.start_time::time
      AND (v_end_time AT TIME ZONE v_tenant.timezone)::time <= s.end_time::time
  ) THEN RAISE EXCEPTION 'Slot outside staff schedule'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_staff_id::text || p_start_time::date::text, 0));
  IF p_resource_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_resource_id::text || p_start_time::date::text, 0));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.appointments a WHERE a.tenant_id=p_tenant_id AND a.user_id=p_staff_id
      AND a.status NOT IN ('CANCELLED','NO_SHOW')
      AND NOT (a.status='PENDING' AND a.payment_status='PENDING' AND a.hold_expires_at < now())
      AND p_start_time < a.end_time AND v_end_time > a.start_time
  ) THEN RAISE EXCEPTION 'Slot is no longer available'; END IF;

  IF p_resource_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.appointments a WHERE a.tenant_id=p_tenant_id AND a.resource_id=p_resource_id
      AND a.status NOT IN ('CANCELLED','NO_SHOW')
      AND NOT (a.status='PENDING' AND a.payment_status='PENDING' AND a.hold_expires_at < now())
      AND p_start_time < a.end_time AND v_end_time > a.start_time
  ) THEN RAISE EXCEPTION 'Booking resource not found'; END IF;

  SELECT id INTO v_client_id FROM public.clients
    WHERE tenant_id=p_tenant_id AND lower(email)=lower(trim(p_client_email)) ORDER BY created_at LIMIT 1;
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients(tenant_id,name,email,phone)
    VALUES(p_tenant_id,trim(p_client_name),lower(trim(p_client_email)),trim(p_client_phone)) RETURNING id INTO v_client_id;
  ELSE
    UPDATE public.clients SET name=trim(p_client_name),phone=trim(p_client_phone),updated_at=now() WHERE id=v_client_id;
  END IF;

  v_amount := CASE
    WHEN p_payment_mode='deposit' THEN greatest(1,round(greatest(0,v_service.price-v_service.discount)*0.30)::integer)
    WHEN p_payment_mode='full_payment' THEN greatest(0,v_service.price-v_service.discount)
    WHEN p_payment_mode='customer_choice' AND p_pay_now THEN greatest(0,v_service.price-v_service.discount)
    ELSE 0 END;

  INSERT INTO public.appointments(
    tenant_id,user_id,client_id,client_name,service_id,start_time,end_time,status,
    public_reference,idempotency_key,payment_mode,payment_status,quoted_amount,hold_expires_at,resource_id
  ) VALUES(
    p_tenant_id,p_staff_id,v_client_id,trim(p_client_name),p_service_id,p_start_time,v_end_time,
    CASE WHEN v_amount>0 THEN 'PENDING' ELSE 'CONFIRMED' END,
    gen_random_uuid(),p_idempotency_key,p_payment_mode,
    CASE WHEN v_amount>0 THEN 'PENDING' ELSE 'NOT_REQUIRED' END,v_amount,
    CASE WHEN v_amount>0 THEN now()+interval '15 minutes' ELSE NULL END,p_resource_id
  ) RETURNING * INTO v_appointment;

  RETURN QUERY SELECT v_appointment.id,v_appointment.public_reference,v_appointment.status,v_amount,
    v_tenant.currency::text,v_appointment.start_time,v_appointment.end_time;
END;
$$;
REVOKE ALL ON FUNCTION public.create_public_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_public_booking_payment(
  p_booking_reference uuid, p_payment_intent_id text, p_amount integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_appointment public.appointments;
BEGIN
  SELECT * INTO v_appointment FROM public.appointments WHERE public_reference=p_booking_reference FOR UPDATE;
  IF v_appointment.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_appointment.quoted_amount <> p_amount THEN RAISE EXCEPTION 'Payment amount mismatch'; END IF;
  IF v_appointment.payment_status='SUCCEEDED' THEN RETURN; END IF;
  UPDATE public.appointments SET payment_status='SUCCEEDED',status='CONFIRMED',hold_expires_at=NULL,updated_at=now()
    WHERE id=v_appointment.id;
  INSERT INTO public.checkout_transactions(tenant_id,appointment_id,total_amount,payment_status,payment_method,purchased_products,stripe_payment_intent_id,purpose)
    VALUES(v_appointment.tenant_id,v_appointment.id,p_amount,'SUCCEEDED','CARD','[]'::jsonb,p_payment_intent_id,'booking_payment')
    ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET payment_status='SUCCEEDED',total_amount=EXCLUDED.total_amount,purpose='booking_payment';
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_public_booking_payment(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_public_booking_payment(uuid,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_public_booking_hold(p_booking_reference uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.appointments SET status='CANCELLED',payment_status='FAILED',updated_at=now()
  WHERE public_reference=p_booking_reference AND status='PENDING' AND payment_status='PENDING';
$$;
REVOKE ALL ON FUNCTION public.cancel_public_booking_hold(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_public_booking_hold(uuid) TO service_role;

-- Booking deposits/full payments confirm the future appointment; they must not
-- run the POS completion/stock workflow used after a service has taken place.
CREATE OR REPLACE FUNCTION public.decrement_stock_on_transaction()
RETURNS TRIGGER AS $$
DECLARE v_item jsonb;
BEGIN
  IF NEW.purpose='booking_payment' THEN RETURN NEW; END IF;
  IF NEW.purchased_products IS NOT NULL AND jsonb_array_length(NEW.purchased_products)>0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.purchased_products) LOOP
      UPDATE public.products SET stock_quantity=stock_quantity-(v_item->>'quantity')::integer,updated_at=now()
      WHERE id=(v_item->>'productId')::uuid AND tenant_id=NEW.tenant_id;
    END LOOP;
  END IF;
  UPDATE public.appointments SET status='COMPLETED',updated_at=now() WHERE id=NEW.appointment_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
