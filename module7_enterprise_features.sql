-- SQL Migration: Module 7 - Enterprise Features (Resources, Waitlist, Client Wallets, Automations, Off-Peak)
-- Run this script inside your Supabase SQL Editor.

-- =========================================================================
-- 1. Table Creations & Indexes (Matched to Drizzle Schema)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.resources (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOTNull REFERENCES public.tenants(id) ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    type varchar(100) NOT NULL, -- e.g., 'room', 'laser-machine'
    capacity integer DEFAULT 1 NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.service_resources (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.waitlist (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    staff_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    preferred_date timestamp NOT NULL,
    status varchar(50) DEFAULT 'PENDING' NOT NULL, -- 'PENDING', 'FILLED', 'EXPIRED'
    created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.client_wallets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    balance_in_cents integer DEFAULT 0 NOT NULL,
    gift_card_balance_in_cents integer DEFAULT 0 NOT NULL,
    packages_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.staff_pricing (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    custom_price_in_cents integer NOT NULL,
    custom_duration_minutes integer NOT NULL
);

CREATE TABLE IF NOT EXISTS public.automation_rules (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    trigger_event varchar(100) NOT NULL, -- 'booking_created', 'off_peak_discount'
    template_text text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.off_peak_rules (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    day_of_week integer NOT NULL, -- 0 = Sunday, 1 = Monday...
    start_time time NOT NULL,
    end_time time NOT NULL,
    discount_percentage integer NOT NULL
);

-- =========================================================================
-- 2. Row Level Security Configuration
-- =========================================================================

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.off_peak_rules ENABLE ROW LEVEL SECURITY;

-- Enable Tenant isolation policies
CREATE POLICY tenant_isolation_resources ON public.resources 
    FOR ALL USING (
        tenant_id = get_auth_tenant_id()
        OR get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );

CREATE POLICY tenant_isolation_service_resources ON public.service_resources 
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.services 
            WHERE services.id = service_resources.service_id 
              AND (
                services.tenant_id = get_auth_tenant_id()
                OR get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
              )
        )
    );

CREATE POLICY tenant_isolation_waitlist ON public.waitlist 
    FOR ALL USING (
        tenant_id = get_auth_tenant_id()
        OR get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );

CREATE POLICY tenant_isolation_client_wallets ON public.client_wallets 
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.clients 
            WHERE clients.id = client_wallets.client_id 
              AND (
                clients.tenant_id = get_auth_tenant_id()
                OR get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
              )
        )
    );

CREATE POLICY tenant_isolation_staff_pricing ON public.staff_pricing 
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = staff_pricing.user_id 
              AND (
                users.tenant_id = get_auth_tenant_id()
                OR get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
              )
        )
    );

CREATE POLICY tenant_isolation_automation_rules ON public.automation_rules 
    FOR ALL USING (
        tenant_id = get_auth_tenant_id()
        OR get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );

CREATE POLICY tenant_isolation_off_peak_rules ON public.off_peak_rules 
    FOR ALL USING (
        tenant_id = get_auth_tenant_id()
        OR get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );

-- =========================================================================
-- 3. Automation Triggers: Auto-Notify Waitlist
-- =========================================================================

-- Trigger function to check the waitlist when an appointment is CANCELLED
CREATE OR REPLACE FUNCTION public.check_waitlist_on_cancellation()
RETURNS trigger AS $$
DECLARE
    v_waitlist_id uuid;
BEGIN
    IF OLD.status != 'CANCELLED' AND NEW.status = 'CANCELLED' THEN
        -- Find the oldest pending waitlist entry for this specific service and slot date
        SELECT id INTO v_waitlist_id
        FROM public.waitlist
        WHERE tenant_id = NEW.tenant_id
          AND service_id = NEW.service_id
          AND preferred_date::date = NEW.start_time::date
          AND status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_waitlist_id IS NOT NULL THEN
            -- Mark waitlist entry as FILLED
            UPDATE public.waitlist
            SET status = 'FILLED'
            WHERE id = v_waitlist_id;

            -- In production, trigger an SMS/email message template here
            RAISE NOTICE 'Vacant appointment slot found! Client on waitlist ID % has been notified.', v_waitlist_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_appointment_cancelled
    AFTER UPDATE ON public.appointments
    FOR EACH ROW
    EXECUTE FUNCTION public.check_waitlist_on_cancellation();
