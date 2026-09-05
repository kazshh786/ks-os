-- Additive only: existing business_type and all client data remain untouched.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_profile jsonb;
-- This column is accessed through authenticated, tenant-scoped Fastify routes.
COMMENT ON COLUMN tenants.business_profile IS 'Versioned product onboarding answers; never an authorization or entitlement source.';
