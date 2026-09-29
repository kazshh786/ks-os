import { z } from 'zod';

export const NativeConversationTypeSchema = z.enum(['CHANNEL', 'PRIVATE_CHANNEL', 'DIRECT', 'GROUP_DIRECT', 'PROJECT', 'CLIENT']);
export const ConversationMemberRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'EXTERNAL', 'GUEST']);
export const CommunicationPositionSchema = z.string().regex(/^(0|[1-9]\d{0,18})$/).refine(value => BigInt(value) <= 9223372036854775807n);
export const CreateNativeConversationSchema = z.object({
  type: NativeConversationTypeSchema,
  name: z.string().trim().min(1).max(255),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  memberUserIds: z.array(z.string().uuid()).max(100).default([]),
}).strict();
export const AddConversationMemberSchema = z.object({
  userId: z.string().uuid(),
  role: ConversationMemberRoleSchema.exclude(['OWNER']).default('MEMBER'),
}).strict();
export const CreateNativeMessageSchema = z.object({
  body: z.string().trim().min(1).max(16000),
  parentMessageId: z.string().uuid().optional(),
}).strict();
export const NativeMessageQuerySchema = z.object({
  before: CommunicationPositionSchema.optional(),
  parentMessageId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export const NativeConversationQuerySchema = z.object({
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export const MarkConversationReadSchema = z.object({ messageId: z.string().uuid() }).strict();
export const NativeConversationSchema = z.object({
  id: z.string().uuid(), type: NativeConversationTypeSchema, name: z.string(),
  slug: z.string().nullable(), description: z.string().nullable(), createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), archivedAt: z.string().datetime().nullable(),
  memberRole: ConversationMemberRoleSchema, lastReadPosition: CommunicationPositionSchema,
  lastReadAt: z.string().datetime().nullable(), unreadCount: z.number().int().nonnegative().optional(),
});
export const NativeMessageSchema = z.object({
  id: z.string().uuid(), conversationId: z.string().uuid(), senderId: z.string().uuid().nullable(),
  body: z.string().nullable(), type: z.string(), parentMessageId: z.string().uuid().nullable(),
  position: CommunicationPositionSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable(), deletedAt: z.string().datetime().nullable(), replyCount: z.number().int().nonnegative(),
});
export const NativeConversationPageSchema = z.object({ data: z.array(NativeConversationSchema), nextCursor: z.string().uuid().nullable() });
export const NativeMessagePageSchema = z.object({ data: z.array(NativeMessageSchema), nextCursor: CommunicationPositionSchema.nullable() });
export type NativeConversation = z.infer<typeof NativeConversationSchema>;
export type NativeMessage = z.infer<typeof NativeMessageSchema>;
export const CommunicationsEventSchema = z.object({
  version: z.literal(1),
  id: CommunicationPositionSchema,
  tenantId: z.string().uuid(),
  conversationId: z.string().uuid(),
  type: z.enum(['conversation.created', 'conversation.member_joined', 'conversation.member_left', 'message.created', 'conversation.read']),
  occurredAt: z.string().datetime(),
  // Invalidation events deliberately carry no message bodies or participant details.
  resourceId: z.string().uuid(),
}).strict();
export type CommunicationsEvent = z.infer<typeof CommunicationsEventSchema>;
export type CreateNativeConversation = z.infer<typeof CreateNativeConversationSchema>;
export type CreateNativeMessage = z.infer<typeof CreateNativeMessageSchema>;
export type NativeMessageQuery = z.infer<typeof NativeMessageQuerySchema>;
export type NativeConversationQuery = z.infer<typeof NativeConversationQuerySchema>;
export type AddConversationMember = z.infer<typeof AddConversationMemberSchema>;
