import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { clients, tasks, tenants, users } from './schema.js';
import { salesOpportunities, salesQuotes } from './sales-schema.js';

export const workItems = pgTable('work_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  referenceNumber: varchar('reference_number', { length: 40 }).notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  workType: varchar('work_type', { length: 20 }).default('JOB').notNull(),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
  priority: varchar('priority', { length: 20 }).default('NORMAL').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
  sourceOpportunityId: uuid('source_opportunity_id').references(() => salesOpportunities.id, { onDelete: 'set null' }),
  sourceQuoteId: uuid('source_quote_id').references(() => salesQuotes.id, { onDelete: 'set null' }),
  scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }),
  scheduledEndAt: timestamp('scheduled_end_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  locationLabel: varchar('location_label', { length: 500 }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  blockedReason: text('blocked_reason'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantReferenceNumberUnique: uniqueIndex('work_items_tenant_reference_number_unique').on(table.tenantId, table.referenceNumber),
  tenantSourceOpportunityUnique: uniqueIndex('work_items_tenant_source_opportunity_unique').on(table.tenantId, table.sourceOpportunityId),
  tenantStatusUpdatedIdx: index('work_items_tenant_status_updated_idx').on(table.tenantId, table.status, table.updatedAt),
  tenantAssigneeStatusIdx: index('work_items_tenant_assignee_status_idx').on(table.tenantId, table.assignedUserId, table.status),
  tenantClientIdx: index('work_items_tenant_client_idx').on(table.tenantId, table.clientId),
  tenantDueIdx: index('work_items_tenant_due_idx').on(table.tenantId, table.dueAt),
}));

export const workItemActivity = pgTable('work_item_activity', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  workItemId: uuid('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  activityType: varchar('activity_type', { length: 40 }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  fromValue: text('from_value'),
  toValue: text('to_value'),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  workCreatedIdx: index('work_item_activity_work_created_idx').on(table.tenantId, table.workItemId, table.createdAt),
}));

// This relation is intentionally lightweight: work uses the canonical tasks table
// rather than creating a second task system. `tasks.source_type = WORK_ITEM` and
// `tasks.source_id = work_items.id` are the authoritative link. This table only
// provides a future-safe FK-backed projection for reporting and cleanup when needed.
export const workTaskLinks = pgTable('work_task_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  workItemId: uuid('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  taskUnique: uniqueIndex('work_task_links_task_unique').on(table.taskId),
  tenantWorkIdx: index('work_task_links_tenant_work_idx').on(table.tenantId, table.workItemId),
}));
