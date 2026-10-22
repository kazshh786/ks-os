import { boolean, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenants, users } from './schema.js';
import { conversations } from './conversation-schema.js';
const time=(name:string)=>timestamp(name,{withTimezone:true});
export const communicationMeetings=pgTable('communication_meetings',{
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id),
 conversationId:uuid('conversation_id').notNull().references(()=>conversations.id),createdBy:uuid('created_by').notNull().references(()=>users.id),
 requestId:uuid('request_id').notNull(),title:text('title').notNull(),type:text('type').notNull(),status:text('status').notNull().default('CREATED'),
 provider:text('provider').notNull().default('LIVEKIT'),providerRoomName:text('provider_room_name').notNull().unique(),
 createdAt:time('created_at').notNull().defaultNow(),startedAt:time('started_at'),endedAt:time('ended_at'),endReason:text('end_reason'),
 expiresAt:time('expires_at').notNull(),lastReconciledAt:time('last_reconciled_at'),cleanupPending:boolean('cleanup_pending').notNull().default(false),
},t=>({retry:unique().on(t.tenantId,t.createdBy,t.requestId)}));
export const communicationMeetingParticipants=pgTable('communication_meeting_participants',{
 id:uuid('id').primaryKey().defaultRandom(),
 meetingId:uuid('meeting_id').notNull().references(()=>communicationMeetings.id),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id),
 userId:uuid('user_id').notNull().references(()=>users.id),role:text('role').notNull(),invitationState:text('invitation_state').notNull().default('INVITED'),
 invitedAt:time('invited_at').notNull().defaultNow(),respondedAt:time('responded_at'),joinedAt:time('joined_at'),leftAt:time('left_at'),
},t=>({member:unique().on(t.meetingId,t.userId)}));
export const communicationMeetingSessions=pgTable('communication_meeting_sessions',{
 participantId:uuid('participant_id').notNull().references(()=>communicationMeetingParticipants.id),
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),meetingId:uuid('meeting_id').notNull().references(()=>communicationMeetings.id),userId:uuid('user_id').notNull().references(()=>users.id),
 authSessionId:uuid('auth_session_id').notNull(),authIssuedAt:time('auth_issued_at').notNull(),requestId:uuid('request_id').notNull(),
 identity:text('identity').notNull().unique(),providerSid:text('provider_sid'),createdAt:time('created_at').notNull().defaultNow(),
 tokenExpiresAt:time('token_expires_at').notNull(),tokenCount:integer('token_count').notNull().default(0),tokenIssuedAt:time('token_issued_at').notNull().defaultNow(),joinedAt:time('joined_at'),leftAt:time('left_at'),revokedAt:time('revoked_at'),
},t=>({retry:unique().on(t.meetingId,t.userId,t.authSessionId,t.requestId)}));
export const communicationMeetingWebhooks=pgTable('communication_meeting_webhooks',{
 id:text('id').primaryKey(),bodyHash:text('body_hash').notNull(),processedAt:time('processed_at').notNull().defaultNow(),
});
// Migration93 owns the composite tenant FKs, RLS, scope triggers and partial lifecycle indexes.
