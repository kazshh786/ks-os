-- SQL Migration: Auto-Sync Supabase Auth Users to Public Users Table
-- Run this once in your Supabase SQL Editor. It automates public profile creation.

-- =========================================================================
-- Trigger Function: handle_new_user
-- =========================================================================
-- Automatically executes every time a new user is created in Supabase Auth.
-- Creates the public.users database entry automatically, avoiding manual seed queries.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Ensure the default Master Agency Tenant exists
  INSERT INTO public.tenants (id, name, subdomain, primary_color, secondary_color, accent_color)
  VALUES (
      '00000000-0000-0000-0000-000000000000', 
      'KS Studio Agency', 
      'agency', 
      '#0f172a', 
      '#475569', 
      '#10b981'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Insert matching public profile referencing the new auth user id
  INSERT INTO public.users (id, tenant_id, email, name, role, permissions)
  VALUES (
    NEW.id,
    '00000000-0000-0000-0000-000000000000', -- Default Agency Tenant ID
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', 'New Staff Member'),
    -- Assign owner/admin permissions if it matches your Master Admin email
    CASE 
      WHEN NEW.email = 'kasimashah@gmail.com' THEN 'owner'
      ELSE 'staff'
    END,
    CASE 
      WHEN NEW.email = 'kasimashah@gmail.com' THEN '{"admin": true, "requires_password_change": true}'::jsonb
      ELSE '{}'::jsonb
    END
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      permissions = EXCLUDED.permissions;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Bind trigger to run after any INSERT into auth.users schema
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
