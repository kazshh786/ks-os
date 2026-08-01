
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const web = (path: string) => readFileSync(resolve(process.cwd(), `../web/src/${path}`), 'utf8');

test('appointment POS offers embedded and payment-link Stripe flows', () => {
  const source = web('components/POSCheckout.tsx');
  assert.match(source, /Pay on this screen/);
  assert.match(source, /Payment link or QR code/);
  assert.match(source, /startOnlinePayment\('EMBEDDED'\)/);
  assert.match(source, /startOnlinePayment\('HOSTED'\)/);
  assert.match(source, /paymentMethod: 'STRIPE_TERMINAL' \| 'STRIPE_ONLINE'/);
  assert.match(source, /undefined, 'STRIPE_ONLINE'\);/);
  assert.match(source, /mode: 'ONLINE_CHECKOUT'/);
});

test('retail POS offers the same server-calculated online payment routes', () => {
  const source = web('components/RetailPOSCheckout.tsx');
  assert.match(source, /pos\/retail\/stripe\/online-sessions/);
  assert.match(source, /EmbeddedPosCheckout/);
  assert.match(source, /PaymentLinkPanel/);
  assert.match(source, /'STRIPE_ONLINE'/);
});

test('hosted POS payment result page is publicly routed', () => {
  const app = web('App.tsx');
  assert.match(app, /path="\/pos-payment-complete"/);
  assert.match(app, /PosPaymentCompletePage/);
});
