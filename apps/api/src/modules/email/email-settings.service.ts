import {
  bookingPages,
  getDatabase,
  locations,
  tenantEmailAutomationSettings,
  tenants,
} from '@ks-os/database';
import {
  AutomatedEmailTemplatesSchema,
  EmailAutomationOptionsSchema,
  EmailBrandingSchema,
  type AutomatedEmailTemplate,
  type AutomatedEmailTemplates,
  type CommunicationsSettingsResponse,
  type EmailAutomationOptions,
  type EmailBranding,
  type UpdateCommunicationsSettingsRequest,
} from '@ks-os/contracts';
import { and, eq } from 'drizzle-orm';

export const DEFAULT_AUTOMATED_EMAIL_TEMPLATES: AutomatedEmailTemplates = {
  customerBookingConfirmation: {
    subject: 'Your booking with {{businessName}} is confirmed',
    heading: 'Booking confirmed',
    body: 'Hi {{customerName}}, your {{serviceName}} booking is confirmed. We look forward to seeing you.',
  },
  businessBookingConfirmation: {
    subject: 'New booking: {{customerName}} — {{serviceName}}',
    heading: 'A new booking is confirmed',
    body: '{{customerName}} is booked for {{serviceName}} on {{bookingDate}} at {{bookingTime}} with {{staffName}}.',
  },
  reminderThreeDays: {
    subject: 'Your appointment with {{businessName}} is in 3 days',
    heading: 'Your appointment is coming up',
    body: 'Hi {{customerName}}, this is a friendly reminder that your {{serviceName}} appointment is in 3 days.',
  },
  reminderOneDay: {
    subject: 'Your appointment with {{businessName}} is tomorrow',
    heading: 'See you tomorrow',
    body: 'Hi {{customerName}}, this is a reminder that your {{serviceName}} appointment is tomorrow.',
  },
  customerThankYouGoogle: {
    subject: 'Thank you for visiting {{businessName}}',
    heading: 'Thank you for choosing us',
    body: 'Hi {{customerName}}, thank you for visiting us. If you have a moment, an honest Google review would mean a lot to our team.',
  },
  customerThankYouTrustpilot: {
    subject: 'Thank you for coming back to {{businessName}}',
    heading: 'Thank you for your continued support',
    body: 'Hi {{customerName}}, thank you for choosing us again. If you have a moment, we would be grateful for an honest Trustpilot review.',
  },
  businessPaymentReceived: {
    subject: 'Payment received: {{customerName}} — {{amount}} {{currency}}',
    heading: 'Payment received',
    body: 'A payment of {{amount}} {{currency}} has been received from {{customerName}} for {{serviceName}}.',
  },
};

export const DEFAULT_EMAIL_AUTOMATIONS: EmailAutomationOptions = {
  businessBookingConfirmationEnabled: true,
  reminderThreeDaysEnabled: true,
  reminderOneDayEnabled: true,
  customerThankYouEnabled: true,
  businessPaymentReceivedEnabled: true,
};

type StoredSettings = {
  branding?: Partial<EmailBranding>;
  automations?: Partial<EmailAutomationOptions>;
  templates?: Partial<Record<keyof AutomatedEmailTemplates, Partial<AutomatedEmailTemplate>>>;
};

export type EmailRuntimeSettings = CommunicationsSettingsResponse;

const normalizeNullable = (value: string | null | undefined) => value?.trim() || null;

export function interpolateEmailCopy(value: string, replacements: Record<string, string | number | null | undefined>) {
  return value.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (token, key: string) => {
    const replacement = replacements[key];
    return replacement === null || replacement === undefined ? token : String(replacement);
  });
}

export function renderAutomatedEmailCopy(template: AutomatedEmailTemplate, replacements: Record<string, string | number | null | undefined>) {
  return {
    emailSubject: interpolateEmailCopy(template.subject, replacements),
    emailHeading: interpolateEmailCopy(template.heading, replacements),
    emailBody: interpolateEmailCopy(template.body, replacements),
  };
}

export function emailBrandingTemplateData(branding: EmailBranding) {
  return {
    tenantName: branding.businessName,
    businessName: branding.businessName,
    businessEmail: branding.businessEmail,
    businessPhone: branding.businessPhone,
    businessAddress: branding.businessAddress,
    businessWebsiteUrl: branding.websiteUrl,
    businessLogoUrl: branding.logoUrl,
    instagramUrl: branding.instagramUrl,
    facebookUrl: branding.facebookUrl,
    tiktokUrl: branding.tiktokUrl,
  };
}

