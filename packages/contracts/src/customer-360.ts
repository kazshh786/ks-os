import { z } from 'zod';
import { RelatedSaleSchema } from './sales-booking.js';

export const CustomerSourceSchema = z.enum(['invoices', 'crm', 'sales', 'work', 'tasks', 'bookings', 'communications', 'payments', 'forms', 'reputation', 'operations']);
export type CustomerSource = z.infer<typeof CustomerSourceSchema>;
const reference = z.string().uuid();
const date = z.string().datetime();
const text = z.string().min(1).max(255);
export const CustomerActionSchema = z.object({
  key: z.string().min(1).max(100), label: text,
  kind: z.enum(['LINK', 'ADD_TASK', 'CREATE_WORK', 'CREATE_OPPORTUNITY', 'CONVERT_WORK']),
  route: z.string().max(500).regex(/^\/app\/[a-zA-Z0-9/?=&_%.-]+$/).nullable(),
  source: CustomerSourceSchema, reference: reference.nullable(), reason: z.string().max(500),
}).strict();
export type CustomerAction = z.infer<typeof CustomerActionSchema>;
export const CustomerNowItemSchema = z.object({
  relatedSale: RelatedSaleSchema.optional(),
  key: z.string().max(150), source: CustomerSourceSchema, type: z.string().max(40), reference,
  title: text, subtitle: z.string().max(255), status: z.string().max(40),
  occurredAt: date, dueAt: date.nullable(), owner: z.string().max(255).nullable(),
  amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  attentionLevel: z.enum(['INFO', 'ATTENTION', 'IMPORTANT']), action: CustomerActionSchema.nullable(),
}).strict();
export type CustomerNowItem = z.infer<typeof CustomerNowItemSchema>;
export const CustomerAttentionItemSchema = z.object({
  key: z.string().max(150), severity: z.enum(['INFO', 'ATTENTION', 'IMPORTANT']),
  code: z.enum(['INVOICE_OVERDUE', 'INVOICE_DUE_SOON', 'SALES_BOOKING_CANCELLED', 'SALES_BOOKING_COMPLETED', 'WORK_BLOCKED', 'WORK_OVERDUE', 'TASK_OVERDUE', 'QUOTE_WAITING', 'SALE_WITHOUT_WORK', 'FORM_PENDING', 'PAYMENT_FAILED', 'UPCOMING_BOOKING', 'UNREAD_CONVERSATION']),
  title: text, reason: z.string().max(500), source: CustomerSourceSchema, reference,
  dueAt: date.nullable(), action: CustomerActionSchema.nullable(),
}).strict();
export type CustomerAttentionItem = z.infer<typeof CustomerAttentionItemSchema>;
export const CustomerTimelineEntrySchema = z.object({
  key: z.string().max(150), source: CustomerSourceSchema, reference,
  type: z.string().max(50), title: text, occurredAt: date, important: z.boolean(),
  route: CustomerActionSchema.shape.route,
}).strict();
export type CustomerTimelineEntry = z.infer<typeof CustomerTimelineEntrySchema>;
export const CustomerTimelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(1200).regex(/^[A-Za-z0-9_-]+$/).optional(),
  source: CustomerSourceSchema.optional(),
  importantOnly: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
}).strict();
export type CustomerTimelineQuery = z.infer<typeof CustomerTimelineQuerySchema>;
export const CustomerDiagnosticSchema = z.object({
  source: CustomerSourceSchema, code: z.literal('CUSTOMER_SOURCE_UNAVAILABLE'),
  message: z.string().max(160), requestId: z.string().max(100),
}).strict();
export const CustomerTimelinePageSchema = z.object({
  entries: z.array(CustomerTimelineEntrySchema).max(50), nextCursor: z.string().max(1200).nullable(),
  diagnostics: z.array(CustomerDiagnosticSchema).max(11),
}).strict();
export type CustomerTimelinePage = z.infer<typeof CustomerTimelinePageSchema>;
export const CustomerOverviewSchema = z.object({
  customer: z.object({ reference, name: text, email: z.string().max(255).nullable(), phone: z.string().max(30).nullable(),
    since: date, terminology: z.string().max(40), workLabel: z.string().max(40), lifecycle: z.string().max(30).nullable(), owner: z.string().max(255).nullable(),
  }).strict(),
  sources: z.array(CustomerSourceSchema).max(11), now: z.array(CustomerNowItemSchema).max(100),
  attention: z.array(CustomerAttentionItemSchema).max(100), actions: z.array(CustomerActionSchema).max(12),
  summary: z.array(z.object({ key: z.string().max(80), label: text, value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/).nullable() }).strict()).max(100),
  nowHasMore: z.boolean(), diagnostics: z.array(CustomerDiagnosticSchema).max(11), timeline: CustomerTimelinePageSchema,
}).strict();
export type CustomerOverview = z.infer<typeof CustomerOverviewSchema>;
export const CustomerCommandSchema = z.object({
  kind: z.enum(['ADD_TASK', 'CREATE_WORK', 'CREATE_OPPORTUNITY', 'CONVERT_WORK']),
  title: z.string().trim().min(1).max(180), sourceReference: reference.optional(),
}).strict();
