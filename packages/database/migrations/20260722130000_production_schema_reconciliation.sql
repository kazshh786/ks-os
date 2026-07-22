-- Migration: 20260722130000_production_schema_reconciliation.sql
-- Description: Additive forward-only production schema reconciliation for 13 missing tables and supporting types
-- Safety: Idempotent (IF NOT EXISTS), zero data deletion, zero table drop.

-- 1. Enum Types
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stripe_payment_status') THEN
        CREATE TYPE stripe_payment_status AS ENUM ('CREATING', 'REQUIRES_PAYMENT_METHOD', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
    END IF;
END $$;

-- 2. checkout_payment_components
CREATE TABLE IF NOT EXISTS "checkout_payment_components" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "checkout_transaction_id" uuid NOT NULL REFERENCES "checkout_transactions"("id") ON DELETE CASCADE,
    "payment_method" varchar(50) NOT NULL,
    "amount" integer NOT NULL,
    "staff_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- 3. client_wallets
CREATE TABLE IF NOT EXISTS "client_wallets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
    "balance_in_cents" integer DEFAULT 0 NOT NULL,
    "gift_card_balance_in_cents" integer DEFAULT 0 NOT NULL,
    "packages_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- 4. off_peak_rules
CREATE TABLE IF NOT EXISTS "off_peak_rules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "name" varchar(255) NOT NULL,
    "discount_percentage" integer NOT NULL,
    "day_of_week" integer NOT NULL,
    "start_time" time NOT NULL,
    "end_time" time NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- 5. service_resources
CREATE TABLE IF NOT EXISTS "service_resources" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
    "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- 6. staff_pricing
CREATE TABLE IF NOT EXISTS "staff_pricing" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "staff_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
    "price_override" integer NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- 7. stripe_connections
CREATE TABLE IF NOT EXISTS "stripe_connections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "stripe_account_id" varchar(255) NOT NULL,
    "charges_enabled" boolean DEFAULT false NOT NULL,
    "payouts_enabled" boolean DEFAULT false NOT NULL,
    "details_submitted" boolean DEFAULT false NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "stripe_connections_tenant_id_unique" UNIQUE("tenant_id")
);

-- 8. stripe_payment_attempts
CREATE TABLE IF NOT EXISTS "stripe_payment_attempts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "appointment_id" uuid NOT NULL REFERENCES "appointments"("id") ON DELETE CASCADE,
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
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    "expires_at" timestamptz NOT NULL,
    "completed_at" timestamptz,
    CONSTRAINT "stripe_payment_attempts_checkout_session_unique" UNIQUE("stripe_checkout_session_id")
);

-- 9. stripe_refunds
CREATE TABLE IF NOT EXISTS "stripe_refunds" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "checkout_transaction_id" uuid NOT NULL REFERENCES "checkout_transactions"("id") ON DELETE CASCADE,
    "appointment_id" uuid REFERENCES "appointments"("id") ON DELETE SET NULL,
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
    "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "refund_source" varchar(50) DEFAULT 'KS_OS' NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    "completed_at" timestamptz,
    CONSTRAINT "stripe_refunds_stripe_refund_id_unique" UNIQUE("stripe_refund_id")
);

-- 10. stripe_disputes
CREATE TABLE IF NOT EXISTS "stripe_disputes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "stripe_account_id" varchar(255) NOT NULL,
    "stripe_dispute_id" varchar(255) NOT NULL,
    "stripe_charge_id" varchar(255),
    "stripe_payment_intent_id" varchar(255),
    "checkout_transaction_id" uuid REFERENCES "checkout_transactions"("id") ON DELETE SET NULL,
    "appointment_id" uuid REFERENCES "appointments"("id") ON DELETE SET NULL,
    "amount" integer NOT NULL,
    "currency" varchar(3) NOT NULL,
    "reason" varchar(255) NOT NULL,
    "status" varchar(50) NOT NULL,
    "is_charge_refundable" boolean DEFAULT false NOT NULL,
    "evidence_due_by" timestamptz,
    "has_evidence_due" boolean DEFAULT false NOT NULL,
    "balance_transaction_id" varchar(255),
    "created_at_stripe" timestamptz NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    "closed_at" timestamptz,
    "last_synced_at" timestamptz DEFAULT now() NOT NULL
);

-- 11. stripe_payouts
CREATE TABLE IF NOT EXISTS "stripe_payouts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "stripe_account_id" varchar(255) NOT NULL,
    "stripe_payout_id" varchar(255) NOT NULL,
    "amount" integer NOT NULL,
    "currency" varchar(3) NOT NULL,
    "status" varchar(50) NOT NULL,
    "arrival_date" timestamptz,
    "method" varchar(50),
    "type" varchar(50),
    "automatic" boolean DEFAULT true NOT NULL,
    "description" varchar(1000),
    "statement_descriptor" varchar(255),
    "failure_code" varchar(255),
    "failure_message_safe" varchar(1000),
    "created_at_stripe" timestamptz NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    "paid_at" timestamptz,
    "failed_at" timestamptz,
    "last_synced_at" timestamptz DEFAULT now() NOT NULL
);

-- 12. stripe_payout_items
CREATE TABLE IF NOT EXISTS "stripe_payout_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "stripe_payout_id" varchar(255) NOT NULL,
    "stripe_balance_transaction_id" varchar(255) NOT NULL,
    "stripe_source_id" varchar(255),
    "source_type" varchar(100),
    "gross_amount" integer NOT NULL,
    "stripe_fee" integer NOT NULL,
    "net_amount" integer NOT NULL,
    "currency" varchar(3) NOT NULL,
    "available_on" timestamptz,
    "checkout_transaction_id" uuid REFERENCES "checkout_transactions"("id") ON DELETE SET NULL,
    "stripe_refund_id" varchar(255),
    "stripe_dispute_id" varchar(255),
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- 13. stripe_webhook_events
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "stripe_event_id" varchar(255) NOT NULL,
    "event_type" varchar(255) NOT NULL,
    "stripe_account_id" varchar(255),
    "processed_at" timestamptz DEFAULT now() NOT NULL,
    "status" varchar(50) DEFAULT 'PROCESSED' NOT NULL,
    "error_message" text,
    CONSTRAINT "stripe_webhook_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);

-- 14. waitlist
CREATE TABLE IF NOT EXISTS "waitlist" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "client_id" uuid REFERENCES "clients"("id") ON DELETE CASCADE,
    "client_name" varchar(255) NOT NULL,
    "client_email" varchar(255),
    "client_phone" varchar(50),
    "service_id" uuid REFERENCES "services"("id") ON DELETE CASCADE,
    "requested_date" date NOT NULL,
    "notes" text,
    "status" varchar(50) DEFAULT 'WAITING' NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL
);
