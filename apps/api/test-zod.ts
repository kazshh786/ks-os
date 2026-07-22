import { CreateBookingRequestSchema } from '../../packages/contracts/src/booking.js';

const body = {
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
};

const result = CreateBookingRequestSchema.safeParse(body);
console.log(JSON.stringify(result, null, 2));
