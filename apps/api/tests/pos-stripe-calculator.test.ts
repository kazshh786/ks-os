import assert from 'node:assert/strict';
import test from 'node:test';
import { getFinalPaymentComponents, validatePaymentMethod } from '../src/modules/pos/pos.calculator.js';

test('Stripe Terminal is accepted as the POS card method', () => {
  const components = getFinalPaymentComponents('STRIPE_TERMINAL', 9700);
  assert.deepEqual(components, [{
    method: 'STRIPE_TERMINAL',
    amountInCents: 9700,
    externalProvider: 'STRIPE',
    externalProviderName: 'Stripe',
  }]);
  assert.doesNotThrow(() => validatePaymentMethod('STRIPE_TERMINAL', 9700, components));
});

test('booking-page Stripe payments remain blocked from staff POS submission', () => {
  assert.throws(
    () => getFinalPaymentComponents('STRIPE_ONLINE', 9700),
    (error: any) => error?.name === 'INVALID_PAYMENT_METHOD',
  );
});

test('Stripe Terminal components must match the server total', () => {
  assert.throws(
    () => validatePaymentMethod('STRIPE_TERMINAL', 9700, [{
      method: 'STRIPE_TERMINAL',
      amountInCents: 9600,
      externalProvider: 'STRIPE',
    }]),
    (error: any) => error?.name === 'INVALID_PAYMENT_TOTAL',
  );
});
