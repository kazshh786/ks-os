import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('payment confirmation email is populated with appointment and payment context', () => {
  const payments = read('modules/payments/payments.service.ts');

  assert.match(payments, /appointmentStartTime:\s*appointments\.startTime/);
  assert.match(payments, /bookingReference:\s*appointments\.publicReference/);
  assert.match(payments, /staffName:\s*users\.name/);
  assert.match(payments, /locationName:\s*locations\.name/);
  assert.match(payments, /paymentReference:\s*checkoutTransactions\.stripePaymentIntentId/);
  assert.match(payments, /appointmentDateTime:\s*row\.appointmentStartTime\?\.toISOString\(\)/);
  assert.match(payments, /appointmentServices\.serviceName/);
  assert.match(payments, /templateKey === 'payment-confirmed' \|\| row\.paymentConfirmationEnabled/);
});

test('paid booking customer gets booking confirmation as well as the payment receipt', () => {
  const claim = read('modules/customer-portal/customer-claim-email.service.ts');
  const email = read('modules/email/email.service.ts');

  assert.match(claim, /booking\.status !== 'CONFIRMED'/);
  assert.match(claim, /BOOKING_NOT_CONFIRMED/);
  assert.doesNotMatch(email, /PAYMENT_CONFIRMATION_COVERS_BOOKING/);
  assert.doesNotMatch(email, /eq\(emailOutbox\.templateKey, 'payment-confirmed'\)/);
});
