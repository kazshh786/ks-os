-- Allow product-only POS sales to be recorded without creating a booking.
-- The migration is intentionally idempotent for safe deployment retries.

ALTER TABLE checkout_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(255);

ALTER TABLE checkout_transactions
  ALTER COLUMN appointment_id DROP NOT NULL;

DO $$
DECLARE
  appointment_fk text;
BEGIN
  SELECT constraint_name
    INTO appointment_fk
  FROM information_schema.constraint_column_usage
  WHERE table_schema = current_schema()
    AND table_name = 'appointments'
    AND column_name = 'id'
    AND constraint_name IN (
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.constraint_schema = kcu.constraint_schema
      WHERE tc.table_schema = current_schema()
        AND tc.table_name = 'checkout_transactions'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'appointment_id'
    )
  LIMIT 1;

  IF appointment_fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE checkout_transactions DROP CONSTRAINT %I', appointment_fk);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkout_transactions_appointment_id_appointments_id_fk'
      AND conrelid = 'checkout_transactions'::regclass
  ) THEN
    ALTER TABLE checkout_transactions
      ADD CONSTRAINT checkout_transactions_appointment_id_appointments_id_fk
      FOREIGN KEY (appointment_id)
      REFERENCES appointments(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS checkout_transactions_tenant_idempotency_unique
  ON checkout_transactions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
