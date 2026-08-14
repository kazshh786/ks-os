import assert from 'node:assert/strict';
import test from 'node:test';
import { BookingRepository } from '../src/modules/bookings/booking.repository.js';

test('race-safe public bookings expose the reference contract expected by the API', async () => {
  const publicReference = '33333333-3333-4333-8333-333333333333';
  const transaction = {
    execute: async () => ({
      rows: [{
        appointment_id: '22222222-2222-4222-8222-222222222222',
        public_reference: publicReference,
        appointment_status: 'CONFIRMED',
      }],
    }),
  };

  const booking = await new BookingRepository().createBookingUsingDbFunction(
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    '2026-08-06T09:00:00.000Z',
    { name: 'Test customer', email: 'booking@example.test', phone: '+447000000000' },
    'pay_now',
    true,
    '66666666-6666-4666-8666-666666666666',
    'in_shop',
    undefined,
    undefined,
    transaction,
  );

  assert.equal(booking.booking_reference, publicReference);
  assert.equal(booking.appointment_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(booking.appointment_status, 'CONFIRMED');
});
