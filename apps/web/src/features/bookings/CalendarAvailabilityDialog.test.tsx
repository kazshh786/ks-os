import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarAvailabilityDialog } from './CalendarAvailabilityDialog';

const fetchWithAuth = vi.fn();
const listTeam = vi.fn();
const getBookingPageSettings = vi.fn();
const getTeamMember = vi.fn();
const updateTeamMemberSchedule = vi.fn();
const updateTeamMemberBookingChannels = vi.fn();

vi.mock('../../api/client', () => ({ fetchWithAuth }));
vi.mock('../../data/data-provider', () => ({
  getDataProvider: () => ({
    listTeam,
    getBookingPageSettings,
    getTeamMember,
    updateTeamMemberSchedule,
    updateTeamMemberBookingChannels,
  }),
}));

const member = {
  id: 'owner-1',
  name: 'Studio Owner',
  role: 'owner',
  schedule: [{ dayOfWeek: 1, enabled: true, startTime: '09:00', endTime: '17:00' }],
  bookingChannels: [],
  bookingOverrides: [],
};

const response = (data: unknown) => ({ ok: true, json: vi.fn().mockResolvedValue({ data }) });

describe('CalendarAvailabilityDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTeam.mockResolvedValue({ members: [{ userId: 'owner-1', name: 'Studio Owner', role: 'owner', accountStatus: 'ACTIVE' }] });
    getBookingPageSettings.mockResolvedValue({ bookingRules: { enabledBookingChannels: ['in_shop'] } });
    getTeamMember.mockResolvedValue(member);
    updateTeamMemberSchedule.mockResolvedValue(member);
    updateTeamMemberBookingChannels.mockResolvedValue(member);
    fetchWithAuth.mockResolvedValue(response({ allowAppointmentsPastClosingTime: false }));
  });

  it('loads and saves the closing-time option with weekly availability', async () => {
    render(<CalendarAvailabilityDialog open initialDate="2026-08-05" onClose={vi.fn()} />);

    const toggle = await screen.findByRole('checkbox', { name: 'Allow appointments to finish after closing time' });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save weekly hours' }));

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith(
      '/api/v1/settings/booking/customer-management',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ allowAppointmentsPastClosingTime: true }),
      }),
    ));
  });
});
