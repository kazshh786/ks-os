import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appointments, clients, customerAccounts, customerClientLinks, customerCollaborationRelationships, integrationConnections, tenants, users } from './schema.js';

export const communicationChannels = pgTable('communication_channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channelType: varchar('channel_type', { length: 20 }).notNull(),
  provider: varchar('provider', { length: 30 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  externalAccountId: varchar('external_account_id', { length: 255 }),
  status: varchar('status', { length: 20 }).default('DISCONNECTED').notNull(),
  capabilities: text('capabilities').array().default([]).notNull(),
  credentialsReference: uuid('credentials_reference').references(() => integrationConnections.id, { onDelete: 'set null' }),
  metadataJson: jsonb('metadata_json').default({}).notNull(),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantTypeAccountUnique: uniqueIndex('communication_channels_tenant_type_account_unique').on(table.tenantId, table.channelType, table.externalAccountId),
  tenantStatusIdx: index('communication_channels_tenant_status_idx').on(table.tenantId, table.status),
}));

export const conversations = pgTable('conversations', {
  externalClientChannel: boolean('external_client_channel').default(false).notNull(),
  collaborationRequestId: uuid('collaboration_request_id'),
  collaborationRequestHash: varchar('collaboration_request_hash', { length: 64 }),
  directKey: varchar('direct_key', { length: 73 }),
  accessMode: varchar('access_mode', { length: 20 }).default('INBOX').notNull(),
  conversationType: varchar('conversation_type', { length: 20 }).default('CLIENT').notNull(),
  name: varchar('name', { length: 255 }),
  slug: varchar('slug', { length: 100 }),
  description: text('description'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  relatedAppointmentId: uuid('related_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  primaryChannel: varchar('primary_channel', { length: 20 }).notNull(),
  subject: varchar('subject', { length: 500 }),
  status: varchar('status', { length: 20 }).default('OPEN').notNull(),
  priority: varchar('priority', { length: 20 }).default('NORMAL').notNull(),
  assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
  unreadCount: integer('unread_count').default(0).notNull(),
  customerDisplayName: varchar('customer_display_name', { length: 255 }).notNull(),
  customerEmail: varchar('customer_email', { length: 255 }),
  customerPhone: varchar('customer_phone', { length: 30 }),
  lastMessagePreview: text('last_message_preview').default('').notNull(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
  tags: text('tags').array().default([]).notNull(),
  metadataJson: jsonb('metadata_json').default({}).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantLastMessageIdx: index('conversations_tenant_last_message_idx').on(table.tenantId, table.lastMessageAt),
  collaborationRequest: uniqueIndex('collaboration_channel_request_unique').on(table.tenantId, table.collaborationRequestId).where(sql`${table.externalClientChannel}`),
  tenantIdUnique: uniqueIndex('conversations_tenant_id_unique').on(table.tenantId, table.id),
  nativeSlugUnique: uniqueIndex('conversations_native_slug_unique').on(table.tenantId, table.slug).where(sql`${table.accessMode} = 'MEMBERS'`),
  directPairUnique: uniqueIndex('conversations_direct_pair_unique').on(table.tenantId,table.directKey).where(sql`${table.directKey} IS NOT NULL`),
  nativeActivityIdx: index('conversations_native_activity_idx').on(table.tenantId,table.lastMessageAt.desc(),table.id.desc()).where(sql`${table.accessMode} = 'MEMBERS' AND ${table.archivedAt} IS NULL`),
  nativeListIdx: index('conversations_native_list_idx').on(table.tenantId, table.id).where(sql`${table.accessMode} = 'MEMBERS' AND ${table.archivedAt} IS NULL`),
  tenantStatusIdx: index('conversations_tenant_status_idx').on(table.tenantId, table.status, table.lastMessageAt),
  tenantAssignmentIdx: index('conversations_tenant_assignment_idx').on(table.tenantId, table.assignedToUserId, table.lastMessageAt),
  tenantClientIdx: index('conversations_tenant_client_idx').on(table.tenantId, table.clientId),
}));

export const conversationMessages = pgTable('conversation_messages', {
  senderCustomerRelationshipId: uuid('sender_customer_relationship_id').references(() => customerCollaborationRelationships.id),
  clientMessageId: uuid('client_message_id'),
  nativePosition: bigint('native_position', { mode: 'bigint' }),
  messageType: varchar('message_type', { length: 30 }).default('TEXT').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').references(() => communicationChannels.id, { onDelete: 'set null' }),
  channelType: varchar('channel_type', { length: 20 }).notNull(),
  direction: varchar('direction', { length: 20 }).notNull(),
  senderType: varchar('sender_type', { length: 20 }).notNull(),
  senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
  senderName: varchar('sender_name', { length: 255 }).notNull(),
  body: text('body').notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  replyToMessageId: uuid('reply_to_message_id'),
  externalMessageId: varchar('external_message_id', { length: 255 }),
  errorCode: varchar('error_code', { length: 120 }),
  attemptCount: integer('attempt_count').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  metadataJson: jsonb('metadata_json').default({}).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  conversationCreatedIdx: index('conversation_messages_conversation_created_idx').on(table.conversationId, table.createdAt),
  scopeUnique: unique('conversation_messages_scope_unique').on(table.tenantId,table.conversationId,table.id),
  nativeRetryUnique: uniqueIndex('conversation_messages_native_retry_unique').on(table.conversationId,table.senderUserId,table.clientMessageId).where(sql`${table.clientMessageId} IS NOT NULL`),
  nativeCustomerRetry: uniqueIndex('native_customer_message_retry').on(table.conversationId,table.senderCustomerRelationshipId,table.clientMessageId).where(sql`${table.clientMessageId} IS NOT NULL`),
  nativePositionUnique: uniqueIndex('conversation_messages_native_position_unique').on(table.conversationId, table.nativePosition),
  nativeThreadIdx: index('conversation_messages_native_thread_idx').on(table.conversationId, table.replyToMessageId, table.nativePosition.desc()).where(sql`${table.nativePosition} IS NOT NULL`),
  deliveryQueueIdx: index('conversation_messages_delivery_queue_idx').on(table.status, table.nextAttemptAt),
  tenantExternalUnique: uniqueIndex('conversation_messages_tenant_channel_external_unique').on(table.tenantId, table.channelType, table.externalMessageId),
}));

export const conversationAttachments = pgTable('conversation_attachments', {
  uploadedByCustomerRelationshipId: uuid('uploaded_by_customer_relationship_id').references(() => customerCollaborationRelationships.id),
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => conversationMessages.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(()=>conversations.id),
  uploadedBy: uuid('uploaded_by').references(()=>users.id),
  status: varchar('status',{length:20}).default('LEGACY').notNull(),
  thumbnailKey:text('thumbnail_key'),scanStatus:varchar('scan_status',{length:30}).default('NOT_SCANNED').notNull(),
  deletedAt:timestamp('deleted_at',{withTimezone:true}),expiresAt:timestamp('expires_at',{withTimezone:true}),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 255 }).notNull(),
  fileSizeBytes: integer('file_size_bytes').default(0).notNull(),
  storageKey: varchar('storage_key', { length: 1000 }).notNull(),
  isSafe: boolean('is_safe').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  messageIdx: index('conversation_attachments_message_idx').on(table.messageId),
}));

