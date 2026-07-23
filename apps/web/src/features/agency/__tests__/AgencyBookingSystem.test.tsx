import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AgencyBookingSystemPage } from '../AgencyBookingSystem';

describe('AgencyBookingSystem', () => {
  it('renders agency booking management dashboard with scheduled client sessions', () => {
    render(
      <MemoryRouter>
        <AgencyBookingSystemPage />
      </MemoryRouter>
    );

    expect(screen.getByText('KS OS Agency Booking System')).toBeInTheDocument();
    expect(screen.getByText('Agency Sessions Management')).toBeInTheDocument();
    expect(screen.getByText('Interactive Agency Booking Engine')).toBeInTheDocument();
    expect(screen.getByText('AGY-10928')).toBeInTheDocument();
    expect(screen.getByText('Salon A Owner')).toBeInTheDocument();
  });

  it('allows switching to interactive agency booking wizard view', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AgencyBookingSystemPage />
      </MemoryRouter>
    );

    const switchButton = screen.getByRole('button', { name: /Interactive Agency Booking Engine/i });
    await user.click(switchButton);

    expect(screen.getByText('Agency Service Booking Wizard')).toBeInTheDocument();
    expect(screen.getByText('Native KS OS Agency Engine')).toBeInTheDocument();
  });
});
