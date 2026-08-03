import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunicationsSettingsResponse } from '@ks-os/contracts';
import { AutomatedEmailsPage } from './AutomatedEmailsPage';

const { getCommunicationsSettings, updateCommunicationsSettings } = vi.hoisted(() => ({
  getCommunicationsSettings: vi.fn(),
  updateCommunicationsSettings: vi.fn(),
}));

vi.mock('../../data/data-provider', () => ({
  getDataProvider: () => ({ getCommunicationsSettings, updateCommunicationsSettings }),
}));

const settings: CommunicationsSettingsResponse = {
  replyToEmail: 'hello@glow.example',
  senderDisplayName: 'Glow Studio',
  bookingConfirmationEnabled: true,
  bookingCancellationEnabled: true,
  bookingRescheduleEnabled: true,
  appointmentRemindersEnabled: true,
  formDeliveryEnabled: true,
  formRemindersEnabled: true,
  paymentConfirmationEnabled: true,
  formReminderTiming: '24_hours_before_appointment',
  branding: {
    businessName: 'Glow Studio',
    businessEmail: 'hello@glow.example',
    businessPhone: '020 0000 0000',
    businessAddress: '10 High Street, London',
    websiteUrl: 'https://glow.example',
    logoUrl: null,
    instagramUrl: 'https://instagram.com/glow',
    facebookUrl: null,
    tiktokUrl: null,
  },
  automations: {
    businessBookingConfirmationEnabled: true,
    reminderThreeDaysEnabled: true,
    reminderOneDayEnabled: true,
    customerThankYouEnabled: true,
    businessPaymentReceivedEnabled: true,
  },
  templates: {
    customerBookingConfirmation: { subject: 'Confirmed with {{businessName}}', heading: 'Booking confirmed', body: 'Hi {{customerName}}, your {{serviceName}} is confirmed.' },
    businessBookingConfirmation: { subject: 'New booking', heading: 'Booking confirmed', body: '{{customerName}} booked {{serviceName}}.' },
    reminderThreeDays: { subject: 'Three days to go', heading: 'Coming up', body: 'Hi {{customerName}}, see you in three days.' },
    reminderOneDay: { subject: 'Tomorrow', heading: 'See you tomorrow', body: 'Hi {{customerName}}, see you tomorrow.' },
    customerThankYouGoogle: { subject: 'Thank you', heading: 'Thank you', body: 'Please review us on Google.' },
    customerThankYouTrustpilot: { subject: 'Welcome back', heading: 'Thank you again', body: 'Please review us on Trustpilot.' },
    businessPaymentReceived: { subject: 'Payment received', heading: 'Payment received', body: '{{amount}} {{currency}} received.' },
  },
};

describe('AutomatedEmailsPage', () => {
  beforeEach(() => {
    getCommunicationsSettings.mockReset();
    updateCommunicationsSettings.mockReset();
    getCommunicationsSettings.mockResolvedValue(structuredClone(settings));
    updateCommunicationsSettings.mockResolvedValue(undefined);
  });

  it('renders tenant branding, lifecycle controls and a live template preview', async () => {
    render(<MemoryRouter initialEntries={['/app/email-marketing/automated-emails']}><AutomatedEmailsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Automated emails' })).toBeInTheDocument();
    expect(screen.getByLabelText('Business name')).toHaveValue('Glow Studio');
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Send a 3-day reminder/ })).toBeChecked();
    expect(screen.getByText('Hi Amelia, your Signature appointment is confirmed.')).toBeInTheDocument();
  });

  it('edits a template and persists all tenant-scoped email settings', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/app/email-marketing/automated-emails']}><AutomatedEmailsPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Automated emails' });
    await user.click(screen.getByRole('button', { name: /3-day reminder/ }));
    const message = screen.getByLabelText('Message');
    fireEvent.change(message, { target: { value: 'Hi {{customerName}}, your visit is nearly here.' } });
    await user.click(screen.getByRole('button', { name: 'Save all changes' }));

    await waitFor(() => expect(updateCommunicationsSettings).toHaveBeenCalledOnce());
    expect(updateCommunicationsSettings.mock.calls[0][0].templates.reminderThreeDays.body)
      .toBe('Hi {{customerName}}, your visit is nearly here.');
    expect(await screen.findByText('Automated email settings saved.')).toBeInTheDocument();
  });
});