// SQL migration also enforces tenant-scoped relationships and principal exclusivity.
export const conversationMembers = pgTable('conversation_members', {
  customerRelationshipId: uuid('customer_relationship_id').references(() => customerCollaborationRelationships.id),
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  customerLinkId: uuid('customer_link_id').references(() => customerClientLinks.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  leftAt: timestamp('left_at', { withTimezone: true }),
  lastReadPosition: bigint('last_read_position', { mode: 'bigint' }).default(0n).notNull(),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  notificationPreference: varchar('notification_preference', { length: 20 }).default('ALL').notNull(),
}, table => ({
  userUnique: uniqueIndex('conversation_members_conversation_id_user_id_key').on(table.conversationId, table.userId),
  customerUnique: uniqueIndex('conversation_members_conversation_id_customer_link_id_key').on(table.conversationId, table.customerLinkId),
  relationshipUnique: uniqueIndex('conversation_member_relationship_unique').on(table.conversationId, table.customerRelationshipId),
  userIdx: index('conversation_members_user_idx').on(table.tenantId, table.userId, table.conversationId).where(sql`${table.leftAt} IS NULL`),
  customerIdx: index('conversation_members_customer_idx').on(table.tenantId, table.customerLinkId, table.conversationId).where(sql`${table.leftAt} IS NULL`),
}));

export const communicationEvents = pgTable('communication_events', {
  actorCustomerRelationshipId: uuid('actor_customer_relationship_id').references(() => customerCollaborationRelationships.id),
  recipientCustomerRelationshipId: uuid('recipient_customer_relationship_id').references(() => customerCollaborationRelationships.id),
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  meetingId: uuid('meeting_id'),
  actorUserId: uuid('actor_user_id').references(()=>users.id),
  recipientUserId:uuid('recipient_user_id').references(()=>users.id),
  type: varchar('type', { length: 60 }).notNull(),
  resourceId: uuid('resource_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ workspaceReplayIdx: index('communication_events_workspace_replay_idx').on(table.tenantId,table.id), replayIdx: index('communication_events_replay_idx').on(table.tenantId, table.conversationId, table.id) }));

export const communicationTickets = pgTable('communication_tickets', {
  tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  actor: jsonb('actor').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => ({ expiryIdx: index('communication_tickets_expiry_idx').on(table.expiresAt) }));

// Composite message scope and active membership constraints are enforced by migration 90.
export const communicationReactions = pgTable('communication_reactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerRelationshipId: uuid('customer_relationship_id').references(() => customerCollaborationRelationships.id),
  tenantId: uuid('tenant_id').notNull(), conversationId: uuid('conversation_id').notNull(),
  messageId: uuid('message_id').notNull().references(() => conversationMessages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ staff: unique('reaction_user_unique').on(table.messageId,table.userId,table.emoji), customer: unique('reaction_customer_unique').on(table.messageId,table.customerRelationshipId,table.emoji), userIdx:index('communication_reactions_user_idx').on(table.userId) }));
export const communicationMentions = pgTable('communication_mentions', {
  customerRelationshipId: uuid('customer_relationship_id').references(() => customerCollaborationRelationships.id),
  tenantId: uuid('tenant_id').notNull(), conversationId: uuid('conversation_id').notNull(),
  messageId: uuid('message_id').notNull().references(() => conversationMessages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  startOffset: integer('start_offset').notNull(), endOffset: integer('end_offset').notNull(),displayName:text('display_name').notNull(),
}, table => ({ identity:primaryKey({name:'communication_mentions_pkey',columns:[table.messageId,table.startOffset]}),recipientIdx:index('communication_mentions_recipient_idx').on(table.tenantId,table.userId,table.messageId) }));

export const communicationPreferences=pgTable('communication_preferences',{
 id:uuid('id').defaultRandom().primaryKey(),
 customerRelationshipId:uuid('customer_relationship_id').unique().references(()=>customerCollaborationRelationships.id),
 tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),
 userId:uuid('user_id').unique().references(()=>users.id,{onDelete:'cascade'}),
 browser:boolean('browser').default(false).notNull(),inApp:boolean('in_app').default(true).notNull(),
 sound:boolean('sound').default(false).notNull(),dnd:boolean('dnd').default(false).notNull(),directMessages:boolean('direct_messages').default(true).notNull(),
});

// Migration95 owns lifecycle checks, composite scope FKs and API-only privileges.
export const customerCollaborationInvitations=pgTable('customer_collaboration_invitations',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id),clientId:uuid('client_id').notNull().references(()=>clients.id),conversationId:uuid('conversation_id').notNull().references(()=>conversations.id),
 emailNormalized:text('email_normalized').notNull(),secretHash:varchar('secret_hash',{length:64}).notNull().unique(),status:text('status').notNull().default('PENDING'),requestId:uuid('request_id').notNull(),
 expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),acceptedAt:timestamp('accepted_at',{withTimezone:true}),revokedAt:timestamp('revoked_at',{withTimezone:true}),acceptedCustomerAccountId:uuid('accepted_customer_account_id').references(()=>customerAccounts.id),
 createdBy:uuid('created_by').notNull().references(()=>users.id),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
},t=>({request:unique().on(t.tenantId,t.requestId)}));
export const customerCollaborationHandoffs=pgTable('customer_collaboration_handoffs',{
 id:uuid('id').defaultRandom().primaryKey(),invitationId:uuid('invitation_id').notNull().references(()=>customerCollaborationInvitations.id,{onDelete:'cascade'}),secretHash:varchar('secret_hash',{length:64}).notNull().unique(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),consumedAt:timestamp('consumed_at',{withTimezone:true}),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
});
