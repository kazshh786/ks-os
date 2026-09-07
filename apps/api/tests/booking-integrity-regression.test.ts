import test from 'node:test';
import assert from 'node:assert/strict';
import sinon from 'sinon';
import Fastify from 'fastify';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getDatabase } from '@ks-os/database';
import publicBookingRoutes from '../src/routes/public/booking.js';
import { BookingPageService } from '../src/modules/bookings/booking-page.service.js';
import { BookingService } from '../src/modules/bookings/booking.service.js';
import { StripeService } from '../src/modules/integrations/stripe/stripe.service.js';
import { EntitlementService } from '../src/modules/agency/agency.service.js';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';

const tenantId = '11111111-1111-4111-8111-111111111111';
const staffId = '22222222-2222-4222-8222-222222222222';
const reference = '33333333-3333-4333-8333-333333333333';
const start = '2027-01-12T10:00:00.000Z';
const end = '2027-01-12T11:00:00.000Z';
const request = { serviceId: tenantId, staffId, startTime: start, bookingChannel: 'in_shop', paymentMode: 'deposit_required', idempotencyKey: reference,
  client: { name: 'Test Person', email: 'test@example.com', phone: '07123456789' } };

test('booking integrity HTTP regressions', async t => {
  const db = getDatabase() as any;
  let existing: any[] = [];
  const writes: any[] = [];
  const builder = (rows: any[] = []) => {
    const query: any = Promise.resolve(rows);
    for (const method of ['where','limit','orderBy','returning','onConflictDoNothing','innerJoin']) query[method] = () => query;
    query.set = (value: any) => { writes.push(value); return query; };
    query.values = () => query;
    return query;
  };
  sinon.stub(db, 'select').callsFake(() => ({ from: (table: any) => builder(getTableName(table) === 'services'
    ? [{ id: tenantId, requiresDeposit: true, price: 10000, discount: 0 }] : getTableName(table) === 'appointments' ? existing : []) }));
  sinon.stub(db, 'update').callsFake(() => builder());
  sinon.stub(db, 'insert').callsFake(() => builder());
  sinon.stub(db, 'execute').resolves({ rows: [] });
  sinon.stub(db, 'transaction').callsFake(async (fn: any) => fn(db));
  sinon.stub(BookingPageService.prototype, 'resolvePublicPage').resolves({ tenant: { id: tenantId, name: 'Studio', currency: 'GBP' },
    page: { id: tenantId, allowedServiceIds: [], allowedStaffIds: [], allowedLocationIds: [], bookingRules: {},
      paymentSettings: { mode: 'DEPOSIT', depositType: 'FIXED', depositFixedAmount: 2000 }, intakeFormSettings: {} } } as any);
  sinon.stub(BookingPageService.prototype, 'applicableIntakeForms').resolves([]);
  const validate = sinon.stub(BookingPageService.prototype, 'validateHoldForBooking').resolves(null);
  sinon.stub(EntitlementService.prototype, 'assertUsageAvailable').resolves({} as any);
  sinon.stub(EntitlementService.prototype, 'recordUsageOverage').resolves({} as any);
  sinon.stub(StripeService.prototype, 'assertBookingPaymentsReady').resolves({} as any);
  sinon.stub(StripeService.prototype, 'assertBookingPaymentAmount');
  const checkout = sinon.stub(StripeService.prototype, 'createBookingPaymentSession');
  const create = sinon.stub(BookingService.prototype, 'createPublicBooking').resolves({ appointment_id: reference, booking_reference: reference,
    appointment_status: 'PENDING', quoted_amount: 10000, start_time: start, end_time: end, booking_channel: 'in_shop' });
  const app = Fastify();
  await app.register(publicBookingRoutes);
  t.after(async () => { await app.close(); sinon.restore(); });

  await t.test('Stripe outage after commit returns the existing reference and saved deposit', async () => {
    checkout.rejects(new Error('Stripe unavailable'));
    const response = await app.inject({ method: 'POST', url: '/studio/bookings', payload: request });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().booking.reference, reference);
    assert.deepEqual(response.json().payment, { required: true, status: 'FAILED', amount: 2000, currency: 'GBP' });
    assert.ok(writes.some(value => value.paymentAmountDue === 2000 && value.bookingIntentHash?.length === 64));
  });
  await t.test('retry uses original deposit and nested URL response', async () => {
    existing = [{ id: reference, status: 'PENDING', quotedAmount: 10000, paymentAmountDue: 2000, paymentCurrency: 'GBP', paymentStatus: 'PENDING' }];
    checkout.resolves({ attempt: { status: 'OPEN' }, url: 'https://checkout.stripe.com/test' } as any);
    const response = await app.inject({ method: 'POST', url: `/studio/bookings/${reference}/payment-session` });
    assert.equal(response.statusCode, 200);
    assert.equal(checkout.lastCall.args[4], 2000);
    assert.equal(response.json().payment.checkoutUrl, 'https://checkout.stripe.com/test');
  });
  await t.test('unknown legacy deposit is never replaced by full price', async () => {
    existing[0].paymentAmountDue = null;
    const response = await app.inject({ method: 'POST', url: `/studio/bookings/${reference}/payment-session` });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'PAYMENT_OBLIGATION_UNKNOWN');
  });
  await t.test('same intent replays its reference without a second booking, hold consumption or checkout session', async () => {
    existing = [{ id: reference, publicReference: reference, bookingIntentHash: writes.find(value => value.bookingIntentHash).bookingIntentHash,
      paymentAmountDue: 2000, paymentCurrency: 'GBP', paymentStatus: 'PENDING', status: 'PENDING',
      startTime: new Date(start), endTime: new Date(end), quotedAmount: 10000, bookingChannel: 'in_shop' }];
    const creates=create.callCount, validations=validate.callCount, sessions=checkout.callCount;
    const response=await app.inject({method:'POST',url:'/studio/bookings',payload:request});
    assert.equal(response.statusCode,200);
    assert.equal(response.json().booking.reference,reference);
    assert.equal(create.callCount,creates); assert.equal(validate.callCount,validations); assert.equal(checkout.callCount,sessions);
  });
  await t.test('a different intent cannot mutate an existing appointment or consume another hold', async () => {
    existing = [{ id: reference, bookingIntentHash: 'different' }];
    const creates = create.callCount, validations = validate.callCount;
    const response = await app.inject({ method: 'POST', url: '/studio/bookings', payload: { ...request, startTime: '2027-01-12T14:00:00.000Z' } });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'IDEMPOTENCY_INTENT_MISMATCH');
    assert.equal(create.callCount, creates);
    assert.equal(validate.callCount, validations);
  });
  await t.test('a database occupied-range conflict is a recoverable slot conflict', async () => {
    existing=[];
    create.rejects(Object.assign(new Error('SLOT_UNAVAILABLE'),{code:'P0001'}));
    const response=await app.inject({method:'POST',url:'/studio/bookings',payload:request});
    assert.equal(response.statusCode,409);
    assert.equal(response.json().error.code,'SLOT_UNAVAILABLE');
  });
});

