-- Add configurable multi-service public bookings while preserving the primary
-- appointments.service_id used by existing calendars, reports and automations.

ALTER TABLE booking_holds
  ADD COLUMN IF NOT EXISTS service_ids uuid[];

UPDATE booking_holds
SET service_ids = ARRAY[service_id]
WHERE service_ids IS NULL OR cardinality(service_ids) = 0;

ALTER TABLE booking_holds
  ALTER COLUMN service_ids SET DEFAULT ARRAY[]::uuid[],
  ALTER COLUMN service_ids SET NOT NULL;

CREATE TABLE IF NOT EXISTS appointment_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  service_name varchar(255) NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  price_amount integer NOT NULL CHECK (price_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_services_appointment_service_unique UNIQUE (appointment_id, service_id)
);

CREATE INDEX IF NOT EXISTS appointment_services_tenant_appointment_idx
  ON appointment_services (tenant_id, appointment_id);

INSERT INTO appointment_services (
  tenant_id,
  appointment_id,
  service_id,
  position,
  service_name,
  duration_minutes,
  price_amount
)
SELECT
  appointment.tenant_id,
  appointment.id,
  service.id,
  0,
  service.name,
  service.duration,
  greatest(0, service.price - coalesce(service.discount, 0))
FROM appointments AS appointment
JOIN services AS service
  ON service.id = appointment.service_id
 AND service.tenant_id = appointment.tenant_id
WHERE appointment.service_id IS NOT NULL
ON CONFLICT (appointment_id, service_id) DO NOTHING;

ALTER TABLE appointment_services ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE appointment_services FROM anon, authenticated;
GRANT ALL ON TABLE appointment_services TO service_role;

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
  p_booking_channel text DEFAULT 'in_shop',
  p_mobile_address jsonb DEFAULT NULL,
  p_service_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
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
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lock_key bigint;
  v_service_ids uuid[];
  v_service_duration integer;
  v_service_price integer;
  v_service_count integer;
  v_end_time timestamptz;
  v_client_id uuid;
  v_appointment_id uuid;
  v_public_ref uuid;
  v_status text;
  v_payment_status text;
  v_requires_payment boolean;
  v_existing_id uuid;
  v_existing_ref uuid;
  v_existing_status text;
  v_existing_pay_status text;
  v_existing_quoted_amount integer;
  v_existing_start timestamptz;
  v_existing_end timestamptz;
  v_existing_channel text;
