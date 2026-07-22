import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ClientCRM from '../ClientCRM';
import * as clientApi from '../../api/client';

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

vi.mock('../../api/client', () => ({
  getClients: vi.fn(),
  getClientProfile: vi.fn(),
}));

describe('ClientCRM Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const renderComponent = (initialEntry = '/app/clients') => {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/app/clients" element={<ClientCRM tenant={mockTenant as any} />} />
          <Route path="/app/clients/:clientId" element={<ClientCRM tenant={mockTenant as any} />} />
          <Route path="/app/calendar" element={<div>Calendar Route Mock</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  describe('Directory functionality', () => {
    it('shows loading state initially while fetching directory', () => {
      // Return a pending promise so loading state stays active
      (clientApi.getClients as any).mockImplementation(() => new Promise(() => {}));

      renderComponent();
      
      // Loading spinner should be rendered in the directory
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('shows empty state when no clients are found', async () => {
      (clientApi.getClients as any).mockResolvedValue({
        data: [],
        meta: { page: 1, totalPages: 1 }
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/No clients found matching/i)).toBeInTheDocument();
      });
    });

    it('displays API error state for directory failure without falling back to mock data', async () => {
      (clientApi.getClients as any).mockRejectedValue(new Error('API Directory Error'));

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('API Directory Error')).toBeInTheDocument();
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });
    });

    it('debounces search input and triggers new fetch', async () => {
      (clientApi.getClients as any).mockResolvedValue({
        data: [],
        meta: { page: 1, totalPages: 1 }
      });

      renderComponent();

      await waitFor(() => {
        expect(clientApi.getClients).toHaveBeenCalledTimes(1); // initial load
      });

      const searchInput = screen.getByPlaceholderText(/Search name, phone, or email.../i);
      await userEvent.type(searchInput, 'John');

      // Fast-forward timers to trigger debounce (350ms)
      act(() => {
        vi.advanceTimersByTime(400);
      });

      await waitFor(() => {
        // Called again after debounce
        expect(clientApi.getClients).toHaveBeenCalledTimes(2);
        expect((clientApi.getClients as any).mock.calls[1][0].search).toBe('John');
      });
    });
  });

  describe('Profile functionality', () => {
    it('shows placeholder when no client is selected', async () => {
      (clientApi.getClients as any).mockResolvedValue({ data: [], meta: { page: 1, totalPages: 1 } });
      
      renderComponent('/app/clients');
      
      await waitFor(() => {
        expect(screen.getByText('No client selected')).toBeInTheDocument();
      });
    });

    it('loads and displays client profile successfully', async () => {
      (clientApi.getClients as any).mockResolvedValue({ data: [], meta: { page: 1, totalPages: 1 } });
      
      (clientApi.getClientProfile as any).mockResolvedValue({
        data: {
          profile: {
            id: 'c1',
            name: 'Jane Smith',
            phone: '555-1234',
            createdAt: '2025-01-01T00:00:00.000Z'
          },
          bookingHistory: []
        }
      });

      renderComponent('/app/clients/c1');
      
      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('555-1234')).toBeInTheDocument();
      });
    });

    it('shows API error (404 state) when client profile fetch fails', async () => {
      (clientApi.getClients as any).mockResolvedValue({ data: [], meta: { page: 1, totalPages: 1 } });
      
      (clientApi.getClientProfile as any).mockRejectedValue(new Error('Client not found'));

      renderComponent('/app/clients/c1');
      
      await waitFor(() => {
        expect(screen.getByText('Unable to load profile')).toBeInTheDocument();
        expect(screen.getByText('Client not found')).toBeInTheDocument();
        expect(screen.getByText('Return to Directory')).toBeInTheDocument();
      });
    });

    it('renders calendar link that navigates correctly for upcoming bookings', async () => {
      (clientApi.getClients as any).mockResolvedValue({ data: [], meta: { page: 1, totalPages: 1 } });
      
      // Setup upcoming booking date (tomorrow)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      (clientApi.getClientProfile as any).mockResolvedValue({
        data: {
          profile: {
            id: 'c1',
            name: 'Jane Smith',
            createdAt: '2025-01-01T00:00:00.000Z'
          },
          bookingHistory: [
            {
              id: 'b1',
              startTime: tomorrow.toISOString(),
              serviceName: 'Haircut',
              staffName: 'Sam',
              status: 'CONFIRMED'
            }
          ]
        }
      });

      renderComponent('/app/clients/c1');
      
      await waitFor(() => {
        expect(screen.getByText('Upcoming Bookings')).toBeInTheDocument();
      });

      const calendarLink = screen.getByText(/View in Calendar/i);
      expect(calendarLink).toBeInTheDocument();
      expect(calendarLink.getAttribute('href')).toBe(`/app/calendar?date=${tomorrow.toISOString().split('T')[0]}`);
      
      // Click the link
      await userEvent.click(calendarLink);
      
      // Verify routing happened
      expect(screen.getByText('Calendar Route Mock')).toBeInTheDocument();
    });
  });
});
