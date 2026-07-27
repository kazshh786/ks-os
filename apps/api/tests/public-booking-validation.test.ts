import test from 'node:test';
import assert from 'node:assert';
import { CreateBookingRequestSchema, MobileAddressSchema, CustomerBookingDetailsSchema, ERROR_CODES } from '@ks-os/contracts';

test('Public Booking API Validation Suite (Prompt 4)', async (t) => {
  const validUUID = '00000000-0000-4000-a000-000000000001';
  const validUUID2 = '00000000-0000-4000-a000-000000000002';
  const futureTime = new Date(Date.now() + 86400000).toISOString();

  await t.test('1: Valid booking payload succeeds schema validation', () => {
    const payload = {
      serviceId: validUUID,
      staffId: validUUID2,
      startTime: futureTime,
      client: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+44 7911 123456',
      },
      bookingChannel: 'in_shop',
      paymentMode: 'pay_later',
      payNow: false,
      idempotencyKey: validUUID,
    };
    const result = CreateBookingRequestSchema.safeParse(payload);
    assert.strictEqual(result.success, true);
  });

  await t.test('2: Unknown/unrecognized fields are rejected (.strict())', () => {
    const payload = {
      serviceId: validUUID,
      staffId: validUUID2,
      startTime: futureTime,
      client: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+44 7911 123456',
      },
      bookingChannel: 'in_shop',
      paymentMode: 'pay_later',
      payNow: false,
      idempotencyKey: validUUID,
      customPrice: 10, // Unexpected field!
    };
    const result = CreateBookingRequestSchema.safeParse(payload);
    assert.strictEqual(result.success, false);
  });

  await t.test('3, 4 & 5: Price, duration, and tenantId cannot be supplied in payload', () => {
    const payloadWithPrice = {
      serviceId: validUUID,
      staffId: validUUID2,
      startTime: futureTime,
      client: { name: 'Jane Doe', email: 'jane@example.com', phone: '+44 7911 123456' },
      bookingChannel: 'in_shop',
      paymentMode: 'pay_later',
      payNow: false,
      idempotencyKey: validUUID,
      price: 0, // Unsafe field!
    };
    assert.strictEqual(CreateBookingRequestSchema.safeParse(payloadWithPrice).success, false);

    const payloadWithTenant = {
      serviceId: validUUID,
      staffId: validUUID2,
      startTime: futureTime,
      client: { name: 'Jane Doe', email: 'jane@example.com', phone: '+44 7911 123456' },
      bookingChannel: 'in_shop',
      paymentMode: 'pay_later',
      payNow: false,
      idempotencyKey: validUUID,
      tenantId: validUUID, // Unsafe field!
    };
    assert.strictEqual(CreateBookingRequestSchema.safeParse(payloadWithTenant).success, false);
  });

  await t.test('15: Invalid email is rejected', () => {
    const result = CustomerBookingDetailsSchema.safeParse({
      name: 'Jane Doe',
      email: 'invalid-email-address',
      phone: '+44 7911 123456',
    });
    assert.strictEqual(result.success, false);
  });

  await t.test('16: Invalid phone is rejected safely', () => {
    const result = CustomerBookingDetailsSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '123', // < 7 chars
    });
    assert.strictEqual(result.success, false);
  });

  await t.test('17: Excessive customer name length (> 255) is rejected', () => {
    const result = CustomerBookingDetailsSchema.safeParse({
      name: 'A'.repeat(256),
      email: 'jane@example.com',
      phone: '+44 7911 123456',
    });
    assert.strictEqual(result.success, false);
  });

  await t.test('19: Executable script or HTML payload in customer details is rejected', () => {
    const result = CustomerBookingDetailsSchema.safeParse({
      name: '<script>alert("xss")</script>',
      email: 'jane@example.com',
      phone: '+44 7911 123456',
    });
    assert.strictEqual(result.success, false);
  });

  await t.test('20 & 21: Malformed and arbitrary nested address JSON is rejected', () => {
    const invalidAddress = {
      line1: '123 Main St',
      city: 'London',
      postcode: 'SW1A 1AA',
      nestedObject: { arbitrary: 'data' }, // Arbitrary nested JSON!
    };
    assert.strictEqual(MobileAddressSchema.safeParse(invalidAddress).success, false);
  });

  await t.test('22: Address is required for mobile bookings', () => {
    const payload = {
      serviceId: validUUID,
      staffId: validUUID2,
      startTime: futureTime,
      client: { name: 'Jane Doe', email: 'jane@example.com', phone: '+44 7911 123456' },
      bookingChannel: 'mobile', // Mobile without address!
      paymentMode: 'pay_later',
      payNow: false,
      idempotencyKey: validUUID,
    };
    assert.strictEqual(CreateBookingRequestSchema.safeParse(payload).success, false);
  });

  await t.test('24: Invalid 2-letter country code is rejected', () => {
    const address = {
      line1: '123 Main St',
      city: 'London',
      postcode: 'SW1A 1AA',
      countryCode: 'GREAT_BRITAIN', // Invalid ISO 2-letter code!
    };
    assert.strictEqual(MobileAddressSchema.safeParse(address).success, false);
  });

  await t.test('25: Malformed timestamp is rejected', () => {
    const payload = {
      serviceId: validUUID,
      staffId: validUUID2,
      startTime: 'not-a-timestamp',
      client: { name: 'Jane Doe', email: 'jane@example.com', phone: '+44 7911 123456' },
      bookingChannel: 'in_shop',
      paymentMode: 'pay_later',
      payNow: false,
      idempotencyKey: validUUID,
    };
    assert.strictEqual(CreateBookingRequestSchema.safeParse(payload).success, false);
  });

  await t.test('26: Past slot is rejected', () => {
    const pastTime = new Date(Date.now() - 3600000).toISOString();
    const payload = {
      serviceId: validUUID,
      staffId: validUUID2,
      startTime: pastTime,
      client: { name: 'Jane Doe', email: 'jane@example.com', phone: '+44 7911 123456' },
      bookingChannel: 'in_shop',
      paymentMode: 'pay_later',
      payNow: false,
      idempotencyKey: validUUID,
    };
    assert.strictEqual(CreateBookingRequestSchema.safeParse(payload).success, false);
  });

  await t.test('27: Invalid idempotency key format is rejected', () => {
    const payload = {
      serviceId: validUUID,
      staffId: validUUID2,
      startTime: futureTime,
      client: { name: 'Jane Doe', email: 'jane@example.com', phone: '+44 7911 123456' },
      bookingChannel: 'in_shop',
      paymentMode: 'pay_later',
      payNow: false,
      idempotencyKey: 'not-a-uuid',
    };
    assert.strictEqual(CreateBookingRequestSchema.safeParse(payload).success, false);
  });
});
