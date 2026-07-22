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
};

vi.mock('../../data/data-provider', () => ({
  getDataProvider: () => mockProvider,
}));

describe('Public Booking Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
