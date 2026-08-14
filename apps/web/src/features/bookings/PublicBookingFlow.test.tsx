import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicBookingFlow } from './PublicBookingFlow';

const provider = vi.hoisted(() => ({
  getPublicCatalog: vi.fn(),
  getPublicAvailability: vi.fn(),
  createBookingHold: vi.fn(),
  releaseBookingHold: vi.fn(),
  createPublicBooking: vi.fn(),
  recordPublicBookingEvent: vi.fn(),
}));

vi.mock('../../data/data-provider.js', () => ({
  getDataProvider: () => provider,
}));

const serviceId = '11111111-1111-4111-8111-111111111111';
const staffId = '22222222-2222-4222-8222-222222222222';
const locationId = '33333333-3333-4333-8333-333333333333';
const holdId = '44444444-4444-4444-8444-444444444444';

describe('PublicBookingFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const start = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    start.setUTCHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1_000);

    provider.getPublicCatalog.mockResolvedValue({
      tenant: {
        name: 'Test Studio',
        timezone: 'Europe/London',
        currency: 'GBP',
        colors: { primary: '#0f172a', secondary: '#475569', accent: '#4f46e5' },
      },
      page: {
        title: 'Book Test Studio',
        description: 'Choose an appointment.',
        publicSlug: 'test-studio',
        logoUrl: null,
        coverImageUrl: null,
        theme: { primaryColor: '#0f172a' },
        paymentSettings: { mode: 'PAY_LATER', depositPercentage: 0 },
        cancellationSettings: { policyText: 'Cancel at least 24 hours before your appointment.' },
        bookingRules: { allowAnyStaff: true },
      },
      bookingChannels: [{ id: 'in_shop', label: 'At the studio' }],
      locations: [{ id: locationId, name: 'Main studio', address: '1 High Street', postcode: 'SW1A 1AA', timezone: 'Europe/London', isPrimary: true }],
      services: [{ id: serviceId, name: 'Consultation', description: 'Initial consultation', duration: 30, price: 5000, requiresDeposit: false }],
      staff: [{ id: staffId, name: 'Alex Owner', accountRole: 'owner', serviceIds: [serviceId] }],
      intakeForms: [],
    });
    provider.getPublicAvailability.mockResolvedValue({
      slots: [{ start: start.toISOString(), end: end.toISOString(), staffId, staffName: 'Alex Owner', price: 5000, duration: 30 }],
    });
    provider.createBookingHold.mockResolvedValue({
      id: holdId,
      token: 'hold-token-that-is-long-enough-for-the-contract',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
      remainingSeconds: 600,
    });
    provider.releaseBookingHold.mockResolvedValue(undefined);
    provider.recordPublicBookingEvent.mockResolvedValue(undefined);
    provider.createPublicBooking.mockResolvedValue({
      booking: {
        reference: 'KS-2026-VERY-LONG-REFERENCE-1234567890',
        status: 'CONFIRMED',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        bookingChannel: 'in_shop',
        serviceName: 'Consultation',
        staffName: 'Alex Owner',
      },
      payment: { required: false, amount: 0, currency: 'GBP', status: 'NOT_REQUIRED' },
    });
  });

  it('completes the public mobile booking journey and renders a resilient confirmation', async () => {
    const user = userEvent.setup();
    render(<PublicBookingFlow slug="test-studio" />);

    await user.click(await screen.findByRole('button', { name: /Consultation/ }));
    await user.click(screen.getByRole('button', { name: /Choose a time/ }));
    await user.click(await screen.findByRole('button', { name: /Alex Owner/ }));

    await user.type(screen.getByLabelText('Full name'), 'A Customer With A Long Name');
    await user.type(screen.getByLabelText('Email'), 'customer.with.a.long.address@example.com');
    await user.type(screen.getByLabelText('Phone'), '07123456789');
    await user.click(screen.getByRole('button', { name: /Review booking/ }));

    expect(screen.getByRole('heading', { name: 'Review and confirm' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Confirm booking/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Confirm booking/ }));

    expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeInTheDocument();
    expect(screen.getByText('KS-2026-VERY-LONG-REFERENCE-1234567890')).toBeInTheDocument();
    expect(provider.createPublicBooking).toHaveBeenCalledTimes(1);
  });
});
