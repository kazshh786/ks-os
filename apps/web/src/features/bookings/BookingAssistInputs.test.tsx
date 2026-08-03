import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { EmailAddressInput } from './EmailAddressInput';

afterEach(() => {
  vi.restoreAllMocks();
});

function EmailHarness() {
  const [value, setValue] = useState('');
  return <EmailAddressInput value={value} onChange={setValue} />;
}

function CalendarHarness() {
  const [value, setValue] = useState('2026-08-05');
  return (
    <AvailabilityCalendar
      slug="north-star"
      serviceId="11111111-1111-4111-8111-111111111111"
      staffId="any"
      bookingChannel="in_shop"
      value={value}
      minimumDate="2026-08-01"
      maximumDate="2026-08-31"
      primary="#172554"
      onChange={setValue}
    />
  );
}

describe('booking assistance controls', () => {
  it('completes popular email domains from the typed local part', () => {
    render(<EmailHarness />);

    const input = screen.getByPlaceholderText('name@gmail.com');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'kasim@' } });

    expect(screen.getByRole('option', { name: 'kasim@gmail.com' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'kasim@outlook.com' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'kasim@gmail.com' }));
    expect(input).toHaveValue('kasim@gmail.com');
  });

  it('shows styled availability hints and opens the selected day inline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        availableDates: ['2026-08-05', '2026-08-12'],
        availabilityByDate: [
          { date: '2026-08-05', slotCount: 2 },
          { date: '2026-08-06', slotCount: 0 },
          { date: '2026-08-12', slotCount: 6 },
        ],
      }),
    }));

    render(<CalendarHarness />);

    const limitedDay = await screen.findByRole('button', {
      name: 'Wednesday 5 August 2026, low availability, 2 times left',
    });
    await waitFor(() => expect(limitedDay).toBeEnabled());
    expect(limitedDay).toHaveClass('is-limited');
    expect(limitedDay).toHaveAttribute('aria-pressed', 'true');
    expect(limitedDay).toHaveAttribute('data-tooltip', 'Only 2 times left');
    expect(limitedDay).toHaveAttribute('data-tooltip-tone', 'limited');

    const availableDay = screen.getByRole('button', {
      name: 'Wednesday 12 August 2026, 6 appointment times available',
    });
    expect(availableDay).toBeEnabled();
    expect(availableDay).toHaveClass('is-available');
    expect(availableDay).toHaveAttribute('data-tooltip', '6 times available');

    const unavailableDay = screen.getByRole('button', {
      name: 'Thursday 6 August 2026, no appointment times available',
    });
    expect(unavailableDay).toBeDisabled();
    expect(unavailableDay).toHaveClass('is-unavailable');
    expect(unavailableDay).toHaveAttribute('data-tooltip', 'No times available');

    fireEvent.click(limitedDay);
    expect(screen.getByText('Selected day')).toBeInTheDocument();
    expect(screen.getByText('Wednesday, 5 August 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change date' })).toBeInTheDocument();
    expect(screen.getByLabelText('Appointment calendar')).toHaveClass('is-times-view');
  });
});
