import { boolean, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenants, users, clients, appointments, customerCollaborationRelationships } from './schema.js';
import { conversations } from './conversation-schema.js';
const time=(name:string)=>timestamp(name,{withTimezone:true});
export const communicationMeetings=pgTable('communication_meetings',{
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id),
 conversationId:uuid('conversation_id').references(()=>conversations.id),createdBy:uuid('created_by').notNull().references(()=>users.id),
 audience:text('audience').notNull().default('INTERNAL'),description:text('description').notNull().default(''),hostUserId:uuid('host_user_id').references(()=>users.id),
 scheduledStartAt:time('scheduled_start_at'),scheduledEndAt:time('scheduled_end_at'),timezone:text('timezone').notNull().default('Europe/London'),
 customerId:uuid('customer_id').references(()=>clients.id),appointmentId:uuid('appointment_id').references(()=>appointments.id),appointmentVersion:integer('appointment_version'),
 version:integer('version').notNull().default(1),waitingRoomEnabled:boolean('waiting_room_enabled').notNull().default(true),guestScreenShare:boolean('guest_screen_share').notNull().default(false),updatedAt:time('updated_at').notNull().defaultNow(),requestFingerprint:text('request_fingerprint'),
 requestId:uuid('request_id').notNull(),title:text('title').notNull(),type:text('type').notNull(),status:text('status').notNull().default('CREATED'),
 provider:text('provider').notNull().default('LIVEKIT'),providerRoomName:text('provider_room_name').notNull().unique(),
 createdAt:time('created_at').notNull().defaultNow(),startedAt:time('started_at'),endedAt:time('ended_at'),endReason:text('end_reason'),
 expiresAt:time('expires_at').notNull(),lastReconciledAt:time('last_reconciled_at'),cleanupPending:boolean('cleanup_pending').notNull().default(false),
},t=>({retry:unique().on(t.tenantId,t.createdBy,t.requestId)}));
export const communicationMeetingParticipants=pgTable('communication_meeting_participants',{
 responseAuthSessionId:uuid('response_auth_session_id'),responseRequestId:uuid('response_request_id'),
 id:uuid('id').primaryKey().defaultRandom(),
 meetingId:uuid('meeting_id').notNull().references(()=>communicationMeetings.id),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id),
 userId:uuid('user_id').references(()=>users.id),guestName:text('guest_name'),role:text('role').notNull(),invitationState:text('invitation_state').notNull().default('INVITED'),
 invitedAt:time('invited_at').notNull().defaultNow(),respondedAt:time('responded_at'),joinedAt:time('joined_at'),leftAt:time('left_at'),
},t=>({member:unique().on(t.meetingId,t.userId)}));
export const communicationMeetingSessions=pgTable('communication_meeting_sessions',{
 participantId:uuid('participant_id').notNull().references(()=>communicationMeetingParticipants.id),
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),meetingId:uuid('meeting_id').notNull().references(()=>communicationMeetings.id),userId:uuid('user_id').references(()=>users.id),guestSessionId:uuid('guest_session_id'),
 authSessionId:uuid('auth_session_id'),authIssuedAt:time('auth_issued_at'),requestId:uuid('request_id').notNull(),
 identity:text('identity').notNull().unique(),providerSid:text('provider_sid'),createdAt:time('created_at').notNull().defaultNow(),
 tokenExpiresAt:time('token_expires_at').notNull(),tokenCount:integer('token_count').notNull().default(0),tokenIssuedAt:time('token_issued_at').notNull().defaultNow(),joinedAt:time('joined_at'),leftAt:time('left_at'),revokedAt:time('revoked_at'),
},t=>({retry:unique().on(t.meetingId,t.userId,t.authSessionId,t.requestId)}));
export const communicationMeetingWebhooks=pgTable('communication_meeting_webhooks',{
 id:text('id').primaryKey(),bodyHash:text('body_hash').notNull(),processedAt:time('processed_at').notNull().defaultNow(),
});
// Migration93 owns the composite tenant FKs, RLS, scope triggers and partial lifecycle indexes.
export const communicationMeetingInvitations=pgTable('communication_meeting_invitations',{
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id),meetingId:uuid('meeting_id').notNull().references(()=>communicationMeetings.id),secretHash:text('secret_hash').notNull().unique(),requestId:uuid('request_id').notNull(),createdBy:uuid('created_by').notNull().references(()=>users.id),email:text('email'),expiresAt:time('expires_at').notNull(),revokedAt:time('revoked_at'),revokedBy:uuid('revoked_by').references(()=>users.id),claimedAt:time('claimed_at'),createdAt:time('created_at').notNull().defaultNow(),
});
export const communicationMeetingGuests=pgTable('communication_meeting_guests',{
 customerRelationshipId:uuid('customer_relationship_id').references(()=>customerCollaborationRelationships.id),customerConversationId:uuid('customer_conversation_id').references(()=>conversations.id),customerAuthSessionId:uuid('customer_auth_session_id'),customerAuthUserId:uuid('customer_auth_user_id'),customerIssuedAt:time('customer_issued_at'),customerExpiresAt:time('customer_expires_at'),
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id),meetingId:uuid('meeting_id').notNull().references(()=>communicationMeetings.id),participantId:uuid('participant_id').notNull().references(()=>communicationMeetingParticipants.id),invitationId:uuid('invitation_id').unique().references(()=>communicationMeetingInvitations.id),requestId:uuid('request_id').notNull(),name:text('name').notNull(),credentialHash:text('credential_hash').notNull(),state:text('state').notNull().default('WAITING'),expiresAt:time('expires_at').notNull(),createdAt:time('created_at').notNull().defaultNow(),admittedAt:time('admitted_at'),decidedBy:uuid('decided_by').references(()=>users.id),revokedAt:time('revoked_at'),
});
export const communicationMeetingCustomerGrants=pgTable('communication_meeting_customer_grants',{
 tenantId:uuid('tenant_id').notNull().references(()=>tenants.id),meetingId:uuid('meeting_id').notNull().references(()=>communicationMeetings.id),conversationId:uuid('conversation_id').notNull().references(()=>conversations.id),createdBy:uuid('created_by').notNull().references(()=>users.id),createdAt:time('created_at').defaultNow().notNull(),revokedAt:time('revoked_at'),
},t=>({identity:primaryKey({columns:[t.meetingId,t.conversationId]})}));
// Migration94 adds the guest principal checks, composite FKs, admission constraints and private grants.
