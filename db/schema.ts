import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, boolean, time } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  subdomain: varchar('subdomain', { length: 100 }).notNull().unique(),
  customDomain: varchar('custom_domain', { length: 255 }).unique(),
  // Brand color customization for white-labeling
  primaryColor: varchar('primary_color', { length: 7 }).default('#0f172a').notNull(), // Slate 900
  secondaryColor: varchar('secondary_color', { length: 7 }).default('#475569').notNull(), // Slate 600
  accentColor: varchar('accent_color', { length: 7 }).default('#10b981').notNull(), // Emerald 500
  packageTier: text('package_tier', { enum: ['core', 'growth', 'scale'] }).default('core').notNull(),
  timezone: varchar('timezone', { length: 100 }).default('Europe/London').notNull(),
  currency: varchar('currency', { length: 3 }).default('GBP').notNull(),
  defaultPaymentMode: varchar('default_payment_mode', { length: 30 }).default('customer_choice').notNull(),
  // Loyalty settings
  enableLoyalty: boolean('enable_loyalty').default(false).notNull(),
  loyaltyPointsPerDollar: integer('loyalty_points_per_dollar').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // Tied directly to Supabase Auth's user id
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: text('role', { enum: ['owner', 'staff'] }).default('staff').notNull(),
  permissions: jsonb('permissions').default({}).notNull(), // JSON block for granular feature access
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const services = pgTable('services', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  duration: integer('duration').notNull(), // in minutes
  bufferTime: integer('buffer_time').default(0).notNull(), // padding added after the service
  price: integer('price').notNull(), // in cents
  discount: integer('discount').default(0).notNull(), // discount in cents
  requiresDeposit: boolean('requires_deposit').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const staffSchedules = pgTable('staff_schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(), // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startTime: varchar('start_time', { length: 5 }).notNull(), // "HH:MM" e.g., "09:00"
  endTime: varchar('end_time', { length: 5 }).notNull(), // "HH:MM" e.g., "17:00"
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const bookingChannelSchedules = pgTable('booking_channel_schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookingChannel: text('booking_channel', { enum: ['in_shop', 'mobile'] }).notNull(),
  dayOfWeek: integer('day_of_week').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const clients = pgTable('clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  medicalNotes: text('medical_notes'),
  patchTestDate: timestamp('patch_test_date', { withTimezone: true }),
  lastVisitDate: timestamp('last_visit_date', { withTimezone: true }),
  loyaltyPoints: integer('loyalty_points').default(0).notNull(), // Client's active loyalty point balance
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const appointments = pgTable('appointments', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id') // The staff member performing the service
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .references(() => clients.id, { onDelete: 'set null' }), // Linked directly to CRM
  clientName: varchar('client_name', { length: 255 }),
  serviceId: uuid('service_id')
    .references(() => services.id, { onDelete: 'cascade' }),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }).notNull(),
  status: text('status', { enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'BLOCKED'] })
    .default('PENDING')
    .notNull(),
  notes: text('notes'),
  publicReference: uuid('public_reference').defaultRandom().notNull(),
  idempotencyKey: uuid('idempotency_key'),
  paymentMode: varchar('payment_mode', { length: 30 }).default('pay_later').notNull(),
  paymentStatus: varchar('payment_status', { length: 30 }).default('NOT_REQUIRED').notNull(),
  quotedAmount: integer('quoted_amount').default(0).notNull(),
  holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
  bookingChannel: text('booking_channel', { enum: ['in_shop', 'mobile'] }).default('in_shop').notNull(),
  mobileAddress: jsonb('mobile_address'),
  resourceId: uuid('resource_id')
    .references(() => resources.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const forms = pgTable('forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  fieldsJson: jsonb('fields_json').notNull(), // Array of field objects: { label, type, required }
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const clientFormSubmissions = pgTable('client_form_submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  formId: uuid('form_id')
    .notNull()
    .references(() => forms.id, { onDelete: 'cascade' }),
  responseJson: jsonb('response_json').notNull(), // Key-value object of inputs
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  sku: varchar('sku', { length: 100 }).notNull().unique(),
  priceInCents: integer('price_in_cents').notNull(), // Store amount in cents (e.g. $15.50 -> 1550)
  stockQuantity: integer('stock_quantity').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const checkoutTransactions = pgTable('checkout_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id')
    .notNull()
    .references(() => appointments.id, { onDelete: 'cascade' }),
  totalAmount: integer('total_amount').notNull(), // Sum of service price + retail additions
  paymentStatus: text('payment_status', { enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] })
    .default('PENDING')
    .notNull(),
  paymentMethod: text('payment_method', { enum: ['CARD', 'CASH', 'SPLIT'] })
    .default('CARD')
    .notNull(),
  purchasedProducts: jsonb('purchased_products').default([]).notNull(), // Array of: { productId: uuid, quantity: number }
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  purpose: text('purpose', { enum: ['point_of_sale', 'booking_payment'] }).default('point_of_sale').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const loyaltyLedger = pgTable('loyalty_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  pointsDelta: integer('points_delta').notNull(),
  reason: varchar('reason', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const resources = pgTable('resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 100 }).notNull(), // e.g. 'room', 'chair', 'laser'
  capacity: integer('capacity').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const serviceResources = pgTable('service_resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  resourceId: uuid('resource_id')
    .notNull()
    .references(() => resources.id, { onDelete: 'cascade' }),
});

export const waitlist = pgTable('waitlist', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  staffId: uuid('staff_id')
    .references(() => users.id, { onDelete: 'set null' }),
  preferredDate: timestamp('preferred_date').notNull(),
  status: varchar('status', { length: 50 }).default('PENDING').notNull(), // PENDING, FILLED, EXPIRED
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const clientWallets = pgTable('client_wallets', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  balanceInCents: integer('balance_in_cents').default(0).notNull(),
  giftCardBalanceInCents: integer('gift_card_balance_in_cents').default(0).notNull(),
  packagesJson: jsonb('packages_json').default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const staffPricing = pgTable('staff_pricing', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  customPriceInCents: integer('custom_price_in_cents').notNull(),
  customDurationMinutes: integer('custom_duration_minutes').notNull(),
});

export const automationRules = pgTable('automation_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  triggerEvent: varchar('trigger_event', { length: 100 }).notNull(), // booking_created, off_peak_discount
  templateText: text('template_text').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const offPeakRules = pgTable('off_peak_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(), // 0 = Sunday, 1 = Monday...
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  discountPercentage: integer('discount_percentage').notNull(),
});
