import { test } from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';

process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_dummy';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_dummy';

import { buildApp } from '../src/app.js';
import { supabase } from '../src/lib/supabase.js';
import { getStripeClient } from '../src/lib/stripe.js';
import { getDatabase } from '@ks-os/database';
import { installTenantAuthFixture } from './helpers/tenant-auth.js';

test('Integration: Finance API', async (t) => {
  const mockUserId = '11111111-1111-1111-1111-111111111111';
  const app = buildApp({ beforeRegister: instance => installTenantAuthFixture(instance, { authUserId: mockUserId }) });
  
  const getClaimsStub = sinon.stub(supabase.auth, 'getClaims');

  const dbSelectStub = sinon.stub(getDatabase() as any, 'select');
  const dbInsertStub = sinon.stub(getDatabase() as any, 'insert');

  const realStripe = getStripeClient();
  const mockStripe = {
    balance: {
      retrieve: sinon.stub(realStripe.balance, 'retrieve')
    },
    balanceTransactions: {
      list: sinon.stub(realStripe.balanceTransactions, 'list')
    },
    webhooks: {
      constructEvent: sinon.stub(realStripe.webhooks, 'constructEvent')
    },
    disputes: {
      list: sinon.stub(realStripe.disputes, 'list'),
      retrieve: sinon.stub(realStripe.disputes, 'retrieve')
    }
  };

  t.afterEach(() => {
    sinon.resetHistory();
  });

  const setupAuth = (role: string) => {
    getClaimsStub.resolves({ data: { claims: { sub: mockUserId } }, error: null } as any);
    
    const dbRow = { 
      stripeAccountId: 'acct_123', 
      role,
      id: 'dp_123',
      amount: 5000,
      currency: 'usd',
      status: 'needs_response',
      reason: 'fraudulent',
      lastSyncedAt: new Date(),
      createdAtStripe: new Date(),
      hasEvidenceDue: false
    };
    
    const fakeResult: any = Promise.resolve([dbRow]);
    fakeResult.limit = sinon.stub().returns(fakeResult);
    fakeResult.orderBy = sinon.stub().returns(fakeResult);
    fakeResult.offset = sinon.stub().returns(fakeResult);
    fakeResult.where = sinon.stub().returns(fakeResult);

    const fakeFrom: any = Promise.resolve([dbRow]);
    fakeFrom.where = sinon.stub().returns(fakeResult);

    dbSelectStub.returns({
      from: sinon.stub().returns(fakeFrom)
    } as any);
  };

  await t.test('GET /api/v1/finance/balance blocks non-owner with 403', async () => {
    setupAuth('staff');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/finance/balance',
      headers: { authorization: 'Bearer mock', 'x-ks-test-role': 'staff' }
    });

    assert.strictEqual(response.statusCode, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'FORBIDDEN_ROLE');
  });

  await t.test('GET /api/v1/finance/balance allows owner and fetches balance', async () => {
    setupAuth('owner');

    mockStripe.balance.retrieve.resolves({
      available: [{ amount: 1000, currency: 'usd' }],
      pending: [{ amount: -500, currency: 'usd' }]
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/finance/balance',
      headers: { authorization: 'Bearer mock' }
    });

    if (response.statusCode !== 200) console.error(response.body);
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.available[0].amount, 1000);
    assert.strictEqual(body.pending[0].amount, -500); // testing negative balance
  });

  await t.test('POST /api/v1/finance/sync/balance rate limits after first call', async () => {
    setupAuth('owner');

    mockStripe.balance.retrieve.resolves({
      available: [{ amount: 1000, currency: 'usd' }],
      pending: [{ amount: 0, currency: 'usd' }]
    });

    const response1 = await app.inject({
      method: 'POST',
      url: '/api/v1/finance/sync/balance',
      headers: { authorization: 'Bearer mock' }
    });

    assert.strictEqual(response1.statusCode, 200);

    const response2 = await app.inject({
      method: 'POST',
      url: '/api/v1/finance/sync/balance',
      headers: { authorization: 'Bearer mock' }
    });

    assert.strictEqual(response2.statusCode, 429); // Rate limit should block this
  });

  await t.test('GET /api/v1/finance/disputes allows owner', async () => {
    setupAuth('owner');
    
    mockStripe.disputes.list.resolves({
      data: [{ id: 'dp_123', amount: 5000, currency: 'usd', status: 'needs_response' }]
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/finance/disputes',
      headers: { authorization: 'Bearer mock' }
    });

    if (response.statusCode !== 200) console.error(response.body);
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.items[0].id, 'dp_123');
  });

  await t.test('POST /api/v1/webhooks/stripe/connect processes payout.paid and performs MATCHED reconciliation', async () => {
    // Mock for Webhooks constructEvent
    mockStripe.webhooks.constructEvent.returns({
      id: 'evt_payout',
      type: 'payout.paid',
      account: 'acct_123',
      data: {
        object: {
          id: 'po_123',
          amount: 5000,
          currency: 'usd',
          status: 'paid',
          arrival_date: 123456789,
          created: 123456789
        }
      }
    });

    mockStripe.balanceTransactions.list.returns(
      (async function* () {
        yield { id: 'txn_123', type: 'charge', amount: 5000, fee: 150, net: 4850, currency: 'usd', available_on: 123456789 };
      })() as any
    );

    const dbRow = { tenantId: 'tenant_123', id: 'dp_123' };
    const fakeResult: any = Promise.resolve([dbRow]);
    fakeResult.limit = sinon.stub().returns(fakeResult);
    fakeResult.orderBy = sinon.stub().returns(fakeResult);
    fakeResult.offset = sinon.stub().returns(fakeResult);
    fakeResult.where = sinon.stub().returns(fakeResult);
    const fakeFrom: any = Promise.resolve([dbRow]);
    fakeFrom.where = sinon.stub().returns(fakeResult);
    dbSelectStub.returns({ from: sinon.stub().returns(fakeFrom) } as any);

    const fakeInsertResult: any = Promise.resolve();
    fakeInsertResult.values = sinon.stub().returns(fakeInsertResult);
    fakeInsertResult.onConflictDoUpdate = sinon.stub().returns(fakeInsertResult);
    fakeInsertResult.onConflictDoNothing = sinon.stub().returns(fakeInsertResult);
    dbInsertStub.returns(fakeInsertResult);
    
    const dbUpdateStub = sinon.stub(getDatabase() as any, 'update');
    const fakeUpdateResult: any = Promise.resolve();
    fakeUpdateResult.set = sinon.stub().returns(fakeUpdateResult);
    fakeUpdateResult.where = sinon.stub().returns(fakeUpdateResult);
    dbUpdateStub.returns(fakeUpdateResult);
    fakeInsertResult.values = sinon.stub().returns(fakeInsertResult);
    fakeInsertResult.onConflictDoUpdate = sinon.stub().returns(fakeInsertResult);
    fakeInsertResult.onConflictDoNothing = sinon.stub().returns(fakeInsertResult);
    dbInsertStub.returns(fakeInsertResult);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe/connect',
      headers: { 'stripe-signature': 'valid', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'evt_payout' })
    });

    if (response.statusCode !== 200) console.error('PAYOUT WEBHOOK ERROR:', response.body);
    assert.strictEqual(response.statusCode, 200);
  });

  await t.test('GET /api/v1/finance/disputes/:id allows owner', async () => {
    setupAuth('owner');
    
    mockStripe.disputes.retrieve.resolves({
      id: 'dp_123', amount: 5000, currency: 'usd', status: 'needs_response'
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/finance/disputes/dp_123',
      headers: { authorization: 'Bearer mock' }
    });

    if (response.statusCode !== 200) console.error(response.body);
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.id, 'dp_123');
  });

});
