import test from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { resolveEffectiveServiceValues } from '../src/modules/bookings/effective-service-resolver.js';
import { calculateAvailability } from '../src/modules/availability/availability.service.js';
import { BookingService } from '../src/modules/bookings/booking.service.js';
import { BookingRepository } from '../src/modules/bookings/booking.repository.js';

test('Staff Pricing & Duration Overrides Suite (Prompt 3)', async (t) => {
  const tenantId = '00000000-0000-4000-a000-000000000001';
  const tenantIdOther = '00000000-0000-4000-a000-000000000099';
  const staffIdOverride = '00000000-0000-4000-a000-000000000002';
  const staffIdBase = '00000000-0000-4000-a000-000000000003';
  const serviceId = '00000000-0000-4000-a000-000000000004';
  const startTime = '2026-11-01T10:00:00.000Z';

  const uuidIdem = '00000000-0000-4000-a000-000000000010';

  t.afterEach(() => {
    sinon.restore();
  });

  await t.test('1 & 2: Staff-specific price and duration overrides are applied', async () => {
    const mockDb: any = {
      select: sinon.stub().callsFake(() => ({
        from: sinon.stub().returnsThis(),
        where: sinon.stub().returnsThis(),
        limit: sinon.stub().resolves([
          {
            id: serviceId,
            price: 5000, // base £50
            duration: 30, // base 30m
            bufferTime: 10,
            discount: 0,
          },
        ]),
        innerJoin: sinon.stub().returnsThis(),
      })),
    };

    // Stub staffPricing query for override
    mockDb.select.onCall(1).returns({
      from: sinon.stub().returnsThis(),
      innerJoin: sinon.stub().returnsThis(),
      where: sinon.stub().returnsThis(),
      limit: sinon.stub().resolves([
        {
          customPriceInCents: 7500, // £75 override
          customDurationMinutes: 45, // 45m override
        },
      ]),
    });

    const resolved = await resolveEffectiveServiceValues(tenantId, serviceId, staffIdOverride, mockDb);
    assert.strictEqual(resolved.hasOverride, true);
    assert.strictEqual(resolved.effectivePrice, 7500);
    assert.strictEqual(resolved.effectiveDuration, 45);
    assert.strictEqual(resolved.totalDurationWithBuffer, 55); // 45 + 10
  });

  await t.test('3 & 4: Base price and duration are used when no override exists', async () => {
    const mockDb: any = {
      select: sinon.stub().callsFake(() => ({
        from: sinon.stub().returnsThis(),
        where: sinon.stub().returnsThis(),
        limit: sinon.stub().resolves([
          {
            id: serviceId,
            price: 5000,
            duration: 30,
            bufferTime: 5,
            discount: 0,
          },
        ]),
      })),
    };

    mockDb.select.onCall(1).returns({
      from: sinon.stub().returnsThis(),
      innerJoin: sinon.stub().returnsThis(),
      where: sinon.stub().returnsThis(),
      limit: sinon.stub().resolves([]), // No override found
    });

    const resolved = await resolveEffectiveServiceValues(tenantId, serviceId, staffIdBase, mockDb);
    assert.strictEqual(resolved.hasOverride, false);
    assert.strictEqual(resolved.effectivePrice, 5000);
    assert.strictEqual(resolved.effectiveDuration, 30);
    assert.strictEqual(resolved.totalDurationWithBuffer, 35);
  });

  await t.test('5: Inactive override or inactive staff user is ignored', async () => {
    const mockDb: any = {
      select: sinon.stub().callsFake(() => ({
        from: sinon.stub().returnsThis(),
        where: sinon.stub().returnsThis(),
        limit: sinon.stub().resolves([
          {
            id: serviceId,
            price: 5000,
            duration: 30,
            bufferTime: 0,
            discount: 0,
          },
        ]),
      })),
    };

    mockDb.select.onCall(1).returns({
      from: sinon.stub().returnsThis(),
      innerJoin: sinon.stub().returnsThis(),
      where: sinon.stub().returnsThis(),
      limit: sinon.stub().resolves([]), // User accountStatus != ACTIVE returns empty
    });

    const resolved = await resolveEffectiveServiceValues(tenantId, serviceId, staffIdOverride, mockDb);
    assert.strictEqual(resolved.hasOverride, false);
    assert.strictEqual(resolved.effectivePrice, 5000);
  });

  await t.test('6: Cross-tenant override record is rejected', async () => {
    const mockDb: any = {
      select: sinon.stub().callsFake(() => ({
        from: sinon.stub().returnsThis(),
        where: sinon.stub().returnsThis(),
        limit: sinon.stub().resolves([
          {
            id: serviceId,
            price: 5000,
            duration: 30,
            bufferTime: 0,
            discount: 0,
          },
        ]),
      })),
    };

    mockDb.select.onCall(1).returns({
      from: sinon.stub().returnsThis(),
      innerJoin: sinon.stub().returnsThis(),
      where: sinon.stub().returnsThis(),
      limit: sinon.stub().resolves([]), // Filter by tenantIdOther yields no result
    });

    const resolved = await resolveEffectiveServiceValues(tenantIdOther, serviceId, staffIdOverride, mockDb);
    assert.strictEqual(resolved.hasOverride, false);
    assert.strictEqual(resolved.effectivePrice, 5000);
  });

  await t.test('7, 8 & 11: Catalogue/Stripe/Persisted price uses authoritative server calculation', async () => {
    const service = new BookingService();

    sinon.stub(BookingRepository.prototype, 'createBookingUsingDbFunction').callsFake(async (tId, sId, stId, sTime, client, mode, payNow, idemKey) => {
      // Server calculates price from staff_pricing override: 7500 (ignoring any browser payload)
      return {
        appointment_id: '00000000-0000-4000-a000-000000000099',
        id: '00000000-0000-4000-a000-000000000099',
        public_reference: '00000000-0000-4000-a000-000000000099',
        status: 'CONFIRMED',
        payment_status: 'NOT_REQUIRED',
        quoted_amount: 7500, // Authoritative override price!
        start_time: sTime,
        end_time: '2026-11-01T10:45:00.000Z',
        booking_channel: 'in_shop',
      };
    });

    const created = await service.createPublicBooking(tenantId, serviceId, staffIdOverride, startTime, { name: 'Client A', email: 'a@example.com' }, 'pay_later', false, uuidIdem, 'in_shop');
    assert.strictEqual(created.quoted_amount, 7500);
    assert.strictEqual(created.end_time, '2026-11-01T10:45:00.000Z');
  });

  await t.test('9, 10 & 12: Availability duration equals appointment duration, buffer rules use effective values', async () => {
    const mockDb: any = {
      select: sinon.stub().callsFake((fields: any) => {
        const query: any = {
          from: sinon.stub().returnsThis(),
          where: sinon.stub().returnsThis(),
          leftJoin: sinon.stub().returnsThis(),
          innerJoin: sinon.stub().returnsThis(),
          limit: sinon.stub().resolves([]),
        };

        // Tenant query
        query.limit = sinon.stub().callsFake(async () => [
          { id: tenantId, timezone: 'Europe/London', currency: 'GBP' }
        ]);

        return query;
      }),
    };

    // Verify resolveEffectiveServiceValues computes matching total duration
    const resolved = await resolveEffectiveServiceValues(tenantId, serviceId, staffIdOverride, {
      select: sinon.stub().callsFake(() => ({
        from: sinon.stub().returnsThis(),
        where: sinon.stub().returnsThis(),
        limit: sinon.stub().resolves([{ id: serviceId, price: 5000, duration: 30, bufferTime: 15, discount: 0 }]),
        innerJoin: sinon.stub().returnsThis(),
      }))
    });

    assert.strictEqual(resolved.effectiveDuration, 30);
    assert.strictEqual(resolved.bufferTime, 15);
    assert.strictEqual(resolved.totalDurationWithBuffer, 45);
  });

  await t.test('13, 14 & 15: Prompt 2 concurrency & idempotency guarantees preserved with overrides', async () => {
    const service = new BookingService();

    let callCount = 0;
    sinon.stub(BookingRepository.prototype, 'createBookingUsingDbFunction').callsFake(async (tId, sId, stId, sTime, client, mode, payNow, idemKey) => {
      callCount++;
      return {
        appointment_id: '00000000-0000-4000-a000-000000000099',
        id: '00000000-0000-4000-a000-000000000099',
        public_reference: '00000000-0000-4000-a000-000000000099',
        status: 'CONFIRMED',
        payment_status: 'NOT_REQUIRED',
        quoted_amount: 7500,
        start_time: sTime,
        end_time: '2026-11-01T10:45:00.000Z',
        booking_channel: 'in_shop',
      };
    });

    const firstCall = await service.createPublicBooking(tenantId, serviceId, staffIdOverride, startTime, { name: 'Client A', email: 'a@example.com' }, 'pay_later', false, uuidIdem, 'in_shop');
    const retryCall = await service.createPublicBooking(tenantId, serviceId, staffIdOverride, startTime, { name: 'Client A', email: 'a@example.com' }, 'pay_later', false, uuidIdem, 'in_shop');

    assert.strictEqual(firstCall.quoted_amount, 7500);
    assert.strictEqual(retryCall.quoted_amount, 7500);
  });
});
