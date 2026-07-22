CREATE TABLE IF NOT EXISTS "stripe_payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"public_booking_reference" uuid NOT NULL,
	"stripe_account_id" varchar(255) NOT NULL,
	"stripe_checkout_session_id" varchar(255) NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"idempotency_key" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"application_fee_amount" integer DEFAULT 0 NOT NULL,
	"status" varchar(50) DEFAULT 'CREATING' NOT NULL,
	"failure_code" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_tenant_idempotency" ON "stripe_payment_attempts" USING btree ("tenant_id","idempotency_key");
--> statement-breakpoint
ALTER TABLE "stripe_payment_attempts" ADD CONSTRAINT "stripe_payment_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stripe_payment_attempts" ADD CONSTRAINT "stripe_payment_attempts_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stripe_payment_attempts" ADD CONSTRAINT "stripe_payment_attempts_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id");
--> statement-breakpoint
ALTER TABLE "stripe_payment_attempts" ADD CONSTRAINT "stripe_payment_attempts_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id");
