-- Stripe-first POS commercial packaging.
-- Core remains a services-only £97 package. Growth becomes the first package
-- with products, stock and inventory at £197 per month.

UPDATE platform_plan_versions
SET monthly_price_minor = 19700
WHERE plan_id = '10000000-0000-4000-8000-000000000002'::uuid
  AND status = 'ACTIVE'
  AND monthly_price_minor <> 19700;

UPDATE platform_plan_entitlements
SET availability = 'GENERALLY_AVAILABLE'
WHERE entitlement_key = 'inventory.enabled'
  AND plan_version_id IN (
    '20000000-0000-4000-8000-000000000002'::uuid,
    '20000000-0000-4000-8000-000000000003'::uuid
  )
  AND value_json->>'enabled' = 'true';
