-- Migration: 20260724180000_align_checkout_payment_components_schema.sql
-- Description: Align production checkout_payment_components schema with provider-neutral POS model
-- Safety: Fully transactional, additive/idempotent, zero table drops, zero data deletion.

-- 1. Handle amount / amount_in_cents columns idempotently
DO $$
DECLARE
  v_target_schema TEXT;
  v_has_amount BOOLEAN;
  v_has_amount_in_cents BOOLEAN;
  v_row_count INTEGER;
BEGIN
  SELECT nspname INTO v_target_schema
  FROM pg_namespace
  WHERE oid = (SELECT relnamespace FROM pg_class WHERE oid = '"checkout_payment_components"'::regclass);

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = v_target_schema
      AND table_name = 'checkout_payment_components'
      AND column_name = 'amount'
  ) INTO v_has_amount;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = v_target_schema
      AND table_name = 'checkout_payment_components'
      AND column_name = 'amount_in_cents'
  ) INTO v_has_amount_in_cents;

  IF NOT v_has_amount_in_cents AND v_has_amount THEN
    EXECUTE 'ALTER TABLE "checkout_payment_components" RENAME COLUMN "amount" TO "amount_in_cents"';
  ELSIF v_has_amount_in_cents AND v_has_amount THEN
    EXECUTE 'UPDATE "checkout_payment_components" SET "amount_in_cents" = "amount" WHERE "amount_in_cents" IS NULL AND "amount" IS NOT NULL';
  ELSIF NOT v_has_amount_in_cents AND NOT v_has_amount THEN
    SELECT count(*) INTO v_row_count FROM "checkout_payment_components";
    IF v_row_count > 0 THEN
      RAISE EXCEPTION 'Cannot infer amount_in_cents safely: checkout_payment_components table contains rows but neither amount nor amount_in_cents column exists';
    ELSE
      EXECUTE 'ALTER TABLE "checkout_payment_components" ADD COLUMN "amount_in_cents" integer';
    END IF;
  END IF;
END $$;

-- 2. Add provider-neutral POS metadata columns if missing
ALTER TABLE "checkout_payment_components" ADD COLUMN IF NOT EXISTS "external_provider" varchar(50);
ALTER TABLE "checkout_payment_components" ADD COLUMN IF NOT EXISTS "external_provider_name" varchar(100);
ALTER TABLE "checkout_payment_components" ADD COLUMN IF NOT EXISTS "external_reference" varchar(255);
ALTER TABLE "checkout_payment_components" ADD COLUMN IF NOT EXISTS "method_description" varchar(255);
ALTER TABLE "checkout_payment_components" ADD COLUMN IF NOT EXISTS "provider_payment_id" varchar(255);

-- 3. Handle verification_source column safely
ALTER TABLE "checkout_payment_components" ADD COLUMN IF NOT EXISTS "verification_source" text;

UPDATE "checkout_payment_components"
SET "verification_source" = 'STAFF_CONFIRMED'
WHERE "verification_source" IS NULL;

-- 4. Post-migration data integrity assertions (before SET NOT NULL)
DO $$
DECLARE
  v_null_count INTEGER;
BEGIN
  SELECT count(*) INTO v_null_count
  FROM "checkout_payment_components"
  WHERE "amount_in_cents" IS NULL OR "verification_source" IS NULL;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'Schema alignment validation failed: % rows have NULL amount_in_cents or verification_source', v_null_count;
  END IF;
END $$;

-- 5. Set NOT NULL constraints after assertions pass
ALTER TABLE "checkout_payment_components" ALTER COLUMN "amount_in_cents" SET NOT NULL;
ALTER TABLE "checkout_payment_components" ALTER COLUMN "verification_source" SET NOT NULL;
