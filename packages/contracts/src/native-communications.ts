import { z } from 'zod';

export const NativeConversationTypeSchema = z.enum(['CHANNEL', 'PRIVATE_CHANNEL', 'DIRECT', 'GROUP_DIRECT', 'PROJECT', 'CLIENT']);
export const ConversationMemberRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'EXTERNAL', 'GUEST']);
export const CommunicationPositionSchema = z.string().regex(/^(0|[1-9]\d{0,18})$/).refine(value => BigInt(value) <= 9223372036854775807n);
export const CreateNativeConversationSchema = z.object({
  type: NativeConversationTypeSchema,
  name: z.string().trim().max(255).default(''),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  memberUserIds: z.array(z.string().uuid()).max(100).default([]),
}).strict();
export const AddConversationMemberSchema = z.object({
  userId: z.string().uuid(),
  role: ConversationMemberRoleSchema.exclude(['OWNER']).default('MEMBER'),
}).strict();
export const CreateNativeMessageSchema = z.object({
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  body: z.string().max(16000),
  parentMessageId: z.string().uuid().optional(),
  clientMessageId: z.string().uuid().optional(),
  mentions: z.array(z.object({ userId: z.string().uuid(), start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict()).max(50).optional(),
}).strict();
export const UpdateNativeMessageSchema = CreateNativeMessageSchema.pick({ body: true, mentions: true }).extend({ expectedUpdatedAt: z.string().datetime().optional() }).strict();
export const UpdateNativeChannelSchema = z.object({name:z.string().trim().min(1).max(255).optional(),description:z.string().trim().max(2000).optional()}).strict();
export const NativeReactionSchema = z.enum(['👍', '❤️', '🎉', '😄', '👀', '✅']);
export const SetNativeReactionSchema = z.object({ emoji: NativeReactionSchema, active: z.boolean() }).strict();
export const ChannelDiscoveryQuerySchema = z.object({ search: z.string().trim().max(100).optional(), after: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export const NativePeopleQuerySchema = ChannelDiscoveryQuerySchema;
export const NativePersonSchema = z.object({ userId: z.string().uuid(), name: z.string(), role: ConversationMemberRoleSchema.optional() });
export type NativePerson = z.infer<typeof NativePersonSchema>;
export const NativeMessageQuerySchema = z.object({
  before: CommunicationPositionSchema.optional(),
  parentMessageId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export const NativeConversationQuerySchema = z.object({
  after: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  channelsOnly: z.enum(['true']).optional(),
  recent: z.enum(['true']).optional(),
  search: z.string().trim().max(100).optional(),
}).strict();
export const MarkConversationReadSchema = z.object({ messageId: z.string().uuid() }).strict();
export const NativeConversationSchema = z.object({
  id: z.string().uuid(), type: NativeConversationTypeSchema, name: z.string(),
  slug: z.string().nullable(), description: z.string().nullable(), createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), archivedAt: z.string().datetime().nullable(),
  memberRole: ConversationMemberRoleSchema, lastReadPosition: CommunicationPositionSchema,
  lastReadAt: z.string().datetime().nullable(), unreadCount: z.number().int().nonnegative().optional(),
  peerUserId: z.string().uuid().nullable().optional(),
  preview: z.string().nullable().optional(), lastActivityAt: z.string().datetime().optional(),
  memberCount: z.number().int().nonnegative().optional(), latestMessageId: z.string().uuid().nullable().optional(),
});
export const ChatAttachmentSchema = z.object({
 id:z.string().uuid(), fileName:z.string(), mimeType:z.string(), sizeBytes:z.number(), status:z.string(),
 thumbnail:z.boolean(), uploadedBy:z.string().nullable(), uploaderName:z.string().optional(), createdAt:z.string(),
 messageId:z.string().nullable().optional(), conversationId:z.string().optional(), scanStatus:z.string().optional(),
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;
export const ChatPreferencesSchema=z.object({browser:z.boolean(),inApp:z.boolean(),sound:z.boolean(),dnd:z.boolean(),directMessages:z.boolean()}).strict();
export type ChatPreferences=z.infer<typeof ChatPreferencesSchema>;
export const ChatSearchQuerySchema=z.object({
 q:z.string().trim().max(200).default(''), conversationId:z.string().uuid().optional(), senderId:z.string().uuid().optional(),
 from:z.string().datetime().optional(), to:z.string().datetime().optional(), attachments:z.enum(['true']).optional(),
 before:CommunicationPositionSchema.optional(),limit:z.coerce.number().int().min(1).max(50).default(30),
}).strict().refine(v=>!v.from || !v.to || v.from<=v.to,'Start date must precede end date');
export const ChatFileQuerySchema=z.object({after:z.string().uuid().optional(),type:z.enum(['image','document']).optional(),limit:z.coerce.number().int().min(1).max(50).default(30)}).strict();
export const NativeMessageSchema = z.object({
  attachments:z.array(ChatAttachmentSchema).optional(),
  id: z.string().uuid(), conversationId: z.string().uuid(), senderId: z.string().uuid().nullable(),
  body: z.string().nullable(), type: z.string(), parentMessageId: z.string().uuid().nullable(),
  position: CommunicationPositionSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable(), deletedAt: z.string().datetime().nullable(), replyCount: z.number().int().nonnegative(),
  senderName: z.string().optional(),
  mentions: z.array(z.object({ userId: z.string().uuid(), name: z.string(), start: z.number().int(), end: z.number().int() })).optional(),
  reactions: z.array(z.object({ emoji: NativeReactionSchema, count: z.number().int(), mine: z.boolean() })).optional(),
});
export const NativeConversationPageSchema = z.object({ data: z.array(NativeConversationSchema), nextCursor: z.string().max(200).nullable() });
export const NativeMessagePageSchema = z.object({ data: z.array(NativeMessageSchema), nextCursor: CommunicationPositionSchema.nullable() });
export type NativeConversation = z.infer<typeof NativeConversationSchema>;
export type NativeMessage = z.infer<typeof NativeMessageSchema>;
export const CommunicationsEventSchema = z.object({
  version: z.literal(1),
  id: CommunicationPositionSchema,
  tenantId: z.string().uuid(),
  conversationId: z.string().uuid(),
  type: z.enum(['conversation.created', 'conversation.member_joined', 'conversation.member_left', 'message.created', 'conversation.read', 'conversation.updated', 'message.updated', 'message.deleted', 'message.reaction','notification.created','notification.read','notification.preferences_updated','call.created','call.invited','call.accepted','call.declined','call.cancelled','call.started','call.participant_joined','call.participant_left','call.ended','call.failed']),
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

export const ChatSignalSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('activity'),active:z.boolean()}).strict(),
  z.object({type:z.literal('watch'),conversationId:z.string().uuid().nullable(),userIds:z.array(z.string().uuid()).max(100)}).strict(),
  z.object({type:z.literal('typing'),active:z.boolean()}).strict(),
]);
export const ChatEphemeralSchema = z.object({
  version:z.literal(1),type:z.literal('ephemeral.snapshot'),conversationId:z.string().uuid().nullable(),
  presence:z.array(z.object({userId:z.string().uuid(),state:z.enum(['ONLINE','AWAY','OFFLINE'])})),
  typing:z.array(z.object({userId:z.string().uuid(),name:z.string()})),
  readers:z.array(z.object({userId:z.string().uuid(),name:z.string(),position:CommunicationPositionSchema})),
}).strict();
export type ChatSignal = z.infer<typeof ChatSignalSchema>;
export type ChatEphemeral = z.infer<typeof ChatEphemeralSchema>;
