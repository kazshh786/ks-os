import { z } from 'zod';

const id = z.string().uuid();
const position = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
export const MobileSyncQuerySchema = z.object({
  cursor: z.string().min(1).max(1500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();
export const MobileSyncChangeSchema = z.object({
  id: position, position, type: z.string().max(80),
  conversationId: id.nullable(), meetingId: id.nullable(), resourceId: id.nullable(),
  action: z.enum(['REFRESH', 'PURGE_CONVERSATION']), occurredAt: z.string().datetime(),
}).strict();
export const MobileSyncResponseSchema = z.object({
  version: z.literal(1), mode: z.enum(['SNAPSHOT_REQUIRED', 'CHANGES']),
  changes: z.array(MobileSyncChangeSchema), cursor: z.string(), hasMore: z.boolean(),
  cursorExpiresAt: z.string().datetime(),
}).strict();
export const MobileBadgesSchema = z.object({
  unreadConversations: z.number().int().nonnegative(), unreadDirectMessages: z.number().int().nonnegative(),
  unreadClientConversations: z.number().int().nonnegative(), unreadNotifications: z.number().int().nonnegative(),
  missedCalls: z.number().int().nonnegative(),
}).strict();
export const CommunicationLinkTargetSchema = z.object({
  kind: z.enum(['CONVERSATION', 'MESSAGE', 'THREAD', 'MEETING', 'PORTAL']),
  tenantId: id, relationshipId: id.optional(), conversationId: id.optional(),
  messageId: id.optional(), meetingId: id.optional(),
}).strict().superRefine((value, ctx) => {
  const chat = ['CONVERSATION', 'MESSAGE', 'THREAD'].includes(value.kind);
  if (chat !== Boolean(value.conversationId) || (['MESSAGE', 'THREAD'].includes(value.kind) !== Boolean(value.messageId))
    || ((value.kind === 'MEETING') !== Boolean(value.meetingId)) || (value.kind === 'PORTAL' && !value.relationshipId)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid resource references for this link' });
  }
});
export const ResolveCommunicationLinkSchema = z.object({ url: z.string().url().max(2000) }).strict();
export type MobileSyncQuery = z.infer<typeof MobileSyncQuerySchema>;
export type CommunicationLinkTarget = z.infer<typeof CommunicationLinkTargetSchema>;
