import { z } from 'zod';

export const ConversationChannelSchema = z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK']);
export const ConversationStatusSchema = z.enum(['OPEN', 'PENDING', 'RESOLVED']);
export const ConversationPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const ConversationDirectionSchema = z.enum(['INBOUND', 'OUTBOUND', 'INTERNAL']);
export const ConversationMessageStatusSchema = z.enum(['RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED']);
export const ConversationSenderTypeSchema = z.enum(['CUSTOMER', 'STAFF', 'AUTOMATION', 'SYSTEM']);

export const ConversationBookingContextSchema = z.object({
  appointmentId: z.string().uuid(),
  serviceName: z.string(),
  startTime: z.string().datetime(),
  status: z.string(),
}).strict();

export const ConversationListItemSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid().nullable(),
  customerName: z.string(),
  customerEmail: z.string().nullable(),
  customerPhone: z.string().nullable(),
  channel: ConversationChannelSchema,
  status: ConversationStatusSchema,
  priority: ConversationPrioritySchema,
  subject: z.string().nullable(),
  preview: z.string(),
  unreadCount: z.number().int().nonnegative(),
  assignedToUserId: z.string().uuid().nullable(),
  assignedToName: z.string().nullable(),
  lastMessageAt: z.string().datetime(),
  booking: ConversationBookingContextSchema.nullable(),
  tags: z.array(z.string()),
}).strict();

export const ConversationMessageAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  downloadUrl: z.string(),
}).strict();

export const ConversationMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  channel: ConversationChannelSchema,
  direction: ConversationDirectionSchema,
  senderType: ConversationSenderTypeSchema,
  senderName: z.string(),
  body: z.string(),
  status: ConversationMessageStatusSchema,
  replyToMessageId: z.string().uuid().nullable(),
  externalMessageId: z.string().nullable(),
  attachments: z.array(ConversationMessageAttachmentSchema),
  createdAt: z.string().datetime(),
}).strict();

export const ConversationCustomerContextSchema = z.object({
  clientId: z.string().uuid().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  totalBookings: z.number().int().nonnegative(),
  completedBookings: z.number().int().nonnegative(),
  upcomingBooking: ConversationBookingContextSchema.nullable(),
  lastVisitAt: z.string().datetime().nullable(),
}).strict();

export const ConversationDetailSchema = z.object({
  conversation: ConversationListItemSchema,
  customer: ConversationCustomerContextSchema,
  messages: z.array(ConversationMessageSchema),
}).strict();

export const ConversationListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  channel: ConversationChannelSchema.optional(),
  status: ConversationStatusSchema.optional(),
  assignment: z.enum(['ALL', 'MINE', 'UNASSIGNED']).default('ALL'),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
}).strict();

export const ConversationIdParamsSchema = z.object({ conversationId: z.string().uuid() }).strict();
export const ConversationListResponseSchema = z.object({ data: z.array(ConversationListItemSchema), nextCursor: z.string().datetime().nullable() }).strict();
export const ConversationDetailResponseSchema = z.object({ data: ConversationDetailSchema }).strict();
export const ConversationResponseSchema = z.object({ data: ConversationListItemSchema }).strict();
export const ConversationMessageResponseSchema = z.object({ data: ConversationMessageSchema }).strict();
export const ConversationPaymentLinkResponseSchema = z.object({
  data: z.object({
    url: z.string().url(),
    appointmentId: z.string().uuid(),
    amount: z.number().int().positive(),
    currency: z.string().length(3),
  }).strict(),
}).strict();

export const SendConversationMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  channel: ConversationChannelSchema.optional(),
  replyToMessageId: z.string().uuid().nullable().optional(),
}).strict();

export const UpdateConversationSchema = z.object({
  status: ConversationStatusSchema.optional(),
  priority: ConversationPrioritySchema.optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  markRead: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, { message: 'At least one update is required' });

export type ConversationChannel = z.infer<typeof ConversationChannelSchema>;
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;
export type ConversationPriority = z.infer<typeof ConversationPrioritySchema>;
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;
export type SendConversationMessage = z.infer<typeof SendConversationMessageSchema>;
export type UpdateConversation = z.infer<typeof UpdateConversationSchema>;
