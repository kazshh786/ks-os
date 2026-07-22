import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BookingOperationsQuerySchema,
  CreateBookingRequestSchema,
  PublicBookingAnalyticsEventSchema,
} from '@ks-os/contracts';
import {
  deterministicPublicToken,
  hashPublicToken,
  normaliseBookingSlug,
  safeReferrerHost,
} from '../src/modules/bookings/booking-page.utils.js';
import { attentionReasonsFor } from '../src/modules/bookings/booking.service.js';

const migration = readFileSync(new URL('../../../packages/database/migrations/20260723020000_booking_operations_platform.sql', import.meta.url), 'utf8');

describe('Booking operations foundations', () => {
  it('normalises public slugs and protects reserved routes', () => {
    assert.equal(normaliseBookingSlug('Café & Spa'), 'cafe-spa');
    assert.equal(normaliseBookingSlug('Admin'), 'book-admin');
    assert.equal(normaliseBookingSlug('!'), 'business');
  });

  it('creates deterministic, scoped hold tokens and one-way hashes', () => {
    const first = deterministicPublicToken('hold', 'same-id', 'test-secret');
    const repeated = deterministicPublicToken('hold', 'same-id', 'test-secret');
    const otherScope = deterministicPublicToken('domain', 'same-id', 'test-secret');
    assert.equal(first, repeated);
    assert.notEqual(first, otherScope);
    assert.equal(hashPublicToken(first, 'test-secret').length, 64);
  });

  it('stores only a safe referrer hostname', () => {
    assert.equal(safeReferrerHost('https://Campaign.Example/path?q=customer@example.com'), 'campaign.example');
    assert.equal(safeReferrerHost('not a url'), null);
  });

  it('rejects unbounded calendar queries', () => {
    const result = BookingOperationsQuerySchema.safeParse({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-05-01T00:00:00.000Z',
    });
    assert.equal(result.success, false);
  });

  it('rejects PII fields from public analytics events', () => {
    const result = PublicBookingAnalyticsEventSchema.safeParse({
      event: 'BOOKING_STARTED',
      sessionId: '11111111-1111-4111-8111-111111111111',
      email: 'customer@example.com',
    });
    assert.equal(result.success, false);
  });

  it('requires an address for mobile appointments', () => {
    const result = CreateBookingRequestSchema.safeParse({
      serviceId: '11111111-1111-4111-8111-111111111111',
      staffId: '22222222-2222-4222-8222-222222222222',
      startTime: '2026-10-10T09:00:00.000Z',
      client: { name: 'Jane Doe', email: 'jane@example.com', phone: '+441234567890' },
      bookingChannel: 'mobile',
      paymentMode: 'pay_later',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0]?.path[0], 'mobileAddress');
  });

  it('deduplicates actionable attention reasons', () => {
    const reasons = attentionReasonsFor({
      status: 'PENDING',
      paymentStatus: 'FAILED',
      intakeStatus: 'OVERDUE',
      attentionReason: 'Payment failed',
      endTime: new Date('2026-01-01T09:00:00.000Z'),
    }, new Date('2026-01-02T09:00:00.000Z'));
    assert.deepEqual(reasons, [
      'Booking is awaiting confirmation',
      'Payment failed',
      'Intake form is overdue',
      'Booking is overdue',
    ]);
  });

  it('protects booking operations tables and calendar access paths in the migration', () => {
    for (const table of ['booking_pages', 'booking_holds', 'booking_analytics_events', 'booking_audit_events']) {
      assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'i'));
    }
    assert.match(migration, /REVOKE ALL ON[\s\S]+FROM anon, authenticated/i);
    assert.match(migration, /appointments_staff_start_idx/i);
    assert.match(migration, /booking_holds_availability_idx/i);
    assert.match(migration, /appointments_tenant_idempotency_unique/i);
  });
});
