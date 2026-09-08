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

test('paid booking suppresses the duplicate only after the combined email is queued', () => {
  const stripe = read('modules/webhooks/stripe/stripe-webhook.service.ts');
  const bookings = read('modules/bookings/booking.service.ts');
  assert.match(stripe, /bookingConfirmed: true/);
  assert.match(stripe, /customerConfirmationCovered: paymentEmail\?\.queued === true/);
  assert.match(bookings, /settings.bookingConfirmationEnabled && booking.clientEmail && !options.customerConfirmationCovered/);
});
