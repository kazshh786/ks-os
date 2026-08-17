import { renderEmail } from '@ks-os/email';
import type { AutomatedEmailPreviewKey, EmailPreviewRequest, EmailPreviewResponse } from '@ks-os/contracts';
import {
  EmailSettingsService,
  emailBrandingTemplateData,
  renderAutomatedEmailCopy,
} from './email-settings.service.js';

const SAMPLE = {
  customerName: 'Amelia',
  clientName: 'Amelia',
  recipientName: 'Amelia',
  serviceName: 'Signature appointment',
  staffName: 'Alex',
  bookingDate: 'Friday 14 August 2026',
  bookingTime: '14:30',
  appointmentDate: 'Friday 14 August 2026',
  appointmentTime: '14:30',
  appointmentDateTime: '2026-08-14T13:30:00.000Z',
  startTime: '2026-08-14T13:30:00.000Z',
  timezone: 'Europe/London',
  amount: '45.00',
  currency: 'GBP',
  status: 'Paid',
  bookingReference: 'KS-PREVIEW',
  locationName: 'Main studio',
  location: 'Main studio',
};

const productionTemplateKey = (key: AutomatedEmailPreviewKey) => {
  if (key === 'customerBookingConfirmation') return 'booking-confirmed';
  if (key === 'businessBookingConfirmation') return 'business-booking-confirmed';
  if (key === 'reminderThreeDays' || key === 'reminderOneDay') return 'appointment-reminder';
  if (key === 'customerThankYouGoogle' || key === 'customerThankYouTrustpilot') return 'review-invitation';
  return 'business-payment-received';
};

export class EmailPreviewService {
  async render(tenantId: string, input: EmailPreviewRequest): Promise<EmailPreviewResponse> {
    const settings = await new EmailSettingsService().get(tenantId);
    const replacements = {
      ...SAMPLE,
      businessName: settings.branding.businessName,
    };
    const copy = renderAutomatedEmailCopy(input.template, replacements);
    const templateData: Record<string, unknown> = {
      ...emailBrandingTemplateData(settings.branding, input.design, settings.theme),
      ...SAMPLE,
      ...copy,
    };

    if (input.templateKey === 'reminderThreeDays') templateData.reminderHours = 72;
    if (input.templateKey === 'reminderOneDay') templateData.reminderHours = 24;
    if (input.templateKey === 'customerThankYouGoogle' || input.templateKey === 'customerThankYouTrustpilot') {
      templateData.message = 'Thank you for trusting us with your visit.';
      templateData.reviewProvider = input.templateKey === 'customerThankYouGoogle' ? 'GOOGLE' : 'TRUSTPILOT';
      templateData.reviewUrl = 'https://preview.invalid/review';
    }

    const rendered = await renderEmail(productionTemplateKey(input.templateKey), templateData);
    return {
      subject: copy.emailSubject,
      html: rendered.html,
      text: rendered.text,
    };
  }
}
