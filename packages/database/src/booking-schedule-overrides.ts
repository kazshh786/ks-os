import { boolean, date, index, pgTable, text, time, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants, users } from './schema.js';

export const bookingScheduleOverrides = pgTable('booking_schedule_overrides', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookingChannel: text('booking_channel', { enum: ['in_shop', 'mobile'] }).notNull(),
  overrideDate: date('override_date', { mode: 'string' }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  note: varchar('note', { length: 160 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  memberChannelDateUnique: uniqueIndex('booking_schedule_overrides_member_channel_date_unique').on(
    table.tenantId,
    table.userId,
    table.bookingChannel,
    table.overrideDate,
  ),
  tenantDateIndex: index('booking_schedule_overrides_tenant_date_idx').on(table.tenantId, table.overrideDate),
}));
