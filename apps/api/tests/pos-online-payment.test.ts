
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('online POS sessions use server totals and provider-confirmed completion', () => {
  const online = source('src/modules/pos/pos-online-stripe.service.ts');
  const routes = source('src/modules/pos/pos.routes.ts');
  const checkout = source('src/modules/pos/pos.service.ts');

  assert.match(online, /unit_amount: input\.amountInCents/);
  assert.match(online, /redirect_on_completion = 'never'/);
  assert.match(online, /stripeAccount: connection\.stripeAccountId/);
  assert.match(routes, /previewCheckout/);
  assert.match(routes, /stripe\/online-sessions/);
  assert.match(checkout, /confirmation\.mode !== 'ONLINE_CHECKOUT'/);
  assert.match(checkout, /method === 'STRIPE_ONLINE'/);
});

test('retail POS online sessions are calculated from live stock prices', () => {
  const routes = source('src/modules/pos/retail-pos.routes.ts');
  const service = source('src/modules/pos/retail-pos.service.ts');

  assert.match(routes, /service\.preview/);
  assert.match(routes, /retail\/stripe\/online-sessions/);
  assert.match(service, /payload\.paymentMethod === 'STRIPE_ONLINE'/);
});
