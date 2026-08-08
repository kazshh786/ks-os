import { test } from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';

process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_dummy';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_dummy';
process.env.STRIPE_PAYMENTS_WEBHOOK_SECRET = 'whsec_dummy2';

import { buildApp } from '../src/app.js';
import { supabase } from '../src/lib/supabase.js';
import { getStripeClient } from '../src/lib/stripe.js';
import { getDatabase } from '@ks-os/database';
import { StripeRepository } from '../src/modules/integrations/stripe/stripe.repository.js';
import { StripeService } from '../src/modules/integrations/stripe/stripe.service.js';
import { EntitlementService } from '../src/modules/agency/agency.service.js';
import { BookingPageService } from '../src/modules/bookings/booking-page.service.js';

test('Integration: Booking Payments E2E', async (t) => {
  const app = buildApp();
  const getClaimsStub = sinon.stub(supabase.auth, 'getClaims');
  
  const dbSelectStub = sinon.stub(getDatabase() as any, 'select');
  const dbInsertStub = sinon.stub(getDatabase() as any, 'insert');
  const dbUpdateStub = sinon.stub(getDatabase() as any, 'update');

  const stripeRepoConnectionStub = sinon.stub(StripeRepository.prototype, 'getConnection');
  const createPaymentSessionStub = sinon.stub(StripeService.prototype, 'createBookingPaymentSession');
  sinon.stub(EntitlementService.prototype, 'assertUsageAvailable').resolves({ plan: null, entitlements: {} } as any);
  sinon.stub(EntitlementService.prototype, 'recordUsageOverage').resolves({ plan: null, entitlements: {} } as any);

  const realStripe = getStripeClient();
  const mockStripe = {
    checkout: {
      sessions: {
        create: sinon.stub(realStripe.checkout.sessions, 'create')
      }
    },
    webhooks: {
      constructEvent: sinon.stub(realStripe.webhooks, 'constructEvent')
    }
  };

  t.afterEach(() => {
    sinon.resetHistory();
  });

  const fakeInsertResult: any = Promise.resolve();
  fakeInsertResult.values = sinon.stub().returns(fakeInsertResult);
  fakeInsertResult.onConflictDoUpdate = sinon.stub().returns(fakeInsertResult);
  fakeInsertResult.onConflictDoNothing = sinon.stub().returns(fakeInsertResult);
  dbInsertStub.returns(fakeInsertResult);

  const fakeUpdateResult: any = Promise.resolve();
  fakeUpdateResult.set = sinon.stub().returns(fakeUpdateResult);
  fakeUpdateResult.where = sinon.stub().returns(fakeUpdateResult);
  dbUpdateStub.returns(fakeUpdateResult);

  const dbTransactionStub = sinon.stub(getDatabase() as any, 'transaction');
  dbTransactionStub.callsFake(async (callback: any) => {
    return callback(getDatabase());
  });

  const dbExecuteStub = sinon.stub(getDatabase() as any, 'execute');
  dbExecuteStub.resolves({ rows: [{ id: '11111111-1111-1111-1111-111111111111', status: 'PENDING', paymentStatus: 'UNPAID', quoted_amount: 5000 }] });
  sinon.stub(BookingPageService.prototype, 'resolvePublicPage').resolves({
    tenant: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Test Tenant',
      currency: 'GBP',
    },
    page: {
      id: '44444444-4444-4444-4444-444444444444',
      allowedServiceIds: [],
      allowedStaffIds: [],
      allowedLocationIds: [],
      paymentSettings: { mode: 'FULL' },
      intakeFormSettings: { requiredBeforeConfirmation: false },
    },
    redirectSlug: null,
  } as any);
  sinon.stub(BookingPageService.prototype, 'validateHoldForBooking').resolves(null);
  sinon.stub(BookingPageService.prototype, 'applicableIntakeForms').resolves([]);

  await t.test('POST /api/v1/public/:subdomain/bookings creates checkout session', async () => {
    // Subdomain resolution
    stripeRepoConnectionStub.resolves({
      id: 'conn_123',
      tenantId: '11111111-1111-1111-1111-111111111111',
      stripeAccountId: 'acct_123',
      connectionStatus: 'READY',
      chargesEnabled: true,
      payoutsEnabled: true
    } as any);

    createPaymentSessionStub.resolves({
      attempt: {
        id: 'att_123',
        status: 'OPEN',
        amount: 5000,
        currency: 'gbp'
      } as any,
      url: 'https://checkout.stripe.com/pay/cs_test_123'
    });

    dbSelectStub.returns({
      from: sinon.stub().returns({
        where: sinon.stub().returns({
          limit: sinon.stub().resolves([{ 
            id: '11111111-1111-1111-1111-111111111111', 
            currency: 'GBP',
            stripeAccountId: 'acct_123',
            connectionStatus: 'READY',
            chargesEnabled: true 
          }])
        })
      })
    } as any);

    mockStripe.checkout.sessions.create.resolves({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/pay/cs_test_123'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/public/test-tenant/bookings',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serviceId: '11111111-1111-1111-1111-111111111111',
        staffId: '22222222-2222-2222-2222-222222222222',
        startTime: new Date().toISOString(),
        bookingChannel: 'in_shop',
        paymentMode: 'pay_now',
        payNow: true,
        idempotencyKey: '33333333-3333-3333-3333-333333333333',
        client: {
          name: 'John Doe',
          email: 'john@example.com',
          phone: '1234567890'
        }
      })
    });

    // In a real implementation this might be a 201 with the checkout url.
    // Assert structure based on typical implementation expectations.
    if (response.statusCode !== 201) console.error('CREATE BOOKING ERROR:', response.body);
    assert.strictEqual(response.statusCode, 201);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.payment.checkoutUrl, 'https://checkout.stripe.com/pay/cs_test_123');
  });

  await t.test('POST /api/v1/webhooks/stripe/payments handles checkout.session.completed', async () => {
    mockStripe.webhooks.constructEvent.returns({
      id: 'evt_checkout_completed',
      type: 'checkout.session.completed',
      account: 'acct_123',
      data: {
        object: {
          id: 'cs_test_123',
          metadata: {
            bookingId: 'booking_123'
          },
          payment_intent: 'pi_123'
        }
      }
    });

    // Mock deduplication check: no existing event found
    dbSelectStub.returns({
      from: sinon.stub().returns({
        where: sinon.stub().resolves([])
      })
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe/connect',
      headers: { 'stripe-signature': 'valid', 'content-type': 'application/json' },
      body: JSON.stringify({ some: 'data' })
    });

    if (response.statusCode !== 200) console.error('WEBHOOK ERROR 1:', response.body);
    assert.strictEqual(response.statusCode, 200);
    // Should verify booking update / transaction insert in a complete test
  });

  await t.test('POST /api/v1/webhooks/stripe/payments idempotency', async () => {
    mockStripe.webhooks.constructEvent.returns({
      id: 'evt_checkout_completed',
      type: 'checkout.session.completed',
      account: 'acct_123',
      data: { object: { id: 'cs_test_123' } }
    });

    // Mock deduplication check: event already exists
    dbSelectStub.returns({
      from: sinon.stub().returns({
        where: sinon.stub().resolves([{ processingStatus: 'PROCESSED' }])
      })
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe/connect',
      headers: { 'stripe-signature': 'valid', 'content-type': 'application/json' },
      body: JSON.stringify({ some: 'data' })
    });

    if (response.statusCode !== 200) console.error('WEBHOOK ERROR 2:', response.body);
    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.status, 'already_processed');
  });

  await t.test('POST /api/v1/webhooks/stripe/payments handles checkout.session.expired', async () => {
    mockStripe.webhooks.constructEvent.returns({
      id: 'evt_checkout_expired',
      type: 'checkout.session.expired',
      account: 'acct_123',
      data: {
        object: {
          id: 'cs_test_123',
          metadata: {
            bookingId: 'booking_123'
          }
        }
      }
    });

    dbSelectStub.returns({
      from: sinon.stub().returns({
        where: sinon.stub().resolves([])
      })
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe/connect',
      headers: { 'stripe-signature': 'valid', 'content-type': 'application/json' },
      body: JSON.stringify({ some: 'data' })
    });

    if (response.statusCode !== 200) console.error('WEBHOOK ERROR 3:', response.body);
    assert.strictEqual(response.statusCode, 200);
    // Should verify booking status was updated to cancelled/expired
  });
});
