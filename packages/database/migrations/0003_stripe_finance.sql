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
CREATE UNIQUE INDEX IF NOT EXISTS "unique_stripe_account_dispute_id" ON "stripe_disputes" USING btree ("stripe_account_id","stripe_dispute_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_stripe_account_balance_transaction_id" ON "stripe_payout_items" USING btree ("tenant_id","stripe_balance_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_stripe_account_payout_id" ON "stripe_payouts" USING btree ("stripe_account_id","stripe_payout_id");--> statement-breakpoint
ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_checkout_transaction_id_checkout_transactions_id_fk" FOREIGN KEY ("checkout_transaction_id") REFERENCES "public"."checkout_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_payout_items" ADD CONSTRAINT "stripe_payout_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_payout_items" ADD CONSTRAINT "stripe_payout_items_checkout_transaction_id_checkout_transactions_id_fk" FOREIGN KEY ("checkout_transaction_id") REFERENCES "public"."checkout_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_payouts" ADD CONSTRAINT "stripe_payouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
