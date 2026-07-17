-- Migration: appointments status lifecycle expansion and internal booking RPC APIs.

DO $$
BEGIN
  -- Recreate appointments status check constraint to include all standard statuses
  ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
  
  ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check CHECK (
    status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'BLOCKED')
  );
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not recreate appointments_status_check: %', SQLERRM;
END $$;

-- RPC Function for Atomic Internal Booking Creation
CREATE OR REPLACE FUNCTION public.create_internal_booking(
  p_tenant_id uuid,
  p_service_id uuid,
  p_staff_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_status text,
  p_notes text,
  p_resource_id uuid,
  p_client_id uuid DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS TABLE(
  appointment_id uuid, status text, start_time timestamptz, end_time timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_client_id uuid; v_appointment public.appointments; v_duration integer;
  v_end_time timestamptz;
BEGIN
  -- 1. Idempotency Check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_appointment FROM public.appointments WHERE tenant_id=p_tenant_id AND idempotency_key=p_idempotency_key;
    IF v_appointment.id IS NOT NULL THEN
      RETURN QUERY SELECT v_appointment.id, v_appointment.status, v_appointment.start_time, v_appointment.end_time;
      RETURN;
    END IF;
  END IF;

  -- 2. Concurrency locking (stylist + resource)
  PERFORM pg_advisory_xact_lock(hashtextextended(p_staff_id::text||p_start_time::date::text,0));
  IF p_resource_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_resource_id::text||p_start_time::date::text,0));
  END IF;

  -- 3. Calculate End Time
  IF p_end_time IS NULL AND p_service_id IS NOT NULL THEN
    SELECT COALESCE(sp.custom_duration_minutes, s.duration) INTO v_duration
    FROM public.services s
    LEFT JOIN public.staff_pricing sp ON sp.service_id = s.id AND sp.user_id = p_staff_id
    WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id;
    
    v_end_time := p_start_time + make_interval(mins=>v_duration + COALESCE((SELECT buffer_time FROM public.services WHERE id=p_service_id), 0));
  ELSE
    v_end_time := p_end_time;
  END IF;

  IF v_end_time IS NULL THEN
    RAISE EXCEPTION 'End time or service duration is required';
  END IF;

  -- 4. Check staff conflict (excluding cancelled/no-shows)
  IF EXISTS(
    SELECT 1 FROM public.appointments a WHERE a.tenant_id=p_tenant_id AND a.user_id=p_staff_id
      AND a.status NOT IN ('CANCELLED','NO_SHOW')
      AND NOT(a.status='PENDING' AND a.payment_status='PENDING' AND a.hold_expires_at<now())
      AND p_start_time<a.end_time AND v_end_time>a.start_time
  ) THEN RAISE EXCEPTION 'Slot is no longer available'; END IF;
  
  -- 5. Check resource conflict
  IF p_resource_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.appointments a WHERE a.tenant_id=p_tenant_id AND a.resource_id=p_resource_id
      AND a.status NOT IN ('CANCELLED','NO_SHOW')
      AND NOT(a.status='PENDING' AND a.payment_status='PENDING' AND a.hold_expires_at<now())
      AND p_start_time<a.end_time AND v_end_time>a.start_time
  ) THEN RAISE EXCEPTION 'Booking resource conflict'; END IF;

  -- 6. Create client if CLIENT booking
  IF p_status <> 'BLOCKED' THEN
    IF p_client_id IS NOT NULL THEN
      v_client_id := p_client_id;
    ELSIF p_client_name IS NOT NULL THEN
      SELECT id INTO v_client_id FROM public.clients WHERE tenant_id=p_tenant_id AND lower(email)=lower(trim(p_client_email)) ORDER BY created_at LIMIT 1;
      IF v_client_id IS NULL THEN
        INSERT INTO public.clients(tenant_id,name,email,phone) VALUES(p_tenant_id,trim(p_client_name),lower(trim(p_client_email)),trim(p_client_phone)) RETURNING id INTO v_client_id;
      END IF;
    END IF;
  ELSE
    v_client_id := NULL;
  END IF;

  -- 7. Insert Appointment
  INSERT INTO public.appointments(
    tenant_id, user_id, client_id, client_name, service_id, start_time, end_time, status, notes, idempotency_key, resource_id
  ) VALUES(
    p_tenant_id, p_staff_id, v_client_id, COALESCE(p_client_name, 'Blocked Time'), p_service_id, p_start_time, v_end_time, p_status, p_notes, p_idempotency_key, p_resource_id
  ) RETURNING * INTO v_appointment;

  RETURN QUERY SELECT v_appointment.id, v_appointment.status, v_appointment.start_time, v_appointment.end_time;
END;
$$;

-- RPC Function for Atomic Internal Booking Update (Rescheduling / Drag-and-drop / Resizing / Address Change)
CREATE OR REPLACE FUNCTION public.update_internal_booking(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_staff_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_status text,
  p_notes text,
  p_resource_id uuid,
  p_mobile_address jsonb DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  -- 1. Concurrency locking (stylist + resource)
  PERFORM pg_advisory_xact_lock(hashtextextended(p_staff_id::text||p_start_time::date::text,0));
  IF p_resource_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_resource_id::text||p_start_time::date::text,0));
  END IF;

  -- 2. Check staff availability conflict (excluding ourselves)
  IF EXISTS(
    SELECT 1 FROM public.appointments a WHERE a.tenant_id=p_tenant_id AND a.user_id=p_staff_id
      AND a.id <> p_appointment_id
      AND a.status NOT IN ('CANCELLED','NO_SHOW')
      AND NOT(a.status='PENDING' AND a.payment_status='PENDING' AND a.hold_expires_at<now())
      AND p_start_time<a.end_time AND p_end_time>a.start_time
  ) THEN RAISE EXCEPTION 'Slot is no longer available'; END IF;
  
  -- 3. Check resource conflict
  IF p_resource_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.appointments a WHERE a.tenant_id=p_tenant_id AND a.resource_id=p_resource_id
      AND a.id <> p_appointment_id
      AND a.status NOT IN ('CANCELLED','NO_SHOW')
      AND NOT(a.status='PENDING' AND a.payment_status='PENDING' AND a.hold_expires_at<now())
      AND p_start_time<a.end_time AND p_end_time>a.start_time
  ) THEN RAISE EXCEPTION 'Booking resource conflict'; END IF;

  -- 4. Update
  UPDATE public.appointments SET
    user_id=p_staff_id,
    start_time=p_start_time,
    end_time=p_end_time,
    status=p_status,
    notes=p_notes,
    resource_id=p_resource_id,
    mobile_address=COALESCE(p_mobile_address, mobile_address),
    updated_at=now()
  WHERE id=p_appointment_id AND tenant_id=p_tenant_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.create_internal_booking(uuid,uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_internal_booking(uuid,uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,uuid,uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.update_internal_booking(uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_internal_booking(uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,jsonb) TO service_role;
