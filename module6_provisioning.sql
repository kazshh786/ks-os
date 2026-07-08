-- SQL Stored Procedure: Module 6 - Agency Onboarding Wizard
-- Run this script in your Supabase SQL Editor to deploy the provisioning RPC function.

-- =========================================================================
-- Stored Procedure: provision_new_tenant
-- =========================================================================
-- Handles atomic creation of a salon workspace, inserts the owner account,
-- and inserts the corresponding industry-specific Starter Pack database rows.
-- Postgres functions are transactional by default (all commands rollback if any fails).
CREATE OR REPLACE FUNCTION public.provision_new_tenant(
    p_name text,
    p_subdomain text,
    p_industry text,
    p_owner_email text,
    p_owner_id uuid
)
RETURNS uuid AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    -- 1. Insert the new tenant record
    INSERT INTO public.tenants (name, subdomain, primary_color, secondary_color, accent_color)
    VALUES (p_name, p_subdomain, '#0f172a', '#475569', '#10b981')
    RETURNING id INTO v_tenant_id;

    -- 2. Insert the owner into the users table (or update if already synced by auth trigger)
    INSERT INTO public.users (id, tenant_id, email, name, role, permissions)
    VALUES (p_owner_id, v_tenant_id, p_owner_email, 'Salon Owner', 'owner', '{"admin": true}'::jsonb)
    ON CONFLICT (id) DO UPDATE
    SET tenant_id = v_tenant_id,
        role = 'owner',
        permissions = '{"admin": true}'::jsonb;

    -- 3. Case switch based on selected industry vertical to insert Starter Packs
    CASE lower(p_industry)
        WHEN 'barber' THEN
            -- Insert Starter Barber Services (Prices in cents)
            INSERT INTO public.services (tenant_id, name, description, duration, price, requires_deposit, is_active)
            VALUES 
                (v_tenant_id, 'Skin Fade', 'Precision fade on the sides, blended into custom top styled cut.', 45, 3500, false, true),
                (v_tenant_id, 'Beard Trim & Shape', 'Beard trimming with lining razor edge detailing.', 30, 2000, false, true),
                (v_tenant_id, 'The Executive Shave', 'Hot towel steam prep, straight razor clean head/neck shave.', 60, 5000, true, true);

            -- Insert Starter Barber Consent Form
            INSERT INTO public.forms (tenant_id, title, fields_json)
            VALUES (
                v_tenant_id,
                'Barber Intake & Razor Waiver',
                '[
                    {"label": "I agree to straight-razor detailing terms", "type": "checkbox", "required": true},
                    {"label": "Skin sensitivities or skin conditions?", "type": "textarea", "required": false},
                    {"label": "Client Signature", "type": "signature", "required": true}
                ]'::jsonb
            );

        WHEN 'nails' THEN
            -- Insert Starter Nail Services (Prices in cents)
            INSERT INTO public.services (tenant_id, name, description, duration, price, requires_deposit, is_active)
            VALUES 
                (v_tenant_id, 'Gel Manicure', 'Cuticle trim, nail shaping, gel polish coat, and oil massage.', 45, 4500, false, true),
                (v_tenant_id, 'Acrylic Full Set', 'Full extension sculpt extensions with gel art coat application.', 90, 7500, true, true),
                (v_tenant_id, 'Luxury Spa Pedicure', 'Foot exfoliation mud soak prep, massage, and nail paint finish.', 60, 5500, false, true);

            -- Insert Starter Nails Consent Form
            INSERT INTO public.forms (tenant_id, title, fields_json)
            VALUES (
                v_tenant_id,
                'Nail Treatment Intake',
                '[
                    {"label": "Any known skin or acrylic product allergies?", "type": "textarea", "required": false},
                    {"label": "Confirming no active nail infections present", "type": "checkbox", "required": true},
                    {"label": "Client Signature", "type": "signature", "required": true}
                ]'::jsonb
            );

        WHEN 'aesthetics' THEN
            -- Insert Starter Aesthetics Services (Prices in cents)
            INSERT INTO public.services (tenant_id, name, description, duration, price, requires_deposit, is_active)
            VALUES 
                (v_tenant_id, 'Laser Facial Treatment', 'Targeted skin resurfacing therapy for rejuvenation.', 45, 12000, true, true),
                (v_tenant_id, 'Botox Consultation', 'Facial analysis mapping sessions and units estimations.', 30, 5000, false, true),
                (v_tenant_id, 'Chemical Peel Resurfacing', 'Exfoliation deep acid peel treatment for hyperpigmentation.', 60, 9500, true, true);

            -- Insert Starter Aesthetics Consent Form
            INSERT INTO public.forms (tenant_id, title, fields_json)
            VALUES (
                v_tenant_id,
                'Clinical Consent & Patch Test Waiver',
                '[
                    {"label": "Have you used retinol or chemical exfoliators in 72h?", "type": "checkbox", "required": true},
                    {"label": "History of keloids or hypertrophic scarring?", "type": "checkbox", "required": true},
                    {"label": "List any skin allergies or active medications", "type": "textarea", "required": false},
                    {"label": "I consent to laser resurfacing treatments", "type": "checkbox", "required": true},
                    {"label": "Client Signature", "type": "signature", "required": true}
                ]'::jsonb
            );
        ELSE
            -- Default Generic Salon Pack
            INSERT INTO public.services (tenant_id, name, description, duration, price, requires_deposit, is_active)
            VALUES 
                (v_tenant_id, 'Standard Consultation', 'Meet with a stylist to map treatments.', 30, 2500, false, true);
    END CASE;

    RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
