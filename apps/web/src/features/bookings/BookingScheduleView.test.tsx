import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BookingOperationsItem } from '@ks-os/contracts';
import { BookingScheduleView } from './BookingScheduleView.js';

const booking: BookingOperationsItem = {
  id: '11111111-1111-4111-8111-111111111111',
  reference: 'BK-1001',
  startTime: '2026-07-29T09:00:00.000Z',
  endTime: '2026-07-29T10:00:00.000Z',
  timezone: 'UTC',
  status: 'CONFIRMED',
  customer: { id: '22222222-2222-4222-8222-222222222222', name: 'Alice Jones', email: 'alice@example.com', phone: '07000000000' },
  service: { id: '33333333-3333-4333-8333-333333333333', name: 'Consultation', durationMinutes: 60 },
  staff: { id: '44444444-4444-4444-8444-444444444444', name: 'Sam' },
  location: { id: '55555555-5555-4555-8555-555555555555', name: 'Studio' },
  bookingChannel: 'in_shop',
  paymentStatus: 'NOT_REQUIRED',
  quotedAmount: 0,
  intakeStatus: 'NOT_REQUIRED',
  source: 'STAFF_CREATED',
  notes: null,
  customerNotes: null,
  attentionReasons: [],
  createdAt: '2026-07-20T09:00:00.000Z',
};

const days = [
  { id: '2026-07-29', label: 'Wed 29', subtitle: 'July' },
  { id: '2026-07-30', label: 'Thu 30', subtitle: 'July' },
];

function dataTransfer() {
  return { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn(), getData: vi.fn() };
}

function setGridBounds(element: HTMLElement) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: 0, left: 0, right: 200, bottom: 1296, width: 200, height: 1296, x: 0, y: 0, toJSON: () => ({}) }),
  });
}

function dispatchDrag(element: HTMLElement, type: 'dragover' | 'drop', clientY: number, transfer: ReturnType<typeof dataTransfer>) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  fireEvent(element, event);
}

function overlapBooking({ id, customerId, name, startTime, endTime }: { id: string; customerId: string; name: string; startTime: string; endTime: string }): BookingOperationsItem {
  return {
    ...booking,
    id,
    reference: `BK-${id.slice(0, 4)}`,
    startTime,
    endTime,
    customer: { ...booking.customer, id: customerId, name },
  };
}

describe('BookingScheduleView time grid', () => {
  it('shows a full-day grid, core hours and the selected day', () => {
    render(<BookingScheduleView
      columns={days}
      days={days}
      bookings={[booking]}
      groupBy="day"
      density="comfortable"
      timezone="UTC"
      selectedDay="2026-07-30"
      onSelectDay={vi.fn()}
      onOpen={vi.fn()}
      onCreate={vi.fn()}
      onReschedule={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Booking schedule' })).toBeInTheDocument();
    expect(screen.getByLabelText('Calendar times')).toHaveTextContent('00:00');
    expect(screen.getByLabelText('Calendar times')).toHaveTextContent('07:00');
    expect(screen.getByLabelText('Calendar times')).toHaveTextContent('20:00');
    expect(screen.getByRole('button', { name: /Thu 30/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Selected day focused availability hours')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /09:00.*Alice Jones.*Consultation/i })).toBeInTheDocument();
  });

  it('snaps a day drop to an exact 15-minute time', () => {
    const onReschedule = vi.fn();
    render(<BookingScheduleView
      columns={days}
      days={days}
      bookings={[booking]}
      groupBy="day"
      density="comfortable"
      timezone="UTC"
      selectedDay="2026-07-30"
      onSelectDay={vi.fn()}
      onOpen={vi.fn()}
      onCreate={vi.fn()}
      onReschedule={onReschedule}
    />);

    const card = screen.getByRole('button', { name: /09:00.*Alice Jones.*Consultation/i });
    const target = screen.getByRole('gridcell', { name: 'Thu 30 time grid' });
    setGridBounds(target);
    const transfer = dataTransfer();

    fireEvent.dragStart(card, { dataTransfer: transfer });
    dispatchDrag(target, 'dragover', 567, transfer);
    expect(screen.getByText('Move to 10:30')).toBeInTheDocument();
    dispatchDrag(target, 'drop', 567, transfer);

    expect(onReschedule).toHaveBeenCalledWith(booking, expect.objectContaining({
      id: '2026-07-30',
      day: '2026-07-30',
      time: '10:30',
      label: 'Thu 30',
    }));
  });

  it('uses one consistent lane count for a staggered overlap cluster', () => {
    const second = overlapBooking({
      id: '66666666-6666-4666-8666-666666666666',
      customerId: '77777777-7777-4777-8777-777777777777',
      name: 'Bilal Khan',
      startTime: '2026-07-29T09:30:00.000Z',
      endTime: '2026-07-29T10:30:00.000Z',
    });
    const third = overlapBooking({
      id: '88888888-8888-4888-8888-888888888888',
      customerId: '99999999-9999-4999-8999-999999999999',
      name: 'Chloe Smith',
      startTime: '2026-07-29T10:00:00.000Z',
      endTime: '2026-07-29T11:00:00.000Z',
    });

    render(<BookingScheduleView
      columns={days}
      days={days}
      bookings={[booking, second, third]}
      groupBy="day"
      density="comfortable"
      timezone="UTC"
      selectedDay="2026-07-29"
      onSelectDay={vi.fn()}
      onOpen={vi.fn()}
      onCreate={vi.fn()}
      onReschedule={vi.fn()}
    />);

    const wrappers = [
      screen.getByRole('button', { name: /Alice Jones/i }).parentElement,
      screen.getByRole('button', { name: /Bilal Khan/i }).parentElement,
      screen.getByRole('button', { name: /Chloe Smith/i }).parentElement,
    ];

    expect(wrappers.every(wrapper => wrapper?.style.width === 'calc(50% - 6px)')).toBe(true);
    expect(new Set(wrappers.map(wrapper => wrapper?.style.left)).size).toBe(2);
  });

  it('combines days and team members into resource columns', () => {
    render(<BookingScheduleView
      columns={[{ id: booking.staff.id, label: 'Sam', subtitle: 'Therapist' }]}
      days={days}
      bookings={[booking]}
      groupBy="staff"
      density="comfortable"
      timezone="UTC"
      selectedDay="2026-07-29"
      onSelectDay={vi.fn()}
      onOpen={vi.fn()}
      onCreate={vi.fn()}
      onReschedule={vi.fn()}
    />);

    expect(screen.getByRole('gridcell', { name: 'Wed 29 · Sam time grid' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'Thu 30 · Sam time grid' })).toBeInTheDocument();
  });
});
