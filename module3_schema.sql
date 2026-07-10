-- SQL Migration: Module 3 - Client CRM & Intake Forms Schema Additions
-- Run this script in your Supabase SQL Editor to create tables and configure RLS.

-- =========================================================================
-- 1. Table Creation & Modifications
-- =========================================================================

-- Clients Table
CREATE TABLE IF NOT EXISTS "clients" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "name" varchar(255) NOT NULL,
    "email" varchar(255),
    "phone" varchar(20),
    "medical_notes" text,
    "patch_test_date" timestamp with time zone,
    "last_visit_date" timestamp with time zone,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE
);

-- Link existing appointments table to our new CRM clients table
ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS "client_id" uuid;

DO $$ BEGIN
  ALTER TABLE public.appointments
  ADD CONSTRAINT "appointments_client_id_clients_id_fk" 
  FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Forms Table (Dynamic Layout Schemas)
CREATE TABLE IF NOT EXISTS "forms" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "title" varchar(255) NOT NULL,
    "fields_json" jsonb NOT NULL, -- Array of objects: { label, type, required }
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE
);

-- Client Form Submissions Table
CREATE TABLE IF NOT EXISTS "client_form_submissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "client_id" uuid NOT NULL,
    "form_id" uuid NOT NULL,
    "response_json" jsonb NOT NULL, -- Key-value answers: { "Allergies": "N/A", "Signature": "..." }
    "submitted_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "client_form_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "client_form_submissions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE,
    CONSTRAINT "client_form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE CASCADE
);


-- =========================================================================
-- 2. Enable Row Level Security (RLS)
-- =========================================================================

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_form_submissions ENABLE ROW LEVEL SECURITY;


-- =========================================================================
-- 3. RLS Policies (Tenant Isolation)
-- =========================================================================

-- --- CLIENTS POLICIES ---

-- Staff, Owners, and Master Admin can view and manage clients under their tenant
CREATE POLICY select_clients_policy ON public.clients
    FOR SELECT
    USING (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );

-- Allow client records to be inserted by authenticated staff/owner or public booking client self-registration
CREATE POLICY insert_clients_policy ON public.clients
    FOR INSERT
    WITH CHECK (true); -- Verified by application tier metadata

-- Staff, Owners, and Master Admin can manage clients under their tenant
CREATE POLICY manage_clients_policy ON public.clients
    FOR ALL
    USING (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );


-- --- FORMS POLICIES ---

-- Forms can be selected by authenticated staff, Master Admin, or by public clients loading forms
CREATE POLICY select_forms_policy ON public.forms
    FOR SELECT
    USING (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
        OR true -- Allows clients loading the form widget to read fields schema
    );

-- Only Owners and Master Admin can create/modify/delete intake forms template layout
CREATE POLICY manage_forms_policy ON public.forms
    FOR ALL
    USING (
        (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner')
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    )
    WITH CHECK (
        (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner')
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );


-- --- CLIENT FORM SUBMISSIONS POLICIES ---

-- Submissions are viewable only by authenticated salon staff and Master Admin
CREATE POLICY select_submissions_policy ON public.client_form_submissions
    FOR SELECT
    USING (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );

-- Allow clients to submit their forms anonymously
CREATE POLICY insert_submissions_policy ON public.client_form_submissions
    FOR INSERT
    WITH CHECK (true);

-- Allow deletion/update only by authenticated staff/owner and Master Admin
CREATE POLICY manage_submissions_policy ON public.client_form_submissions
    FOR ALL
    USING (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        OR public.get_auth_tenant_id() = '00000000-0000-0000-0000-000000000000'
    );
