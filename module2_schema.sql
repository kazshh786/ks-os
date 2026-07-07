-- SQL Migration: Module 2 - Scheduling & Calendar Schema Additions
-- Run this script in your Supabase SQL Editor to create tables and enable RLS.

-- =========================================================================
-- 1. Table Creation
-- =========================================================================

-- Services Table
CREATE TABLE IF NOT EXISTS "services" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "name" varchar(255) NOT NULL,
    "description" text,
    "duration" integer NOT NULL, -- in minutes
    "price" integer NOT NULL, -- in cents (e.g. $50.00 is stored as 5000)
    "requires_deposit" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE
);

-- Staff Schedules Table (Weekly Recurring Shifts)
CREATE TABLE IF NOT EXISTS "staff_schedules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "day_of_week" integer NOT NULL, -- 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    "start_time" varchar(5) NOT NULL, -- "HH:MM" e.g., "09:00"
    "end_time" varchar(5) NOT NULL, -- "HH:MM" e.g., "17:00"
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "staff_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "staff_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE,
    CONSTRAINT "valid_day_of_week" CHECK (day_of_week BETWEEN 0 AND 6)
);

-- Appointments Table
CREATE TABLE IF NOT EXISTS "appointments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "user_id" uuid NOT NULL, -- The staff member assigned to the appointment
    "client_name" varchar(255) NOT NULL,
    "service_id" uuid NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "status" text DEFAULT 'PENDING' NOT NULL, -- 'PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "appointments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE,
    CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE,
    CONSTRAINT "valid_appointment_times" CHECK (start_time < end_time)
);


-- =========================================================================
-- 2. Enable Row Level Security (RLS)
-- =========================================================================

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;


-- =========================================================================
-- 3. RLS Policies (Tenant Isolation)
-- =========================================================================

-- --- SERVICES POLICIES ---

-- Authenticated Users (Staff/Owner) and public widgets can select active services
CREATE POLICY select_services_policy ON public.services
    FOR SELECT
    USING (
        tenant_id = public.get_auth_tenant_id() 
        OR (is_active = true) -- Allow public booking widget queries
    );

-- Only Owners can manage (insert/update/delete) services
CREATE POLICY manage_services_policy ON public.services
    FOR ALL
    USING (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner')
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner');


-- --- STAFF SCHEDULES POLICIES ---

-- Staff schedules are viewable by anyone in the tenant or the public booking widget
CREATE POLICY select_schedules_policy ON public.staff_schedules
    FOR SELECT
    USING (
        tenant_id = public.get_auth_tenant_id() 
        OR true -- Public booking widget reads schedules to check availability
    );

-- Only Owners can modify schedules
CREATE POLICY manage_schedules_policy ON public.staff_schedules
    FOR ALL
    USING (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner')
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner');


-- --- APPOINTMENTS POLICIES ---

-- Staff & Owners can view all appointments under their tenant
CREATE POLICY select_appointments_policy ON public.appointments
    FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

-- Allow public booking flow to insert new appointments (anonymous bookings)
CREATE POLICY insert_appointments_policy ON public.appointments
    FOR INSERT
    WITH CHECK (true); -- Validated via server-side checks or client logic

-- Staff & Owners can manage updates/deletions of appointments
CREATE POLICY manage_appointments_policy ON public.appointments
    FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());
