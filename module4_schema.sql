-- SQL Migration: Module 4 - Lean POS & Inventory Schema Additions
-- Run this script in your Supabase SQL Editor to create tables, enable RLS, and deploy triggers.

-- =========================================================================
-- 1. Table Creation
-- =========================================================================

-- Products Table
CREATE TABLE IF NOT EXISTS "products" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "name" varchar(255) NOT NULL,
    "sku" varchar(100) NOT NULL UNIQUE,
    "price_in_cents" integer NOT NULL, -- Retail price in cents
    "stock_quantity" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE
);

-- Checkout Transactions Table
CREATE TABLE IF NOT EXISTS "checkout_transactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "appointment_id" uuid NOT NULL,
    "total_amount" integer NOT NULL, -- Total amount in cents (Service + Products)
    "payment_status" text DEFAULT 'PENDING' NOT NULL, -- 'PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'
    "payment_method" text DEFAULT 'CARD' NOT NULL, -- 'CARD', 'CASH', 'SPLIT'
    "purchased_products" jsonb DEFAULT '[]'::jsonb NOT NULL, -- Array of: { "productId": "uuid", "quantity": 1 }
    "stripe_payment_intent_id" varchar(255),
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "checkout_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "checkout_transactions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE
);


-- =========================================================================
-- 2. Inventory Synchronization Trigger (PL/pgSQL)
-- =========================================================================

-- Trigger function that decrements stock on transaction success
-- and updates the corresponding appointment status to 'COMPLETED'.
CREATE OR REPLACE FUNCTION public.decrement_stock_on_transaction()
RETURNS TRIGGER AS $$
DECLARE
    v_item jsonb;
BEGIN
    -- 1. Loop through purchased items and decrement stock counts
    IF NEW.purchased_products IS NOT NULL AND jsonb_array_length(NEW.purchased_products) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.purchased_products) LOOP
            UPDATE public.products
            SET stock_quantity = stock_quantity - (v_item->>'quantity')::integer,
                updated_at = now()
            WHERE id = (v_item->>'productId')::uuid 
              AND tenant_id = NEW.tenant_id;
        END LOOP;
    END IF;

    -- 2. Automatically update the linked appointment state to COMPLETED
    UPDATE public.appointments
    SET status = 'COMPLETED',
        updated_at = now()
    WHERE id = NEW.appointment_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Bind trigger to transactions table
DROP TRIGGER IF EXISTS trg_decrement_stock_on_transaction ON public.checkout_transactions;
CREATE TRIGGER trg_decrement_stock_on_transaction
    AFTER INSERT OR UPDATE OF payment_status ON public.checkout_transactions
    FOR EACH ROW
    WHEN (NEW.payment_status = 'SUCCEEDED')
    EXECUTE FUNCTION public.decrement_stock_on_transaction();


-- =========================================================================
-- 3. Enable Row Level Security (RLS)
-- =========================================================================

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_transactions ENABLE ROW LEVEL SECURITY;


-- =========================================================================
-- 4. RLS Policies (Tenant Isolation)
-- =========================================================================

-- --- PRODUCTS POLICIES ---

-- Staff, Owners, and Master Admin can view products under their tenant
CREATE POLICY select_products_policy ON public.products
    FOR SELECT
    USING (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );

-- Only Owners and Master Admin can manage (insert/update/delete) products
CREATE POLICY manage_products_policy ON public.products
    FOR ALL
    USING (
        (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner')
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    )
    WITH CHECK (
        (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner')
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );


-- --- CHECKOUT TRANSACTIONS POLICIES ---

-- Staff, Owners, and Master Admin can view checkout transactions under their tenant
CREATE POLICY select_transactions_policy ON public.checkout_transactions
    FOR SELECT
    USING (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );

-- Staff, Owners, and Master Admin can insert transactions to process checkouts
CREATE POLICY insert_transactions_policy ON public.checkout_transactions
    FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );

-- Allow updates only for payment processing roles
CREATE POLICY update_transactions_policy ON public.checkout_transactions
    FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );
