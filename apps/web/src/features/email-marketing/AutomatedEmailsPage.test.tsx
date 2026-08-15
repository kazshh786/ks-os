import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunicationsSettingsResponse } from '@ks-os/contracts';
import { AutomatedEmailsPage } from './AutomatedEmailsPage';

const { getCommunicationsSettings, updateCommunicationsSettings, renderAutomatedEmailPreview } = vi.hoisted(() => ({
  getCommunicationsSettings: vi.fn(),
  updateCommunicationsSettings: vi.fn(),
  renderAutomatedEmailPreview: vi.fn(),
}));

vi.mock('../../data/data-provider', () => ({
  getDataProvider: () => ({ getCommunicationsSettings, updateCommunicationsSettings, renderAutomatedEmailPreview }),
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
  design: { style: 'CLEAN' },
  theme: {
    primaryColor: '#7c3aed',
    secondaryColor: '#334155',
    accentColor: '#ec4899',
    surfaceColor: '#ffffff',
    textColor: '#0f172a',
    fontFamily: 'system',
    borderRadius: 'rounded',
    mode: 'light',
  },
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
    renderAutomatedEmailPreview.mockReset();
    getCommunicationsSettings.mockResolvedValue(structuredClone(settings));
    updateCommunicationsSettings.mockResolvedValue(undefined);
    renderAutomatedEmailPreview.mockResolvedValue({ subject: 'Confirmed with Glow Studio', html: '<!doctype html><html lang="en"><body><p>Rendered email</p></body></html>', text: 'Rendered email' });
  });

  it('renders tenant branding, lifecycle controls and a live template preview', async () => {
    render(<MemoryRouter initialEntries={['/app/email-marketing/automated-emails']}><AutomatedEmailsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Automated emails' })).toBeInTheDocument();
    expect(screen.getByLabelText('Business name')).toHaveValue('Glow Studio');
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Send a 3-day reminder/ })).toBeChecked();
    expect(await screen.findByTitle('Rendered transactional email')).toBeInTheDocument();
    await waitFor(() => expect(renderAutomatedEmailPreview).toHaveBeenCalled());
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
    expect(updateCommunicationsSettings.mock.calls[0][0].design).toEqual({ style: 'CLEAN' });
    expect(await screen.findByText('Automated email settings saved.')).toBeInTheDocument();
  });

  it('selects a global style, uses the booking palette and offers a mobile real-render preview', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/app/email-marketing/automated-emails']}><AutomatedEmailsPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Automated emails' });
    expect(screen.getByText('Colours synced from your booking page')).toBeInTheDocument();
    const editorial = screen.getByRole('button', { name: /Editorial/ });
    await user.click(editorial);
    expect(editorial).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByRole('button', { name: 'Mobile' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(renderAutomatedEmailPreview).toHaveBeenLastCalledWith(expect.objectContaining({
      design: { style: 'EDITORIAL' },
    })));
  });
});