export class EmailSettingsService {
  async get(tenantId: string, query: any = getDatabase()): Promise<EmailRuntimeSettings> {
    const [[tenant], [stored], [primaryLocation], [bookingPage]] = await Promise.all([
      query.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1),
      query.select().from(tenantEmailAutomationSettings).where(eq(tenantEmailAutomationSettings.tenantId, tenantId)).limit(1),
      query.select().from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.isPrimary, true))).limit(1),
      query.select().from(bookingPages).where(eq(bookingPages.tenantId, tenantId)).limit(1),
    ]);
    if (!tenant) throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });

    const saved = (stored?.settingsJson ?? {}) as StoredSettings;
    const defaultBranding: EmailBranding = {
      businessName: tenant.senderDisplayName || tenant.name,
      businessEmail: tenant.replyToEmail || tenant.primaryContactEmail || null,
      businessPhone: primaryLocation?.phone || tenant.operationalPhone || null,
      businessAddress: primaryLocation?.address || null,
      websiteUrl: null,
      logoUrl: bookingPage?.logoUrl || null,
      instagramUrl: null,
      facebookUrl: null,
      tiktokUrl: null,
    };
    const branding = EmailBrandingSchema.parse({ ...defaultBranding, ...(saved.branding ?? {}) });
    const automations = EmailAutomationOptionsSchema.parse({ ...DEFAULT_EMAIL_AUTOMATIONS, ...(saved.automations ?? {}) });
    const templates = AutomatedEmailTemplatesSchema.parse(Object.fromEntries(
      Object.entries(DEFAULT_AUTOMATED_EMAIL_TEMPLATES).map(([key, value]) => [
        key,
        { ...value, ...(saved.templates?.[key as keyof AutomatedEmailTemplates] ?? {}) },
      ]),
    ));

    return {
      replyToEmail: tenant.replyToEmail,
      senderDisplayName: tenant.senderDisplayName,
      bookingConfirmationEnabled: tenant.bookingConfirmationEnabled,
      bookingCancellationEnabled: tenant.bookingCancellationEnabled,
      bookingRescheduleEnabled: tenant.bookingRescheduleEnabled,
      appointmentRemindersEnabled: tenant.appointmentRemindersEnabled,
      formDeliveryEnabled: tenant.formDeliveryEnabled,
      formRemindersEnabled: tenant.formRemindersEnabled,
      paymentConfirmationEnabled: tenant.paymentConfirmationEnabled,
      formReminderTiming: tenant.formReminderTiming,
      branding,
      automations,
      templates,
    };
  }

  async update(
    tenantId: string,
    updatedByUserId: string,
    input: UpdateCommunicationsSettingsRequest,
    query: any = getDatabase(),
  ) {
    const current = await this.get(tenantId, query);
    const branding = EmailBrandingSchema.parse({ ...current.branding, ...(input.branding ?? {}) });
    const automations = EmailAutomationOptionsSchema.parse({ ...current.automations, ...(input.automations ?? {}) });
    const templates = AutomatedEmailTemplatesSchema.parse(Object.fromEntries(
      Object.entries(current.templates).map(([key, value]) => [
        key,
        { ...value, ...(input.templates?.[key as keyof AutomatedEmailTemplates] ?? {}) },
      ]),
    ));

    const tenantUpdate = {
      ...(input.replyToEmail !== undefined ? { replyToEmail: normalizeNullable(input.replyToEmail) } : {}),
      ...(input.senderDisplayName !== undefined ? { senderDisplayName: normalizeNullable(input.senderDisplayName) } : {}),
      ...(input.bookingConfirmationEnabled !== undefined ? { bookingConfirmationEnabled: input.bookingConfirmationEnabled } : {}),
      ...(input.bookingCancellationEnabled !== undefined ? { bookingCancellationEnabled: input.bookingCancellationEnabled } : {}),
      ...(input.bookingRescheduleEnabled !== undefined ? { bookingRescheduleEnabled: input.bookingRescheduleEnabled } : {}),
      ...(input.appointmentRemindersEnabled !== undefined ? { appointmentRemindersEnabled: input.appointmentRemindersEnabled } : {}),
      ...(input.formDeliveryEnabled !== undefined ? { formDeliveryEnabled: input.formDeliveryEnabled } : {}),
      ...(input.formRemindersEnabled !== undefined ? { formRemindersEnabled: input.formRemindersEnabled } : {}),
      ...(input.paymentConfirmationEnabled !== undefined ? { paymentConfirmationEnabled: input.paymentConfirmationEnabled } : {}),
      ...(input.formReminderTiming !== undefined ? { formReminderTiming: input.formReminderTiming } : {}),
      updatedAt: new Date(),
    };

    await query.update(tenants).set(tenantUpdate).where(eq(tenants.id, tenantId));
    await query.insert(tenantEmailAutomationSettings).values({
      tenantId,
      settingsJson: { branding, automations, templates },
      updatedByUserId,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: tenantEmailAutomationSettings.tenantId,
      set: { settingsJson: { branding, automations, templates }, updatedByUserId, updatedAt: new Date() },
    });
  }
}
