-- Preserve both booking overloads and their locking/payment rules.
-- Existing appointments and customer contact details are deliberately untouched.
DO $migration$
DECLARE
  target record;
  definition text;
  patched integer := 0;
  old_lookup text := $old$  SELECT c.id
  INTO v_client_id
  FROM clients c
  WHERE c.tenant_id = p_tenant_id
    AND (
      (nullif(p_client_email, '') IS NOT NULL AND c.email = p_client_email)
      OR (nullif(p_client_phone, '') IS NOT NULL AND c.phone = p_client_phone)
    )
  ORDER BY c.created_at ASC
  LIMIT 1;
$old$;
  new_lookup text := $new$  -- A shared phone must never route booking details to a different email owner.
  SELECT c.id
  INTO v_client_id
  FROM clients c
  WHERE c.tenant_id = p_tenant_id
    AND (
      (nullif(btrim(p_client_email), '') IS NOT NULL
        AND lower(btrim(c.email)) = lower(btrim(p_client_email)))
      OR (nullif(btrim(p_client_email), '') IS NULL
        AND nullif(btrim(c.email), '') IS NULL
        AND nullif(btrim(p_client_phone), '') IS NOT NULL
        AND c.phone = btrim(p_client_phone))
    )
  ORDER BY c.created_at ASC, c.id ASC
  LIMIT 1;
$new$;
BEGIN
  FOR target IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_public_booking'
  LOOP
    definition := pg_get_functiondef(target.oid);
    IF position(old_lookup IN definition) = 0 THEN
      RAISE EXCEPTION 'Unexpected create_public_booking definition: %', target.oid::regprocedure;
    END IF;
    definition := replace(definition, old_lookup, new_lookup);
    definition := replace(definition, 'nullif(p_client_email, '''')', 'nullif(lower(btrim(p_client_email)), '''')');
    EXECUTE definition;
    patched := patched + 1;
  END LOOP;
  IF patched <> 2 THEN
    RAISE EXCEPTION 'Expected two create_public_booking overloads, found %', patched;
  END IF;
END;
$migration$;
