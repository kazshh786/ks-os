import { z } from 'zod';

export const CustomerBookingPaymentImpactTypeSchema = z.enum([
  'NONE',
  'PAYMENT_RETAINED',
  'REFUND_REVIEW_REQUIRED',
  'NO_AUTOMATIC_REFUND',
]);

export const CustomerBookingPaymentImpactSchema = z.object({
  type: CustomerBookingPaymentImpactTypeSchema,
  message: z.string().min(1).max(1000),
}).strict();

export const CustomerBookingManagementPolicySchema = z.object({
  canCancel: z.boolean(),
  canReschedule: z.boolean(),
  cancellationDeadline: z.string().datetime().nullable(),
  rescheduleDeadline: z.string().datetime().nullable(),
  reschedulesUsed: z.number().int().nonnegative(),
  reschedulesRemaining: z.number().int().nonnegative().nullable(),
  requireCancellationReason: z.boolean(),
  paymentImpact: CustomerBookingPaymentImpactSchema,
  blockedReasons: z.array(z.string().min(1).max(500)),
  cancellationPolicyMessage: z.string().max(1000),
  depositPolicyMessage: z.string().max(1000),
}).strict();

export const CustomerRescheduleAvailabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD.'),
}).strict();

export const CustomerRescheduleSlotSchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  staffReference: z.string().uuid(),
  staffName: z.string().min(1),
  isCurrentStaff: z.boolean(),
}).strict();

export const CustomerRescheduleAvailabilityResponseSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  slots: z.array(CustomerRescheduleSlotSchema),
}).strict();

export const CustomerRescheduleRequestSchema = z.object({
  expectedAppointmentVersion: z.string().regex(/^\d+$/),
  newStartTime: z.string().datetime(),
  staffReference: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid(),
}).strict();

export const CustomerCancellationReasonCodeSchema = z.enum([
  'NO_LONGER_NEEDED',
  'SCHEDULE_CONFLICT',
  'UNWELL',
  'BOOKED_BY_MISTAKE',
  'OTHER',
  'PREFER_NOT_TO_SAY',
]);

export const CustomerCancellationRequestSchema = z.object({
  expectedAppointmentVersion: z.string().regex(/^\d+$/),
  reasonCode: CustomerCancellationReasonCodeSchema.optional(),
  reasonText: z.string().trim().min(1).max(500).regex(/^[^<>]*$/, 'HTML is not permitted.').optional(),
  idempotencyKey: z.string().uuid(),
}).strict().superRefine((value, context) => {
  if (value.reasonText && value.reasonCode !== 'OTHER') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonText'], message: 'Reason text is only accepted with OTHER.' });
  }
});

export const CustomerBookingMutationAppointmentSchema = z.object({
  bookingReference: z.string().uuid(),
  appointmentVersion: z.string().regex(/^\d+$/),
  status: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  staffName: z.string(),
}).strict();

export const CustomerRescheduleResponseSchema = z.object({
  appointment: CustomerBookingMutationAppointmentSchema,
  previousStartTime: z.string().datetime(),
  policy: CustomerBookingManagementPolicySchema,
}).strict();

export const CustomerCancellationResponseSchema = z.object({
  appointment: CustomerBookingMutationAppointmentSchema,
  cancelledAt: z.string().datetime(),
  paymentImpact: CustomerBookingPaymentImpactSchema,
}).strict();

export const CustomerBookingChangeHistorySchema = z.object({
  changeReference: z.string().uuid(),
  changeType: z.enum(['RESCHEDULED', 'CANCELLED']),
  source: z.enum(['CUSTOMER', 'STAFF', 'OWNER', 'SYSTEM']),
  previousStartTime: z.string().datetime().nullable(),
  newStartTime: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
}).strict();

export const CustomerBookingNoticeMinutesSchema = z.union([
  z.literal(0),
  z.literal(120),
  z.literal(360),
  z.literal(720),
  z.literal(1440),
  z.literal(2880),
  z.literal(4320),
]);

export const CustomerBookingMaximumReschedulesSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
  z.literal(10),
]);

const CustomerVisiblePolicyTextSchema = z.string().trim().min(1).max(1000)
  .regex(/^[^<>]*$/, 'HTML is not permitted.')
  .refine((value) => !/\{\{|\}\}|\$\{/.test(value), 'Template expressions are not permitted.');

export const CustomerBookingPolicySettingsSchema = z.object({
  customerCancellationEnabled: z.boolean(),
  customerReschedulingEnabled: z.boolean(),
  minimumCancellationNoticeMinutes: CustomerBookingNoticeMinutesSchema,
  minimumRescheduleNoticeMinutes: CustomerBookingNoticeMinutesSchema,
  maximumCustomerReschedules: CustomerBookingMaximumReschedulesSchema,
  requireCancellationReason: z.boolean(),
  lateCancellationMessage: CustomerVisiblePolicyTextSchema,
  depositPolicyMessage: CustomerVisiblePolicyTextSchema,
}).strict();

export const CustomerBookingPolicySettingsUpdateSchema = CustomerBookingPolicySettingsSchema.partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one policy setting.' });

export const CustomerBookingManagementTokenParamsSchema = z.object({
  token: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export type CustomerBookingManagementPolicy = z.infer<typeof CustomerBookingManagementPolicySchema>;
export type CustomerRescheduleAvailabilityQuery = z.infer<typeof CustomerRescheduleAvailabilityQuerySchema>;
export type CustomerRescheduleAvailabilityResponse = z.infer<typeof CustomerRescheduleAvailabilityResponseSchema>;
export type CustomerRescheduleRequest = z.infer<typeof CustomerRescheduleRequestSchema>;
export type CustomerRescheduleResponse = z.infer<typeof CustomerRescheduleResponseSchema>;
export type CustomerCancellationRequest = z.infer<typeof CustomerCancellationRequestSchema>;
export type CustomerCancellationResponse = z.infer<typeof CustomerCancellationResponseSchema>;
export type CustomerBookingChangeHistory = z.infer<typeof CustomerBookingChangeHistorySchema>;
export type CustomerBookingPolicySettings = z.infer<typeof CustomerBookingPolicySettingsSchema>;
