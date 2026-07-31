import test from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { buildApp } from '../src/app.js';
import { BookingService } from '../src/modules/bookings/booking.service.js';
import { BookingPageService } from '../src/modules/bookings/booking-page.service.js';
import { EntitlementService } from '../src/modules/agency/agency.service.js';
import { getDatabase } from '@ks-os/database';

test('Booking Creation endpoints', async (t) => {
  const previousWorkspaceDomain = process.env.PUBLIC_WORKSPACE_DOMAIN;
  process.env.PUBLIC_WORKSPACE_DOMAIN = 'kasimshah.com';
  const app = buildApp();
  const bookingOrigin = 'https://ks-agency.kasimshah.com';
  
  const mockTenant = { 
    id: 'test-tenant-id', 
    name: 'Test Tenant', 
    subdomain: 'test-tenant',
    isActive: true,
    bookingConfig: {
      timezone: 'Europe/London',
      currency: 'GBP',
      paymentPolicy: 'PayLater',
      visitOptions: ['Shop', 'Mobile']
    }
  };

  const queryBuilder = {
    from: sinon.stub().returnsThis(),
    where: sinon.stub().returnsThis(),
    limit: sinon.stub().returnsThis(),
    then: function(resolve: any) {
      resolve([mockTenant]);
    }
  };

  const dbStub = sinon.stub(getDatabase() as any, 'select').returns(queryBuilder as any);
  const insertResult: any = Promise.resolve();
  insertResult.values = sinon.stub().returns(insertResult);
  insertResult.onConflictDoNothing = sinon.stub().returns(insertResult);
  sinon.stub(getDatabase() as any, 'insert').returns(insertResult);
  const updateResult: any = Promise.resolve();
  updateResult.set = sinon.stub().returns(updateResult);
  updateResult.where = sinon.stub().returns(updateResult);
  sinon.stub(getDatabase() as any, 'update').returns(updateResult);
  sinon.stub(getDatabase() as any, 'transaction').callsFake(async (callback: any) => callback(getDatabase()));

  sinon.stub(BookingPageService.prototype, 'resolvePublicPage').resolves({
    tenant: { ...mockTenant, currency: 'GBP' },
    page: {
      id: '44444444-4444-4444-4444-444444444444',
      allowedServiceIds: [],
      allowedStaffIds: [],
      allowedLocationIds: [],
      paymentSettings: { mode: 'PAY_LATER' },
      intakeFormSettings: { requiredBeforeConfirmation: false },
    },
    redirectSlug: null,
  } as any);
  sinon.stub(BookingPageService.prototype, 'validateHoldForBooking').resolves(null);
  sinon.stub(BookingPageService.prototype, 'applicableIntakeForms').resolves([]);
  
  const createBookingStub = sinon.stub(BookingService.prototype, 'createPublicBooking').resolves({
    id: 'booking-123',
    booking_reference: 'REF-123',
    appointment_status: 'CONFIRMED',
    start_time: '2026-10-10T09:00:00Z',
    end_time: '2026-10-10T09:30:00Z',
    booking_channel: 'in_shop'
  } as any);
  sinon.stub(EntitlementService.prototype, 'assertUsageAvailable').resolves({ plan: null, entitlements: {} } as any);
  sinon.stub(EntitlementService.prototype, 'recordUsageOverage').resolves({ plan: null, entitlements: {} } as any);

  t.afterEach(() => {
    sinon.resetHistory();
    queryBuilder.then = function(resolve: any) {
      resolve([mockTenant]);
    };
  });

  t.after(() => {
    sinon.restore();
    app.close();
    if (previousWorkspaceDomain === undefined) delete process.env.PUBLIC_WORKSPACE_DOMAIN;
    else process.env.PUBLIC_WORKSPACE_DOMAIN = previousWorkspaceDomain;
  });

  await t.test('tenant booking host passes browser preflight', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/public/test-tenant/bookings',
      headers: {
        origin: bookingOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    assert.strictEqual(response.statusCode, 204);
    assert.strictEqual(response.headers['access-control-allow-origin'], bookingOrigin);
  });

  await t.test('POST /api/v1/public/:subdomain/bookings - successful creation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/public/test-tenant/bookings',
      headers: { origin: bookingOrigin },
      payload: {
        serviceId: '11111111-1111-1111-1111-111111111111',
        staffId: '22222222-2222-2222-2222-222222222222',
        startTime: '2026-10-10T09:00:00Z',
        bookingChannel: 'in_shop',
        client: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          phone: '+1234567890'
        },
        paymentMode: 'pay_later',
        payNow: false,
        idempotencyKey: '33333333-3333-3333-3333-333333333333'
      }
    });

    assert.strictEqual(response.statusCode, 201);
    assert.strictEqual(response.headers['access-control-allow-origin'], bookingOrigin);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.booking.reference, 'REF-123');
  });

  await t.test('POST /api/v1/public/:subdomain/bookings - invalid payload returns 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/public/test-tenant/bookings',
      headers: { origin: bookingOrigin },
      payload: {
        serviceId: 'test-svc',
        // missing customer, date, etc
      }
    });

    assert.strictEqual(response.statusCode, 400);
    assert.strictEqual(response.headers['access-control-allow-origin'], bookingOrigin);
  });
});