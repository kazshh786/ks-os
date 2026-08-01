import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { appointments, clients, integrationConnections, tenants, users } from './schema.js';

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
  whatsappServiceWindowExpiresAt: timestamp('whatsapp_service_window_expires_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantLastMessageIdx: index('conversations_tenant_last_message_idx').on(table.tenantId, table.lastMessageAt),
  tenantStatusIdx: index('conversations_tenant_status_idx').on(table.tenantId, table.status, table.lastMessageAt),
  tenantAssignmentIdx: index('conversations_tenant_assignment_idx').on(table.tenantId, table.assignedToUserId, table.lastMessageAt),
  tenantClientIdx: index('conversations_tenant_client_idx').on(table.tenantId, table.clientId),
}));

export const conversationMessages = pgTable('conversation_messages', {
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
  deliveryQueueIdx: index('conversation_messages_delivery_queue_idx').on(table.status, table.nextAttemptAt),
  tenantExternalUnique: uniqueIndex('conversation_messages_tenant_channel_external_unique').on(table.tenantId, table.channelType, table.externalMessageId),
}));

export const conversationAttachments = pgTable('conversation_attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').notNull().references(() => conversationMessages.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 255 }).notNull(),
  fileSizeBytes: integer('file_size_bytes').default(0).notNull(),
  storageKey: varchar('storage_key', { length: 1000 }).notNull(),
  isSafe: boolean('is_safe').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  messageIdx: index('conversation_attachments_message_idx').on(table.messageId),
}));

export const whatsappMessageTemplates = pgTable('whatsapp_message_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => communicationChannels.id, { onDelete: 'cascade' }),
  providerTemplateId: varchar('provider_template_id', { length: 255 }),
  name: varchar('name', { length: 512 }).notNull(),
  language: varchar('language', { length: 35 }).notNull(),
  category: varchar('category', { length: 20 }).notNull(),
  status: varchar('status', { length: 30 }).notNull(),
  components: jsonb('components').default([]).notNull(),
  qualityScore: varchar('quality_score', { length: 30 }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantChannelNameLanguageUnique: uniqueIndex('whatsapp_message_templates_tenant_channel_name_language_unique').on(table.tenantId, table.channelId, table.name, table.language),
  tenantCategoryStatusIdx: index('whatsapp_message_templates_tenant_category_status_idx').on(table.tenantId, table.category, table.status, table.name),
}));

export const whatsappMarketingConsents = pgTable('whatsapp_marketing_consents', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  recipientPhone: varchar('recipient_phone', { length: 30 }).notNull(),
  status: varchar('status', { length: 20 }).default('UNKNOWN').notNull(),
  source: varchar('source', { length: 80 }),
  evidence: jsonb('evidence').default({}).notNull(),
  consentedAt: timestamp('consented_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantPhoneUnique: uniqueIndex('whatsapp_marketing_consents_tenant_phone_unique').on(table.tenantId, table.recipientPhone),
  tenantStatusIdx: index('whatsapp_marketing_consents_tenant_status_idx').on(table.tenantId, table.status, table.updatedAt),
}));
