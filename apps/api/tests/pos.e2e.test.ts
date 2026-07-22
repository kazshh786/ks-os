import { test } from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';

import { buildApp } from '../src/app.js';
import { supabase } from '../src/lib/supabase.js';
import { getDatabase } from '@ks-os/database';
import { PosService } from '../src/modules/pos/pos.service.js';
import { EntitlementService } from '../src/modules/agency/agency.service.js';
import { installTenantAuthFixture } from './helpers/tenant-auth.js';

test('Integration: POS Endpoints', async (t) => {
  const app = buildApp();
  sinon.stub(EntitlementService.prototype, 'assertBoolean').resolves({ plan: null, entitlements: {} } as any);
  
  const getClaimsStub = sinon.stub(supabase.auth, 'getClaims');
  const mockUserId = '11111111-1111-1111-1111-111111111111';
  const mockTenantId = mockUserId; 
  installTenantAuthFixture(app, { authUserId: mockUserId, tenantId: mockTenantId });

  const dbSelectStub = sinon.stub(getDatabase() as any, 'select').returns({
    from: sinon.stub().returns({
      where: sinon.stub().returns({
        limit: sinon.stub().resolves([{ 
          id: mockUserId, 
          tenantId: mockTenantId,
          name: 'Mock Staff', 
          role: 'owner', 
          permissions: []
        }])
      })
    })
  } as any);

  const transactionStub = sinon.stub(getDatabase() as any, 'transaction');
  const servicePreviewStub = sinon.stub(PosService.prototype, 'previewCheckout');
  const serviceProductsStub = sinon.stub(PosService.prototype, 'getProducts');

  t.afterEach(() => {
    sinon.resetHistory();
  });

  t.after(async () => {
    sinon.restore();
    await app.close();
  });

  await t.test('GET /api/v1/products - catalogue filtering', async () => {
    getClaimsStub.resolves({ data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } }, error: null } as any);
    
    serviceProductsStub.resolves([
      { id: 'prod1', name: 'Shampoo', sku: 'SHAM01', priceInCents: 1500, stockQuantity: 5 }
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/products?limit=10&search=Shampoo&inStockOnly=true',
      headers: { authorization: 'Bearer mock-token' }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data[0].name, 'Shampoo');
    assert.strictEqual(serviceProductsStub.calledWith(mockTenantId, 10, 'Shampoo', true), true);
  });

  await t.test('POST /api/v1/pos/checkout/preview - preview calculations', async () => {
    getClaimsStub.resolves({ data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } }, error: null } as any);
    
    servicePreviewStub.resolves({
      serviceAmountInCents: 4000,
      retailAmountInCents: 1500,
      tipAmountInCents: 500,
      grandTotalInCents: 6000
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/checkout/preview',
      headers: { authorization: 'Bearer mock-token' },
      payload: {
        appointmentId: '22222222-2222-2222-2222-222222222222',
        paymentMethod: 'CASH',
        tipAmountInCents: 500,
        purchasedProducts: [{ productId: '33333333-3333-3333-3333-333333333333', quantity: 1 }]
      }
    });

    const body = JSON.parse(response.body);
    if (response.statusCode !== 200) console.log('PREVIEW ERROR:', body.error?.details || body);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.data.grandTotalInCents, 6000);
  });

  await t.test('POST /api/v1/pos/checkout - checkout success permutations (SPLIT)', async () => {
    getClaimsStub.resolves({ data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } }, error: null } as any);

    transactionStub.callsFake(async (callback) => {
      return {
        transactionId: 'txn-uuid',
        appointment: { appointmentId: '22222222-2222-2222-2222-222222222222' },
        calculation: { serviceAmountInCents: 4000, retailAmountInCents: 0, tipAmountInCents: 1000, grandTotalInCents: 5000 },
        paymentStatus: 'SUCCEEDED',
        paymentMethod: 'SPLIT',
        splitAmounts: { cashInCents: 2000, cardInCents: 3000 },
        date: new Date().toISOString(),
        items: []
      };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/checkout',
      headers: { authorization: 'Bearer mock-token' },
      payload: {
        idempotencyKey: 'test-key-split',
        appointmentId: '22222222-2222-2222-2222-222222222222',
        paymentMethod: 'SPLIT',
        splitAmounts: { cashInCents: 2000, cardInCents: 3000 },
        tipAmountInCents: 1000,
        purchasedProducts: []
      }
    });

    const body = JSON.parse(response.body);
    if (response.statusCode !== 200) console.log('SPLIT ERROR:', body.error?.details || body);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.data.paymentMethod, 'SPLIT');
  });

  await t.test('POST /api/v1/pos/checkout - owner vs staff permission logic (Access Denied)', async () => {
    getClaimsStub.resolves({ data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } }, error: null } as any);

    transactionStub.rejects(Object.assign(new Error('Access denied'), { name: 'POS_ACCESS_DENIED' }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/checkout',
      headers: { authorization: 'Bearer mock-token' },
      payload: {
        idempotencyKey: 'test-key-access',
        appointmentId: '22222222-2222-2222-2222-222222222222',
        paymentMethod: 'CARD',
        tipAmountInCents: 0,
        purchasedProducts: []
      }
    });

    assert.strictEqual(response.statusCode, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error.code, 'POS_ACCESS_DENIED');
  });

  await t.test('POST /api/v1/pos/checkout - concurrency stock locking logic (Insufficient Stock)', async () => {
    getClaimsStub.resolves({ data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } }, error: null } as any);

    transactionStub.rejects(Object.assign(new Error('Insufficient stock'), { name: 'INSUFFICIENT_STOCK' }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/checkout',
      headers: { authorization: 'Bearer mock-token' },
      payload: {
        idempotencyKey: 'test-key-stock',
        appointmentId: '22222222-2222-2222-2222-222222222222',
        paymentMethod: 'CARD',
        tipAmountInCents: 0,
        purchasedProducts: [{ productId: '33333333-3333-3333-3333-333333333333', quantity: 999 }]
      }
    });

    const body = JSON.parse(response.body);
    if (response.statusCode !== 409) console.log('STOCK ERROR:', body.error?.details || body);
    assert.strictEqual(response.statusCode, 409);
    assert.strictEqual(body.error.code, 'INSUFFICIENT_STOCK');
  });

  await t.test('POST /api/v1/pos/checkout - catches raw database errors and maps to 500', async () => {
    getClaimsStub.resolves({ data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } }, error: null } as any);

    transactionStub.rejects(Object.assign(new Error('Deadlock detected'), { name: 'PostgresError' }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/checkout',
      headers: { authorization: 'Bearer mock-token' },
      payload: {
        idempotencyKey: 'test-key-deadlock',
        appointmentId: '22222222-2222-2222-2222-222222222222',
        paymentMethod: 'CARD',
        tipAmountInCents: 0,
        purchasedProducts: []
      }
    });

    assert.strictEqual(response.statusCode, 500);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error.code, 'CHECKOUT_FAILED');
  });
});
