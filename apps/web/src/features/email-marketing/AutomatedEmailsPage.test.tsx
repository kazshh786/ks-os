import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunicationsSettingsResponse, EmailPreviewResponse } from '@ks-os/contracts';
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
    customerBookingConfirmation: { subject: 'Confirmed with {{businessName}}', preview: 'Your appointment is secured.', heading: 'Booking confirmed', body: 'Hi {{customerName}}, your {{serviceName}} is confirmed.' },
    businessBookingConfirmation: { subject: 'New booking', heading: 'Booking confirmed', body: '{{customerName}} booked {{serviceName}}.' },
    reminderThreeDays: { subject: 'Three days to go', preview: 'Your visit is coming up.', heading: 'Coming up', body: 'Hi {{customerName}}, see you in three days.' },
    reminderOneDay: { subject: 'Tomorrow', heading: 'See you tomorrow', body: 'Hi {{customerName}}, see you tomorrow.' },
    customerThankYouGoogle: { subject: 'Thank you', heading: 'Thank you', body: 'Please review us on Google.' },
    customerThankYouTrustpilot: { subject: 'Welcome back', heading: 'Thank you again', body: 'Please review us on Trustpilot.' },
    businessPaymentReceived: { subject: 'Payment received', heading: 'Payment received', body: '{{amount}} {{currency}} received.' },
  },
};

const firstPreview: EmailPreviewResponse = {
  subject: 'Confirmed with Glow Studio',
  html: '<!doctype html><html lang="en"><body><p>First rendered email</p></body></html>',
  text: 'First rendered email',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/email-marketing/automated-emails']}>
      <AutomatedEmailsPage />
    </MemoryRouter>,
  );
}

