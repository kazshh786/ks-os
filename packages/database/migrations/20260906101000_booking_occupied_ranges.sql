-- Separate customer duration from occupied inventory. Backfill uses available service definitions;
-- historical buffers were not snapshotted and must be reviewed before rollout.
ALTER TABLE appointments ADD COLUMN occupied_start timestamptz, ADD COLUMN occupied_end timestamptz;
ALTER TABLE booking_holds ADD COLUMN occupied_start timestamptz, ADD COLUMN occupied_end timestamptz;
UPDATE appointments a SET occupied_start = start_time, occupied_end = end_time + make_interval(mins => coalesce(
 (SELECT sum(s.buffer_time)::int FROM appointment_services x JOIN services s ON s.id=x.service_id AND s.tenant_id=x.tenant_id WHERE x.appointment_id=a.id AND x.tenant_id=a.tenant_id),
 (SELECT s.buffer_time FROM services s WHERE s.id=a.service_id AND s.tenant_id=a.tenant_id), 0));
UPDATE booking_holds h SET occupied_start=start_time, occupied_end=end_time + make_interval(mins => coalesce(
 (SELECT sum(s.buffer_time)::int FROM services s WHERE s.id=ANY(h.service_ids) AND s.tenant_id=h.tenant_id),0));
ALTER TABLE appointments ALTER COLUMN occupied_start SET NOT NULL, ALTER COLUMN occupied_end SET NOT NULL;
ALTER TABLE booking_holds ALTER COLUMN occupied_start SET NOT NULL, ALTER COLUMN occupied_end SET NOT NULL;
ALTER TABLE appointments ADD CHECK (occupied_start <= start_time AND occupied_end >= end_time);
ALTER TABLE booking_holds ADD CHECK (occupied_start <= start_time AND occupied_end >= end_time);

CREATE FUNCTION enforce_appointment_occupancy() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE buffer_minutes int;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.start_time,NEW.end_time,NEW.user_id,NEW.resource_id,NEW.status,NEW.occupied_start,NEW.occupied_end)
   IS NOT DISTINCT FROM (OLD.start_time,OLD.end_time,OLD.user_id,OLD.resource_id,OLD.status,OLD.occupied_start,OLD.occupied_end) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.user_id::text,0));
 IF NEW.resource_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':resource:' || NEW.resource_id::text,0)); END IF;
 IF TG_OP='UPDATE' AND NEW.occupied_end=OLD.occupied_end THEN
   NEW.occupied_start:=NEW.start_time + (OLD.occupied_start-OLD.start_time);
   NEW.occupied_end:=NEW.end_time + (OLD.occupied_end-OLD.end_time);
 END IF;
 IF NEW.occupied_end IS NULL THEN
   SELECT coalesce(buffer_time,0) INTO buffer_minutes FROM services WHERE id=NEW.service_id AND tenant_id=NEW.tenant_id;
   NEW.occupied_end:=NEW.end_time + make_interval(mins=>coalesce(buffer_minutes,0));
 END IF;
 NEW.occupied_start:=coalesce(NEW.occupied_start,NEW.start_time);
 IF NEW.status NOT IN ('CANCELLED','NO_SHOW') THEN
   IF EXISTS (SELECT 1 FROM appointments a WHERE a.tenant_id=NEW.tenant_id AND a.id<>NEW.id AND a.status NOT IN ('CANCELLED','NO_SHOW')
     AND (a.user_id=NEW.user_id OR (NEW.resource_id IS NOT NULL AND a.resource_id=NEW.resource_id))
     AND a.occupied_start<NEW.occupied_end AND a.occupied_end>NEW.occupied_start)
   OR EXISTS (SELECT 1 FROM booking_holds h WHERE h.tenant_id=NEW.tenant_id AND h.status='ACTIVE' AND h.expires_at>now()
     AND h.id::text IS DISTINCT FROM current_setting('ks.validated_hold_id',true)
     AND (h.staff_user_id=NEW.user_id OR (NEW.resource_id IS NOT NULL AND h.resource_id=NEW.resource_id))
     AND h.occupied_start<NEW.occupied_end AND h.occupied_end>NEW.occupied_start) THEN
     RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE='P0001';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appointments_occupancy BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION enforce_appointment_occupancy();

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
  p_service_ids uuid[],
  p_booking_channel text DEFAULT 'in_shop',
  p_mobile_address jsonb DEFAULT NULL
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

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':intent:' || p_idempotency_key::text,0));
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
    IF NOT EXISTS (SELECT 1 FROM appointments a WHERE a.id=v_existing_id
      AND a.user_id=p_staff_id AND a.start_time=p_start_time AND a.booking_channel=p_booking_channel
      AND a.mobile_address IS NOT DISTINCT FROM p_mobile_address
      AND a.payment_mode=CASE WHEN p_pay_now AND a.quoted_amount>0 THEN p_payment_mode ELSE 'not_required' END
      AND (SELECT array_agg(x.service_id ORDER BY x.position) FROM appointment_services x WHERE x.appointment_id=a.id AND x.tenant_id=a.tenant_id)=v_service_ids) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_INTENT_MISMATCH' USING ERRCODE='P0001';
    END IF;
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
    occupied_start,
    occupied_end,
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
    p_start_time,
    v_end_time + make_interval(mins => (SELECT coalesce(sum(buffer_time),0)::int FROM services WHERE tenant_id=p_tenant_id AND id=ANY(v_service_ids))),
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
  uuid, uuid, uuid, timestamptz, text, text, text, text, boolean, uuid, uuid[], text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_public_booking(
  uuid, uuid, uuid, timestamptz, text, text, text, text, boolean, uuid, uuid[], text, jsonb
) TO service_role;

COMMENT ON TABLE appointment_services IS
  'Ordered immutable service snapshots for an appointment; appointments.service_id remains the primary compatibility field.';

CREATE INDEX appointments_staff_occupied_idx ON appointments(tenant_id,user_id,occupied_start,occupied_end) WHERE status NOT IN ('CANCELLED','NO_SHOW');
CREATE INDEX appointments_resource_occupied_idx ON appointments(tenant_id,resource_id,occupied_start,occupied_end) WHERE resource_id IS NOT NULL AND status NOT IN ('CANCELLED','NO_SHOW');
CREATE INDEX booking_holds_staff_occupied_idx ON booking_holds(tenant_id,staff_user_id,occupied_start,occupied_end) WHERE status='ACTIVE';
CREATE INDEX booking_holds_resource_occupied_idx ON booking_holds(tenant_id,resource_id,occupied_start,occupied_end) WHERE status='ACTIVE' AND resource_id IS NOT NULL;
