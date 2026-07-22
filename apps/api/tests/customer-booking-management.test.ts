import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CustomerBookingPolicySettingsSchema,
  CustomerCancellationRequestSchema,
  CustomerRescheduleAvailabilityQuerySchema,
  CustomerRescheduleRequestSchema,
} from '@ks-os/contracts';
import {
  createCustomerBookingManagementToken,
  hashCustomerBookingManagementToken,
} from '../src/modules/customer-portal/customer-booking-management.service.js';
import { evaluateCustomerBookingManagementPolicy } from '../src/modules/customer-portal/customer-booking-management.policy.js';

const settings = {
  customerCancellationEnabled: true,
  customerReschedulingEnabled: true,
  minimumCancellationNoticeMinutes: 1440,
  minimumRescheduleNoticeMinutes: 1440,
  maximumCustomerReschedules: 3,
  requireCancellationReason: false,
  lateCancellationMessage: 'Please contact the salon.',
  depositPolicyMessage: 'No automatic refund. The salon will review your payment.',
};
const appointment = {
  status: 'CONFIRMED',
  startTime: new Date('2026-08-01T10:00:00.000Z'),
  customerRescheduleCount: 1,
};

describe('customer booking management policy', () => {
  it('allows eligible cancellation and rescheduling before both deadlines', () => {
    const policy = evaluateCustomerBookingManagementPolicy({ appointment, settings, payment: { paidAmount: 0, hasOnlinePayment: false, hasDirectPayment: false }, now: new Date('2026-07-20T10:00:00.000Z') });
    assert.equal(policy.canCancel, true);
    assert.equal(policy.canReschedule, true);
    assert.equal(policy.reschedulesRemaining, 2);
  });

  it('honours each tenant enablement flag independently', () => {
    const policy = evaluateCustomerBookingManagementPolicy({ appointment, settings: { ...settings, customerCancellationEnabled: false }, payment: { paidAmount: 0, hasOnlinePayment: false, hasDirectPayment: false }, now: new Date('2026-07-20T10:00:00.000Z') });
    assert.equal(policy.canCancel, false);
    assert.equal(policy.canReschedule, true);
  });

  it('blocks late changes at the deadline instant', () => {
    const policy = evaluateCustomerBookingManagementPolicy({ appointment, settings, payment: { paidAmount: 0, hasOnlinePayment: false, hasDirectPayment: false }, now: new Date('2026-07-31T10:00:00.000Z') });
    assert.equal(policy.canCancel, false);
    assert.equal(policy.canReschedule, false);
  });

  it('calculates deadlines as UTC instants across the UK DST boundary', () => {
    const policy = evaluateCustomerBookingManagementPolicy({ appointment: { ...appointment, startTime: new Date('2026-03-29T09:00:00.000Z') }, settings, payment: { paidAmount: 0, hasOnlinePayment: false, hasDirectPayment: false }, now: new Date('2026-03-20T00:00:00.000Z') });
    assert.equal(policy.cancellationDeadline, '2026-03-28T09:00:00.000Z');
    assert.equal(policy.rescheduleDeadline, '2026-03-28T09:00:00.000Z');
  });

  it('enforces the customer reschedule limit without counting a source itself', () => {
    const policy = evaluateCustomerBookingManagementPolicy({ appointment: { ...appointment, customerRescheduleCount: 3 }, settings, payment: { paidAmount: 0, hasOnlinePayment: false, hasDirectPayment: false }, now: new Date('2026-07-20T10:00:00.000Z') });
    assert.equal(policy.canReschedule, false);
    assert.equal(policy.reschedulesRemaining, 0);
  });

  it('blocks terminal appointment states', () => {
    for (const status of ['CHECKED_IN', 'IN_SERVICE', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'BLOCKED']) {
      const policy = evaluateCustomerBookingManagementPolicy({ appointment: { ...appointment, status }, settings, payment: { paidAmount: 0, hasOnlinePayment: false, hasDirectPayment: false }, now: new Date('2026-07-20T10:00:00.000Z') });
      assert.equal(policy.canCancel, false, status);
      assert.equal(policy.canReschedule, false, status);
    }
  });

  it('uses safe payment impact states and never promises a refund', () => {
    const none = evaluateCustomerBookingManagementPolicy({ appointment, settings, payment: { paidAmount: 0, hasOnlinePayment: false, hasDirectPayment: false } });
    const direct = evaluateCustomerBookingManagementPolicy({ appointment, settings, payment: { paidAmount: 1000, hasOnlinePayment: false, hasDirectPayment: true } });
    const online = evaluateCustomerBookingManagementPolicy({ appointment, settings, payment: { paidAmount: 1000, hasOnlinePayment: true, hasDirectPayment: false } });
    assert.equal(none.paymentImpact.type, 'NONE');
    assert.equal(direct.paymentImpact.type, 'NO_AUTOMATIC_REFUND');
    assert.equal(online.paymentImpact.type, 'REFUND_REVIEW_REQUIRED');
    assert.doesNotMatch(online.paymentImpact.message, /has been refunded/i);
  });
});