describe('AutomatedEmailsPage email studio', () => {
  beforeEach(() => {
    getCommunicationsSettings.mockReset();
    updateCommunicationsSettings.mockReset();
    renderAutomatedEmailPreview.mockReset();
    getCommunicationsSettings.mockResolvedValue(structuredClone(settings));
    updateCommunicationsSettings.mockResolvedValue(undefined);
    renderAutomatedEmailPreview.mockResolvedValue(firstPreview);
  });

  it('makes the production-rendered iframe the focus of the studio layout', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Automated emails' })).toBeInTheDocument();
    const studio = screen.getByTestId('email-studio');
    expect(studio).toHaveClass('lg:-mx-8', 'lg:-mt-8');
    const stickyBar = screen.getByTestId('email-studio-sticky-bar');
    expect(stickyBar).toHaveClass('sticky', 'top-0', 'bg-white');
    expect(screen.getByTestId('email-studio-header')).toHaveClass('bg-white');
    expect(screen.getByTestId('email-studio-header')).not.toHaveClass('bg-white/95', 'backdrop-blur');

    const layout = screen.getByTestId('email-studio-layout');
    expect(layout).toHaveClass('min-h-[calc(100vh-7rem)]', 'xl:grid-cols-[220px_minmax(520px,1fr)_380px]');
    const previewStage = screen.getByTestId('preview-stage');
    expect(previewStage).toBeInTheDocument();
    expect(previewStage).not.toHaveClass('border');
    expect(screen.getByTestId('preview-canvas')).not.toHaveClass('overflow-auto', 'p-3', 'sm:p-6');
    expect(within(previewStage).queryByText(/Production React Email render/i)).not.toBeInTheDocument();
    expect(within(previewStage).queryByText(/Subject:/i)).not.toBeInTheDocument();

    const inspector = screen.getByTestId('email-settings-inspector');
    expect(inspector).toHaveClass('lg:sticky', 'lg:top-28', 'lg:overflow-y-auto');

    const iframe = await screen.findByTitle('Rendered transactional email');
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(iframe).toHaveAttribute('srcdoc', firstPreview.html);
    expect(screen.getAllByRole('button', { name: 'Save changes' })).toHaveLength(1);
  });

  it('provides compact desktop template navigation and a responsive selector fallback', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Automated emails' });

    const rail = screen.getByRole('navigation', { name: 'Email templates', hidden: true });
    const threeDayButton = within(rail).getByRole('button', { name: /3-day reminder/i, hidden: true });
    expect(threeDayButton).toHaveClass('min-h-10');

    const selector = screen.getByLabelText('Email template');
    await user.selectOptions(selector, 'reminderThreeDays');

    expect(selector).toHaveValue('reminderThreeDays');
    expect(screen.getByLabelText('Subject')).toHaveValue('Three days to go');
    expect(screen.getByLabelText('Preview text')).toHaveValue('Your visit is coming up.');
    expect(screen.getByLabelText('Message')).toHaveValue('Hi {{customerName}}, see you in three days.');
  });

  it('changes templates from the keyboard-accessible navigation rail', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Automated emails' });

    const rail = screen.getByRole('navigation', { name: 'Email templates', hidden: true });
    const paymentButton = within(rail).getByRole('button', { name: /Payment received/i, hidden: true });
    paymentButton.focus();
    await user.keyboard('{Enter}');

    expect(paymentButton).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Subject')).toHaveValue('Payment received');
    expect(screen.getByRole('checkbox', { name: /Send automatically/i })).toBeChecked();
  });

  it('selects Email V3 designs accessibly from the inspector', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTitle('Rendered transactional email');

    expect(screen.getByText('Synced from booking page')).toBeInTheDocument();
    const editorial = screen.getByRole('button', { name: /Editorial/i });
    editorial.focus();
    await user.keyboard('{Enter}');

    expect(editorial).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(renderAutomatedEmailPreview).toHaveBeenLastCalledWith(expect.objectContaining({
      design: { style: 'EDITORIAL' },
    })));
  });

  it('places the desktop and mobile preview toggle on the email marketing bar', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTitle('Rendered transactional email');

    const toolbar = screen.getByTestId('email-marketing-toolbar');
    const desktop = within(toolbar).getByRole('button', { name: 'Desktop' });
    const mobile = within(toolbar).getByRole('button', { name: 'Mobile' });
    expect(within(screen.getByTestId('preview-stage')).queryByRole('button', { name: 'Desktop' })).not.toBeInTheDocument();
    expect(desktop).toHaveAttribute('aria-pressed', 'true');

    await user.click(mobile);
    expect(mobile).toHaveAttribute('aria-pressed', 'true');
    expect(desktop).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps business fields and lifecycle controls editable in the inspector', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Automated emails' });

    await user.click(within(screen.getByTestId('email-settings-inspector')).getByText('Business'));
    const businessName = screen.getByLabelText('Business name');
    expect(businessName).toHaveValue('Glow Studio');
    expect(screen.getByLabelText('Instagram URL')).toHaveValue('https://instagram.com/glow');

    await user.clear(businessName);
    await user.type(businessName, 'Glow House');
    expect(businessName).toHaveValue('Glow House');

    expect(screen.getByRole('checkbox', { name: /Send automatically/i })).toBeChecked();
    await user.click(screen.getByText('Advanced automation settings'));
    expect(screen.getByRole('checkbox', { name: /Customer appointment reminders/i })).toBeChecked();
  });

  it('saves the current settings once and announces dirty and successful states', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Automated emails' });

    await user.selectOptions(screen.getByLabelText('Email template'), 'reminderThreeDays');
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Hi {{customerName}}, your visit is nearly here.' },
    });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateCommunicationsSettings).toHaveBeenCalledOnce());
    expect(updateCommunicationsSettings.mock.calls[0][0].templates.reminderThreeDays.body)
      .toBe('Hi {{customerName}}, your visit is nearly here.');
    expect(updateCommunicationsSettings.mock.calls[0][0].design).toEqual({ style: 'CLEAN' });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('keeps the last iframe visible while a refreshed preview is loading', async () => {
    let resolveRefresh!: (value: EmailPreviewResponse) => void;
    const refresh = new Promise<EmailPreviewResponse>(resolve => {
      resolveRefresh = resolve;
    });
    renderAutomatedEmailPreview
      .mockReset()
      .mockResolvedValueOnce(firstPreview)
      .mockReturnValueOnce(refresh);

    renderPage();
    const iframe = await screen.findByTitle('Rendered transactional email');
    expect(iframe).toHaveAttribute('srcdoc', firstPreview.html);

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Updated message copy.' },
    });

    expect(await screen.findByText('Updating preview…')).toBeInTheDocument();
    expect(screen.getByTitle('Rendered transactional email')).toHaveAttribute('srcdoc', firstPreview.html);

    const refreshed: EmailPreviewResponse = {
      subject: 'Updated subject',
      html: '<!doctype html><html lang="en"><body><p>Updated rendered email</p></body></html>',
      text: 'Updated rendered email',
    };
    await act(async () => {
      resolveRefresh(refreshed);
    });

    await waitFor(() => expect(screen.getByTitle('Rendered transactional email')).toHaveAttribute('srcdoc', refreshed.html));
    expect(screen.queryByText('Updating preview…')).not.toBeInTheDocument();
  });

  it('preserves the last successful iframe when preview refresh fails', async () => {
    renderAutomatedEmailPreview
      .mockReset()
      .mockResolvedValueOnce(firstPreview)
      .mockRejectedValueOnce(new Error('preview unavailable'));

    renderPage();
    const iframe = await screen.findByTitle('Rendered transactional email');
    expect(iframe).toHaveAttribute('srcdoc', firstPreview.html);

    fireEvent.change(screen.getByLabelText('Heading'), {
      target: { value: 'A changed heading' },
    });

    expect(await screen.findByRole('alert', { name: '' })).toHaveTextContent("Preview couldn't update. Try again.");
    expect(screen.getByTitle('Rendered transactional email')).toHaveAttribute('srcdoc', firstPreview.html);
  });

  it('keeps available variables insertable without changing the preview architecture', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTitle('Rendered transactional email');

    await user.click(screen.getByRole('button', { name: 'Insert {{bookingDate}}' }));
    expect(screen.getByLabelText('Message')).toHaveValue(
      'Hi {{customerName}}, your {{serviceName}} is confirmed. {{bookingDate}}',
    );
    expect(renderAutomatedEmailPreview).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'customerBookingConfirmation',
    }));
  });
});
