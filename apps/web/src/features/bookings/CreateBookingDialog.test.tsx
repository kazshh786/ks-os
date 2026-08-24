import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateBookingDialog } from './CreateBookingDialog.js';

const createStaffBooking = vi.fn();
const listForms = vi.fn();

vi.mock('../../data/data-provider.js', () => ({
  getDataProvider: () => ({ createStaffBooking, listForms }),
}));

const services = [{
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Express manicure',
  description: '',
  price: 25,
  durationMin: 30,
  category: 'Nails',
}];

const staff = [{
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Sara',
  role: 'Therapist',
  avatarUrl: '',
  rating: 5,
  servicesHandled: [],
  schedules: [],
}];

describe('CreateBookingDialog walk-in mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T15:30:00.000Z'));
    createStaffBooking.mockReset().mockResolvedValue({ success: true });
    listForms.mockReset().mockResolvedValue([]);
    window.history.replaceState({}, '', '/app/calendar');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the dialog above calendar chrome and allows a walk-in without contact details', () => {
    render(<CreateBookingDialog
      open
      mode="walk-in"
      timezone="UTC"
      services={services}
      staff={staff}
      initialDate="2026-07-30"
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />);

    const dialog = screen.getByRole('dialog', { name: 'Add walk-in' });
    expect(dialog.parentElement).toHaveAttribute('data-calendar-dialog-layer', 'true');
    expect(dialog.parentElement).toHaveClass('z-[110]');
    expect(screen.getByLabelText(/Email/)).not.toBeRequired();
    expect(screen.getByLabelText(/Phone/)).not.toBeRequired();

    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Walk In Customer' } });
    fireEvent.change(screen.getByLabelText('Arrival date'), { target: { value: '2026-07-30' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '15:25' } });
    expect(screen.queryByText('Confirm historical booking')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check in walk-in' }));

    expect(createStaffBooking).toHaveBeenCalledTimes(1);
    expect(createStaffBooking).toHaveBeenCalledWith(expect.objectContaining({
      walkIn: true,
      notifyCustomer: false,
      startTime: '2026-07-30T15:31:00.000Z',
      client: { name: 'Walk In Customer', email: '', phone: '' },
    }));
  });

  it('continues to require contact details for a standard appointment', () => {
    render(<CreateBookingDialog
      open
      timezone="UTC"
      services={services}
      staff={staff}
      initialDate="2026-07-30"
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />);

    expect(screen.getByLabelText('Email')).toBeRequired();
    expect(screen.getByLabelText('Phone')).toBeRequired();
  });

  it('reveals a newly created appointment date and clears filters that could hide it', async () => {
    window.history.replaceState({}, '', '/app/calendar?date=2026-07-30&status=PENDING&payment=PENDING&staff=old-staff');
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(<CreateBookingDialog
      open
      timezone="UTC"
      services={services}
      staff={staff}
      initialDate="2026-08-05"
      onClose={onClose}
      onCreated={onCreated}
    />);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-08-05' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Customer Test' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'customer@example.com' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '07123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create booking' }));

    await Promise.resolve();
    await Promise.resolve();

    expect(createStaffBooking).toHaveBeenCalledTimes(1);
    const params = new URLSearchParams(window.location.search);
    expect(params.get('date')).toBe('2026-08-05');
    expect(params.has('status')).toBe(false);
    expect(params.has('payment')).toBe(false);
    expect(params.has('staff')).toBe(false);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