describe('strict customer mutation contracts', () => {
  const idempotencyKey = '1d042977-4cab-4b37-b96b-f00c6aaf0cab';
  it('accepts the intended reschedule request', () => {
    assert.equal(CustomerRescheduleRequestSchema.safeParse({ expectedAppointmentVersion: '2', newStartTime: '2026-08-02T10:00:00.000Z', idempotencyKey }).success, true);
  });
  it('rejects tenant, client, service, location, amount and refund controls', () => {
    for (const extra of ['tenantId', 'clientId', 'serviceId', 'locationId', 'amount', 'refundAmount']) {
      assert.equal(CustomerRescheduleRequestSchema.safeParse({ expectedAppointmentVersion: '2', newStartTime: '2026-08-02T10:00:00.000Z', idempotencyKey, [extra]: 'forbidden' }).success, false, extra);
    }
  });
  it('requires idempotency and an expected version', () => {
    assert.equal(CustomerRescheduleRequestSchema.safeParse({ newStartTime: '2026-08-02T10:00:00.000Z' }).success, false);
    assert.equal(CustomerCancellationRequestSchema.safeParse({ idempotencyKey }).success, false);
  });
  it('validates cancellation reasons and rejects HTML', () => {
    assert.equal(CustomerCancellationRequestSchema.safeParse({ expectedAppointmentVersion: '2', idempotencyKey, reasonCode: 'OTHER', reasonText: '<b>private</b>' }).success, false);
    assert.equal(CustomerCancellationRequestSchema.safeParse({ expectedAppointmentVersion: '2', idempotencyKey, reasonCode: 'UNWELL', reasonText: 'details' }).success, false);
  });
  it('availability accepts only a date', () => {
    assert.equal(CustomerRescheduleAvailabilityQuerySchema.safeParse({ date: '2026-08-02' }).success, true);
    assert.equal(CustomerRescheduleAvailabilityQuerySchema.safeParse({ date: '2026-08-02', tenantId: crypto.randomUUID() }).success, false);
  });
  it('owner policy choices are bounded and strict', () => {
    assert.equal(CustomerBookingPolicySettingsSchema.safeParse(settings).success, true);
    assert.equal(CustomerBookingPolicySettingsSchema.safeParse({ ...settings, maximumCustomerReschedules: 4 }).success, false);
    assert.equal(CustomerBookingPolicySettingsSchema.safeParse({ ...settings, minimumCancellationNoticeMinutes: 90 }).success, false);
    assert.equal(CustomerBookingPolicySettingsSchema.safeParse({ ...settings, lateCancellationMessage: '<b>Late</b>' }).success, false);
    assert.equal(CustomerBookingPolicySettingsSchema.safeParse({ ...settings, depositPolicyMessage: '{{ refund }}' }).success, false);
    assert.equal(CustomerBookingPolicySettingsSchema.safeParse({ ...settings, script: 'return true' }).success, false);
  });
});

describe('guest token and lifecycle security invariants', () => {
  it('creates 256-bit base64url tokens and stores only deterministic SHA-256 hashes', () => {
    const token = createCustomerBookingManagementToken();
    assert.match(token, /^[A-Za-z0-9_-]{43,}$/);
    assert.match(hashCustomerBookingManagementToken(token), /^[0-9a-f]{64}$/);
    assert.notEqual(token, hashCustomerBookingManagementToken(token));
  });

  it('migration enables RLS, revokes browser roles and adds scoped uniqueness', () => {
    const sql = readFileSync(new URL('../../../packages/database/migrations/20260720135949_phase_10_2_customer_booking_management.sql', import.meta.url), 'utf8');
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/g);
    assert.match(sql, /REVOKE ALL ON customer_booking_management_tokens[\s\S]*FROM anon, authenticated/);
    assert.match(sql, /actor_scope_hash, appointment_id, action, idempotency_key/);
    assert.doesNotMatch(sql, /raw_token|management_url/i);
  });

  it('service preserves forms, uses canonical availability, locks the row and emits one stable event', () => {
    const source = readFileSync(new URL('../src/modules/customer-portal/customer-booking-management.service.ts', import.meta.url), 'utf8');
    const availability = readFileSync(new URL('../src/modules/availability/availability.service.ts', import.meta.url), 'utf8');
    assert.match(source, /calculateAvailability/);
    assert.match(source, /\.for\('update'\)/);
    assert.match(source, /pg_advisory_xact_lock/);
    assert.match(source, /resource:\$\{row\.resourceId\}/);
    assert.match(source, /customerRescheduleCount/);
    assert.match(source, /rescheduleFormReminders/);
    assert.match(source, /cancelPendingFormReminders/);
    assert.match(source, /stableEventId\('BOOKING_RESCHEDULED'/);
    assert.match(source, /CUSTOMER_CANCELLATION_REFUND_REVIEW/);
    assert.doesNotMatch(source, /refunds\.create|stripeClient\.refund/i);
    assert.match(availability, /excludeAppointmentId/);
    assert.match(availability, /existingBufferTime/);
    assert.match(availability, /gt\(appointments\.endTime, dayStartUtc\)/);
  });

  it('issues a one-booking management link after public booking without storing the raw URL', () => {
    const publicBooking = readFileSync(new URL('../src/routes/public/booking.ts', import.meta.url), 'utf8');
    const claimEmail = readFileSync(new URL('../src/modules/customer-portal/customer-claim-email.service.ts', import.meta.url), 'utf8');
    assert.match(publicBooking, /createGuestToken/);
    assert.match(publicBooking, /bookingManagementUrl/);
    assert.doesNotMatch(publicBooking, /management_url|raw_token/i);
    assert.match(claimEmail, /bookingManagementUrl/);
  });

  it('late payment webhooks cannot resurrect a cancelled hold', () => {
    const source = readFileSync(new URL('../src/modules/webhooks/stripe/stripe-webhook.service.ts', import.meta.url), 'utf8');
    assert.match(source, /\['SUCCEEDED', 'CANCELLED', 'EXPIRED'\]/);
    assert.match(source, /currentAppointment\.status !== 'PENDING'/);
  });
});
