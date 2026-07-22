CREATE TABLE IF NOT EXISTS "stripe_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"checkout_transaction_id" uuid NOT NULL,
	"appointment_id" uuid,
	"stripe_account_id" varchar(255) NOT NULL,
	"stripe_payment_intent_id" varchar(255) NOT NULL,
	"stripe_refund_id" varchar(255),
	"idempotency_key" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"reason" varchar(255) NOT NULL,
	"internal_note" varchar(1000),
	"status" varchar(50) DEFAULT 'CREATING' NOT NULL,
	"failure_code" varchar(255),
	"requested_by_user_id" uuid,
	"refund_source" varchar(50) DEFAULT 'KS_OS' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_tenant_idempotency_refund" ON "stripe_refunds" USING btree ("tenant_id","idempotency_key");
--> statement-breakpoint
ALTER TABLE "stripe_refunds" ADD CONSTRAINT "stripe_refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stripe_refunds" ADD CONSTRAINT "stripe_refunds_checkout_transaction_id_checkout_transactions_id_fk" FOREIGN KEY ("checkout_transaction_id") REFERENCES "public"."checkout_transactions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stripe_refunds" ADD CONSTRAINT "stripe_refunds_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stripe_refunds" ADD CONSTRAINT "stripe_refunds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stripe_refunds" ADD CONSTRAINT "stripe_refunds_stripe_refund_id_unique" UNIQUE("stripe_refund_id");
