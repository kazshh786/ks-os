import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { assertStripeCheckoutAmount, getStripeConfiguredMode, getStripePublishableKey } from '../src/lib/stripe.js';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Stripe accepts the legacy publishable-key alias but rejects mixed key modes', () => {
  const originalSecret = process.env.STRIPE_SECRET_KEY;
  const originalCanonical = process.env.STRIPE_PUBLISHABLE_KEY;
  const originalLegacy = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  try {
    process.env.STRIPE_SECRET_KEY = 'sk_test_platform';
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_platform';
    assert.equal(getStripePublishableKey(), 'pk_test_platform');
    assert.equal(getStripeConfiguredMode(), 'test');

    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_platform';
    assert.throws(() => getStripeConfiguredMode(), (error: unknown) => (
      error instanceof Error && error.name === 'STRIPE_KEY_MODE_MISMATCH'
    ));
  } finally {
    if (originalSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalSecret;
    if (originalCanonical === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = originalCanonical;
    if (originalLegacy === undefined) delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = originalLegacy;
  }

  const preflight = source('../../scripts/deploy/preflight.mjs');
  assert.match(preflight, /Stripe secret and publishable keys mix live and test modes/);
  assert.match(preflight, /STRIPE_CONNECT_WEBHOOK_SECRET is missing or invalid/);
  assert.match(preflight, /STRIPE_PAYMENTS_WEBHOOK_SECRET is missing or invalid/);
});

test('paid bookings and every POS Stripe path preflight the active connected account', () => {
  const bookingRoute = source('src/routes/public/booking.ts');
  const bookingFlow = source('../web/src/features/bookings/PublicBookingFlow.tsx');
  const onlinePos = source('src/modules/pos/pos-online-stripe.service.ts');
  const appointmentPos = source('src/modules/pos/pos-stripe.service.ts');
  const retailPos = source('src/modules/pos/retail-pos-stripe.service.ts');

  assert.match(bookingRoute, /assertBookingPaymentsReady\(tenant\.id\)/);
  assert.match(bookingRoute, /assertBookingPaymentAmount\(expectedAmountDue/);
  assert.match(bookingRoute, /baseServiceAmount > 0/);
  assert.match(bookingFlow, /business needs to reconnect Stripe for this environment/);
  assert.match(bookingFlow, /PAYMENT_AMOUNT_INVALID/);
  assert.match(onlinePos, /assertStripeConnectedAccountReady\(connection\.stripeAccountId\)/);
  assert.match(appointmentPos, /assertStripeConnectedAccountReady\(connection\.stripeAccountId\)/);
  assert.match(retailPos, /assertStripeConnectedAccountReady\(connection\.stripeAccountId\)/);
  assert.match(onlinePos, /getStripePublishableKey\(\)/);
  assert.match(onlinePos, /assertStripeCheckoutAmount\(input\.amountInCents, tenant\.currency\)/);
  assert.match(appointmentPos, /assertStripeCheckoutAmount\(input\.amountInCents, tenant\.currency\)/);
  assert.match(retailPos, /assertStripeCheckoutAmount\(input\.amountInCents, tenant\.currency\)/);
});

test('Stripe minimum charge validation runs before booking or POS payment creation', () => {
  assert.throws(() => assertStripeCheckoutAmount(29, 'GBP'), (error: unknown) => (
    error instanceof Error && error.name === 'STRIPE_PAYMENT_AMOUNT_INVALID'
  ));
  assert.doesNotThrow(() => assertStripeCheckoutAmount(30, 'GBP'));
  assert.throws(() => assertStripeCheckoutAmount(49, 'USD'));
  assert.doesNotThrow(() => assertStripeCheckoutAmount(50, 'EUR'));

  const bookingRoute = source('src/routes/public/booking.ts');
  assert.ok(
    bookingRoute.indexOf('assertBookingPaymentAmount(expectedAmountDue')
      < bookingRoute.indexOf('const booking = await db.transaction'),
    'Stripe amount validation must happen before the booking transaction',
  );
});

test('Connect replaces an inaccessible or opposite-mode tenant account', () => {
  const service = source('src/modules/integrations/stripe/stripe.service.ts');
  const repository = source('src/modules/integrations/stripe/stripe.repository.ts');

  assert.match(service, /StripePermissionError/);
  assert.match(service, /stripeError\.statusCode === 403/);
  assert.match(service, /connection\.livemode !== livemode/);
  assert.match(service, /createConnectedAccount\(tenantId, livemode\)/);
  assert.match(service, /ks_os_tenant_id: tenantId/);
  assert.match(repository, /livemode: data\.livemode/);
});

test('Connect and payment webhooks use separate secrets and ignore the wrong mode', () => {
  const app = source('src/app.ts');
  const routes = source('src/modules/webhooks/stripe/stripe-webhook.routes.ts');
  const service = source('src/modules/webhooks/stripe/stripe-webhook.service.ts');
  const migration = source('../../packages/database/migrations/20260804010000_stripe_connection_mode.sql');

  assert.match(app, /'\/api\/v1\/webhooks\/stripe\/connect'/);
  assert.match(app, /'\/api\/v1\/webhooks\/stripe\/payments'/);
  assert.match(routes, /registerWebhook\('\/connect'/);
  assert.match(routes, /registerWebhook\('\/payments'/);
  assert.match(service, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  assert.match(service, /STRIPE_PAYMENTS_WEBHOOK_SECRET/);
  assert.match(service, /event\.livemode !== \(configuredMode === 'live'\)/);
  assert.match(service, /attempt\.stripeAccountId !== stripeAccountId/);
  assert.match(service, /status: 'CONFIRMED', paymentStatus: 'SUCCEEDED'/);
  assert.doesNotMatch(service, /status: 'CONFIRMED', paymentStatus: 'PAID'/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS livemode boolean/);
  assert.doesNotMatch(migration, /DEFAULT (true|false)/i);
});
