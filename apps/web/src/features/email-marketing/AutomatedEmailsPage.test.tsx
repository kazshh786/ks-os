import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunicationsSettingsResponse } from '@ks-os/contracts';
import { AutomatedEmailsPage } from './AutomatedEmailsPage';

const { getCommunicationsSettings, updateCommunicationsSettings, listForms } = vi.hoisted(() => ({
  getCommunicationsSettings: vi.fn(),
  updateCommunicationsSettings: vi.fn(),
  listForms: vi.fn(),
}));

vi.mock('../../data/data-provider', () => ({
  getDataProvider: () => ({ getCommunicationsSettings, updateCommunicationsSettings, listForms }),
}));

const mainFormId = '11111111-1111-4111-8111-111111111111';
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
  mainBookingFormId: mainFormId,
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
    customerBookingCancellation: { subject: 'Booking cancelled', heading: 'Booking cancelled', body: 'Hi {{customerName}}, your booking is cancelled.' },
    customerBookingReschedule: { subject: 'Booking updated', heading: 'A new time', body: 'Hi {{customerName}}, your booking has a new time.' },
    customerPaymentConfirmation: { subject: 'Payment confirmed', heading: 'Thank you', body: 'We received {{amount}} {{currency}}.' },
    customerRefundUpdate: { subject: 'Refund update', heading: 'Refund updated', body: 'Your refund is {{status}}.' },
    formAssignment: { subject: 'Complete {{formName}}', heading: 'Form ready', body: 'Please complete {{formName}}.' },
    formReminder: { subject: 'Reminder for {{formName}}', heading: 'Form reminder', body: 'Please complete {{formName}}.' },
    customerPortalAccess: { subject: 'Your portal', heading: 'Secure access', body: 'View your appointments and forms.' },
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
    listForms.mockReset();
    getCommunicationsSettings.mockResolvedValue(structuredClone(settings));
    listForms.mockResolvedValue([{ id: mainFormId, title: 'Consultation form', status: 'PUBLISHED' }]);
    updateCommunicationsSettings.mockResolvedValue(undefined);
  });

  it('renders expanded customer templates, main form and prominent socials', async () => {
    render(<MemoryRouter initialEntries={['/app/email-marketing/automated-emails']}><AutomatedEmailsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Automated emails' })).toBeInTheDocument();
    expect(screen.getByLabelText('Business name')).toHaveValue('Glow Studio');
    expect(screen.getByRole('option', { name: 'Consultation form' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Booking cancelled/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Customer portal access/ })).toBeInTheDocument();
    expect(screen.getByText('Check us out on our socials')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Send a 3-day reminder/ })).toBeChecked();
  });

  it('edits a priority template and persists the main booking form', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/app/email-marketing/automated-emails']}><AutomatedEmailsPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Automated emails' });
    await user.click(screen.getByRole('button', { name: /Booking cancelled/ }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hi {{customerName}}, your visit has been cancelled.' } });
    await user.click(screen.getByRole('button', { name: 'Save all changes' }));

    await waitFor(() => expect(updateCommunicationsSettings).toHaveBeenCalledOnce());
    expect(updateCommunicationsSettings.mock.calls[0][0].templates.customerBookingCancellation.body)
      .toBe('Hi {{customerName}}, your visit has been cancelled.');
    expect(updateCommunicationsSettings.mock.calls[0][0].mainBookingFormId).toBe(mainFormId);
    expect(await screen.findByText('Automated email settings saved.')).toBeInTheDocument();
  });
});