test('different hold start times acquire the same staff inventory lock', async () => {
  const db = getDatabase() as any;
  const locks: string[] = [];
  let requestedStart = start;
  const query: any = { where() { return this; }, limit: async () => [{ id: reference, serviceId: tenantId, serviceIds: [tenantId], staffUserId: staffId,
    startTime: new Date(requestedStart), endTime: new Date(end), expiresAt: new Date(Date.now()+600_000), status: 'ACTIVE', locationId: null, resourceId: null }] };
  sinon.stub(db,'transaction').callsFake(async (fn: any) => fn(db));
  sinon.stub(db,'select').returns({ from: () => query });
  sinon.stub(db,'update').returns({ set: () => ({ where: async () => [] }) });
  sinon.stub(db,'execute').callsFake(async (statement: any) => {
    const compiled = new PgDialect().sqlToQuery(statement);
    if (compiled.sql.includes('pg_advisory_xact_lock')) locks.push(compiled.params[0]);
    return { rows: [] };
  });
  sinon.stub(BookingPageService.prototype,'resolvePublicPage').resolves({ tenant: { id: tenantId }, page: { id: tenantId, allowedServiceIds: [], bookingRules: {} } } as any);
  try {
    const service = new BookingPageService();
    await service.createHold('studio', { serviceId: tenantId, staffId, startTime: requestedStart, bookingChannel: 'in_shop', idempotencyKey: reference } as any);
    requestedStart = '2027-01-12T10:30:00.000Z';
    await service.createHold('studio', { serviceId: tenantId, staffId, startTime: requestedStart, bookingChannel: 'in_shop', idempotencyKey: reference } as any);
    assert.deepEqual(locks, [`${tenantId}:${staffId}`, `${tenantId}:${staffId}`]);
  } finally { sinon.restore(); }
});
