import { z } from 'zod';

const OptionalEmailUrlSchema = z.string().url().max(1000).nullable();

export const AutomatedEmailTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(160).refine(value => !/[\r\n]/.test(value), 'Subject must be one line'),
  heading: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
});

export const AutomatedEmailTemplatesSchema = z.object({
  customerBookingConfirmation: AutomatedEmailTemplateSchema,
  businessBookingConfirmation: AutomatedEmailTemplateSchema,
  reminderThreeDays: AutomatedEmailTemplateSchema,
  reminderOneDay: AutomatedEmailTemplateSchema,
  customerThankYouGoogle: AutomatedEmailTemplateSchema,
  customerThankYouTrustpilot: AutomatedEmailTemplateSchema,
  businessPaymentReceived: AutomatedEmailTemplateSchema,
});

export const EmailBrandingSchema = z.object({
  businessName: z.string().trim().min(1).max(255),
  businessEmail: z.string().email().max(255).nullable(),
  businessPhone: z.string().trim().max(40).nullable(),
  businessAddress: z.string().trim().max(500).nullable(),
  websiteUrl: OptionalEmailUrlSchema,
  logoUrl: OptionalEmailUrlSchema,
  instagramUrl: OptionalEmailUrlSchema,
  facebookUrl: OptionalEmailUrlSchema,
  tiktokUrl: OptionalEmailUrlSchema,
});

export const EmailAutomationOptionsSchema = z.object({
  businessBookingConfirmationEnabled: z.boolean(),
  reminderThreeDaysEnabled: z.boolean(),
  reminderOneDayEnabled: z.boolean(),
  customerThankYouEnabled: z.boolean(),
  businessPaymentReceivedEnabled: z.boolean(),
});

export const UpdateCommunicationsSettingsSchema = z.object({
  replyToEmail: z.string().email().nullable().optional(),
  senderDisplayName: z.string().nullable().optional(),
  bookingConfirmationEnabled: z.boolean().optional(),
  bookingCancellationEnabled: z.boolean().optional(),
  bookingRescheduleEnabled: z.boolean().optional(),
  appointmentRemindersEnabled: z.boolean().optional(),
  formDeliveryEnabled: z.boolean().optional(),
  formRemindersEnabled: z.boolean().optional(),
  paymentConfirmationEnabled: z.boolean().optional(),
  formReminderTiming: z.enum(['no_reminder', '24_hours_after_assignment', '48_hours_before_appointment', '24_hours_before_appointment']).optional(),
  branding: EmailBrandingSchema.optional(),
  automations: EmailAutomationOptionsSchema.optional(),
  templates: AutomatedEmailTemplatesSchema.optional(),
});

export type UpdateCommunicationsSettingsRequest = z.infer<typeof UpdateCommunicationsSettingsSchema>;

export const CommunicationsSettingsSchema = z.object({
  replyToEmail: z.string().nullable(),
  senderDisplayName: z.string().nullable(),
  bookingConfirmationEnabled: z.boolean(),
  bookingCancellationEnabled: z.boolean(),
  bookingRescheduleEnabled: z.boolean(),
  appointmentRemindersEnabled: z.boolean(),
  formDeliveryEnabled: z.boolean(),
  formRemindersEnabled: z.boolean(),
  paymentConfirmationEnabled: z.boolean(),
  formReminderTiming: z.string(),
  branding: EmailBrandingSchema,
  automations: EmailAutomationOptionsSchema,
  templates: AutomatedEmailTemplatesSchema,
});

export type CommunicationsSettingsResponse = z.infer<typeof CommunicationsSettingsSchema>;
export type EmailBranding = z.infer<typeof EmailBrandingSchema>;
export type EmailAutomationOptions = z.infer<typeof EmailAutomationOptionsSchema>;
export type AutomatedEmailTemplate = z.infer<typeof AutomatedEmailTemplateSchema>;
export type AutomatedEmailTemplates = z.infer<typeof AutomatedEmailTemplatesSchema>;

export const EmailHistoryQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional()
});

export type EmailHistoryQuery = z.infer<typeof EmailHistoryQuerySchema>;

export const EmailHistoryItemSchema = z.object({
  id: z.string(),
  recipientEmailMasked: z.string(),
  templateKey: z.string(),
  status: z.string(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  relatedEntityType: z.string().nullable()
});

export type EmailHistoryItem = z.infer<typeof EmailHistoryItemSchema>;
