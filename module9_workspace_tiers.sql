-- Module 9: Agency workspace package tiers
-- Apply before deploying the matching dashboard and provisioning updates.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS package_tier text DEFAULT 'core' NOT NULL;

UPDATE public.tenants
SET package_tier = 'core'
WHERE package_tier IS NULL OR package_tier NOT IN ('core', 'growth', 'scale');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_package_tier_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_package_tier_check
      CHECK (package_tier IN ('core', 'growth', 'scale'));
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.package_tier IS
  'Agency package assigned to the workspace. Feature release state is handled separately from entitlement.';
