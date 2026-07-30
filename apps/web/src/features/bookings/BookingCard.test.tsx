import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BookingOperationsItem } from '@ks-os/contracts';
import { BookingCard } from './BookingCard.js';

const booking: BookingOperationsItem = {
  id: '11111111-1111-4111-8111-111111111111',
  reference: 'ABC-123',
  startTime: '2026-07-30T09:00:00.000Z',
  endTime: '2026-07-30T09:30:00.000Z',
  timezone: 'Europe/London',
  status: 'CONFIRMED',
  customer: { id: '22222222-2222-4222-8222-222222222222', name: 'Aisha Khan', email: 'aisha@example.com', phone: '07123456789' },
  service: { id: '33333333-3333-4333-8333-333333333333', name: 'Gel manicure', durationMinutes: 30 },
  staff: { id: '44444444-4444-4444-8444-444444444444', name: 'Sara' },
  location: { id: null, name: null },
  bookingChannel: 'in_shop',
  paymentStatus: 'NOT_REQUIRED',
  quotedAmount: 3500,
  intakeStatus: 'NOT_REQUIRED',
  source: 'PUBLIC_BOOKING_PAGE',
  notes: null,
  customerNotes: null,
  attentionReasons: [],
  createdAt: '2026-07-20T10:00:00.000Z',
};

describe('BookingCard', () => {
  for (const density of ['compact', 'comfortable', 'detailed'] as const) {
    it(`keeps a 30 minute customer and service on one line in ${density} density`, () => {
      render(<BookingCard booking={booking} density={density} timeGrid onOpen={vi.fn()} />);
      const card = screen.getByRole('button');
      expect(card).toHaveAttribute('data-booking-card-layout', 'single-line');
      expect(card).toHaveTextContent('Aisha Khan');
      expect(card).toHaveTextContent('Gel manicure');
      expect(card).toHaveAccessibleName(/Aisha Khan, Gel manicure/i);
    });
  }

  it('returns to the stacked layout when the appointment has enough height', () => {
    render(<BookingCard booking={{ ...booking, endTime: '2026-07-30T10:00:00.000Z' }} density="comfortable" timeGrid onOpen={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-booking-card-layout', 'stacked');
  });
});
