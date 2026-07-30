import { test } from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { buildApp } from '../src/app.js';
import { EntitlementService } from '../src/modules/agency/agency.service.js';
import { RetailPosService } from '../src/modules/pos/retail-pos.service.js';
import { installTenantAuthFixture } from './helpers/tenant-auth.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const transactionId = '33333333-3333-4333-8333-333333333333';

const totals = {
  serviceAmountInCents: 0,
  retailAmountInCents: 2500,
  tipAmountInCents: 0,
  grandTotalInCents: 2500,
};

const basket = [{ productId, quantity: 2 }];

test('standalone retail POS routes do not require an appointment', async t => {
  sinon.stub(EntitlementService.prototype, 'assertBoolean').resolves();
  const preview = sinon.stub(RetailPosService.prototype, 'preview').resolves(totals);
  const startReaderPayment = sinon.stub(RetailPosService.prototype, 'startReaderPayment').resolves({
    paymentIntentId: 'pi_retail123',
    readerId: 'tmr_reader123',
    amountInCents: 2500,
    currency: 'GBP',
    status: 'requires_payment_method',
  });
  const complete = sinon.stub(RetailPosService.prototype, 'complete').resolves({
    idempotent: false,
    summary: {
      transactionId,
      customerLabel: 'Walk-in retail customer',
      calculation: totals,
      paymentMethod: 'STRIPE_TERMINAL',
      paymentStatus: 'SUCCEEDED',
      date: '2026-07-30T20:00:00.000Z',
      items: [{ name: 'Shampoo', quantity: 2, priceInCents: 1250, totalInCents: 2500 }],
    },
  });

  const app = buildApp();
  installTenantAuthFixture(app, { authUserId: tenantId, tenantId, defaultRole: 'owner' });

  t.after(async () => {
    sinon.restore();
    await app.close();
  });

  const previewResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/pos/retail/preview',
    headers: { authorization: 'Bearer test' },
    payload: {
      paymentMethod: 'STRIPE_TERMINAL',
      tipAmountInCents: 0,
      purchasedProducts: basket,
    },
  });
  assert.strictEqual(previewResponse.statusCode, 200);
  assert.deepStrictEqual(previewResponse.json().data, totals);
  assert.strictEqual(preview.calledOnce, true);
  assert.strictEqual('appointmentId' in preview.firstCall.args[1], false);

  const readerResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/pos/retail/stripe/payment-intents',
    headers: { authorization: 'Bearer test' },
    payload: {
      readerId: 'tmr_reader123',
      idempotencyKey: 'retail-sale-1',
      tipAmountInCents: 0,
      purchasedProducts: basket,
    },
  });
  assert.strictEqual(readerResponse.statusCode, 201);
  assert.strictEqual(readerResponse.json().data.paymentIntentId, 'pi_retail123');
  assert.strictEqual(startReaderPayment.calledOnce, true);

  const checkoutResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/pos/retail/checkout',
    headers: { authorization: 'Bearer test' },
    payload: {
      idempotencyKey: 'retail-sale-1',
      paymentMethod: 'STRIPE_TERMINAL',
      tipAmountInCents: 0,
      purchasedProducts: basket,
      stripePayment: {
        mode: 'TERMINAL_MANUAL',
        manuallyConfirmed: true,
        manualReference: 'stripe-receipt-1',
      },
    },
  });
  assert.strictEqual(checkoutResponse.statusCode, 200);
  assert.strictEqual(checkoutResponse.json().data.transactionId, transactionId);
  assert.strictEqual(checkoutResponse.json().data.customerLabel, 'Walk-in retail customer');
  assert.strictEqual(complete.calledOnce, true);
  assert.strictEqual('appointmentId' in complete.firstCall.args[2], false);
});
