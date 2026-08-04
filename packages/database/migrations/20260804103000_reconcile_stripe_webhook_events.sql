-- Reconcile the legacy production webhook ledger with the canonical Drizzle
-- shape used by StripeWebhookService. Historical production databases can
-- contain the additive Phase 13 table (id/status/error_message), while fresh
-- databases contain the original event-processing columns.

ALTER TABLE "stripe_webhook_events"
  ADD COLUMN IF NOT EXISTS "received_at" timestamp;

UPDATE "stripe_webhook_events"
SET "received_at" = COALESCE("processed_at", now())
WHERE "received_at" IS NULL;

ALTER TABLE "stripe_webhook_events"
  ALTER COLUMN "received_at" SET DEFAULT now(),
  ALTER COLUMN "received_at" SET NOT NULL;

ALTER TABLE "stripe_webhook_events"
  ADD COLUMN IF NOT EXISTS "processing_status" varchar(50);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stripe_webhook_events'
      AND column_name = 'status'
  ) THEN
    EXECUTE $sql$
      UPDATE "stripe_webhook_events"
      SET "processing_status" = CASE
        WHEN "status" IN ('PENDING', 'PROCESSED', 'FAILED') THEN "status"
        WHEN "processed_at" IS NULL THEN 'PENDING'
        ELSE 'PROCESSED'
      END
      WHERE "processing_status" IS NULL
    $sql$;
  ELSE
    UPDATE "stripe_webhook_events"
    SET "processing_status" = CASE
      WHEN "processed_at" IS NULL THEN 'PENDING'
      ELSE 'PROCESSED'
    END
    WHERE "processing_status" IS NULL;
  END IF;
END $$;

ALTER TABLE "stripe_webhook_events"
  ALTER COLUMN "processing_status" SET NOT NULL;

ALTER TABLE "stripe_webhook_events"
  ADD COLUMN IF NOT EXISTS "error_code" varchar(255);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stripe_webhook_events'
      AND column_name = 'error_message'
  ) THEN
    EXECUTE $sql$
      UPDATE "stripe_webhook_events"
      SET "error_code" = LEFT("error_message", 255)
      WHERE "error_code" IS NULL
        AND "error_message" IS NOT NULL
    $sql$;
  END IF;
END $$;

ALTER TABLE "stripe_webhook_events"
  ALTER COLUMN "processed_at" DROP DEFAULT,
  ALTER COLUMN "processed_at" DROP NOT NULL;
