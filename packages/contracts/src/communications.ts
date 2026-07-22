import { z } from 'zod';

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
  formReminderTiming: z.enum(['no_reminder', '24_hours_after_assignment', '48_hours_before_appointment', '24_hours_before_appointment']).optional()
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
  formReminderTiming: z.string()
});

export type CommunicationsSettingsResponse = z.infer<typeof CommunicationsSettingsSchema>;

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
