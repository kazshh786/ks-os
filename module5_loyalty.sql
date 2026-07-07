-- SQL Migration: Module 5 - Digital Loyalty Ledger Schema Additions
-- Run this script in your Supabase SQL Editor to alter tables and redeploy transaction triggers.

-- =========================================================================
-- 1. Table Alterations & Creations
-- =========================================================================

-- Add loyalty switches to Tenants
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS "enable_loyalty" boolean DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS "loyalty_points_per_dollar" integer DEFAULT 1 NOT NULL;

-- Add points balance tracking to Clients
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS "loyalty_points" integer DEFAULT 0 NOT NULL;

-- Create Loyalty Ledger Table
CREATE TABLE IF NOT EXISTS "loyalty_ledger" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "client_id" uuid NOT NULL,
    "points_delta" integer NOT NULL,
    "reason" varchar(255) NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "loyalty_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "loyalty_ledger_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE
);

-- Enable RLS on loyalty ledger
ALTER TABLE public.loyalty_ledger ENABLE ROW LEVEL SECURITY;

-- Allow Staff & Owners to read the ledger
CREATE POLICY select_ledger_policy ON public.loyalty_ledger
    FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());


-- =========================================================================
-- 2. Transaction Trigger Update (Atomic Loyalty Points Calculations)
-- =========================================================================

-- Redefining the trigger function to automatically deduct stock levels,
-- update appointment state, and credit loyalty points (if enabled by tenant settings).
CREATE OR REPLACE FUNCTION public.decrement_stock_on_transaction()
RETURNS TRIGGER AS $$
DECLARE
    v_item jsonb;
    v_client_id uuid;
    v_enable_loyalty boolean;
    v_loyalty_ratio integer;
    v_points_earned integer;
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
    WHERE id = NEW.appointment_id
    RETURNING client_id INTO v_client_id;

    -- 3. Loyalty Points Automation Engine
    -- Read settings from the active tenant
    SELECT enable_loyalty, loyalty_points_per_dollar 
      INTO v_enable_loyalty, v_loyalty_ratio 
      FROM public.tenants 
     WHERE id = NEW.tenant_id;

    -- If loyalty is enabled and a valid client is linked, credit points
    IF v_enable_loyalty = true AND v_client_id IS NOT NULL THEN
        -- Calculate points: ($ Total Amount) * Ratio
        -- NEW.total_amount is stored in cents, so we divide by 100
        v_points_earned := (NEW.total_amount / 100) * v_loyalty_ratio;

        IF v_points_earned > 0 THEN
            -- Atomic update client balance
            UPDATE public.clients
            SET loyalty_points = loyalty_points + v_points_earned,
                updated_at = now()
            WHERE id = v_client_id;

            -- Write audit trail ledger entry
            INSERT INTO public.loyalty_ledger (tenant_id, client_id, points_delta, reason)
            VALUES (
                NEW.tenant_id, 
                v_client_id, 
                v_points_earned, 
                'Earned from appointment transaction #' || NEW.id
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Rebind trigger to handle both inserts and status updates
DROP TRIGGER IF EXISTS trg_decrement_stock_on_transaction ON public.checkout_transactions;
CREATE TRIGGER trg_decrement_stock_on_transaction
    AFTER INSERT OR UPDATE OF payment_status ON public.checkout_transactions
    FOR EACH ROW
    WHEN (NEW.payment_status = 'SUCCEEDED')
    EXECUTE FUNCTION public.decrement_stock_on_transaction();
