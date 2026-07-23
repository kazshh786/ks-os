import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AGENCY_SERVICES, AGENCY_STAFF, AgencyBookingSystemPage } from '../AgencyBookingSystem';

describe('AgencyBookingSystem', () => {
  it('defines essential agency services and agency staff', () => {
    expect(AGENCY_SERVICES.map(s => s.name)).toContain('Platform Demo & Tour');
    expect(AGENCY_SERVICES.map(s => s.name)).toContain('Onboarding & Business Setup');
    expect(AGENCY_STAFF.map(s => s.name)).toContain('Kasim Shah');
  });

  it('renders agency booking dashboard with services catalog and existing client bookings', () => {
    render(
      <MemoryRouter>
        <AgencyBookingSystemPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Agency Booking System')).toBeInTheDocument();
    expect(screen.getByText('Platform Demo & Tour')).toBeInTheDocument();
    expect(screen.getByText('Onboarding & Business Setup')).toBeInTheDocument();
    expect(screen.getByText('AGY-10928')).toBeInTheDocument();
    expect(screen.getByText('Salon A Owner')).toBeInTheDocument();
  });

  it('opens agency booking modal and allows booking client onboarding session', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AgencyBookingSystemPage />
      </MemoryRouter>
    );

    const openModalButton = screen.getByRole('button', { name: /Book client session/i });
    await user.click(openModalButton);

    expect(screen.getByText('Book Agency Client Session')).toBeInTheDocument();
    expect(screen.getByText('Select Agency Service')).toBeInTheDocument();

    const chooseDateButton = screen.getByRole('button', { name: /Choose date & time/i });
    await user.click(chooseDateButton);

    const clientNameInput = screen.getByPlaceholderText('e.g. Jane Doe');
    await user.type(clientNameInput, 'Sarah Connor');

    const clientEmailInput = screen.getByPlaceholderText('jane@clientbusiness.com');
    await user.type(clientEmailInput, 'sarah@apexsalon.com');

    const clientCompanyInput = screen.getByPlaceholderText('e.g. Apex Salon');
    await user.type(clientCompanyInput, 'Apex Salon');

    const confirmButton = screen.getByRole('button', { name: /Confirm booking/i });
    await user.click(confirmButton);

    expect(screen.getByText('Agency Session Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Sarah Connor')).toBeInTheDocument();
  });
});
