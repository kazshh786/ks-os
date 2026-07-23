import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { CustomerBookingPolicyActions, CustomerCancellationPage, CustomerReschedulePage } from './CustomerBookingManagement.js';
import { customerPortalProvider } from './customer-portal-provider.js';

const policy = {
  canCancel: true,
  canReschedule: true,
  cancellationDeadline: '2026-08-01T10:00:00.000Z',
  rescheduleDeadline: '2026-08-01T10:00:00.000Z',
  reschedulesUsed: 0,
  reschedulesRemaining: 3,
  requireCancellationReason: false,
  paymentImpact: { type: 'NONE' as const, message: 'No online payment was recorded for this booking.' },
  blockedReasons: [],
  cancellationPolicyMessage: 'Please contact the salon.',
  depositPolicyMessage: 'No automatic refund.',
};
const reference = '1d042977-4cab-4b37-b96b-f00c6aaf0cab';
const appointment = {
  bookingReference: reference,
  appointmentVersion: '4',
  timezone: 'Europe/London',
  startTime: '2026-08-10T09:00:00.000Z',
  endTime: '2026-08-10T10:00:00.000Z',
  serviceName: 'Cut and finish',
  staffName: 'Alex',
  location: 'Main salon',
  payment: { status: 'No payment due' },
  salon: { displayName: 'Fiction Salon', contactPhone: '+442079460000' },
};
const slot = {
  startTime: '2026-08-11T10:00:00.000Z',
  endTime: '2026-08-11T11:00:00.000Z',
  staffReference: 'e5b8183d-c58a-45c1-ab87-bb85283cba8f',
  staffName: 'Alex',
  isCurrentStaff: true,
};

function renderCustomerRoute(path: string, element: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path={path.includes('/cancel') ? '/customer/appointments/:bookingReference/cancel' : '/customer/appointments/:bookingReference/reschedule'} element={element} /></Routes></MemoryRouter>);
}

afterEach(() => vi.restoreAllMocks());

describe('CustomerBookingPolicyActions', () => {
  it('shows explicit cancellation and rescheduling actions when allowed', async () => {
    vi.spyOn(customerPortalProvider, 'getManagementPolicy').mockResolvedValue(policy);
    render(<BrowserRouter><CustomerBookingPolicyActions bookingReference={reference} appointment={appointment} /></BrowserRouter>);
    expect(await screen.findByRole('link', { name: 'Reschedule booking' })).toHaveAttribute('href', `/customer/appointments/${reference}/reschedule`);
    expect(screen.getByRole('link', { name: 'Cancel booking' })).toHaveAttribute('href', `/customer/appointments/${reference}/cancel`);
    expect(screen.getByText('No automatic refund.')).toBeInTheDocument();
  });

  it('hides mutation actions and explains a blocked policy', async () => {
    vi.spyOn(customerPortalProvider, 'getManagementPolicy').mockResolvedValue({ ...policy, canCancel: false, canReschedule: false, blockedReasons: ['Online changes are no longer available. Please contact the salon.'] });
    render(<BrowserRouter><CustomerBookingPolicyActions bookingReference={reference} appointment={appointment} /></BrowserRouter>);
    expect(await screen.findByText('Online changes are no longer available. Please contact the salon.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reschedule booking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cancel booking' })).not.toBeInTheDocument();
  });
});

describe('customer booking mutation flows', () => {
  it('loads canonical availability and shows a reschedule review before mutation', async () => {
    const user = userEvent.setup();
    vi.spyOn(customerPortalProvider, 'getAppointment').mockResolvedValue(appointment);
    vi.spyOn(customerPortalProvider, 'getManagementPolicy').mockResolvedValue(policy);
    vi.spyOn(customerPortalProvider, 'getRescheduleAvailability').mockResolvedValue({ date: '2026-08-10', timezone: appointment.timezone, slots: [slot] });
    vi.spyOn(customerPortalProvider, 'reschedule').mockResolvedValue({ appointment: { ...appointment, startTime: slot.startTime }, previousStartTime: appointment.startTime, policy } as never);
    renderCustomerRoute(`/customer/appointments/${reference}/reschedule`, <CustomerReschedulePage />);
    await user.click(await screen.findByRole('button', { name: /Alex/ }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: 'Review new time' }));
    expect(screen.getByRole('heading', { name: 'Review your change' })).toBeInTheDocument();
    expect(screen.getByText('Proposed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm reschedule' }));
    expect(await screen.findByText('Booking rescheduled.')).toBeInTheDocument();
  });

  it('shows the no-availability state without substituting mock slots', async () => {
    vi.spyOn(customerPortalProvider, 'getAppointment').mockResolvedValue(appointment);
    vi.spyOn(customerPortalProvider, 'getManagementPolicy').mockResolvedValue(policy);
    vi.spyOn(customerPortalProvider, 'getRescheduleAvailability').mockResolvedValue({ date: '2026-08-10', timezone: appointment.timezone, slots: [] });
    renderCustomerRoute(`/customer/appointments/${reference}/reschedule`, <CustomerReschedulePage />);
    expect(await screen.findByText(/No available times were found/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /current/ })).not.toBeInTheDocument();
  });

  it('refreshes a stale reschedule and explains the state change', async () => {
    const user = userEvent.setup();
    vi.spyOn(customerPortalProvider, 'getAppointment').mockResolvedValue(appointment);
    vi.spyOn(customerPortalProvider, 'getManagementPolicy').mockResolvedValue(policy);
    vi.spyOn(customerPortalProvider, 'getRescheduleAvailability').mockResolvedValue({ date: '2026-08-10', timezone: appointment.timezone, slots: [slot] });
    vi.spyOn(customerPortalProvider, 'reschedule').mockRejectedValue(new Error('CUSTOMER_BOOKING_STATE_CHANGED'));
    renderCustomerRoute(`/customer/appointments/${reference}/reschedule`, <CustomerReschedulePage />);
    await user.click(await screen.findByRole('button', { name: /Alex/ }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: 'Review new time' }));
    await user.click(screen.getByRole('button', { name: 'Confirm reschedule' }));
    expect(await screen.findByText(/booking changed while you were viewing it/i)).toBeInTheDocument();
    await waitFor(() => expect(customerPortalProvider.getAppointment).toHaveBeenCalledTimes(2));
  });

  it('requires explicit cancellation confirmation and reports success', async () => {
    const user = userEvent.setup();
    vi.spyOn(customerPortalProvider, 'getAppointment').mockResolvedValue(appointment);
    vi.spyOn(customerPortalProvider, 'getManagementPolicy').mockResolvedValue(policy);
    const cancel = vi.spyOn(customerPortalProvider, 'cancel').mockResolvedValue({
      appointment: { ...appointment, status: 'Cancelled' },
      cancelledAt: '2026-07-20T12:00:00.000Z',
      paymentImpact: policy.paymentImpact,
    } as never);
    renderCustomerRoute(`/customer/appointments/${reference}/cancel`, <CustomerCancellationPage />);
    const confirmButton = await screen.findByRole('button', { name: 'Confirm cancellation' });
    expect(confirmButton).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(confirmButton);
    expect(await screen.findByText('Booking cancelled.')).toBeInTheDocument();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
