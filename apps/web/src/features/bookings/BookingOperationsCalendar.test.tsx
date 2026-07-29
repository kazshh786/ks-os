import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingOperationsCalendar } from './BookingOperationsCalendar';

const getBookingOperations = vi.fn();
const empty = { items: [], meta: { page: 1, limit: 250, total: 0, hasMore: false }, summary: { total: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, awaitingPayment: 0, incompleteForms: 0, requiresAttention: 0 } };
vi.mock('../../data/data-provider', () => ({ getDataProvider: () => ({ getBookingOperations, getServices: vi.fn().mockResolvedValue([]), getStaff: vi.fn().mockResolvedValue([]) }) }));
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace: () => ({ activeTenant: { id: 'business-1', name: 'Studio', timezone: 'Europe/London' } }) }));
vi.mock('./BookingScheduleView', () => ({ BookingScheduleView: ({ bookings }: { bookings: unknown[] }) => <div role="region" aria-label="Booking schedule">{bookings.length} bookings shown</div> }));
vi.mock('./CreateBookingDialog', () => ({ CreateBookingDialog: () => null }));
vi.mock('./BlockTimeDialog', () => ({ BlockTimeDialog: () => null }));
vi.mock('./BookingQuickView', () => ({ BookingQuickView: () => null }));

describe('BookingOperationsCalendar resilience', () => {
  beforeEach(() => { sessionStorage.clear(); getBookingOperations.mockReset(); });

  it('renders a focused calendar workspace with search, filters, views and anchored footer stats', async () => {
    getBookingOperations.mockResolvedValue(empty);
    render(<MemoryRouter><BookingOperationsCalendar /></MemoryRouter>);

    expect(await screen.findByRole('region', { name: 'Booking schedule' })).toHaveTextContent('0 bookings shown');
    expect(screen.getByRole('textbox', { name: 'Search bookings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Booking filters' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('region', { name: 'Booking filters' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by intake status' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change calendar view' }));
    expect(screen.getByRole('group', { name: 'Calendar date views' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'false');

    const summary = screen.getByRole('region', { name: 'Calendar summary' });
    expect(summary).toBeInTheDocument();
    expect(summary.closest('footer')).toHaveAttribute('data-anchored', 'viewport-bottom');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers appointment, walk-in and block time from one new booking chooser', async () => {
    getBookingOperations.mockResolvedValue(empty);
    render(<MemoryRouter><BookingOperationsCalendar /></MemoryRouter>);

    await screen.findByRole('region', { name: 'Booking schedule' });
    fireEvent.click(screen.getByRole('button', { name: 'New booking' }));

    expect(screen.getByRole('dialog', { name: 'Add to calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Appointment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Walk-in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Block time/i })).toBeInTheDocument();
  });

  it('keeps an empty calendar visible when the booking request fails', async () => {
    getBookingOperations.mockRejectedValue(new Error('Could not fetch bookings'));
    render(<MemoryRouter><BookingOperationsCalendar /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('The calendar remains available with an empty schedule');
    expect(screen.getByRole('region', { name: 'Booking schedule' })).toHaveTextContent('0 bookings shown');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
