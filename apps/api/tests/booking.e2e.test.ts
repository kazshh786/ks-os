import { test } from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';

import { buildApp } from '../src/app.js';
import { supabase } from '../src/lib/supabase.js';
import { BookingRepository } from '../src/modules/bookings/booking.repository.js';
import { getDatabase } from '@ks-os/database';
import { installTenantAuthFixture } from './helpers/tenant-auth.js';

test('Integration: Authorization for rescheduling bookings', async (t) => {
  const app = buildApp();
  
  const getClaimsStub = sinon.stub(supabase.auth, 'getClaims');
  const mockUserId = '11111111-1111-1111-1111-111111111111';
  const mockTenantId = mockUserId; // Use same ID so tenant query mock matches user query mock
  const mockBookingId = '33333333-3333-3333-3333-333333333333';
  installTenantAuthFixture(app, { authUserId: mockUserId, tenantId: mockTenantId, defaultRole: 'staff' });

  const dbStub = sinon.stub(getDatabase() as any, 'select').returns({
    from: sinon.stub().returns({
      where: sinon.stub().returns({
        limit: sinon.stub().resolves([{ 
          id: mockUserId, 
          tenantId: mockTenantId,
          name: 'Mock Staff / Mock Tenant', 
          subdomain: 'mock-tenant',
          role: 'staff', 
          permissions: ['create_bookings'],
          duration: 30,
          bufferTime: 0
        }])
      })
    })
  } as any);

  const getBookingByIdStub = sinon.stub(BookingRepository.prototype, 'getBookingById');
  const rescheduleBookingRepoStub = sinon.stub(BookingRepository.prototype, 'rescheduleBooking').resolves();
  const getOverlappingStub = sinon.stub(BookingRepository.prototype, 'getOverlappingAppointments').resolves([]);
  sinon.stub(BookingRepository.prototype, 'isRescheduleSlotAvailable').resolves(true);
  const dbInsertStub = sinon.stub(getDatabase() as any, 'insert');
  const dbUpdateStub = sinon.stub(getDatabase() as any, 'update');
  const dbTransactionStub = sinon.stub(getDatabase() as any, 'transaction');

  const fakeMutationResult: any = Promise.resolve();
  fakeMutationResult.values = sinon.stub().returns(fakeMutationResult);
  fakeMutationResult.set = sinon.stub().returns(fakeMutationResult);
  fakeMutationResult.where = sinon.stub().returns(fakeMutationResult);
  fakeMutationResult.onConflictDoNothing = sinon.stub().returns(fakeMutationResult);
  dbInsertStub.returns(fakeMutationResult);
  dbUpdateStub.returns(fakeMutationResult);
  dbTransactionStub.callsFake(async (callback: any) => callback(getDatabase()));

  t.afterEach(() => {
    sinon.resetHistory();
  });

  await t.test('PATCH /api/v1/bookings/:id/reschedule - allows valid request for assigned staff', async () => {
    getClaimsStub.resolves({
      data: {
        claims: { sub: mockUserId, email: 'test@ks-os.com' }
      },
      error: null
    } as any);

    getBookingByIdStub.resolves({
      id: mockBookingId,
      tenantId: mockTenantId,
      serviceId: '55555555-5555-5555-5555-555555555555',
      userId: mockUserId, // Assigned to this staff!
      status: 'CONFIRMED',
      startTime: new Date('2026-07-16T14:00:00.000Z'),
      endTime: new Date('2026-07-16T14:30:00.000Z')
    } as any);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${mockBookingId}/reschedule`,
      headers: { authorization: 'Bearer mock-token' },
      payload: {
        startTime: '2026-07-16T15:00:00.000Z',
        staffId: mockUserId
      }
    });

    if (response.statusCode !== 200) {
      console.log('Reschedule test failed with body:', response.body);
    }
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(rescheduleBookingRepoStub.calledOnce, true);
  });

  await t.test('POST /api/v1/bookings/:id/cancel - rejects request for unassigned staff', async () => {
    getClaimsStub.resolves({
      data: {
        claims: { sub: mockUserId, email: 'test@ks-os.com' }
      },
      error: null
    } as any);

    getBookingByIdStub.resolves({
      id: mockBookingId,
      tenantId: mockTenantId,
      serviceId: '55555555-5555-5555-5555-555555555555',
      userId: '44444444-4444-4444-4444-444444444444', // NOT assigned to this staff
      status: 'CONFIRMED',
      startTime: new Date('2026-07-16T14:00:00.000Z'),
      endTime: new Date('2026-07-16T14:30:00.000Z')
    } as any);

    const updateStatusStub = sinon.stub(BookingRepository.prototype, 'updateBookingStatus').resolves();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${mockBookingId}/cancel`,
      headers: { authorization: 'Bearer mock-token' }
    });

    assert.strictEqual(response.statusCode, 400); // Because service throws UNAUTHORIZED -> INVALID_STATUS (400)
    const body = JSON.parse(response.body);
    assert.match(body.error.message, /UNAUTHORIZED: Cannot cancel/);
    assert.strictEqual(updateStatusStub.called, false);
  });
});
