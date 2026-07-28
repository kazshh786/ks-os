import assert from 'node:assert/strict';
import test from 'node:test';
import { getStripeClient } from '../src/lib/stripe.js';

test('getStripeClient reports a recognised configuration error when the server key is missing', () => {
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;

  try {
    assert.throws(() => getStripeClient(), /STRIPE_NOT_CONFIGURED/);
  } finally {
    if (originalSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalSecretKey;
    }
  }
});
