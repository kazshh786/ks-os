import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AgencyBookingSystemPage } from '../AgencyBookingSystem';

const { workspace } = vi.hoisted(() => ({ workspace: {
  tenant: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'KS OS Agency',
    subdomain: 'ks-agency',
    timezone: 'Europe/London',
    currency: 'GBP',
    primaryColor: '#0f172a',
    secondaryColor: '#475569',
  },
  membershipReference: '22222222-2222-4222-8222-222222222222',
  publicBookingPath: '/book/ks-agency',
} }));

vi.mock('../AgencyAuth', () => ({ agencyFetch: vi.fn().mockResolvedValue(workspace) }));
vi.mock('../../../api/client', () => ({
  fetchWithAuth: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }),
  setDefaultAuthContextOverride: vi.fn(),
}));
vi.mock('../../bookings/BookingOperationsCalendar', () => ({ BookingOperationsCalendar: () => <div>Live agency calendar</div> }));
vi.mock('../../services/ServicesPage', () => ({ ServicesPage: () => <div>Live agency services</div> }));
vi.mock('../../team/AvailabilityPage', () => ({ default: () => <div>Live agency availability</div> }));
vi.mock('../../../components/POSCheckout', () => ({ default: () => <div>Live agency POS</div> }));

describe('AgencyBookingSystemPage', () => {
  it('opens a dedicated live agency booking workspace', async () => {
    render(<MemoryRouter><AgencyBookingSystemPage /></MemoryRouter>);
    expect(await screen.findByText('KS OS Agency Bookings')).toBeInTheDocument();
    expect(screen.getByText('Live agency calendar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open full booking workspace/i })).toHaveAttribute('href', '/app/calendar');
    expect(screen.getByRole('link', { name: /open public booking page/i })).toHaveAttribute('href', '/book/ks-agency');
  });

  it('uses the real services and availability modules', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AgencyBookingSystemPage /></MemoryRouter>);
    await screen.findByText('KS OS Agency Bookings');
    await user.click(screen.getByRole('button', { name: 'Services' }));
    expect(screen.getByText('Live agency services')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Availability' }));
    expect(screen.getByText('Live agency availability')).toBeInTheDocument();
  });

  it('embeds the dedicated public booking page', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AgencyBookingSystemPage /></MemoryRouter>);
    await screen.findByText('KS OS Agency Bookings');
    await user.click(screen.getByRole('button', { name: 'Public booking page' }));
    expect(screen.getByTitle('KS OS Agency public booking page')).toHaveAttribute('src', '/book/ks-agency');
  });
});
