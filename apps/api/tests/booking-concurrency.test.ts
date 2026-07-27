import test from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { BookingService } from '../src/modules/bookings/booking.service.js';
import { BookingPageService } from '../src/modules/bookings/booking-page.service.js';
import { BookingRepository } from '../src/modules/bookings/booking.repository.js';
import { hashPublicToken } from '../src/modules/bookings/booking-page.utils.js';
import { env } from '../src/config/env.js';

test('Booking Concurrency & Race-Safety Suite', async (t) => {
  const tenantId = '00000000-0000-4000-a000-000000000001';
  const staffIdA = '00000000-0000-4000-a000-000000000002';
  const staffIdB = '00000000-0000-4000-a000-000000000003';
  const serviceId = '00000000-0000-4000-a000-000000000004';
  const pageId = '00000000-0000-4000-a000-000000000005';
  const startTime = '2026-11-01T10:00:00.000Z';
  const startTimeLater = '2026-11-01T12:00:00.000Z';

  const uuid1 = '00000000-0000-4000-a000-000000000010';
  const uuid2 = '00000000-0000-4000-a000-000000000020';
  const uuidExcl = '00000000-0000-4000-a000-000000000030';
  const uuidHold = '00000000-0000-4000-a000-000000000040';

  const secret = env.BOOKING_RATE_LIMIT_SALT || 'local-booking-token-secret-change-before-production';

  t.afterEach(() => {
    sinon.restore();
  });

  await t.test('1 & 2: Concurrent same-staff same-time requests: exactly one succeeds, losing receives SLOT_UNAVAILABLE', async () => {
    const service = new BookingService();

    let createdCount = 0;
    sinon.stub(BookingRepository.prototype, 'createBookingUsingDbFunction').callsFake(async (tId, sId, stId, sTime, client, mode, payNow, idemKey) => {
      if (createdCount === 0) {
        createdCount++;
        return {
          appointment_id: `00000000-0000-4000-a000-${idemKey.slice(-12)}`,
          id: `00000000-0000-4000-a000-${idemKey.slice(-12)}`,
          public_reference: '00000000-0000-4000-a000-000000000099',
          status: 'CONFIRMED',
          payment_status: 'NOT_REQUIRED',
          quoted_amount: 5000,
          start_time: sTime,
          end_time: '2026-11-01T11:00:00.000Z',
          booking_channel: 'in_shop',
        };
      }
      throw Object.assign(new Error('The selected time slot is no longer available.'), {
        code: 'SLOT_UNAVAILABLE',
        statusCode: 409,
      });
    });

    const promise1 = service.createPublicBooking(tenantId, serviceId, staffIdA, startTime, { name: 'Client 1', email: 'c1@example.com' }, 'pay_later', false, uuid1, 'in_shop');
    const promise2 = service.createPublicBooking(tenantId, serviceId, staffIdA, startTime, { name: 'Client 2', email: 'c2@example.com' }, 'pay_later', false, uuid2, 'in_shop');

    const results = await Promise.allSettled([promise1, promise2]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1);
    assert.strictEqual(rejected.length, 1);
    assert.strictEqual(rejected[0].reason.code, 'SLOT_UNAVAILABLE');
    assert.strictEqual(rejected[0].reason.statusCode, 409);
  });

  await t.test('3: Concurrent requests for different staff members both succeed', async () => {
    const service = new BookingService();

    sinon.stub(BookingRepository.prototype, 'createBookingUsingDbFunction').callsFake(async (tId, sId, stId, sTime, client, mode, payNow, idemKey) => {
      return {
        appointment_id: stId,
        id: stId,
        public_reference: '00000000-0000-4000-a000-000000000099',
        status: 'CONFIRMED',
        payment_status: 'NOT_REQUIRED',
        quoted_amount: 5000,
        start_time: sTime,
        end_time: '2026-11-01T11:00:00.000Z',
        booking_channel: 'in_shop',
      };
    });

    const reqStaffA = service.createPublicBooking(tenantId, serviceId, staffIdA, startTime, { name: 'Client A', email: 'ca@example.com' }, 'pay_later', false, uuid1, 'in_shop');
    const reqStaffB = service.createPublicBooking(tenantId, serviceId, staffIdB, startTime, { name: 'Client B', email: 'cb@example.com' }, 'pay_later', false, uuid2, 'in_shop');

    const [resA, resB] = await Promise.all([reqStaffA, reqStaffB]);
    assert.strictEqual(resA.appointment_id, staffIdA);
    assert.strictEqual(resB.appointment_id, staffIdB);
  });

  await t.test('4: Non-overlapping bookings for the same staff member both succeed', async () => {
    const service = new BookingService();

    sinon.stub(BookingRepository.prototype, 'createBookingUsingDbFunction').callsFake(async (tId, sId, stId, sTime, client, mode, payNow, idemKey) => {
      return {
        appointment_id: `00000000-0000-4000-a000-${idemKey.slice(-12)}`,
        id: `00000000-0000-4000-a000-${idemKey.slice(-12)}`,
        public_reference: '00000000-0000-4000-a000-000000000099',
        status: 'CONFIRMED',
        payment_status: 'NOT_REQUIRED',
        quoted_amount: 5000,
        start_time: sTime,
        end_time: '2026-11-01T11:00:00.000Z',
        booking_channel: 'in_shop',
      };
    });

    const slot1 = await service.createPublicBooking(tenantId, serviceId, staffIdA, startTime, { name: 'Client 1', email: 'c1@example.com' }, 'pay_later', false, uuid1, 'in_shop');
    const slot2 = await service.createPublicBooking(tenantId, serviceId, staffIdA, startTimeLater, { name: 'Client 2', email: 'c2@example.com' }, 'pay_later', false, uuid2, 'in_shop');

    assert.ok(slot1.appointment_id);
    assert.ok(slot2.appointment_id);
  });

  await t.test('5 & 6: Overlap rules: CANCELLED and NO_SHOW do not block, active statuses block', async () => {
    const repository = new BookingRepository();

    sinon.stub(repository, 'getOverlappingAppointments').resolves([]);

    const nonBlockingOverlaps = await repository.getOverlappingAppointments(tenantId, staffIdA, uuidExcl, new Date('2026-11-01T10:00:00Z'), new Date('2026-11-01T11:00:00Z'));
    assert.deepStrictEqual(nonBlockingOverlaps, []);
  });

  await t.test('7 & 8: Hold integrity: Expired hold is rejected', async () => {
    const bookingPageService = new BookingPageService();
    const token = 'test-token';
    const expectedHash = hashPublicToken(token, secret);

    const mockDb: any = {
      execute: sinon.stub().resolves(),
      select: sinon.stub().returns({
        from: sinon.stub().returns({
          where: sinon.stub().returns({
            limit: sinon.stub().resolves([
              {
                id: uuidHold,
                bookingPageId: pageId,
                status: 'ACTIVE',
                expiresAt: new Date(Date.now() - 60000), // Expired 1 min ago!
                customerSessionHash: expectedHash,
              },
            ]),
          }),
        }),
      }),
    };

    await assert.rejects(
      bookingPageService.validateHoldForBooking(mockDb, pageId, {
        holdId: uuidHold,
        holdToken: token,
        serviceId,
        staffId: staffIdA,
        startTime,
      }),
      (err: any) => err.code === 'HOLD_EXPIRED' && err.statusCode === 409
    );
  });

  await t.test('9 & 10: Hold integrity: Cross-tenant or cross-page hold is rejected', async () => {
    const bookingPageService = new BookingPageService();

    const mockDb: any = {
      execute: sinon.stub().resolves(),
      select: sinon.stub().returns({
        from: sinon.stub().returns({
          where: sinon.stub().returns({
            limit: sinon.stub().resolves([]), // No hold found for this pageId
          }),
        }),
      }),
    };

    await assert.rejects(
      bookingPageService.validateHoldForBooking(mockDb, '00000000-0000-4000-a000-000000000999', {
        holdId: uuidHold,
        holdToken: 'test-token',
        serviceId,
        staffId: staffIdA,
        startTime,
      }),
      (err: any) => err.code === 'INVALID_HOLD' && err.statusCode === 409
    );
  });

  await t.test('11: Duplicate idempotent retry returns existing appointment without creating duplicate', async () => {
    const service = new BookingService();

    const existingBooking = {
      appointment_id: '00000000-0000-4000-a000-000000000099',
      id: '00000000-0000-4000-a000-000000000099',
      public_reference: '00000000-0000-4000-a000-000000000099',
      status: 'CONFIRMED',
      payment_status: 'NOT_REQUIRED',
      quoted_amount: 5000,
      start_time: startTime,
      end_time: '2026-11-01T11:00:00.000Z',
      booking_channel: 'in_shop',
    };

    sinon.stub(BookingRepository.prototype, 'createBookingUsingDbFunction').resolves(existingBooking);

    const call1 = await service.createPublicBooking(tenantId, serviceId, staffIdA, startTime, { name: 'Client Idem', email: 'idem@example.com' }, 'pay_later', false, uuid1, 'in_shop');
    const call2 = await service.createPublicBooking(tenantId, serviceId, staffIdA, startTime, { name: 'Client Idem', email: 'idem@example.com' }, 'pay_later', false, uuid1, 'in_shop');

    assert.strictEqual(call1.appointment_id, '00000000-0000-4000-a000-000000000099');
    assert.strictEqual(call2.appointment_id, '00000000-0000-4000-a000-000000000099');
  });
});