BEGIN
  IF nullif(p_client_email, '') IS NULL AND nullif(p_client_phone, '') IS NULL THEN
    RAISE EXCEPTION 'Invalid customer details'
      USING ERRCODE = 'P0001', DETAIL = 'Either email or phone is required.';
  END IF;

  v_service_ids := CASE
    WHEN p_service_ids IS NULL OR cardinality(p_service_ids) = 0 THEN ARRAY[p_service_id]
    ELSE p_service_ids
  END;

  IF cardinality(v_service_ids) NOT BETWEEN 1 AND 10
     OR v_service_ids[1] IS DISTINCT FROM p_service_id
     OR cardinality(v_service_ids) <> (SELECT count(DISTINCT selected_id) FROM unnest(v_service_ids) AS selected(selected_id)) THEN
    RAISE EXCEPTION 'INVALID_SERVICE_SELECTION'
      USING ERRCODE = 'P0001', DETAIL = 'Services must be unique and the primary service must be first.';
  END IF;

  v_lock_key := hashtextextended(p_tenant_id::text || ':' || p_staff_id::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT
    a.id,
    a.public_reference,
    a.status,
    a.payment_status,
    a.quoted_amount,
    a.start_time,
    a.end_time,
    a.booking_channel
  INTO
    v_existing_id,
    v_existing_ref,
    v_existing_status,
    v_existing_pay_status,
    v_existing_quoted_amount,
    v_existing_start,
    v_existing_end,
    v_existing_channel
  FROM appointments a
  WHERE a.tenant_id = p_tenant_id
    AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing_id,
      v_existing_ref,
      v_existing_status,
      v_existing_pay_status,
      v_existing_quoted_amount,
      v_existing_start,
      v_existing_end,
      v_existing_channel;
    RETURN;
  END IF;

  SELECT
    coalesce(sum(s.duration), 0)::integer,
    coalesce(sum(greatest(0, s.price - coalesce(s.discount, 0))), 0)::integer,
    count(*)::integer
  INTO v_service_duration, v_service_price, v_service_count
  FROM unnest(v_service_ids) AS selected(service_id)
  JOIN services s
    ON s.id = selected.service_id
   AND s.tenant_id = p_tenant_id
   AND s.is_active = true;

  IF v_service_count <> cardinality(v_service_ids) THEN
    RAISE EXCEPTION 'SERVICE_NOT_AVAILABLE'
      USING ERRCODE = 'P0001', DETAIL = 'One or more services are not active or available.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_service_ids) AS selected(service_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM staff_service_assignments assignment
      WHERE assignment.tenant_id = p_tenant_id
        AND assignment.staff_user_id = p_staff_id
        AND assignment.service_id = selected.service_id
        AND assignment.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'STAFF_NOT_AVAILABLE'
      USING ERRCODE = 'P0001', DETAIL = 'The team member cannot provide every selected service.';
  END IF;

  v_end_time := p_start_time + (v_service_duration || ' minutes')::interval;

  IF NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = p_staff_id
      AND u.tenant_id = p_tenant_id
      AND u.account_status = 'ACTIVE'
      AND (u.role = 'owner' OR u.booking_enabled = true)
  ) THEN
    RAISE EXCEPTION 'STAFF_NOT_AVAILABLE'
      USING ERRCODE = 'P0001', DETAIL = 'Staff member is not available.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM staff_time_off sto
    WHERE sto.tenant_id = p_tenant_id
      AND sto.staff_user_id = p_staff_id
      AND sto.status = 'APPROVED'
      AND sto.starts_at < v_end_time
      AND sto.ends_at > p_start_time
  ) THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE'
      USING ERRCODE = 'P0001', DETAIL = 'Staff member has approved time off during this slot.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM appointments a
    WHERE a.tenant_id = p_tenant_id
      AND a.user_id = p_staff_id
      AND a.status NOT IN ('CANCELLED', 'NO_SHOW')
      AND a.start_time < v_end_time
      AND a.end_time > p_start_time
  ) THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE'
      USING ERRCODE = 'P0001', DETAIL = 'The selected time slot is no longer available.';
  END IF;

  SELECT c.id
  INTO v_client_id
  FROM clients c
  WHERE c.tenant_id = p_tenant_id
    AND (
      (nullif(p_client_email, '') IS NOT NULL AND c.email = p_client_email)
      OR (nullif(p_client_phone, '') IS NOT NULL AND c.phone = p_client_phone)
    )
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO clients (tenant_id, name, email, phone)
    VALUES (
      p_tenant_id,
      p_client_name,
      nullif(p_client_email, ''),
      nullif(p_client_phone, '')
    )
    RETURNING id INTO v_client_id;
  END IF;

  v_requires_payment := p_pay_now AND v_service_price > 0;
  v_status := CASE WHEN v_requires_payment THEN 'PENDING' ELSE 'CONFIRMED' END;
  v_payment_status := CASE WHEN v_requires_payment THEN 'PENDING' ELSE 'NOT_REQUIRED' END;

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
    CASE WHEN v_requires_payment THEN p_payment_mode ELSE 'not_required' END,
    v_payment_status,
    v_service_price,
    p_idempotency_key,
    p_booking_channel,
    p_mobile_address,
    'PUBLIC_BOOKING_PAGE',
    now(),
    now()
  )
  RETURNING appointments.id, appointments.public_reference
  INTO v_appointment_id, v_public_ref;

  INSERT INTO appointment_services (
    tenant_id,
    appointment_id,
    service_id,
    position,
    service_name,
    duration_minutes,
    price_amount
  )
  SELECT
    p_tenant_id,
    v_appointment_id,
    service.id,
    selected.ordinality::integer - 1,
    service.name,
    service.duration,
    greatest(0, service.price - coalesce(service.discount, 0))
  FROM unnest(v_service_ids) WITH ORDINALITY AS selected(service_id, ordinality)
  JOIN services service
    ON service.id = selected.service_id
   AND service.tenant_id = p_tenant_id
  ORDER BY selected.ordinality;

  RETURN QUERY SELECT
    v_appointment_id,
    v_public_ref,
    v_status,
    v_payment_status,
    v_service_price,
    p_start_time,
    v_end_time,
    p_booking_channel;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_public_booking(
  uuid, uuid, uuid, timestamptz, text, text, text, text, boolean, uuid, text, jsonb, uuid[]
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_public_booking(
  uuid, uuid, uuid, timestamptz, text, text, text, text, boolean, uuid, text, jsonb, uuid[]
) TO service_role;

COMMENT ON TABLE appointment_services IS
  'Ordered immutable service snapshots for an appointment; appointments.service_id remains the primary compatibility field.';
