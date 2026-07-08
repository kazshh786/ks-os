-- SQL Seed Script: Create Master Admin User
-- Run this directly in your Supabase SQL Editor to create the admin account.
-- Default credentials:
-- Email: kasimashah@gmail.com
-- Temporary Password: Monopoly12

-- Enable pgcrypto extension for bcrypt hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create a Master Agency Tenant (if not already existing)
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

-- 2. Insert admin user into Supabase Auth schema (auth.users)
-- Hashes the temporary password 'Monopoly12' using standard Blowfish/bcrypt (bf)
INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'd68a35e2-2cf2-4c22-8ea9-281340800a6b', -- Custom fixed UUID for admin
    'authenticated',
    'authenticated',
    'kasimashah@gmail.com',
    crypt('Monopoly12', gen_salt('bf', 10)),
    now(),
    null,
    null,
    '{"provider": "email", "providers": ["email"], "tenant_id": "00000000-0000-0000-0000-000000000000"}'::jsonb,
    '{"name": "Master Agency Admin"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
)
ON CONFLICT (id) DO NOTHING;

-- 3. Insert matching profile into public.users
-- Sets permissions flag: "requires_password_change": true to trigger force change UI on first login
INSERT INTO public.users (id, tenant_id, email, name, role, permissions)
VALUES (
    'd68a35e2-2cf2-4c22-8ea9-281340800a6b',
    '00000000-0000-0000-0000-000000000000',
    'kasimashah@gmail.com',
    'Master Agency Admin',
    'owner',
    '{"admin": true, "requires_password_change": true}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
