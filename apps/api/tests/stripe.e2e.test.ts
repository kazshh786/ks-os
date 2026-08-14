import { test } from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';

process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_dummy';
process.env.STRIPE_PAYMENTS_WEBHOOK_SECRET = 'whsec_payments_dummy';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_dummy';
process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
process.env.STRIPE_CONNECT_RETURN_URL = 'http://localhost:3000/app/settings/payments/return';
process.env.STRIPE_CONNECT_REFRESH_URL = 'http://localhost:3000/app/settings/payments/refresh';

import { buildApp } from '../src/app.js';
import { supabase } from '../src/lib/supabase.js';
import { getStripeClient } from '../src/lib/stripe.js';
import { getDatabase } from '@ks-os/database';
import { StripeRepository } from '../src/modules/integrations/stripe/stripe.repository.js';
import { deriveStripeConnectionStatus } from '../src/modules/integrations/stripe/stripe.mapper.js';
import { installTenantAuthFixture } from './helpers/tenant-auth.js';

test('Integration: Stripe Connect API', async (t) => {
  const app = buildApp();

  const getClaimsStub = sinon.stub(supabase.auth, 'getClaims');
  const mockUserId = '11111111-1111-1111-1111-111111111111';
  const mockTenantId = mockUserId;
  installTenantAuthFixture(app, { authUserId: mockUserId, tenantId: mockTenantId });

  const dbSelectStub = sinon.stub(getDatabase() as any, 'select');
  const dbInsertStub = sinon.stub(getDatabase() as any, 'insert');
  const dbUpdateStub = sinon.stub(getDatabase() as any, 'update');

  const realStripe = getStripeClient();
  const mockStripe = {
    accounts: {
      create: sinon.stub(realStripe.accounts, 'create'),
      retrieve: sinon.stub(realStripe.accounts, 'retrieve'),
    },
    accountLinks: {
      create: sinon.stub(realStripe.accountLinks, 'create'),
    },
    webhooks: {
      constructEvent: sinon.stub(realStripe.webhooks, 'constructEvent'),
    },
  };

  const getConnectionStub = sinon.stub(StripeRepository.prototype, 'getConnection');
  const upsertConnectionStub = sinon.stub(StripeRepository.prototype, 'upsertConnection');

  t.afterEach(() => {
    sinon.resetHistory();
  });

  await t.test('POST /api/v1/integrations/stripe/connect blocks staff with 403', async () => {
    getClaimsStub.resolves({ data: { claims: { sub: mockUserId } }, error: null } as any);
    dbSelectStub.returns({
      from: sinon.stub().returns({
        where: sinon.stub().returns({
          limit: sinon.stub().resolves([{ role: 'staff' }]),
        }),
      }),
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/stripe/connect',
      headers: { authorization: 'Bearer mock', 'x-ks-test-role': 'staff' },
    });

    assert.strictEqual(response.statusCode, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'STRIPE_ACCESS_DENIED');
  });

  await t.test('POST /api/v1/integrations/stripe/connect creates one account and returns a setup link', async () => {
    getClaimsStub.resolves({ data: { claims: { sub: mockUserId } }, error: null } as any);
    dbSelectStub.returns({
      from: sinon.stub().returns({
        where: sinon.stub().returns({
          limit: sinon.stub().resolves([{
            role: 'owner',
            name: 'Test Business',
            legalBusinessName: 'Test Business Ltd',
            primaryContactEmail: 'owner@example.test',
          }]),
        }),
      }),
    } as any);

    getConnectionStub.resolves(null);
    mockStripe.accounts.create.resolves({
      id: 'acct_1234567890',
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
      requirements: {},
    });
    mockStripe.accountLinks.create.resolves({
      url: 'https://connect.stripe.test/setup',
    });

    upsertConnectionStub.resolves({
      stripeAccountId: 'acct_1234567890',
      connectionStatus: 'READY',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/stripe/connect',
      headers: { authorization: 'Bearer mock' },
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.data.stripeAccountId, 'acct_••••7890');
    assert.strictEqual(body.data.connectionStatus, 'READY');
    assert.strictEqual(body.url, 'https://connect.stripe.test/setup');
    assert.strictEqual(mockStripe.accounts.create.callCount, 1);
    assert.strictEqual(mockStripe.accountLinks.create.callCount, 1);

    const accountInput = mockStripe.accounts.create.firstCall.args[0];
    assert.strictEqual(accountInput.metadata.ks_os_tenant_id, mockTenantId);
    assert.strictEqual(upsertConnectionStub.firstCall.args[0].livemode, false);

    const linkInput = mockStripe.accountLinks.create.firstCall.args[0];
    assert.strictEqual(linkInput.account, 'acct_1234567890');
    assert.strictEqual(linkInput.return_url, 'http://localhost:3000/app/settings/payments/return');
    assert.strictEqual(linkInput.refresh_url, 'http://localhost:3000/app/settings/payments/refresh');
  });

  await t.test('POST /api/v1/integrations/stripe/connect replaces a legacy account inaccessible to test mode', async () => {
    getClaimsStub.resolves({ data: { claims: { sub: mockUserId } }, error: null } as any);
    dbSelectStub.returns({
      from: sinon.stub().returns({
        where: sinon.stub().returns({
          limit: sinon.stub().resolves([{
            role: 'owner',
            name: 'Test Business',
            legalBusinessName: 'Test Business Ltd',
            primaryContactEmail: 'owner@example.test',
          }]),
        }),
      }),
    } as any);

    getConnectionStub.resolves({
      stripeAccountId: 'acct_from_other_environment',
      livemode: null,
      accountType: 'standard',
      connectionStatus: 'READY',
    } as any);
    mockStripe.accounts.retrieve.rejects(Object.assign(new Error('account is unavailable'), {
      type: 'StripePermissionError',
      statusCode: 403,
      code: 'account_invalid',
    }));
    mockStripe.accounts.create.resolves({
      id: 'acct_test_replacement',
      details_submitted: false,
      charges_enabled: false,
      payouts_enabled: false,
      requirements: {},
    });
    upsertConnectionStub.resolves({
      stripeAccountId: 'acct_test_replacement',
      livemode: false,
      connectionStatus: 'ONBOARDING',
    });
    mockStripe.accountLinks.create.resolves({ url: 'https://connect.stripe.test/replacement' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/stripe/connect',
      headers: { authorization: 'Bearer mock' },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(mockStripe.accounts.retrieve.callCount, 1);
    assert.strictEqual(mockStripe.accounts.create.callCount, 1);
    assert.strictEqual(upsertConnectionStub.firstCall.args[0].livemode, false);
    assert.strictEqual(mockStripe.accountLinks.create.firstCall.args[0].account, 'acct_test_replacement');
  });

  await t.test('POST /api/v1/webhooks/stripe/connect fails on invalid signature', async () => {
    mockStripe.webhooks.constructEvent.throws(new Error('Invalid signature'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe/connect',
      headers: { 'stripe-signature': 'invalid', 'content-type': 'application/json' },
      body: JSON.stringify({ some: 'data' }),
    });

    assert.strictEqual(response.statusCode, 401);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'STRIPE_WEBHOOK_SIGNATURE_INVALID');
    assert.strictEqual(mockStripe.webhooks.constructEvent.lastCall.args[2], 'whsec_dummy');
  });

  await t.test('POST /api/v1/webhooks/stripe/payments uses the payment-endpoint secret', async () => {
    mockStripe.webhooks.constructEvent.throws(new Error('Invalid signature'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe/payments',
      headers: { 'stripe-signature': 'invalid', 'content-type': 'application/json' },
      body: JSON.stringify({ some: 'data' }),
    });

    assert.strictEqual(response.statusCode, 401);
    assert.strictEqual(mockStripe.webhooks.constructEvent.lastCall.args[2], 'whsec_payments_dummy');
  });

  await t.test('POST /api/v1/webhooks/stripe/connect processes deduplication correctly', async () => {
    mockStripe.webhooks.constructEvent.returns({
      id: 'evt_123',
      type: 'account.updated',
      account: 'acct_123',
      data: { object: { id: 'acct_123' } },
    });

    dbSelectStub.returns({
      from: sinon.stub().returns({
        where: sinon.stub().resolves([{ processingStatus: 'PROCESSED' }]),
      }),
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe/connect',
      headers: { 'stripe-signature': 'valid', 'content-type': 'application/json' },
      body: JSON.stringify({ some: 'data' }),
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.status, 'already_processed');
  });

  await t.test('deriveStripeConnectionStatus maps states correctly', async () => {
    const activeState = deriveStripeConnectionStatus({
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
    } as any);
    assert.strictEqual(activeState, 'READY');

    const pendingState = deriveStripeConnectionStatus({
      details_submitted: true,
      charges_enabled: false,
      payouts_enabled: false,
    } as any);
    assert.strictEqual(pendingState, 'PENDING_VERIFICATION');

    const incompleteState = deriveStripeConnectionStatus({
      details_submitted: false,
      charges_enabled: false,
      payouts_enabled: false,
    } as any);
    assert.strictEqual(incompleteState, 'ONBOARDING');
  });
});
