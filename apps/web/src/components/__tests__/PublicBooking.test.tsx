import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import BookingWizard from '../BookingWizard';
import { DataProvider } from '../../data/data-provider';

// Mock tenant
const mockTenant = {
  id: 't1',
  subdomain: 'test',
  name: 'Test Tenant',
  paymentPolicy: 'PayLater',
  visitOptions: ['Shop'],
  depositPercentage: 0,
  timezone: 'Europe/London',
  currency: 'GBP'
};

// Mock the data provider
const mockProvider = {
  getPublicCatalog: vi.fn(),
  getPublicAvailability: vi.fn(),
};

vi.mock('../../data/data-provider', () => ({
  getDataProvider: () => mockProvider,
}));

describe('Public Booking Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.getPublicAvailability.mockResolvedValue({ slots: [] });
  });

  it('shows loading state initially', () => {
    mockProvider.getPublicCatalog.mockImplementation(() => new Promise(() => {}));

    render(<BookingWizard tenant={mockTenant as any} onBookingSuccess={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows no-services state when catalogue is empty', async () => {
    mockProvider.getPublicCatalog.mockImplementation(async () => ({
      tenantName: 'Test Tenant',
      services: [],
      staff: [],
    }));

    render(<BookingWizard tenant={mockTenant as any} onBookingSuccess={vi.fn()} />);
    
    await waitFor(() => {
      expect(screen.getByText(/no active services available/i)).toBeInTheDocument();
    });
  });

  it('live failure does not enable mock mode', async () => {
    mockProvider.getPublicCatalog.mockImplementation(async () => {
      throw new Error('API Error');
    });

    render(<BookingWizard tenant={mockTenant as any} onBookingSuccess={vi.fn()} />);
    
    await waitFor(() => {
      expect(screen.getByText(/error loading/i)).toBeInTheDocument();
      expect(screen.queryByText(/Mock/i)).not.toBeInTheDocument();
    });
  });

  it('hides a redundant single-location step and defaults to anyone available', async () => {
    const user = userEvent.setup();
    mockProvider.getPublicCatalog.mockResolvedValue({
      tenant: {
        name: 'Test Tenant',
        timezone: 'Europe/London',
        currency: 'GBP',
        colors: { primary: '#0f172a', secondary: '#475569', accent: '#4f46e5' },
      },
      page: {
        title: 'Book Test Tenant',
        description: 'Choose an appointment.',
        publicSlug: 'test',
        logoUrl: null,
        coverImageUrl: null,
        theme: { primaryColor: '#0f172a' },
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

    render(<BookingWizard tenant={mockTenant as any} onBookingSuccess={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Consultation/ }));

    expect(screen.queryByText('Choose a location')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anyone available/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
