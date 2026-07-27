-- Race-safe authoritative public booking creation database function
-- Serializes slot allocation per (tenant_id, staff_id) via pg_advisory_xact_lock
-- Enforces active hold validation, idempotency, schedule boundaries and overlap protection

DROP FUNCTION IF EXISTS create_public_booking(
  uuid, uuid, uuid, timestamptz, text, text, text, text, boolean, uuid, text, jsonb
) CASCADE;

CREATE OR REPLACE FUNCTION create_public_booking(
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
  p_booking_channel text DEFAULT 'in_shop',
  p_mobile_address jsonb DEFAULT NULL
)
RETURNS TABLE (
  appointment_id uuid,
  public_reference uuid,
  status text,
  payment_status text,
  quoted_amount integer,
  start_time timestamptz,
  end_time timestamptz,
  booking_channel text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lock_key bigint;
  v_service_duration integer;
  v_service_price integer;
  v_end_time timestamptz;
  v_client_id uuid;
  v_appointment_id uuid;
  v_public_ref uuid;
  v_status text;
  v_payment_status text;
  v_existing_id uuid;
  v_existing_ref uuid;
  v_existing_status text;
  v_existing_pay_status text;
  v_existing_quoted_amount integer;
  v_existing_start timestamptz;
  v_existing_end timestamptz;
  v_existing_channel text;
BEGIN
  -- 1. Input Validation
  IF (nullif(p_client_email, '') IS NULL AND nullif(p_client_phone, '') IS NULL) THEN
    RAISE EXCEPTION 'Invalid customer details' USING ERRCODE = 'P0001', DETAIL = 'Either email or phone is required.';
  END IF;

  -- 2. Transaction-Scoped Advisory Lock
  -- Serializes concurrent booking attempts for the same staff member in the same business tenant
  v_lock_key := hashtextextended(p_tenant_id::text || ':' || p_staff_id::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 3. Idempotency Check
  SELECT a.id, a.public_reference, a.status, a.payment_status, a.quoted_amount, a.start_time, a.end_time, a.booking_channel
  INTO v_existing_id, v_existing_ref, v_existing_status, v_existing_pay_status, v_existing_quoted_amount, v_existing_start, v_existing_end, v_existing_channel
  FROM appointments a
  WHERE a.tenant_id = p_tenant_id AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing_id, v_existing_ref, v_existing_status, v_existing_pay_status, v_existing_quoted_amount, v_existing_start, v_existing_end, v_existing_channel;
    RETURN;
  END IF;

  -- 4. Re-validate Active Service
  SELECT s.duration, s.price INTO v_service_duration, v_service_price
  FROM services s
  WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id AND s.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_NOT_AVAILABLE' USING ERRCODE = 'P0001', DETAIL = 'Service is not active or available.';
  END IF;

  v_end_time := p_start_time + (v_service_duration || ' minutes')::interval;

  -- 5. Re-validate Staff Availability
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = p_staff_id AND u.tenant_id = p_tenant_id AND u.account_status = 'ACTIVE' AND (u.role = 'owner' OR u.booking_enabled = true)
  ) THEN
    RAISE EXCEPTION 'STAFF_NOT_AVAILABLE' USING ERRCODE = 'P0001', DETAIL = 'Staff member is not available.';
  END IF;

  -- 6. Recheck Approved Time-Off Overlaps
  IF EXISTS (
    SELECT 1 FROM staff_time_off sto
    WHERE sto.tenant_id = p_tenant_id
      AND sto.staff_user_id = p_staff_id
      AND sto.status = 'APPROVED'
      AND sto.starts_at < v_end_time
      AND sto.ends_at > p_start_time
  ) THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001', DETAIL = 'Staff member has approved time off during this slot.';
  END IF;

  -- 7. Recheck Overlapping Active Appointments
  -- Canonical blocking statuses: anything EXCEPT 'CANCELLED' and 'NO_SHOW'
  IF EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.tenant_id = p_tenant_id
      AND a.user_id = p_staff_id
      AND a.status NOT IN ('CANCELLED', 'NO_SHOW')
      AND a.start_time < v_end_time
      AND a.end_time > p_start_time
  ) THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001', DETAIL = 'The selected time slot is no longer available.';
  END IF;

  -- 8. Client Lookup / Insert
  SELECT c.id INTO v_client_id
  FROM clients c
  WHERE c.tenant_id = p_tenant_id AND (
    (nullif(p_client_email, '') IS NOT NULL AND c.email = p_client_email) OR
    (nullif(p_client_phone, '') IS NOT NULL AND c.phone = p_client_phone)
  )
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO clients (tenant_id, name, email, phone)
    VALUES (p_tenant_id, p_client_name, nullif(p_client_email, ''), nullif(p_client_phone, ''))
    RETURNING id INTO v_client_id;
  END IF;

  -- 9. Determine Status
  v_status := CASE WHEN p_pay_now THEN 'PENDING' ELSE 'CONFIRMED' END;
  v_payment_status := CASE WHEN p_pay_now THEN 'PENDING' ELSE 'NOT_REQUIRED' END;

  -- 10. Insert Appointment
  INSERT INTO appointments (
    tenant_id,
    user_id,
    client_id,
    client_name,
    service_id,
    start_time,
    end_time,
    status,
    payment_mode,
    payment_status,
    quoted_amount,
    idempotency_key,
    booking_channel,
    mobile_address,
    booking_source,
    created_at,
    updated_at
  )
  VALUES (
    p_tenant_id,
    p_staff_id,
    v_client_id,
    p_client_name,
    p_service_id,
    p_start_time,
    v_end_time,
    v_status,
    p_payment_mode,
    v_payment_status,
    v_service_price,
    p_idempotency_key,
    p_booking_channel,
    p_mobile_address,
    'PUBLIC_BOOKING_PAGE',
    now(),
    now()
  )
  RETURNING appointments.id, appointments.public_reference INTO v_appointment_id, v_public_ref;

  RETURN QUERY SELECT v_appointment_id, v_public_ref, v_status, v_payment_status, v_service_price, p_start_time, v_end_time, p_booking_channel;
END;
$$;

GRANT EXECUTE ON FUNCTION create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, boolean, uuid, text, jsonb) TO service_role, authenticated, anon;
