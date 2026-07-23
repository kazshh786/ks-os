import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingOperationsCalendar } from './BookingOperationsCalendar';

const getBookingOperations = vi.fn();
const empty = { items: [], meta: { page: 1, limit: 250, total: 0, hasMore: false }, summary: { total: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, awaitingPayment: 0, incompleteForms: 0, requiresAttention: 0 } };
vi.mock('../../data/data-provider', () => ({ getDataProvider: () => ({ getBookingOperations, getServices: vi.fn().mockResolvedValue([]), getStaff: vi.fn().mockResolvedValue([]) }) }));
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace: () => ({ activeTenant: { id: 'business-1', name: 'Studio', timezone: 'Europe/London' } }) }));
vi.mock('./BookingScheduleView', () => ({ BookingScheduleView: ({ bookings }: { bookings: unknown[] }) => <div role="region" aria-label="Booking schedule">{bookings.length} bookings shown</div> }));
vi.mock('./CreateBookingDialog', () => ({ CreateBookingDialog: () => null }));
vi.mock('./BookingQuickView', () => ({ BookingQuickView: () => null }));

describe('BookingOperationsCalendar resilience', () => {
  beforeEach(() => { sessionStorage.clear(); getBookingOperations.mockReset(); });

  it('renders the calendar when there are no bookings', async () => {
    getBookingOperations.mockResolvedValue(empty);
    render(<MemoryRouter><BookingOperationsCalendar /></MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'Booking schedule' })).toHaveTextContent('0 bookings shown');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps an empty calendar visible when the booking request fails', async () => {
    getBookingOperations.mockRejectedValue(new Error('Could not fetch bookings'));
    render(<MemoryRouter><BookingOperationsCalendar /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('The calendar remains available with an empty schedule');
    expect(screen.getByRole('region', { name: 'Booking schedule' })).toHaveTextContent('0 bookings shown');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
