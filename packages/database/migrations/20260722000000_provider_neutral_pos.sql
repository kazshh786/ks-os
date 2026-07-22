CREATE TABLE IF NOT EXISTS "checkout_payment_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkout_transaction_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_method" text NOT NULL,
	"amount_in_cents" integer NOT NULL,
	"external_provider" varchar(50),
	"external_provider_name" varchar(100),
	"external_reference" varchar(255),
	"method_description" varchar(255),
	"verification_source" text NOT NULL,
	"provider_payment_id" varchar(255),
	"staff_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkout_payment_components" ADD CONSTRAINT "checkout_payment_components_checkout_transaction_id_checkout_transactions_id_fk" FOREIGN KEY ("checkout_transaction_id") REFERENCES "public"."checkout_transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkout_payment_components" ADD CONSTRAINT "checkout_payment_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkout_payment_components" ADD CONSTRAINT "checkout_payment_components_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Backfill legacy CARD to EXTERNAL_CARD for point_of_sale transactions where stripe_payment_intent_id IS NULL
UPDATE "checkout_transactions"
SET "payment_method" = 'EXTERNAL_CARD'
WHERE "payment_method" = 'CARD'
  AND "purpose" = 'point_of_sale'
  AND "stripe_payment_intent_id" IS NULL;

-- Keep booking payments as CARD or whatever they are, but if any Stripe payments got recorded as CARD, update to STRIPE_ONLINE (though mostly POS uses CARD)
UPDATE "checkout_transactions"
SET "payment_method" = 'STRIPE_ONLINE'
WHERE "payment_method" = 'CARD'
  AND "stripe_payment_intent_id" IS NOT NULL;
