-- Supabase Row Level Security (RLS) Strategy for Multi-Tenant Isolation
-- Apply these policies directly to the Supabase PostgreSQL database.

-- =========================================================================
-- 1. Helper Functions (Security Definer to Bypass RLS Recursion)
-- =========================================================================

-- Retrieve the tenant ID of the currently authenticated user.
-- Marked as SECURITY DEFINER so it runs with database owner privileges,
-- avoiding infinite recursion when querying the 'users' table.
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- 1. Optimistic Check: Attempt to read tenant_id from auth JWT claims for maximum performance
  v_tenant_id := (nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid;
  
  -- 2. Fallback Check: Query the database users table if not present in the JWT
  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM public.users WHERE id = auth.uid();
  END IF;

  RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Retrieve the role of the currently authenticated user.
CREATE OR REPLACE FUNCTION public.get_auth_user_role()
RETURNS text AS $$
BEGIN
  RETURN (SELECT role FROM public.users WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;


-- =========================================================================
-- 2. Tenants Table RLS Policies
-- =========================================================================

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own tenant's details
CREATE POLICY select_tenant_policy ON public.tenants
  FOR SELECT
  USING (id = public.get_auth_tenant_id());

-- Allow tenant creation during signup (can be restricted to admin roles if signup is handled via custom API)
CREATE POLICY insert_tenant_policy ON public.tenants
  FOR INSERT
  WITH CHECK (true);

-- Only Owners can update their tenant's settings
CREATE POLICY update_tenant_policy ON public.tenants
  FOR UPDATE
  USING (id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner');


-- =========================================================================
-- 3. Users (Staff) Table RLS Policies
-- =========================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Allow users to read other users/staff members under the same tenant
CREATE POLICY select_users_policy ON public.users
  FOR SELECT
  USING (tenant_id = public.get_auth_tenant_id());

-- Only Owners can invite/create new users under their tenant
CREATE POLICY insert_users_policy ON public.users
  FOR INSERT
  WITH CHECK (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner');

-- Owners can edit any user; Staff can only edit their own name/avatar (but not roles or permissions)
CREATE POLICY update_users_policy ON public.users
  FOR UPDATE
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (
    public.get_auth_user_role() = 'owner' OR (id = auth.uid() AND role = 'staff')
  );

-- Only Owners can delete users from their tenant
CREATE POLICY delete_users_policy ON public.users
  FOR DELETE
  USING (tenant_id = public.get_auth_tenant_id() AND public.get_auth_user_role() = 'owner');


-- =========================================================================
-- 4. Template Policy for Future Multi-Tenant Tables (Clients, Appointments, etc.)
-- =========================================================================
/*
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON public.appointments
  FOR ALL
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());
*/
