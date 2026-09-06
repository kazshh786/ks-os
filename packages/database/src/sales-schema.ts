import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { clients, tenants, users } from './schema.js';

export const clientSalesProfiles = pgTable('client_sales_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  lifecycle: varchar('lifecycle', { length: 20 }).default('CUSTOMER').notNull(),
  source: varchar('source', { length: 120 }),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  clientUnique: uniqueIndex('client_sales_profiles_client_unique').on(table.clientId),
  tenantLifecycleIdx: index('client_sales_profiles_tenant_lifecycle_idx').on(table.tenantId, table.lifecycle),
  tenantOwnerIdx: index('client_sales_profiles_tenant_owner_idx').on(table.tenantId, table.ownerUserId),
}));

export const salesPipelines = pgTable('sales_pipelines', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  purpose: varchar('purpose', { length: 30 }).default('SALES').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantPurposeIdx: index('sales_pipelines_tenant_purpose_idx').on(table.tenantId, table.purpose, table.isActive),
}));

export const salesPipelineStages = pgTable('sales_pipeline_stages', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  pipelineId: uuid('pipeline_id').notNull().references(() => salesPipelines.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  position: integer('position').notNull(),
  category: varchar('category', { length: 20 }).default('OPEN').notNull(),
  probability: integer('probability').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  pipelinePositionUnique: uniqueIndex('sales_pipeline_stages_pipeline_position_unique').on(table.pipelineId, table.position),
  tenantPipelineIdx: index('sales_pipeline_stages_tenant_pipeline_idx').on(table.tenantId, table.pipelineId, table.isActive),
}));

export const salesOpportunities = pgTable('sales_opportunities', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  pipelineId: uuid('pipeline_id').notNull().references(() => salesPipelines.id, { onDelete: 'restrict' }),
  stageId: uuid('stage_id').notNull().references(() => salesPipelineStages.id, { onDelete: 'restrict' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  source: varchar('source', { length: 120 }),
  estimatedValue: integer('estimated_value'),
  currency: varchar('currency', { length: 3 }).default('GBP').notNull(),
  expectedCloseDate: timestamp('expected_close_date', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedReason: text('closed_reason'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantUpdatedIdx: index('sales_opportunities_tenant_updated_idx').on(table.tenantId, table.updatedAt),
  tenantOwnerIdx: index('sales_opportunities_tenant_owner_idx').on(table.tenantId, table.ownerUserId),
  tenantStageIdx: index('sales_opportunities_tenant_stage_idx').on(table.tenantId, table.stageId),
  tenantClientIdx: index('sales_opportunities_tenant_client_idx').on(table.tenantId, table.clientId),
}));

export const salesOpportunityActivity = pgTable('sales_opportunity_activity', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  opportunityId: uuid('opportunity_id').notNull().references(() => salesOpportunities.id, { onDelete: 'cascade' }),
  activityType: varchar('activity_type', { length: 40 }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  fromValue: text('from_value'),
  toValue: text('to_value'),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  opportunityCreatedIdx: index('sales_opportunity_activity_opportunity_created_idx').on(table.tenantId, table.opportunityId, table.createdAt),
}));

export const salesQuotes = pgTable('sales_quotes', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  opportunityId: uuid('opportunity_id').notNull().references(() => salesOpportunities.id, { onDelete: 'restrict' }),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
  quoteNumber: varchar('quote_number', { length: 40 }).notNull(),
  version: integer('version').default(1).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  introduction: text('introduction'),
  terms: text('terms'),
  currency: varchar('currency', { length: 3 }).default('GBP').notNull(),
  subtotal: integer('subtotal').default(0).notNull(),
  taxTotal: integer('tax_total').default(0).notNull(),
  total: integer('total').default(0).notNull(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedByName: varchar('accepted_by_name', { length: 255 }),
  acceptedByEmail: varchar('accepted_by_email', { length: 255 }),
  declinedAt: timestamp('declined_at', { withTimezone: true }),
  declinedReason: text('declined_reason'),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantQuoteNumberUnique: uniqueIndex('sales_quotes_tenant_quote_number_unique').on(table.tenantId, table.quoteNumber),
  tenantOpportunityIdx: index('sales_quotes_tenant_opportunity_idx').on(table.tenantId, table.opportunityId),
  tenantStatusIdx: index('sales_quotes_tenant_status_idx').on(table.tenantId, table.status),
}));

export const salesQuoteItems = pgTable('sales_quote_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  quoteId: uuid('quote_id').notNull().references(() => salesQuotes.id, { onDelete: 'cascade' }),
  description: varchar('description', { length: 1000 }).notNull(),
  quantity: integer('quantity').notNull(),
  unitAmount: integer('unit_amount').notNull(),
  taxRateBasisPoints: integer('tax_rate_basis_points').default(0).notNull(),
  subtotal: integer('subtotal').notNull(),
  taxAmount: integer('tax_amount').notNull(),
  total: integer('total').notNull(),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  quotePositionUnique: uniqueIndex('sales_quote_items_quote_position_unique').on(table.quoteId, table.position),
  tenantQuoteIdx: index('sales_quote_items_tenant_quote_idx').on(table.tenantId, table.quoteId),
}));

export const salesQuoteAccessTokens = pgTable('sales_quote_access_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  quoteId: uuid('quote_id').notNull().references(() => salesQuotes.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  quoteTokenIdx: index('sales_quote_access_tokens_quote_idx').on(table.tenantId, table.quoteId),
}));
