import { z } from 'zod';

export const BusinessEventTypeSchema = z.enum([
  'BOOKING_CONFIRMED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'APPOINTMENT_CHECKED_IN',
  'APPOINTMENT_COMPLETED', 'FORM_ASSIGNED', 'FORM_SUBMITTED', 'PAYMENT_SUCCEEDED', 'REFUND_SUCCEEDED',
  'SCHEDULED_BEFORE_APPOINTMENT', 'SCHEDULED_AFTER_APPOINTMENT',
]);
export type BusinessEventType = z.infer<typeof BusinessEventTypeSchema>;

export const TriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('BOOKING_CONFIRMED'), config: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('BOOKING_RESCHEDULED'), config: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('BOOKING_CANCELLED'), config: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('APPOINTMENT_CHECKED_IN'), config: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('APPOINTMENT_COMPLETED'), config: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('FORM_ASSIGNED'), config: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('FORM_SUBMITTED'), config: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('PAYMENT_SUCCEEDED'), config: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('REFUND_SUCCEEDED'), config: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('SCHEDULED_BEFORE_APPOINTMENT'), config: z.object({ offsetMinutes: z.union([z.literal(2880), z.literal(1440), z.literal(120)]) }).strict() }).strict(),
  z.object({ type: z.literal('SCHEDULED_AFTER_APPOINTMENT'), config: z.object({ offsetMinutes: z.literal(1440) }).strict() }).strict(),
]);

const EmptyCondition = <T extends string>(type: T) => z.object({ type: z.literal(type) }).strict();
export const AutomationConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SERVICE_EQUALS'), serviceId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('BOOKING_CHANNEL_EQUALS'), bookingChannel: z.enum(['in_shop', 'mobile']) }).strict(),
  z.object({ type: z.literal('STAFF_EQUALS'), staffId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('APPOINTMENT_STATUS_EQUALS'), status: z.enum(['PENDING','CONFIRMED','CHECKED_IN','IN_SERVICE','AWAITING_PAYMENT','COMPLETED','CANCELLED','NO_SHOW']) }).strict(),
  z.object({ type: z.literal('PAYMENT_STATUS_EQUALS'), status: z.enum(['NOT_REQUIRED','PENDING','SUCCEEDED','FAILED','REFUNDED']) }).strict(),
  EmptyCondition('CLIENT_HAS_EMAIL'), EmptyCondition('CLIENT_HAS_SMS_NUMBER'), EmptyCondition('FORM_IS_INCOMPLETE'),
  EmptyCondition('TENANT_EMAIL_ENABLED'), EmptyCondition('TENANT_SMS_ENABLED'),
]);

const EmailTemplateSchema = z.enum(['booking-confirmed','booking-rescheduled','booking-cancelled','appointment-reminder','payment-confirmed','refund-updated','form-assigned','form-reminder','staff-operational-notification']);
const SmsTemplateSchema = z.enum(['booking-confirmed','booking-rescheduled','booking-cancelled','appointment-reminder','form-assigned','form-reminder','payment-confirmed','refund-updated','thank-you']);
// CREATE_TASK has a cross-field refinement, so this must be a regular union:
// Zod discriminated unions only accept bare object schemas, not ZodEffects.
export const AutomationActionSchema = z.union([
  z.object({ type: z.literal('ASSIGN_FORM'), formId: z.string().uuid(), formVersionId: z.string().uuid().optional(), linkToAppointment: z.boolean().default(true) }).strict(),
  z.object({ type: z.literal('SEND_EMAIL'), templateKey: EmailTemplateSchema }).strict(),
  z.object({ type: z.literal('SEND_SMS'), templateKey: SmsTemplateSchema }).strict(),
  z.object({ type: z.literal('SCHEDULE_EMAIL'), templateKey: EmailTemplateSchema, offsetMinutes: z.union([z.literal(2880),z.literal(1440),z.literal(120),z.literal(-1440)]) }).strict(),
  z.object({ type: z.literal('SCHEDULE_SMS'), templateKey: SmsTemplateSchema, offsetMinutes: z.union([z.literal(2880),z.literal(1440),z.literal(120),z.literal(-1440)]) }).strict(),
  z.object({ type: z.literal('CANCEL_PENDING_REMINDERS') }).strict(),
  z.object({ type: z.literal('CANCEL_PENDING_FORM_ASSIGNMENTS') }).strict(),
  z.object({ type: z.literal('CREATE_INTERNAL_NOTIFICATION'), notificationType: z.enum(['FORM_COMPLETED','AUTOMATION_FAILED','SMS_DELIVERY_FAILED','STRIPE_ACTION_REQUIRED','PAYMENT_DISPUTE_ACTION_REQUIRED']) }).strict(),
  z.object({
    type: z.literal('CREATE_TASK'),
    titleTemplateKey: z.enum(['follow-up-client','review-form','rebook-cancelled','resolve-payment']),
    assignTo: z.enum(['APPOINTMENT_STAFF','OWNER','SPECIFIC_USER']),
    specificUserId: z.string().uuid().optional(),
    dueOffsetMinutes: z.union([z.literal(0),z.literal(120),z.literal(1440),z.literal(2880),z.literal(10080)]),
    priority: z.enum(['LOW','NORMAL','HIGH','URGENT']).default('NORMAL'),
  }).strict().superRefine((value,ctx)=>{if(value.assignTo==='SPECIFIC_USER'&&!value.specificUserId)ctx.addIssue({code:z.ZodIssueCode.custom,path:['specificUserId'],message:'A specific user is required.'});}),
]);

export const CreateAutomationSchema = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).default(''),
  trigger: TriggerSchema, conditions: z.array(AutomationConditionSchema).max(10).default([]),
  actions: z.array(AutomationActionSchema).min(1).max(10),
}).strict();
export const UpdateAutomationSchema = CreateAutomationSchema.partial().strict();
export const AutomationIdParamsSchema = z.object({ automationId: z.string().uuid() }).strict();
export const AutomationRunIdParamsSchema = z.object({ runId: z.string().uuid() }).strict();
export const AutomationActionRunIdParamsSchema = z.object({ actionRunId: z.string().uuid() }).strict();

export const BusinessEventSchema = z.object({
  id: z.string().min(1).max(255), tenantId: z.string().uuid(), type: BusinessEventTypeSchema,
  occurredAt: z.string().datetime(), sourceType: z.string().min(1).max(50), sourceId: z.string().uuid(),
  payload: z.record(z.unknown()),
}).strict();
export type BusinessEvent = z.infer<typeof BusinessEventSchema>;
export type CreateAutomationInput = z.infer<typeof CreateAutomationSchema>;
export type AutomationCondition = z.infer<typeof AutomationConditionSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;
