import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookingWizard from '../BookingWizard';

const mockTenant = {
  id: 't1',
  subdomain: 'test',
  name: 'Test Tenant',
  paymentPolicy: 'PayLater',
  visitOptions: ['Shop'],
  depositPercentage: 0,
  timezone: 'Europe/London',
  currency: 'GBP',
};

const mockProvider = {
  getPublicCatalog: vi.fn(),
  getPublicAvailability: vi.fn(),
};

vi.mock('../../data/data-provider', () => ({
  getDataProvider: () => mockProvider,
}));

const standardCatalog = () => ({
  tenant: {
    name: 'Test Tenant',
    timezone: 'Europe/London',
    currency: 'GBP',
    colors: { primary: '#0f172a', secondary: '#475569', accent: '#4f46e5' },
  },
  page: {
    title: 'Tenant-controlled title that must not render',
    description: 'Tenant-controlled description that must not render.',
    publicSlug: 'test',
    logoUrl: null,
    coverImageUrl: 'https://example.com/cover.jpg',
    layout: 'EDITORIAL',
    theme: { primaryColor: '#0f172a', accentColor: '#4f46e5', borderRadius: 'compact' },
    paymentSettings: { mode: 'PAY_LATER', depositPercentage: 0 },
    cancellationSettings: { policyText: '' },
    bookingRules: { allowAnyStaff: true },
  },
  bookingChannels: [{ id: 'in_shop', label: 'At the business' }],
  locations: [{ id: 'location-1', name: 'Main studio', address: '1 High Street', postcode: 'SW1A 1AA', timezone: 'Europe/London', isPrimary: true }],
  services: [{ id: 'service-1', name: 'Consultation', description: 'Initial consultation', duration: 30, price: 5000, basePrice: 5000, discount: 0, requiresDeposit: false }],
  staff: [{ id: 'staff-1', name: 'Alex Owner', accountRole: 'owner', serviceIds: ['service-1'] }],
  intakeForms: [],
});

describe('Public Booking Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.getPublicAvailability.mockResolvedValue({ slots: [] });
  });

  it('shows loading state initially', () => {
    mockProvider.getPublicCatalog.mockImplementation(() => new Promise(() => {}));
    render(<BookingWizard tenant={mockTenant as any} onBookingSuccess={vi.fn()} />);
    expect(screen.getByText(/loading live availability/i)).toBeInTheDocument();
  });

  it('shows no-services state when catalogue is empty', async () => {
    mockProvider.getPublicCatalog.mockResolvedValue({ tenantName: 'Test Tenant', services: [], staff: [] });
    render(<BookingWizard tenant={mockTenant as any} onBookingSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no active services available/i)).toBeInTheDocument());
  });

  it('live failure does not enable mock mode', async () => {
    mockProvider.getPublicCatalog.mockRejectedValue(new Error('API Error'));
    render(<BookingWizard tenant={mockTenant as any} onBookingSuccess={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/error loading/i)).toBeInTheDocument();
      expect(screen.queryByText(/Mock/i)).not.toBeInTheDocument();
    });
  });

  it('uses one platform-controlled design and ignores tenant layout copy', async () => {
    mockProvider.getPublicCatalog.mockResolvedValue(standardCatalog());
    const { container } = render(<BookingWizard tenant={mockTenant as any} onBookingSuccess={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Book with Test Tenant' })).toBeInTheDocument();
    expect(screen.getByText('No account required')).toBeInTheDocument();
    expect(screen.queryByText('Tenant-controlled title that must not render')).not.toBeInTheDocument();
    expect(screen.queryByText('Tenant-controlled description that must not render.')).not.toBeInTheDocument();
    expect(container.querySelector('img[src="https://example.com/cover.jpg"]')).toBeNull();
  });

  it('hides a redundant single-location step and defaults to anyone available', async () => {
    const user = userEvent.setup();
    mockProvider.getPublicCatalog.mockResolvedValue(standardCatalog());

    render(<BookingWizard tenant={mockTenant as any} onBookingSuccess={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Consultation, 30 minutes, £50\.00/ }));

    expect(screen.queryByText('Choose a location')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anyone available/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
