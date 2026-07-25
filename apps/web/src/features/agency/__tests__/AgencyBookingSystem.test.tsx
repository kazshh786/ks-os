import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AgencyBookingSystemPage } from '../AgencyBookingSystem';

describe('AgencyBookingSystem Workstation', () => {
  it('renders complete agency booking workstation tabs and dispatch schedule', () => {
    render(
      <MemoryRouter>
        <AgencyBookingSystemPage />
      </MemoryRouter>
    );

    expect(screen.getByText('KS OS Agency Booking Workstation')).toBeInTheDocument();
    expect(screen.getByText('Calendar & Dispatch Workstation')).toBeInTheDocument();
    expect(screen.getByText('Agency Service Catalog')).toBeInTheDocument();
    expect(screen.getByText('Agency Hosts & Schedules')).toBeInTheDocument();
    expect(screen.getByText('POS & Financial Checkout')).toBeInTheDocument();
    expect(screen.getByText('AGY-10928')).toBeInTheDocument();
    expect(screen.getByText('Salon A Owner')).toBeInTheDocument();
  });

  it('allows switching to Agency Service Catalog tab', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AgencyBookingSystemPage />
      </MemoryRouter>
    );

    const serviceTab = screen.getByRole('button', { name: /Agency Service Catalog/i });
    await user.click(serviceTab);

    expect(screen.getByText('Agency Service Catalog & Offers')).toBeInTheDocument();
    expect(screen.getByText('Platform Demo & Product Tour')).toBeInTheDocument();
  });

  it('allows switching to Live Public Agency Booking Engine tab', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AgencyBookingSystemPage />
      </MemoryRouter>
    );

    const publicTab = screen.getByRole('button', { name: /Live Public Agency Booking Engine/i });
    await user.click(publicTab);

    expect(screen.getAllByText('Live Public Agency Booking Engine').length).toBeGreaterThan(0);
    expect(screen.getByText('Native KS OS Agency Engine')).toBeInTheDocument();
  });
});
