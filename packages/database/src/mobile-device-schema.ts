import { index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
const time = (name: string) => timestamp(name, { withTimezone: true });
export const mobileDevices = pgTable('mobile_devices', {
  id: uuid('id').primaryKey().defaultRandom(), authUserId: uuid('auth_user_id').notNull(), authSessionId: uuid('auth_session_id').notNull().unique(),
  platform: varchar('platform', { length: 10 }).notNull(), applicationId: varchar('application_id', { length: 255 }).notNull(), environment: varchar('environment', { length: 20 }).notNull(),
  installationHash: varchar('installation_hash', { length: 64 }).notNull(), deviceName: varchar('device_name', { length: 80 }),
  authIssuedAt: time('auth_issued_at').notNull(), lastAuthenticatedAt: time('last_authenticated_at').notNull(),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(), lastSeenAt: time('last_seen_at').notNull().defaultNow(), revokedAt: time('revoked_at'), revokeReason: varchar('revoke_reason', { length: 120 }),
}, table => ({ ownerIdentity: unique().on(table.id, table.authUserId), installation: index().on(table.authUserId, table.applicationId, table.environment, table.installationHash) }));
