CREATE TABLE IF NOT EXISTS "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"recipient_email" varchar(255) NOT NULL,
	"recipient_name" varchar(255),
	"reply_to_email" varchar(255),
	"template_key" varchar(255) NOT NULL,
	"template_version" varchar(50) DEFAULT '1.0.0' NOT NULL,
	"template_data_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"provider" varchar(50) DEFAULT 'resend' NOT NULL,
	"provider_message_id" varchar(255),
	"scheduled_for" timestamp DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error_code" varchar(255),
	"related_entity_type" varchar(100),
	"related_entity_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"failed_at" timestamp,
	CONSTRAINT "email_outbox_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "email_outbox_provider_message_id_unique" UNIQUE("provider_message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stripe_account_id" varchar(255) NOT NULL,
	"stripe_dispute_id" varchar(255) NOT NULL,
	"stripe_charge_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"checkout_transaction_id" uuid,
	"appointment_id" uuid,
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"reason" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"is_charge_refundable" boolean DEFAULT false NOT NULL,
	"evidence_due_by" timestamp,
	"has_evidence_due" boolean DEFAULT false NOT NULL,
	"balance_transaction_id" varchar(255),
	"created_at_stripe" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"last_synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"completed_at" timestamp,
	CONSTRAINT "stripe_payment_attempts_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "stripe_payment_attempts_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_payout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stripe_payout_id" varchar(255) NOT NULL,
	"stripe_balance_transaction_id" varchar(255) NOT NULL,
	"stripe_source_id" varchar(255),
	"source_type" varchar(100),
	"gross_amount" integer NOT NULL,
	"stripe_fee" integer NOT NULL,
	"net_amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"available_on" timestamp,
	"checkout_transaction_id" uuid,
	"stripe_refund_id" varchar(255),
	"stripe_dispute_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stripe_account_id" varchar(255) NOT NULL,
	"stripe_payout_id" varchar(255) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(50) NOT NULL,
	"arrival_date" timestamp,
	"method" varchar(50),
	"type" varchar(50),
	"automatic" boolean DEFAULT true NOT NULL,
	"description" varchar(1000),
	"statement_descriptor" varchar(255),
	"failure_code" varchar(255),
	"failure_message_safe" varchar(1000),
	"created_at_stripe" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"failed_at" timestamp,
	"last_synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"completed_at" timestamp,
	CONSTRAINT "stripe_refunds_stripe_refund_id_unique" UNIQUE("stripe_refund_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "reply_to_email" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sender_display_name" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "booking_confirmation_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "booking_cancellation_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "booking_reschedule_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "appointment_reminders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "form_delivery_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "form_reminders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "form_reminder_timing" varchar(50) DEFAULT '24_hours_before_appointment' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_checkout_transaction_id_checkout_transactions_id_fk" FOREIGN KEY ("checkout_transaction_id") REFERENCES "public"."checkout_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_payment_attempts" ADD CONSTRAINT "stripe_payment_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_payment_attempts" ADD CONSTRAINT "stripe_payment_attempts_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_payout_items" ADD CONSTRAINT "stripe_payout_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_payout_items" ADD CONSTRAINT "stripe_payout_items_checkout_transaction_id_checkout_transactions_id_fk" FOREIGN KEY ("checkout_transaction_id") REFERENCES "public"."checkout_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_payouts" ADD CONSTRAINT "stripe_payouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_refunds" ADD CONSTRAINT "stripe_refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_refunds" ADD CONSTRAINT "stripe_refunds_checkout_transaction_id_checkout_transactions_id_fk" FOREIGN KEY ("checkout_transaction_id") REFERENCES "public"."checkout_transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_refunds" ADD CONSTRAINT "stripe_refunds_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_refunds" ADD CONSTRAINT "stripe_refunds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_stripe_account_dispute_id" ON "stripe_disputes" USING btree ("stripe_account_id","stripe_dispute_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_tenant_idempotency" ON "stripe_payment_attempts" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_stripe_account_balance_transaction_id" ON "stripe_payout_items" USING btree ("tenant_id","stripe_balance_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_stripe_account_payout_id" ON "stripe_payouts" USING btree ("stripe_account_id","stripe_payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_tenant_idempotency_refund" ON "stripe_refunds" USING btree ("tenant_id","idempotency_key");