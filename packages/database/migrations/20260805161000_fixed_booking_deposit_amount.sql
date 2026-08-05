-- Booking pages may calculate a deposit as either a percentage of the service
-- price or a fixed amount stored in the tenant currency's minor unit.

ALTER TABLE booking_pages
  ALTER COLUMN payment_settings
  SET DEFAULT '{"mode":"DEPOSIT","depositType":"PERCENTAGE","depositPercentage":20,"depositFixedAmount":1000,"promotionCodesEnabled":false,"giftCardsEnabled":false}'::jsonb;

UPDATE booking_pages
SET payment_settings = jsonb_set(
  jsonb_set(
    COALESCE(payment_settings, '{}'::jsonb),
    '{depositType}',
    to_jsonb((CASE WHEN payment_settings->>'depositType' = 'FIXED' THEN 'FIXED' ELSE 'PERCENTAGE' END)::text),
    true
  ),
  '{depositFixedAmount}',
  to_jsonb(CASE
    WHEN COALESCE(payment_settings->>'depositFixedAmount', '') ~ '^[0-9]+$'
      AND (payment_settings->>'depositFixedAmount')::numeric BETWEEN 1 AND 100000000
      THEN round((payment_settings->>'depositFixedAmount')::numeric)::integer
    ELSE 1000
  END),
  true
);

COMMENT ON COLUMN booking_pages.payment_settings IS
  'Public paid bookings use DEPOSIT or FULL. Deposits may be PERCENTAGE (1-99) or FIXED in tenant-currency minor units and are capped at the service total.';
