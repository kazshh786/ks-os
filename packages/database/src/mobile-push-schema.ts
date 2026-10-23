import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { customerCollaborationRelationships, internalNotifications, tenants, users } from './schema.js';
import { mobileDevices } from './mobile-device-schema.js';

// Migration 97 additionally owns principal exclusivity, RLS, scope triggers and queue fan-out.
export const mobilePushRegistrations = pgTable('mobile_push_registrations', {
  id: uuid('id').defaultRandom().primaryKey(), deviceId: uuid('device_id').notNull().references(() => mobileDevices.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), channel: text('channel').notNull(), tokenCiphertext: text('token_ciphertext').notNull(), tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  tokenVersion: integer('token_version').notNull().default(1), tokenUpdatedAt: timestamp('token_updated_at', { withTimezone: true }).notNull().defaultNow(), lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }), invalidatedAt: timestamp('invalidated_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({ device: unique().on(t.deviceId, t.provider, t.channel), activeToken: uniqueIndex('mobile_push_active_token').on(t.tokenHash).where(sql`${t.revokedAt} IS NULL AND ${t.invalidatedAt} IS NULL`) }));

export const mobilePushContexts = pgTable('mobile_push_contexts', {
  id: uuid('id').defaultRandom().primaryKey(), deviceId: uuid('device_id').notNull().references(() => mobileDevices.id, { onDelete: 'cascade' }), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  applicationContext: text('application_context').notNull(), userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), customerRelationshipId: uuid('customer_relationship_id').references(() => customerCollaborationRelationships.id, { onDelete: 'cascade' }),
  securityVersion: integer('security_version'), enabled: boolean('enabled').notNull().default(true), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({ context: uniqueIndex('mobile_push_context_once').on(t.deviceId, t.tenantId, sql`coalesce(${t.userId},${t.customerRelationshipId})`), recipient: index('mobile_push_context_recipient').on(t.tenantId, sql`coalesce(${t.userId},${t.customerRelationshipId})`).where(sql`${t.enabled}`) }));

export const mobilePushDeliveries = pgTable('mobile_push_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(), notificationId: uuid('notification_id').notNull().references(() => internalNotifications.id, { onDelete: 'cascade' }), registrationId: uuid('registration_id').notNull().references(() => mobilePushRegistrations.id, { onDelete: 'cascade' }), contextId: uuid('context_id').notNull().references(() => mobilePushContexts.id, { onDelete: 'cascade' }),
  tokenVersion: integer('token_version').notNull(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }), status: text('status').notNull().default('PENDING'), attemptCount: integer('attempt_count').notNull().default(0), nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  leaseId: uuid('lease_id'), leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), lastErrorCode: varchar('last_error_code', { length: 100 }), providerReference: varchar('provider_reference', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), acceptedAt: timestamp('accepted_at', { withTimezone: true }),
}, t => ({ once: unique().on(t.notificationId, t.registrationId), due: index('mobile_push_due').on(t.nextAttemptAt, t.createdAt).where(sql`${t.status} IN ('PENDING','RETRY')`), lease: index('mobile_push_lease').on(t.leaseExpiresAt).where(sql`${t.status}='PROCESSING'`), pending: index('mobile_push_context_pending').on(t.contextId).where(sql`${t.status} IN ('PENDING','PROCESSING','RETRY')`) }));

export const mobilePushAttempts = pgTable('mobile_push_attempts', {
  id: uuid('id').defaultRandom().primaryKey(), deliveryId: uuid('delivery_id').notNull().references(() => mobilePushDeliveries.id, { onDelete: 'cascade' }), attempt: integer('attempt').notNull(), leaseId: uuid('lease_id').notNull(), startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp('completed_at', { withTimezone: true }), outcome: varchar('outcome', { length: 20 }), errorCode: varchar('error_code', { length: 100 }),
}, t => ({ attempt: unique().on(t.deliveryId, t.attempt), retention: index('mobile_push_attempt_retention').on(t.startedAt) }));
