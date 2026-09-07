-- Preserve the original obligation; never reconstruct a historical deposit from today's settings.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_amount_due integer CHECK (payment_amount_due >= 0);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_currency varchar(3);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_intent_hash varchar(64);
UPDATE appointments a SET payment_amount_due = p.amount, payment_currency = upper(p.currency)
FROM (SELECT DISTINCT ON (appointment_id) appointment_id, tenant_id, amount, currency
      FROM stripe_payment_attempts ORDER BY appointment_id, created_at ASC) p
WHERE a.id = p.appointment_id AND a.tenant_id = p.tenant_id AND a.payment_amount_due IS NULL;
UPDATE appointments a SET payment_amount_due = CASE WHEN payment_mode IN ('pay_later','not_required') THEN 0 ELSE quoted_amount END,
 payment_currency = upper(t.currency)
FROM tenants t WHERE t.id = a.tenant_id AND a.payment_amount_due IS NULL AND a.payment_mode <> 'deposit_required';
-- Legacy deposits without an attempt deliberately remain NULL and require operator review.
