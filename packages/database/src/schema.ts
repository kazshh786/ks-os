import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, boolean, time, date, numeric, uniqueIndex, index, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessReference: uuid('business_reference').defaultRandom().notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  subdomain: varchar('subdomain', { length: 100 }).notNull().unique(),
  customDomain: varchar('custom_domain', { length: 255 }).unique(),
  primaryColor: varchar('primary_color', { length: 7 }).default('#0f172a').notNull(),
  secondaryColor: varchar('secondary_color', { length: 7 }).default('#475569').notNull(),
  accentColor: varchar('accent_color', { length: 7 }).default('#10b981').notNull(),
  packageTier: text('package_tier', { enum: ['core', 'growth', 'scale'] }).default('core').notNull(),
  timezone: varchar('timezone', { length: 100 }).default('Europe/London').notNull(),
  currency: varchar('currency', { length: 3 }).default('GBP').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  agencyReference: uuid('agency_reference').defaultRandom().notNull().unique(),
  lifecycleStatus: varchar('lifecycle_status', { length: 30 }).default('PROSPECT').notNull(),
  legalBusinessName: varchar('legal_business_name', { length: 255 }),
  businessType: varchar('business_type', { length: 80 }),
  primaryContactName: varchar('primary_contact_name', { length: 255 }),
  primaryContactEmail: varchar('primary_contact_email', { length: 255 }),
  contractStartAt: timestamp('contract_start_at', { withTimezone: true }),
  minimumTermEndsAt: timestamp('minimum_term_ends_at', { withTimezone: true }),
  foundingClient: boolean('founding_client').default(false).notNull(),
  commercialNotes: text('commercial_notes'),
  launchedAt: timestamp('launched_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  offboardedAt: timestamp('offboarded_at', { withTimezone: true }),
  defaultPaymentMode: varchar('default_payment_mode', { length: 30 }).default('customer_choice').notNull(),
  enableLoyalty: boolean('enable_loyalty').default(false).notNull(),
  loyaltyPointsPerDollar: integer('loyalty_points_per_dollar').default(1).notNull(),
  replyToEmail: varchar('reply_to_email', { length: 255 }),
  senderDisplayName: varchar('sender_display_name', { length: 255 }),
  bookingConfirmationEnabled: boolean('booking_confirmation_enabled').default(true).notNull(),
  bookingCancellationEnabled: boolean('booking_cancellation_enabled').default(true).notNull(),
  bookingRescheduleEnabled: boolean('booking_reschedule_enabled').default(true).notNull(),
  customerCancellationEnabled: boolean('customer_cancellation_enabled').default(true).notNull(),
  customerReschedulingEnabled: boolean('customer_rescheduling_enabled').default(true).notNull(),
  minimumCancellationNoticeMinutes: integer('minimum_cancellation_notice_minutes').default(1440).notNull(),
  minimumRescheduleNoticeMinutes: integer('minimum_reschedule_notice_minutes').default(1440).notNull(),
  maximumCustomerReschedules: integer('maximum_customer_reschedules').default(3).notNull(),
  requireCancellationReason: boolean('require_cancellation_reason').default(false).notNull(),
  lateCancellationMessage: text('late_cancellation_message').default('Online changes are no longer available because your appointment is within the salon notice period. Please contact the salon.').notNull(),
  depositPolicyMessage: text('deposit_policy_message').default('Cancelling an appointment does not automatically issue a refund. The salon will review any payment already made.').notNull(),
  appointmentRemindersEnabled: boolean('appointment_reminders_enabled').default(true).notNull(),
  formDeliveryEnabled: boolean('form_delivery_enabled').default(true).notNull(),
  formRemindersEnabled: boolean('form_reminders_enabled').default(true).notNull(),
  paymentConfirmationEnabled: boolean('payment_confirmation_enabled').default(true).notNull(),
  formReminderTiming: varchar('form_reminder_timing', { length: 50 }).default('24_hours_before_appointment').notNull(),
  operationalPhone: varchar('operational_phone', { length: 30 }),
  smsEnabled: boolean('sms_enabled').default(false).notNull(),
  smsBookingConfirmationEnabled: boolean('sms_booking_confirmation_enabled').default(true).notNull(),
  smsBookingRescheduleEnabled: boolean('sms_booking_reschedule_enabled').default(true).notNull(),
  smsBookingCancellationEnabled: boolean('sms_booking_cancellation_enabled').default(true).notNull(),
  smsAppointmentRemindersEnabled: boolean('sms_appointment_reminders_enabled').default(true).notNull(),
  smsFormDeliveryEnabled: boolean('sms_form_delivery_enabled').default(true).notNull(),
  smsFormRemindersEnabled: boolean('sms_form_reminders_enabled').default(true).notNull(),
  smsPaymentConfirmationEnabled: boolean('sms_payment_confirmation_enabled').default(false).notNull(),
  smsRefundUpdatesEnabled: boolean('sms_refund_updates_enabled').default(false).notNull(),
  smsReminderTiming: varchar('sms_reminder_timing', { length: 30 }).default('24_hours_before').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  // `id` is the tenant-membership key referenced by operational records. It is
  // deliberately distinct from the nullable Supabase identity below so one
  // identity can belong to several tenants without rewriting historic FKs.
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  authUserId: uuid('auth_user_id'),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  emailNormalized: varchar('email_normalized', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: text('role', { enum: ['owner', 'staff'] }).default('staff').notNull(),
  permissions: jsonb('permissions').default({}).notNull(),
  accountStatus: varchar('account_status', { length: 20 }).default('ACTIVE').notNull(),
  invitedByUserId: uuid('invited_by_user_id'),
  invitedByAgencyUserId: uuid('invited_by_agency_user_id'),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  securityVersion: integer('security_version').default(1).notNull(),
  sessionsValidAfter: timestamp('sessions_valid_after', { withTimezone: true }),
  jobTitle: varchar('job_title', { length: 120 }),
  phone: varchar('staff_phone', { length: 30 }),
  profileImageUrl: varchar('profile_image_url', { length: 1000 }),
  bio: text('bio'),
  bookingEnabled: boolean('booking_enabled').default(true).notNull(),
  accessProfile: varchar('access_profile',{length:30}).default('PRACTITIONER').notNull(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, table => ({
  tenantAuthUserUnique: uniqueIndex('users_tenant_auth_user_unique').on(table.tenantId, table.authUserId),
  tenantEmailUnique: uniqueIndex('users_tenant_email_normalized_unique').on(table.tenantId, table.emailNormalized),
  authStatusIdx: index('users_auth_status_idx').on(table.authUserId, table.accountStatus),
}));

export const staffInvitations = pgTable('staff_invitations', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),
  emailNormalized: varchar('email_normalized',{length:255}).notNull(), name: varchar('name',{length:255}).notNull(), role: varchar('role',{length:20}).default('staff').notNull(),
  status: varchar('status',{length:20}).default('PENDING').notNull(), authUserId: uuid('auth_user_id'), invitedByUserId: uuid('invited_by_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}),
  expiresAt: timestamp('expires_at',{withTimezone:true}).notNull(), createdAt: timestamp('created_at',{withTimezone:true}).defaultNow().notNull(), sentAt: timestamp('sent_at',{withTimezone:true}),
  acceptedAt: timestamp('accepted_at',{withTimezone:true}), cancelledAt: timestamp('cancelled_at',{withTimezone:true}), lastSentAt: timestamp('last_sent_at',{withTimezone:true}), sendCount: integer('send_count').default(0).notNull(),
});

export const staffServiceAssignments = pgTable('staff_service_assignments', {
 id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}), staffUserId: uuid('staff_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}), serviceId: uuid('service_id').notNull().references(()=>services.id,{onDelete:'restrict'}), isActive:boolean('is_active').default(true).notNull(), createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(), updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
},t=>({memberServiceUnique:uniqueIndex('staff_service_assignments_member_service_unique').on(t.staffUserId,t.serviceId)}));

export const services = pgTable('services', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  duration: integer('duration').notNull(),
  bufferTime: integer('buffer_time').default(0).notNull(),
  price: integer('price').notNull(),
  discount: integer('discount').default(0).notNull(),
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
  dayOfWeek: integer('day_of_week').notNull(),
  startTime: varchar('start_time', { length: 5 }).notNull(),
  endTime: varchar('end_time', { length: 5 }).notNull(),
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
  phoneE164: varchar('phone_e164', { length: 20 }),
  smsTransactionalStatus: varchar('sms_transactional_status', { length: 20 }).default('UNKNOWN').notNull(),
  smsMarketingStatus: varchar('sms_marketing_status', { length: 20 }).default('UNKNOWN').notNull(),
  smsOptedOutAt: timestamp('sms_opted_out_at', { withTimezone: true }),
  smsOptedInAt: timestamp('sms_opted_in_at', { withTimezone: true }),
  smsSuppressionReason: varchar('sms_suppression_reason', { length: 100 }),
  smsLastConfirmedAt: timestamp('sms_last_confirmed_at', { withTimezone: true }),
  medicalNotes: text('medical_notes'),
  patchTestDate: timestamp('patch_test_date', { withTimezone: true }),
  lastVisitDate: timestamp('last_visit_date', { withTimezone: true }),
  loyaltyPoints: integer('loyalty_points').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Customer identities are deliberately separate from staff workspace memberships.
// `auth_user_id` maps to Supabase Auth, while links map a customer to one canonical
// CRM client record per tenant.
export const customerAccounts = pgTable('customer_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  authUserId: uuid('auth_user_id').notNull().unique(),
  emailNormalized: varchar('email_normalized', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  phoneE164: varchar('phone_e164', { length: 20 }),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  sessionsValidAfter: timestamp('sessions_valid_after', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  lastSignedInAt: timestamp('last_signed_in_at', { withTimezone: true }),
});

export const customerClientLinks = pgTable('customer_client_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerAccountId: uuid('customer_account_id').notNull().references(() => customerAccounts.id, { onDelete: 'cascade' }),
  authUserId: uuid('auth_user_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  linkSource: varchar('link_source', { length: 30 }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => ({
  tenantClientUnique: uniqueIndex('customer_client_links_tenant_client_unique').on(table.tenantId, table.clientId),
  tenantAuthUnique: uniqueIndex('customer_client_links_tenant_auth_unique').on(table.tenantId, table.authUserId),
  customerStatusIdx: index('customer_client_links_customer_status_idx').on(table.customerAccountId, table.status),
}));

export const customerAccountClaims = pgTable('customer_account_claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  emailNormalized: varchar('email_normalized', { length: 255 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  status: varchar('status', { length: 20 }).default('PENDING').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdByType: varchar('created_by_type', { length: 30 }).default('PUBLIC_BOOKING').notNull(),
}, (table) => ({
  pendingAppointmentIdx: index('customer_account_claims_pending_appointment_idx').on(table.appointmentId, table.status),
  expiryIdx: index('customer_account_claims_expiry_idx').on(table.status, table.expiresAt),
}));

export const appointments = pgTable('appointments', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .references(() => clients.id, { onDelete: 'set null' }),
  clientName: varchar('client_name', { length: 255 }),
  serviceId: uuid('service_id')
    .references(() => services.id, { onDelete: 'cascade' }),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }).notNull(),
  status: text('status', { enum: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'BLOCKED'] })
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
  locationId: uuid('location_id'),
  version: integer('version').default(1).notNull(),
  customerRescheduleCount: integer('customer_reschedule_count').default(0).notNull(),
  cancellationSource: varchar('cancellation_source', { length: 20 }),
  cancellationReasonCode: varchar('cancellation_reason_code', { length: 40 }),
  cancellationReasonText: text('cancellation_reason_text'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  isTest: boolean('is_test').default(false).notNull(),
  isInternal: boolean('is_internal').default(false).notNull(),
  reviewInvitationExcluded: boolean('review_invitation_excluded').default(false).notNull(),
  reviewInvitationExclusionReason: varchar('review_invitation_exclusion_reason', { length: 80 }),
  bookingSource: varchar('booking_source', { length: 40 }).default('STAFF_CREATED').notNull(),
  sourceMedium: varchar('source_medium', { length: 80 }),
  sourceCampaign: varchar('source_campaign', { length: 120 }),
  sourceReferrerHost: varchar('source_referrer_host', { length: 255 }),
  bookingPageId: uuid('booking_page_id'),
  bookingHoldId: uuid('booking_hold_id'),
  intakeStatus: varchar('intake_status', { length: 20 }).default('NOT_REQUIRED').notNull(),
  attentionReason: varchar('attention_reason', { length: 120 }),
  customerNotes: text('customer_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantPublicReferenceUnique: uniqueIndex('appointments_tenant_public_reference_unique').on(table.tenantId, table.publicReference),
}));

export const bookingPages = pgTable('booking_pages', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }).unique(),
  publicSlug: varchar('public_slug', { length: 63 }).notNull().unique(),
  title: varchar('title', { length: 160 }).notNull(),
  description: text('description').default('').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  published: boolean('published').default(true).notNull(),
  logoUrl: varchar('logo_url', { length: 1000 }),
  coverImageUrl: varchar('cover_image_url', { length: 1000 }),
  layout: varchar('layout', { length: 20 }).default('STANDARD').notNull(),
  themeJson: jsonb('theme_json').default({}).notNull(),
  defaultLanguage: varchar('default_language', { length: 12 }).default('en-GB').notNull(),
  supportedLanguages: text('supported_languages').array().default(['en-GB']).notNull(),
  defaultLocationId: uuid('default_location_id'),
  allowedLocationIds: uuid('allowed_location_ids').array().default([]).notNull(),
  allowedServiceIds: uuid('allowed_service_ids').array().default([]).notNull(),
  allowedStaffIds: uuid('allowed_staff_ids').array().default([]).notNull(),
  bookingRules: jsonb('booking_rules').default({}).notNull(),
  paymentSettings: jsonb('payment_settings').default({}).notNull(),
  intakeFormSettings: jsonb('intake_form_settings').default({}).notNull(),
  confirmationSettings: jsonb('confirmation_settings').default({}).notNull(),
  cancellationSettings: jsonb('cancellation_settings').default({}).notNull(),
  seoSettings: jsonb('seo_settings').default({}).notNull(),
  socialSharingSettings: jsonb('social_sharing_settings').default({}).notNull(),
  analyticsSettings: jsonb('analytics_settings').default({ enabled: true }).notNull(),
  customDomain: varchar('custom_domain', { length: 255 }),
  customDomainStatus: varchar('custom_domain_status', { length: 20 }).default('NOT_CONFIGURED').notNull(),
  customDomainVerificationTokenHash: varchar('custom_domain_verification_token_hash', { length: 64 }),
  canonicalDomain: varchar('canonical_domain', { length: 255 }),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  publicResolutionIdx: index('booking_pages_public_resolution_idx').on(table.publicSlug, table.enabled, table.published),
}));

export const bookingPageSlugHistory = pgTable('booking_page_slug_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  bookingPageId: uuid('booking_page_id').notNull().references(() => bookingPages.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  previousSlug: varchar('previous_slug', { length: 63 }).notNull().unique(),
  changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  redirectUntil: timestamp('redirect_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const bookingPageForms = pgTable('booking_page_forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  bookingPageId: uuid('booking_page_id').notNull().references(() => bookingPages.id, { onDelete: 'cascade' }),
  formId: uuid('form_id').notNull().references(() => forms.id, { onDelete: 'restrict' }),
  serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
  staffUserId: uuid('staff_user_id').references(() => users.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id'),
  completionStage: varchar('completion_stage', { length: 30 }).default('AFTER_BOOKING').notNull(),
  required: boolean('required').default(true).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const bookingHolds = pgTable('booking_holds', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  bookingPageId: uuid('booking_page_id').notNull().references(() => bookingPages.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  staffUserId: uuid('staff_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id'),
  resourceId: uuid('resource_id'),
  customerSessionHash: varchar('customer_session_hash', { length: 64 }).notNull(),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  consumedAppointmentId: uuid('consumed_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
}, table => ({
  idempotencyUnique: uniqueIndex('booking_holds_booking_page_idempotency_unique').on(table.bookingPageId, table.idempotencyKey),
  expiryIdx: index('booking_holds_expiry_idx').on(table.status, table.expiresAt),
}));

export const bookingAnalyticsEvents = pgTable('booking_analytics_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  bookingPageId: uuid('booking_page_id').notNull().references(() => bookingPages.id, { onDelete: 'cascade' }),
  sessionHash: varchar('session_hash', { length: 64 }).notNull(),
  eventType: varchar('event_type', { length: 40 }).notNull(),
  serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
  staffUserId: uuid('staff_user_id').references(() => users.id, { onDelete: 'set null' }),
  locationId: uuid('location_id'),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  bookingSource: varchar('booking_source', { length: 40 }),
  sourceMedium: varchar('source_medium', { length: 80 }),
  sourceCampaign: varchar('source_campaign', { length: 120 }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  pageEventTimeIdx: index('booking_analytics_page_event_time_idx').on(table.bookingPageId, table.eventType, table.occurredAt),
}));

export const bookingAuditEvents = pgTable('booking_audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
  actingUserId: uuid('acting_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 50 }).notNull(),
  previousValues: jsonb('previous_values').default({}).notNull(),
  newValues: jsonb('new_values').default({}).notNull(),
  reason: text('reason'),
  requestId: varchar('request_id', { length: 120 }),
  bookingSource: varchar('booking_source', { length: 40 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  appointmentTimeIdx: index('booking_audit_events_appointment_time_idx').on(table.tenantId, table.appointmentId, table.createdAt),
}));

export const customerBookingManagementTokens = pgTable('customer_booking_management_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => ({
  appointmentStatusIdx: index('customer_booking_management_tokens_appointment_status_idx').on(table.appointmentId, table.status),
  expiryIdx: index('customer_booking_management_tokens_status_expiry_idx').on(table.status, table.expiresAt),
}));

export const customerBookingChangeHistory = pgTable('customer_booking_change_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
  changeType: varchar('change_type', { length: 20 }).notNull(),
  source: varchar('source', { length: 20 }).notNull(),
  previousStartTime: timestamp('previous_start_time', { withTimezone: true }),
  previousEndTime: timestamp('previous_end_time', { withTimezone: true }),
  newStartTime: timestamp('new_start_time', { withTimezone: true }),
  newEndTime: timestamp('new_end_time', { withTimezone: true }),
  previousStaffUserId: uuid('previous_staff_user_id').references(() => users.id, { onDelete: 'set null' }),
  newStaffUserId: uuid('new_staff_user_id').references(() => users.id, { onDelete: 'set null' }),
  reasonCode: varchar('reason_code', { length: 40 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantAppointmentCreatedIdx: index('customer_booking_change_history_tenant_appointment_created_idx').on(table.tenantId, table.appointmentId, table.createdAt),
}));

export const customerBookingActionIdempotency = pgTable('customer_booking_action_idempotency', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 20 }).notNull(),
  actorScopeHash: varchar('actor_scope_hash', { length: 64 }).notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestFingerprint: varchar('request_fingerprint', { length: 64 }).notNull(),
  responseJson: jsonb('response_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  scopeUnique: uniqueIndex('customer_booking_action_idempotency_scope_unique').on(table.actorScopeHash, table.appointmentId, table.action, table.idempotencyKey),
  tenantAppointmentIdx: index('customer_booking_action_idempotency_tenant_appointment_idx').on(table.tenantId, table.appointmentId),
}));

export const forms = pgTable('forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').default('').notNull(),
  internalDescription: text('internal_description').default('').notNull(),
  formType: varchar('form_type',{length:40}).default('CUSTOM').notNull(),
  fieldsJson: jsonb('fields_json').notNull(),
  acknowledgementText: text('acknowledgement_text').default('').notNull(),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  defaultLanguage:varchar('default_language',{length:12}).default('en-GB').notNull(),
  supportedLanguages:text('supported_languages').array().default(['en-GB']).notNull(),
  settings:jsonb('settings').default({}).notNull(),themeJson:jsonb('theme_json').default({}).notNull(),
  draftRevision:integer('draft_revision').default(1).notNull(),publishedVersionId:uuid('published_version_id'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const formVersions = pgTable('form_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  formId: uuid('form_id').notNull().references(() => forms.id, { onDelete: 'restrict' }),
  versionNumber: integer('version_number').notNull(),
  titleSnapshot: varchar('title_snapshot', { length: 255 }).notNull(),
  descriptionSnapshot: text('description_snapshot').default('').notNull(),
  schemaJson: jsonb('schema_json').notNull(),
  acknowledgementText: text('acknowledgement_text').notNull(),
  themeSnapshot:jsonb('theme_snapshot').default({}).notNull(),logicSnapshot:jsonb('logic_snapshot').default([]).notNull(),validationSnapshot:jsonb('validation_snapshot').default({}).notNull(),settingsSnapshot:jsonb('settings_snapshot').default({}).notNull(),changeSummary:varchar('change_summary',{length:1000}),previousVersionId:uuid('previous_version_id'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ formVersionUnique: uniqueIndex('form_versions_form_version_unique').on(table.formId, table.versionNumber) }));

export const formAssignments = pgTable('form_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  formId: uuid('form_id').notNull().references(() => forms.id, { onDelete: 'restrict' }),
  formVersionId: uuid('form_version_id').notNull().references(() => formVersions.id, { onDelete: 'restrict' }),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 20 }).default('PENDING').notNull(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  publicTokenHash: varchar('public_token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  assignedByUserId: uuid('assigned_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
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
  assignmentId: uuid('assignment_id').references(() => formAssignments.id, { onDelete: 'restrict' }).unique(),
  formVersionId: uuid('form_version_id').references(() => formVersions.id, { onDelete: 'restrict' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  responseJson: jsonb('response_json').notNull(),
  acknowledgementName: varchar('acknowledgement_name', { length: 255 }),
  acknowledgementAccepted: boolean('acknowledgement_accepted').default(false).notNull(),
  acknowledgementText: text('acknowledgement_text'),
  submittedFrom: varchar('submitted_from', { length: 30 }).default('PUBLIC_LINK').notNull(),
  status:varchar('status',{length:30}).default('SUBMITTED').notNull(),reviewedAt:timestamp('reviewed_at',{withTimezone:true}),reviewedByUserId:uuid('reviewed_by_user_id').references(()=>users.id,{onDelete:'set null'}),reviewNotes:text('review_notes'),reviewFlags:jsonb('review_flags').default([]).notNull(),completionPercentage:integer('completion_percentage').default(100).notNull(),language:varchar('language',{length:12}).default('en-GB').notNull(),timezone:varchar('timezone',{length:100}),trackingParameters:jsonb('tracking_parameters').default({}).notNull(),
  idempotencyKey: uuid('idempotency_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  sku: varchar('sku', { length: 100 }).notNull().unique(),
  priceInCents: integer('price_in_cents').notNull(),
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
  totalAmount: integer('total_amount').notNull(),
  paymentStatus: text('payment_status', { enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] })
    .default('PENDING')
    .notNull(),
  paymentMethod: text('payment_method', { enum: ['CARD', 'CASH', 'BANK_TRANSFER', 'EXTERNAL_CARD', 'OTHER', 'STRIPE_ONLINE', 'STRIPE_TERMINAL', 'SPLIT'] })
    .default('CARD')
    .notNull(),
  purchasedProducts: jsonb('purchased_products').default([]).notNull(),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  purpose: text('purpose', { enum: ['point_of_sale', 'booking_payment'] }).default('point_of_sale').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const checkoutPaymentComponents = pgTable('checkout_payment_components', {
  id: uuid('id').defaultRandom().primaryKey(),
  checkoutTransactionId: uuid('checkout_transaction_id')
    .notNull()
    .references(() => checkoutTransactions.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  paymentMethod: text('payment_method', { enum: ['CASH', 'BANK_TRANSFER', 'EXTERNAL_CARD', 'OTHER', 'STRIPE_ONLINE', 'STRIPE_TERMINAL'] }).notNull(),
  amountInCents: integer('amount_in_cents').notNull(),
  externalProvider: varchar('external_provider', { length: 50 }),
  externalProviderName: varchar('external_provider_name', { length: 100 }),
  externalReference: varchar('external_reference', { length: 255 }),
  methodDescription: varchar('method_description', { length: 255 }),
  verificationSource: text('verification_source', { enum: ['PROVIDER_CONFIRMED', 'STAFF_CONFIRMED'] }).notNull(),
  providerPaymentId: varchar('provider_payment_id', { length: 255 }),
  staffUserId: uuid('staff_user_id').references(() => users.id, { onDelete: 'set null' }),
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
  type: varchar('type', { length: 100 }).notNull(),
  locationId: uuid('location_id'),
  description: text('description'),
  capacity: integer('capacity').default(1).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
});

export const locations=pgTable('locations',{id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),name:varchar('name',{length:150}).notNull(),address:text('address').notNull(),postcode:varchar('postcode',{length:20}).notNull(),phone:varchar('phone',{length:30}),timezone:varchar('timezone',{length:100}).notNull(),isPrimary:boolean('is_primary').default(false).notNull(),isActive:boolean('is_active').default(true).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull()});
export const staffLocations=pgTable('staff_locations',{tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),staffUserId:uuid('staff_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}),locationId:uuid('location_id').notNull().references(()=>locations.id,{onDelete:'restrict'})},t=>({unique:uniqueIndex('staff_locations_unique').on(t.staffUserId,t.locationId)}));
export const serviceLocations=pgTable('service_locations',{tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),serviceId:uuid('service_id').notNull().references(()=>services.id,{onDelete:'restrict'}),locationId:uuid('location_id').notNull().references(()=>locations.id,{onDelete:'restrict'})},t=>({unique:uniqueIndex('service_locations_unique').on(t.serviceId,t.locationId)}));
export const staffTimeOff=pgTable('staff_time_off',{id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),staffUserId:uuid('staff_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}),type:varchar('type',{length:30}).notNull(),status:varchar('status',{length:20}).default('PENDING').notNull(),startsAt:timestamp('starts_at',{withTimezone:true}).notNull(),endsAt:timestamp('ends_at',{withTimezone:true}).notNull(),allDay:boolean('all_day').default(false).notNull(),reason:varchar('reason',{length:500}),createdByUserId:uuid('created_by_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}),approvedByUserId:uuid('approved_by_user_id').references(()=>users.id,{onDelete:'restrict'}),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull()});
export const commissionRules=pgTable('commission_rules',{id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),staffUserId:uuid('staff_user_id').references(()=>users.id,{onDelete:'restrict'}),name:varchar('name',{length:150}).notNull(),servicePercentageBasisPoints:integer('service_percentage_basis_points'),productPercentageBasisPoints:integer('product_percentage_basis_points'),fixedServiceAmountMinor:integer('fixed_service_amount_minor'),effectiveFrom:timestamp('effective_from',{withTimezone:true}).notNull(),effectiveTo:timestamp('effective_to',{withTimezone:true}),isActive:boolean('is_active').default(true).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull()});

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
  status: varchar('status', { length: 50 }).default('PENDING').notNull(),
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
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description').default('').notNull(),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
  triggerType: varchar('trigger_type', { length: 60 }).notNull(),
  triggerConfigJson: jsonb('trigger_config_json').default({}).notNull(),
  conditionsJson: jsonb('conditions_json').default([]).notNull(),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
});

export const automationRuleActions = pgTable('automation_rule_actions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  automationRuleId: uuid('automation_rule_id').notNull().references(() => automationRules.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  actionType: varchar('action_type', { length: 60 }).notNull(),
  actionConfigJson: jsonb('action_config_json').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ rulePositionUnique: uniqueIndex('automation_rule_actions_rule_position_unique').on(table.automationRuleId, table.position) }));

export const businessEvents = pgTable('business_events', {
  id: varchar('id', { length: 255 }).primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 60 }).notNull(),
  sourceType: varchar('source_type', { length: 50 }).notNull(),
  sourceId: uuid('source_id').notNull(),
  payloadJson: jsonb('payload_json').default({}).notNull(),
  status: varchar('status', { length: 20 }).default('PENDING').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  lastErrorCode: varchar('last_error_code', { length: 100 }),
});

export const automationRuns = pgTable('automation_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  automationRuleId: uuid('automation_rule_id').notNull().references(() => automationRules.id, { onDelete: 'restrict' }),
  triggerType: varchar('trigger_type', { length: 60 }).notNull(),
  triggerEventId: varchar('trigger_event_id', { length: 255 }).notNull(),
  sourceType: varchar('source_type', { length: 50 }).notNull(),
  sourceId: uuid('source_id').notNull(),
  status: varchar('status', { length: 30 }).default('PENDING').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }), completedAt: timestamp('completed_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }), lastErrorCode: varchar('last_error_code', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ ruleEventUnique: uniqueIndex('automation_runs_rule_event_unique').on(table.automationRuleId, table.triggerEventId) }));

export const automationActionRuns = pgTable('automation_action_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  automationRunId: uuid('automation_run_id').notNull().references(() => automationRuns.id, { onDelete: 'cascade' }),
  automationRuleActionId: uuid('automation_rule_action_id').notNull().references(() => automationRuleActions.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 30 }).default('PENDING').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).defaultNow().notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }), completedAt: timestamp('completed_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }), lastErrorCode: varchar('last_error_code', { length: 100 }),
  resultReferenceType: varchar('result_reference_type', { length: 50 }), resultReferenceId: uuid('result_reference_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const internalNotifications = pgTable('internal_notifications', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  recipientUserId: uuid('recipient_user_id').references(() => users.id, { onDelete: 'set null' }), recipientRole: varchar('recipient_role', { length: 20 }),
  type: varchar('type', { length: 60 }).notNull(), title: varchar('title', { length: 160 }).notNull(), message: varchar('message', { length: 500 }).notNull(),
  sourceType: varchar('source_type', { length: 50 }).notNull(), sourceId: uuid('source_id').notNull(), readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const operationsIssues = pgTable('operations_issues', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  category: varchar('category', { length: 30 }).notNull(), issueType: varchar('issue_type', { length: 60 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull(), status: varchar('status', { length: 20 }).default('OPEN').notNull(),
  title: varchar('title', { length: 180 }).notNull(), message: text('message').notNull(),
  sourceType: varchar('source_type', { length: 60 }).notNull(), sourceId: varchar('source_id', { length: 255 }).notNull(),
  relatedAppointmentId: uuid('related_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  deduplicationKey: varchar('deduplication_key', { length: 255 }).notNull(), occurrenceCount: integer('occurrence_count').default(1).notNull(),
  metadataJson: jsonb('metadata_json').default({}).notNull(), actionDeadline: timestamp('action_deadline', { withTimezone: true }),
  assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
  acknowledgedByUserId: uuid('acknowledged_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(), lastOccurredAt: timestamp('last_occurred_at', { withTimezone: true }).defaultNow().notNull(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }), resolvedAt: timestamp('resolved_at', { withTimezone: true }), dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantDedupUnique: uniqueIndex('operations_issues_tenant_dedup_unique').on(table.tenantId, table.deduplicationKey),
  tenantStatusSeverityIdx: index('operations_issues_tenant_status_severity_idx').on(table.tenantId, table.status, table.severity, table.lastOccurredAt),
  tenantAssigneeIdx: index('operations_issues_tenant_assignee_idx').on(table.tenantId, table.assignedToUserId, table.status),
}));

export const tasks = pgTable('tasks', {
  id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),
  title:varchar('title',{length:180}).notNull(),description:text('description'),notes:text('notes'),status:varchar('status',{length:20}).default('OPEN').notNull(),priority:varchar('priority',{length:20}).default('NORMAL').notNull(),
  assignedUserId:uuid('assigned_user_id').references(()=>users.id,{onDelete:'set null'}),createdByUserId:uuid('created_by_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}),dueAt:timestamp('due_at',{withTimezone:true}),
  completedAt:timestamp('completed_at',{withTimezone:true}),completedByUserId:uuid('completed_by_user_id').references(()=>users.id,{onDelete:'set null'}),cancelledAt:timestamp('cancelled_at',{withTimezone:true}),cancelledByUserId:uuid('cancelled_by_user_id').references(()=>users.id,{onDelete:'set null'}),
  sourceType:varchar('source_type',{length:30}).default('MANUAL').notNull(),sourceId:uuid('source_id'),deduplicationKey:varchar('deduplication_key',{length:255}),
  appointmentId:uuid('appointment_id').references(()=>appointments.id,{onDelete:'set null'}),clientId:uuid('client_id').references(()=>clients.id,{onDelete:'set null'}),operationsIssueId:uuid('operations_issue_id').references(()=>operationsIssues.id,{onDelete:'set null'}),
  formAssignmentId:uuid('form_assignment_id').references(()=>formAssignments.id,{onDelete:'set null'}),automationRunId:uuid('automation_run_id').references(()=>automationRuns.id,{onDelete:'set null'}),overdueNotifiedAt:timestamp('overdue_notified_at',{withTimezone:true}),
  createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
},table=>({tenantDedupUnique:uniqueIndex('tasks_tenant_dedup_unique').on(table.tenantId,table.deduplicationKey),tenantStatusUpdatedIdx:index('tasks_tenant_status_updated_idx').on(table.tenantId,table.status,table.updatedAt,table.id),tenantAssigneeStatusDueIdx:index('tasks_tenant_assignee_status_due_idx').on(table.tenantId,table.assignedUserId,table.status,table.dueAt),appointmentIdx:index('tasks_appointment_idx').on(table.appointmentId),clientIdx:index('tasks_client_idx').on(table.clientId),issueIdx:index('tasks_operations_issue_idx').on(table.operationsIssueId),formAssignmentIdx:index('tasks_form_assignment_idx').on(table.formAssignmentId),automationRunIdx:index('tasks_automation_run_idx').on(table.automationRunId)}));

export const taskActivity = pgTable('task_activity', {
  id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),taskId:uuid('task_id').notNull().references(()=>tasks.id,{onDelete:'cascade'}),
  activityType:varchar('activity_type',{length:30}).notNull(),actorUserId:uuid('actor_user_id').references(()=>users.id,{onDelete:'set null'}),fromValue:varchar('from_value',{length:255}),toValue:varchar('to_value',{length:255}),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
},table=>({taskCreatedIdx:index('task_activity_task_created_idx').on(table.taskId,table.createdAt),tenantIdx:index('task_activity_tenant_idx').on(table.tenantId)}));

export const offPeakRules = pgTable('off_peak_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  discountPercentage: integer('discount_percentage').notNull(),
});

export const stripeConnections = pgTable('stripe_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  stripeAccountId: varchar('stripe_account_id', { length: 255 }).notNull().unique(),
  accountType: varchar('account_type', { length: 50 }).notNull(),
  connectionStatus: varchar('connection_status', { length: 50 }).notNull(),
  detailsSubmitted: boolean('details_submitted').default(false).notNull(),
  chargesEnabled: boolean('charges_enabled').default(false).notNull(),
  payoutsEnabled: boolean('payouts_enabled').default(false).notNull(),
  currentlyDue: jsonb('currently_due').default([]).notNull(),
  eventuallyDue: jsonb('eventually_due').default([]).notNull(),
  pastDue: jsonb('past_due').default([]).notNull(),
  disabledReason: varchar('disabled_reason', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
});

export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  stripeEventId: varchar('stripe_event_id', { length: 255 }).primaryKey(),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  stripeAccountId: varchar('stripe_account_id', { length: 255 }),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
  processingStatus: varchar('processing_status', { length: 50 }).notNull(),
  errorCode: varchar('error_code', { length: 255 }),
});

export const stripePaymentAttempts = pgTable('stripe_payment_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
  publicBookingReference: uuid('public_booking_reference').notNull(),
  stripeAccountId: varchar('stripe_account_id', { length: 255 }).notNull(),
  stripeCheckoutSessionId: varchar('stripe_checkout_session_id', { length: 255 }).unique().notNull(),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }).unique(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  applicationFeeAmount: integer('application_fee_amount').default(0).notNull(),
  status: varchar('status', { length: 50 }).default('CREATING').notNull(),
  failureCode: varchar('failure_code', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => {
  return {
    uniqueTenantIdempotency: uniqueIndex('unique_tenant_idempotency').on(table.tenantId, table.idempotencyKey),
  }
});
export const stripeRefunds = pgTable('stripe_refunds', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  checkoutTransactionId: uuid('checkout_transaction_id').notNull().references(() => checkoutTransactions.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  stripeAccountId: varchar('stripe_account_id', { length: 255 }).notNull(),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }).notNull(),
  stripeRefundId: varchar('stripe_refund_id', { length: 255 }).unique(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  reason: varchar('reason', { length: 255 }).notNull(),
  internalNote: varchar('internal_note', { length: 1000 }),
  status: varchar('status', { length: 50 }).default('CREATING').notNull(),
  failureCode: varchar('failure_code', { length: 255 }),
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  refundSource: varchar('refund_source', { length: 50 }).default('KS_OS').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => {
  return {
    uniqueTenantIdempotencyRefund: uniqueIndex('unique_tenant_idempotency_refund').on(table.tenantId, table.idempotencyKey),
  }
});

export const stripePayouts = pgTable('stripe_payouts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stripeAccountId: varchar('stripe_account_id', { length: 255 }).notNull(),
  stripePayoutId: varchar('stripe_payout_id', { length: 255 }).notNull(),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  arrivalDate: timestamp('arrival_date'),
  method: varchar('method', { length: 50 }),
  type: varchar('type', { length: 50 }),
  automatic: boolean('automatic').default(true).notNull(),
  description: varchar('description', { length: 1000 }),
  statementDescriptor: varchar('statement_descriptor', { length: 255 }),
  failureCode: varchar('failure_code', { length: 255 }),
  failureMessageSafe: varchar('failure_message_safe', { length: 1000 }),
  createdAtStripe: timestamp('created_at_stripe').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  paidAt: timestamp('paid_at'),
  failedAt: timestamp('failed_at'),
  lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
}, (table) => {
  return {
    uniqueStripeAccountPayoutId: uniqueIndex('unique_stripe_account_payout_id').on(table.stripeAccountId, table.stripePayoutId),
  }
});

export const stripePayoutItems = pgTable('stripe_payout_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stripePayoutId: varchar('stripe_payout_id', { length: 255 }).notNull(),
  stripeBalanceTransactionId: varchar('stripe_balance_transaction_id', { length: 255 }).notNull(),
  stripeSourceId: varchar('stripe_source_id', { length: 255 }),
  sourceType: varchar('source_type', { length: 100 }),
  grossAmount: integer('gross_amount').notNull(),
  stripeFee: integer('stripe_fee').notNull(),
  netAmount: integer('net_amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  availableOn: timestamp('available_on'),
  checkoutTransactionId: uuid('checkout_transaction_id').references(() => checkoutTransactions.id, { onDelete: 'set null' }),
  stripeRefundId: varchar('stripe_refund_id', { length: 255 }),
  stripeDisputeId: varchar('stripe_dispute_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    uniqueStripeAccountBalanceTransactionId: uniqueIndex('unique_stripe_account_balance_transaction_id').on(table.tenantId, table.stripeBalanceTransactionId),
  }
});

export const stripeDisputes = pgTable('stripe_disputes', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stripeAccountId: varchar('stripe_account_id', { length: 255 }).notNull(),
  stripeDisputeId: varchar('stripe_dispute_id', { length: 255 }).notNull(),
  stripeChargeId: varchar('stripe_charge_id', { length: 255 }),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  checkoutTransactionId: uuid('checkout_transaction_id').references(() => checkoutTransactions.id, { onDelete: 'set null' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  reason: varchar('reason', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  isChargeRefundable: boolean('is_charge_refundable').default(false).notNull(),
  evidenceDueBy: timestamp('evidence_due_by'),
  hasEvidenceDue: boolean('has_evidence_due').default(false).notNull(),
  balanceTransactionId: varchar('balance_transaction_id', { length: 255 }),
  createdAtStripe: timestamp('created_at_stripe').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  closedAt: timestamp('closed_at'),
  lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
}, (table) => {
  return {
    uniqueStripeAccountDisputeId: uniqueIndex('unique_stripe_account_dispute_id').on(table.stripeAccountId, table.stripeDisputeId),
  }
});

export const emailOutbox = pgTable('email_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
  recipientName: varchar('recipient_name', { length: 255 }),
  replyToEmail: varchar('reply_to_email', { length: 255 }),
  templateKey: varchar('template_key', { length: 255 }).notNull(),
  templateVersion: varchar('template_version', { length: 50 }).default('1.0.0').notNull(),
  templateDataJson: jsonb('template_data_json').default({}).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  status: varchar('status', { length: 50 }).default('PENDING').notNull(),
  provider: varchar('provider', { length: 50 }).default('resend').notNull(),
  providerMessageId: varchar('provider_message_id', { length: 255 }).unique(),
  scheduledFor: timestamp('scheduled_for').defaultNow().notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at').defaultNow().notNull(),
  lastErrorCode: varchar('last_error_code', { length: 255 }),
  relatedEntityType: varchar('related_entity_type', { length: 100 }),
  relatedEntityId: uuid('related_entity_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  failedAt: timestamp('failed_at'),
});

export const smsOutbox = pgTable('sms_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  formAssignmentId: uuid('form_assignment_id').references(() => formAssignments.id, { onDelete: 'set null' }),
  recipientPhoneE164: varchar('recipient_phone_e164', { length: 20 }).notNull(),
  templateKey: varchar('template_key', { length: 80 }).notNull(),
  templateVersion: varchar('template_version', { length: 20 }).default('1.0.0').notNull(),
  templateDataJson: jsonb('template_data_json').default({}).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  status: varchar('status', { length: 30 }).default('PENDING').notNull(),
  provider: varchar('provider', { length: 30 }).default('twilio').notNull(),
  providerMessageSid: varchar('provider_message_sid', { length: 64 }).unique(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).defaultNow().notNull(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  attemptCount: integer('attempt_count').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  segmentCount: integer('segment_count'),
  encoding: varchar('encoding', { length: 10 }),
  lastErrorCode: varchar('last_error_code', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
});

export const twilioWebhookEvents = pgTable('twilio_webhook_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventKey: varchar('event_key', { length: 255 }).notNull().unique(),
  eventType: varchar('event_type', { length: 30 }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
});

export const emailWebhookEvents = pgTable('email_webhook_events', {
  eventId: varchar('event_id', { length: 255 }).primaryKey(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  providerMessageId: varchar('provider_message_id', { length: 255 }),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export const emailSuppressions = pgTable('email_suppressions', {
  id: uuid('id').defaultRandom().primaryKey(),
  recipientEmailNormalized: varchar('recipient_email_normalized', { length: 255 }).notNull().unique(),
  reason: varchar('reason', { length: 30 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Provider-hosted review integration. These tables never contain KS OS-authored
// ratings or public testimonials: external_reviews is a read-only provider cache.
export const reviewProviderConnections = pgTable('review_provider_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 20 }).notNull(),
  connectionType: varchar('connection_type', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).default('CONFIGURED').notNull(),
  providerBusinessId: varchar('provider_business_id', { length: 255 }),
  providerLocationId: varchar('provider_location_id', { length: 255 }),
  locationId: uuid('location_id').references(() => locations.id, { onDelete: 'restrict' }),
  reviewUrl: varchar('review_url', { length: 2048 }),
  businessDisplayName: varchar('business_display_name', { length: 160 }).notNull(),
  profileDomain: varchar('profile_domain', { length: 255 }),
  encryptedCredentialsReference: text('encrypted_credentials_reference'),
  settingsJson: jsonb('settings_json').default({}).notNull(),
  connectedByUserId: uuid('connected_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  configuredAt: timestamp('configured_at', { withTimezone: true }).defaultNow().notNull(),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastErrorCode: varchar('last_error_code', { length: 80 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantProviderIdx: index('review_provider_connections_tenant_provider_idx').on(table.tenantId, table.provider),
  tenantLocationIdx: index('review_provider_connections_tenant_location_idx').on(table.tenantId, table.locationId),
  connectedByIdx: index('review_provider_connections_connected_by_idx').on(table.connectedByUserId),
}));

export const reviewProviderLocationMappings = pgTable('review_provider_location_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => reviewProviderConnections.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  providerBusinessId: varchar('provider_business_id', { length: 255 }),
  providerLocationId: varchar('provider_location_id', { length: 255 }),
  reviewUrl: varchar('review_url', { length: 2048 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  connectionLocationUnique: uniqueIndex('review_provider_location_mappings_connection_location_unique').on(table.connectionId, table.locationId),
  tenantLocationIdx: index('review_provider_location_mappings_tenant_location_idx').on(table.tenantId, table.locationId),
}));

export const reviewOauthStates = pgTable('review_oauth_states', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 20 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  status: varchar('status', { length: 20 }).default('PENDING').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantExpiryIdx: index('review_oauth_states_tenant_expiry_idx').on(table.tenantId, table.status, table.expiresAt),
  userIdx: index('review_oauth_states_user_idx').on(table.userId),
}));

export const reviewInvitationRules = pgTable('review_invitation_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  providerMode: varchar('provider_mode', { length: 20 }).notNull(),
  channel: varchar('channel', { length: 30 }).notNull(),
  delayMinutes: integer('delay_minutes').default(1440).notNull(),
  locationId: uuid('location_id').references(() => locations.id, { onDelete: 'restrict' }),
  messageTemplate: text('message_template').notNull(),
  privateContactEnabled: boolean('private_contact_enabled').default(true).notNull(),
  ruleVersion: integer('rule_version').default(1).notNull(),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantStatusIdx: index('review_invitation_rules_tenant_status_idx').on(table.tenantId, table.status),
  locationIdx: index('review_invitation_rules_location_idx').on(table.locationId),
}));

export const reviewInvitations = pgTable('review_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'restrict' }),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').references(() => locations.id, { onDelete: 'restrict' }),
  ruleId: uuid('rule_id').notNull().references(() => reviewInvitationRules.id, { onDelete: 'restrict' }),
  provider: varchar('provider', { length: 20 }).notNull(),
  channel: varchar('channel', { length: 30 }).notNull(),
  status: varchar('status', { length: 30 }).default('SCHEDULED').notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).unique(),
  providerInvitationId: varchar('provider_invitation_id', { length: 255 }),
  providerReferenceId: varchar('provider_reference_id', { length: 255 }).notNull(),
  providerDestinationsJson: jsonb('provider_destinations_json').default({}).notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  queuedAt: timestamp('queued_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  clickedAt: timestamp('clicked_at', { withTimezone: true }),
  googleClickedAt: timestamp('google_clicked_at', { withTimezone: true }),
  trustpilotClickedAt: timestamp('trustpilot_clicked_at', { withTimezone: true }),
  confirmedReviewAt: timestamp('confirmed_review_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  failureCode: varchar('failure_code', { length: 80 }),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantScheduledIdx: index('review_invitations_tenant_scheduled_idx').on(table.tenantId, table.status, table.scheduledFor),
  appointmentIdx: index('review_invitations_appointment_idx').on(table.appointmentId),
  experienceUnique: uniqueIndex('review_invitations_one_experience_unique').on(table.tenantId, table.appointmentId, table.provider),
  clientIdx: index('review_invitations_client_idx').on(table.clientId),
  ruleIdx: index('review_invitations_rule_idx').on(table.ruleId),
  locationIdx: index('review_invitations_location_idx').on(table.locationId),
}));

export const externalReviews = pgTable('external_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 20 }).notNull(),
  providerReviewId: varchar('provider_review_id', { length: 255 }).notNull(),
  providerBusinessId: varchar('provider_business_id', { length: 255 }).notNull(),
  providerLocationId: varchar('provider_location_id', { length: 255 }),
  locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
  rating: integer('rating').notNull(),
  title: varchar('title', { length: 500 }),
  reviewText: text('review_text'),
  reviewerDisplayName: varchar('reviewer_display_name', { length: 255 }),
  reviewCreatedAt: timestamp('review_created_at', { withTimezone: true }).notNull(),
  reviewUpdatedAt: timestamp('review_updated_at', { withTimezone: true }),
  verificationLevel: varchar('verification_level', { length: 80 }),
  businessReplyText: text('business_reply_text'),
  businessReplyCreatedAt: timestamp('business_reply_created_at', { withTimezone: true }),
  sourceUrl: varchar('source_url', { length: 2048 }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  providerReviewUnique: uniqueIndex('external_reviews_tenant_provider_review_unique').on(table.tenantId, table.provider, table.providerReviewId),
  tenantProviderCreatedIdx: index('external_reviews_tenant_provider_created_idx').on(table.tenantId, table.provider, table.reviewCreatedAt),
  locationIdx: index('external_reviews_location_idx').on(table.locationId),
}));

export const reportExportJobs = pgTable('report_export_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  reportType: varchar('report_type', { length: 40 }).notNull(), filtersJson: jsonb('filters_json').default({}).notNull(),
  format: varchar('format', { length: 10 }).default('CSV').notNull(), status: varchar('status', { length: 20 }).default('PENDING').notNull(),
  fileStoragePath: varchar('file_storage_path', { length: 500 }), downloadFilename: varchar('download_filename', { length: 180 }),
  rowCount: integer('row_count'), fileSizeBytes: integer('file_size_bytes'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(), startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }), expiresAt: timestamp('expires_at', { withTimezone: true }), failureCode: varchar('failure_code', { length: 80 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantRequestedIdx: index('report_export_jobs_tenant_requested_idx').on(table.tenantId, table.requestedAt, table.id),
  requestedByIdx: index('report_export_jobs_requested_by_idx').on(table.requestedByUserId), statusRequestedIdx: index('report_export_jobs_status_requested_idx').on(table.status, table.requestedAt),
}));

export const reportSchedules = pgTable('report_schedules', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(), reportType: varchar('report_type', { length: 40 }).notNull(), filtersJson: jsonb('filters_json').default({}).notNull(),
  frequency: varchar('frequency', { length: 20 }).notNull(), timezone: varchar('timezone', { length: 100 }).notNull(), deliveryTimeLocal: time('delivery_time_local').notNull(),
  weekday: integer('weekday'), monthlyDay: varchar('monthly_day', { length: 10 }), recipientUserIds: jsonb('recipient_user_ids').default([]).notNull(),
  additionalRecipientEmails: jsonb('additional_recipient_emails').default([]).notNull(), status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }), lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantStatusNextIdx: index('report_schedules_tenant_status_next_idx').on(table.tenantId, table.status, table.nextRunAt), dueIdx: index('report_schedules_due_idx').on(table.status, table.nextRunAt),
  createdByIdx: index('report_schedules_created_by_idx').on(table.createdByUserId),
}));

export const reportScheduleRuns = pgTable('report_schedule_runs', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  scheduleId: uuid('schedule_id').notNull().references(() => reportSchedules.id, { onDelete: 'restrict' }), scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 20 }).default('QUEUED').notNull(), reportExportJobId: uuid('report_export_job_id').references(() => reportExportJobs.id, { onDelete: 'set null' }),
  failureCode: varchar('failure_code', { length: 80 }), startedAt: timestamp('started_at', { withTimezone: true }), completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  occurrenceUnique: uniqueIndex('report_schedule_runs_occurrence_unique').on(table.scheduleId, table.scheduledFor),
  tenantScheduleIdx: index('report_schedule_runs_tenant_schedule_idx').on(table.tenantId, table.scheduleId, table.scheduledFor), exportJobIdx: index('report_schedule_runs_export_job_idx').on(table.reportExportJobId),
}));

// Phase 12 control-plane identities are deliberately independent of tenant
// memberships. Browser roles have no direct table grants; all access is via API.
export const agencyUsers = pgTable('agency_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  authUserId: uuid('auth_user_id').unique(),
  emailNormalized: varchar('email_normalized', { length: 255 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  role: varchar('role', { length: 40 }).notNull(),
  status: varchar('status', { length: 20 }).default('INVITED').notNull(),
  mfaRequired: boolean('mfa_required').default(true).notNull(),
  invitedByAgencyUserId: uuid('invited_by_agency_user_id'),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  securityVersion: integer('security_version').default(1).notNull(),
  sessionsValidAfter: timestamp('sessions_valid_after', { withTimezone: true }),
  lastAuthenticatedAt: timestamp('last_authenticated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const accountInvitations = pgTable('account_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  invitationType: varchar('invitation_type', { length: 30 }).notNull(),
  emailNormalized: varchar('email_normalized', { length: 255 }).notNull(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
  agencyRole: varchar('agency_role', { length: 40 }),
  tenantRole: varchar('tenant_role', { length: 20 }),
  status: varchar('status', { length: 20 }).default('PENDING').notNull(),
  supabaseAuthUserId: uuid('supabase_auth_user_id'),
  provisioningMode: varchar('provisioning_mode', { length: 30 }),
  invitedByAuthUserId: uuid('invited_by_auth_user_id').notNull(),
  invitedByTenantUserId: uuid('invited_by_tenant_user_id').references(() => users.id, { onDelete: 'restrict' }),
  invitedByAgencyUserId: uuid('invited_by_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  sendCount: integer('send_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantEmailStatusIdx: index('account_invitations_tenant_email_status_idx').on(table.tenantId, table.emailNormalized, table.status),
  agencyEmailStatusIdx: index('account_invitations_agency_email_status_idx').on(table.emailNormalized, table.status),
  expiryIdx: index('account_invitations_status_expiry_idx').on(table.status, table.expiresAt),
}));

export const applicationSessions = pgTable('application_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  authSessionId: uuid('auth_session_id').notNull(),
  authUserId: uuid('auth_user_id').notNull(),
  applicationContext: varchar('application_context', { length: 20 }).notNull(),
  selectedTenantUserId: uuid('selected_tenant_user_id').references(() => users.id, { onDelete: 'set null' }),
  securityVersion: integer('security_version').default(1).notNull(),
  assuranceLevel: varchar('assurance_level', { length: 10 }).default('aal1').notNull(),
  deviceSummary: varchar('device_summary', { length: 255 }),
  ipHash: varchar('ip_hash', { length: 64 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: varchar('revoke_reason', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  authContextUnique: uniqueIndex('application_sessions_auth_context_unique').on(table.authSessionId, table.applicationContext),
  userContextExpiryIdx: index('application_sessions_user_context_expiry_idx').on(table.authUserId, table.applicationContext, table.expiresAt),
  selectedMembershipIdx: index('application_sessions_selected_membership_idx').on(table.selectedTenantUserId),
}));

export const accountAccessAuditEvents = pgTable('account_access_audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  authUserId: uuid('auth_user_id'),
  agencyUserId: uuid('agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
  tenantUserId: uuid('tenant_user_id').references(() => users.id, { onDelete: 'restrict' }),
  applicationContext: varchar('application_context', { length: 20 }),
  action: varchar('action', { length: 120 }).notNull(),
  outcome: varchar('outcome', { length: 30 }).default('SUCCESS').notNull(),
  reason: varchar('reason', { length: 500 }),
  requestId: varchar('request_id', { length: 100 }),
  ipHash: varchar('ip_hash', { length: 64 }),
  metadata: jsonb('metadata').default({}).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  authOccurredIdx: index('account_access_audit_auth_occurred_idx').on(table.authUserId, table.occurredAt),
  tenantOccurredIdx: index('account_access_audit_tenant_occurred_idx').on(table.tenantId, table.occurredAt),
  actionOccurredIdx: index('account_access_audit_action_occurred_idx').on(table.action, table.occurredAt),
}));

export const agencySessions = pgTable('agency_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  agencyUserId: uuid('agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }),
  authSessionId: uuid('auth_session_id').notNull(),
  assuranceLevel: varchar('assurance_level', { length: 10 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: varchar('revoke_reason', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  authSessionUnique: uniqueIndex('agency_sessions_auth_session_unique').on(table.authSessionId),
  userExpiryIdx: index('agency_sessions_user_expiry_idx').on(table.agencyUserId, table.expiresAt),
}));

export const agencySupportSessions = pgTable('agency_support_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  agencyUserId: uuid('agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  scope: varchar('scope', { length: 30 }).default('STANDARD_SUPPORT').notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantExpiryIdx: index('agency_support_sessions_tenant_expiry_idx').on(table.tenantId, table.expiresAt),
  agencyUserExpiryIdx: index('agency_support_sessions_user_expiry_idx').on(table.agencyUserId, table.expiresAt),
}));

export const platformAuditEvents = pgTable('platform_audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  agencyUserId: uuid('agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }),
  supportSessionId: uuid('support_session_id').references(() => agencySupportSessions.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
  action: varchar('action', { length: 120 }).notNull(),
  targetType: varchar('target_type', { length: 80 }).notNull(),
  targetId: varchar('target_id', { length: 255 }),
  outcome: varchar('outcome', { length: 30 }).default('SUCCESS').notNull(),
  reason: varchar('reason', { length: 500 }),
  requestId: varchar('request_id', { length: 100 }),
  ipHash: varchar('ip_hash', { length: 64 }),
  metadata: jsonb('metadata').default({}).notNull(),
  eventCategory: varchar('event_category', { length: 50 }).default('ADMINISTRATION').notNull(),
  description: varchar('description', { length: 1000 }),
  actorRole: varchar('actor_role', { length: 50 }),
  sessionId: uuid('session_id'),
  userAgent: varchar('user_agent', { length: 500 }),
  previousValues: jsonb('previous_values'),
  newValues: jsonb('new_values'),
  environment: varchar('environment', { length: 30 }).default('production').notNull(),
  sourceComponent: varchar('source_component', { length: 120 }).default('api').notNull(),
  containsRedactions: boolean('contains_redactions').default(false).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tenantOccurredIdx: index('platform_audit_events_tenant_occurred_idx').on(table.tenantId, table.occurredAt),
  actorOccurredIdx: index('platform_audit_events_actor_occurred_idx').on(table.agencyUserId, table.occurredAt),
  actionOccurredIdx: index('platform_audit_events_action_occurred_idx').on(table.action, table.occurredAt),
  categoryOccurredIdx: index('platform_audit_category_occurred_idx').on(table.eventCategory, table.occurredAt),
  targetOccurredIdx: index('platform_audit_target_occurred_idx').on(table.targetType, table.targetId, table.occurredAt),
  outcomeOccurredIdx: index('platform_audit_outcome_occurred_idx').on(table.outcome, table.occurredAt),
}));

export const platformPlans = pgTable('platform_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: varchar('key', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const platformPlanVersions = pgTable('platform_plan_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  planId: uuid('plan_id').notNull().references(() => platformPlans.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(), name: varchar('name', { length: 120 }).notNull(),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
  monthlyPriceMinor: integer('monthly_price_minor').notNull(), setupFeeAmountMinor: integer('setup_fee_amount_minor').notNull(), currency: varchar('currency', { length: 3 }).default('GBP').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }), retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdByAgencyUserId: uuid('created_by_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ planVersionUnique: uniqueIndex('platform_plan_versions_plan_version_unique').on(table.planId, table.version), statusIdx: index('platform_plan_versions_status_idx').on(table.status, table.effectiveFrom) }));

export const platformPlanEntitlements = pgTable('platform_plan_entitlements', {
  id: uuid('id').defaultRandom().primaryKey(),
  planVersionId: uuid('plan_version_id').notNull().references(() => platformPlanVersions.id, { onDelete: 'cascade' }),
  entitlementKey: varchar('entitlement_key', { length: 80 }).notNull(), name: varchar('name', { length: 120 }).notNull(),
  entitlementType: varchar('entitlement_type', { length: 20 }).notNull(), availability: varchar('availability', { length: 30 }).default('GENERALLY_AVAILABLE').notNull(),
  valueJson: jsonb('value_json').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ versionKeyUnique: uniqueIndex('platform_plan_entitlements_version_key_unique').on(table.planVersionId, table.entitlementKey), keyIdx: index('platform_plan_entitlements_key_idx').on(table.entitlementKey) }));

export const tenantPlanAssignments = pgTable('tenant_plan_assignments', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  planVersionId: uuid('plan_version_id').notNull().references(() => platformPlanVersions.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), startsAt: timestamp('starts_at', { withTimezone: true }).notNull(), endsAt: timestamp('ends_at', { withTimezone: true }),
  scheduledReplacementPlanVersionId: uuid('scheduled_replacement_plan_version_id').references(() => platformPlanVersions.id, { onDelete: 'restrict' }),
  scheduledReplacementAt: timestamp('scheduled_replacement_at', { withTimezone: true }), reason: varchar('reason', { length: 500 }),
  assignedByAgencyUserId: uuid('assigned_by_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantStatusIdx: index('tenant_plan_assignments_tenant_status_idx').on(table.tenantId, table.status, table.startsAt), planVersionIdx: index('tenant_plan_assignments_plan_version_idx').on(table.planVersionId) }));

export const tenantEntitlementOverrides = pgTable('tenant_entitlement_overrides', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  entitlementKey: varchar('entitlement_key', { length: 80 }).notNull(), valueJson: jsonb('value_json').notNull(), reason: varchar('reason', { length: 500 }).notNull(),
  previousValueJson: jsonb('previous_value_json'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdByAgencyUserId: uuid('created_by_agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }), approvedByAgencyUserId: uuid('approved_by_agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantKeyExpiryIdx: index('tenant_entitlement_overrides_tenant_key_expiry_idx').on(table.tenantId, table.entitlementKey, table.expiresAt) }));

export const tenantEntitlementUsage = pgTable('tenant_entitlement_usage', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), entitlementKey: varchar('entitlement_key', { length: 80 }).notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(), periodEnd: timestamp('period_end', { withTimezone: true }).notNull(), used: integer('used').default(0).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantKeyPeriodUnique: uniqueIndex('tenant_entitlement_usage_tenant_key_period_unique').on(table.tenantId, table.entitlementKey, table.periodStart) }));

export const tenantOnboarding = pgTable('tenant_onboarding', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }).unique(), status: varchar('status', { length: 30 }).default('IN_PROGRESS').notNull(),
  ownerAgencyUserId: uuid('owner_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }), targetLaunchAt: timestamp('target_launch_at', { withTimezone: true }), launchedAt: timestamp('launched_at', { withTimezone: true }),
  responsibleTenantUserId: uuid('responsible_tenant_user_id').references(() => users.id, { onDelete: 'set null' }),
  completionPercentage: integer('completion_percentage').default(0).notNull(), currentStage: varchar('current_stage', { length: 40 }).default('SALE_HANDOVER').notNull(),
  missingInformation: jsonb('missing_information').default([]).notNull(), blockers: jsonb('blockers').default([]).notNull(), nextAction: text('next_action'),
  internalNotes: text('internal_notes'), clientVisibleNotes: text('client_visible_notes'), lastClientActivityAt: timestamp('last_client_activity_at', { withTimezone: true }),
  businessProfile: jsonb('business_profile').default({}).notNull(), brandingProfile: jsonb('branding_profile').default({}).notNull(), domainEmailProfile: jsonb('domain_email_profile').default({}).notNull(), websiteProfile: jsonb('website_profile').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const tenantOnboardingStages = pgTable('tenant_onboarding_stages', {
  id: uuid('id').defaultRandom().primaryKey(), onboardingId: uuid('onboarding_id').notNull().references(() => tenantOnboarding.id, { onDelete: 'cascade' }), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  stageKey: varchar('stage_key', { length: 40 }).notNull(), sequence: integer('sequence').notNull(), status: varchar('status', { length: 20 }).default('NOT_STARTED').notNull(), blockerCode: varchar('blocker_code', { length: 80 }), blockerNote: text('blocker_note'), notes: text('notes'),
  dueAt: timestamp('due_at', { withTimezone: true }), completedAt: timestamp('completed_at', { withTimezone: true }), updatedByAgencyUserId: uuid('updated_by_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ onboardingStageUnique: uniqueIndex('tenant_onboarding_stages_onboarding_stage_unique').on(table.onboardingId, table.stageKey), tenantSequenceIdx: index('tenant_onboarding_stages_tenant_sequence_idx').on(table.tenantId, table.sequence) }));
export const tenantLaunchChecks = pgTable('tenant_launch_checks', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), checkKey: varchar('check_key', { length: 80 }).notNull(), status: varchar('status', { length: 20 }).notNull(), blocking: boolean('blocking').default(true).notNull(), detail: text('detail'), checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantCheckUnique: uniqueIndex('tenant_launch_checks_tenant_check_unique').on(table.tenantId, table.checkKey), tenantStatusIdx: index('tenant_launch_checks_tenant_status_idx').on(table.tenantId, table.status) }));

export const tenantBillingAccounts = pgTable('tenant_billing_accounts', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }).unique(), provider: varchar('provider', { length: 30 }).default('GOCARDLESS').notNull(),
  providerCustomerId: varchar('provider_customer_id', { length: 255 }).unique(), providerMandateId: varchar('provider_mandate_id', { length: 255 }).unique(), mandateStatus: varchar('mandate_status', { length: 30 }).default('NOT_CREATED').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const tenantSetupPayments = pgTable('tenant_setup_payments', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), billingAccountId: uuid('billing_account_id').notNull().references(() => tenantBillingAccounts.id, { onDelete: 'restrict' }),
  providerPaymentId: varchar('provider_payment_id', { length: 255 }).unique(), providerBillingRequestId: varchar('provider_billing_request_id', { length: 255 }).unique(), amountMinor: integer('amount_minor').notNull(), currency: varchar('currency', { length: 3 }).default('GBP').notNull(), status: varchar('status', { length: 20 }).default('PENDING').notNull(),
  waivedReason: varchar('waived_reason', { length: 500 }), confirmedAt: timestamp('confirmed_at', { withTimezone: true }), refundedAt: timestamp('refunded_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantStatusIdx: index('tenant_setup_payments_tenant_status_idx').on(table.tenantId, table.status) }));
export const tenantSubscriptions = pgTable('tenant_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), billingAccountId: uuid('billing_account_id').notNull().references(() => tenantBillingAccounts.id, { onDelete: 'restrict' }), planVersionId: uuid('plan_version_id').notNull().references(() => platformPlanVersions.id, { onDelete: 'restrict' }),
  providerSubscriptionId: varchar('provider_subscription_id', { length: 255 }).unique(), status: varchar('status', { length: 40 }).default('DRAFT').notNull(), amountMinor: integer('amount_minor').notNull(), currency: varchar('currency', { length: 3 }).default('GBP').notNull(), intervalUnit: varchar('interval_unit', { length: 20 }).default('MONTHLY').notNull(),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }), nextChargeAt: timestamp('next_charge_at', { withTimezone: true }), graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }), cancellationScheduledAt: timestamp('cancellation_scheduled_at', { withTimezone: true }), cancelledAt: timestamp('cancelled_at', { withTimezone: true }), minimumTermEndsAt: timestamp('minimum_term_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantStatusIdx: index('tenant_subscriptions_tenant_status_idx').on(table.tenantId, table.status), nextChargeIdx: index('tenant_subscriptions_next_charge_idx').on(table.status, table.nextChargeAt) }));
export const tenantSubscriptionEvents = pgTable('tenant_subscription_events', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), subscriptionId: uuid('subscription_id').references(() => tenantSubscriptions.id, { onDelete: 'restrict' }), setupPaymentId: uuid('setup_payment_id').references(() => tenantSetupPayments.id, { onDelete: 'restrict' }),
  providerEventId: varchar('provider_event_id', { length: 255 }).notNull().unique(), resourceType: varchar('resource_type', { length: 40 }).notNull(), action: varchar('action', { length: 80 }).notNull(), payloadJson: jsonb('payload_json').notNull(), processedAt: timestamp('processed_at', { withTimezone: true }), failureCode: varchar('failure_code', { length: 80 }), receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantReceivedIdx: index('tenant_subscription_events_tenant_received_idx').on(table.tenantId, table.receivedAt), processingIdx: index('tenant_subscription_events_processing_idx').on(table.processedAt, table.receivedAt) }));
export const tenantPriceExceptions = pgTable('tenant_price_exceptions', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), subscriptionId: uuid('subscription_id').references(() => tenantSubscriptions.id, { onDelete: 'restrict' }), kind: varchar('kind', { length: 30 }).notNull(), amountMinor: integer('amount_minor'), percentageBasisPoints: integer('percentage_basis_points'), reason: varchar('reason', { length: 500 }).notNull(), startsAt: timestamp('starts_at', { withTimezone: true }).notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }), createdByAgencyUserId: uuid('created_by_agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantExpiryIdx: index('tenant_price_exceptions_tenant_expiry_idx').on(table.tenantId, table.expiresAt) }));

export const managedDeliverables = pgTable('managed_deliverables', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), type: varchar('type', { length: 30 }).notNull(), title: varchar('title', { length: 180 }).notNull(), description: text('description'), status: varchar('status', { length: 30 }).default('NOT_STARTED').notNull(),
  assignedAgencyUserId: uuid('assigned_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }), dueAt: timestamp('due_at', { withTimezone: true }), estimatedMinutes: integer('estimated_minutes').default(0).notNull(), actualMinutes: integer('actual_minutes').default(0).notNull(), costMinor: integer('cost_minor').default(0).notNull(), completedAt: timestamp('completed_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantStatusDueIdx: index('managed_deliverables_tenant_status_due_idx').on(table.tenantId, table.status, table.dueAt), assigneeStatusIdx: index('managed_deliverables_assignee_status_idx').on(table.assignedAgencyUserId, table.status) }));
export const managedDeliverableActivity = pgTable('managed_deliverable_activity', {
  id: uuid('id').defaultRandom().primaryKey(), deliverableId: uuid('deliverable_id').notNull().references(() => managedDeliverables.id, { onDelete: 'cascade' }), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), agencyUserId: uuid('agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }), action: varchar('action', { length: 80 }).notNull(), fromStatus: varchar('from_status', { length: 30 }), toStatus: varchar('to_status', { length: 30 }), note: text('note'), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ deliverableCreatedIdx: index('managed_deliverable_activity_deliverable_created_idx').on(table.deliverableId, table.createdAt) }));
export const managedDeliverableApprovals = pgTable('managed_deliverable_approvals', {
  id: uuid('id').defaultRandom().primaryKey(), deliverableId: uuid('deliverable_id').notNull().references(() => managedDeliverables.id, { onDelete: 'restrict' }), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), status: varchar('status', { length: 20 }).default('PENDING').notNull(), requestedByAgencyUserId: uuid('requested_by_agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }), responseNote: text('response_note'), requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(), respondedAt: timestamp('responded_at', { withTimezone: true }),
}, table => ({ deliverableStatusIdx: index('managed_deliverable_approvals_deliverable_status_idx').on(table.deliverableId, table.status) }));
export const managedServiceTimeEntries = pgTable('managed_service_time_entries', {
  id: uuid('id').defaultRandom().primaryKey(), deliverableId: uuid('deliverable_id').notNull().references(() => managedDeliverables.id, { onDelete: 'restrict' }), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), agencyUserId: uuid('agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }), minutes: integer('minutes').notNull(), costMinor: integer('cost_minor').default(0).notNull(), note: varchar('note', { length: 1000 }), workedAt: timestamp('worked_at', { withTimezone: true }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantWorkedIdx: index('managed_service_time_entries_tenant_worked_idx').on(table.tenantId, table.workedAt), deliverableIdx: index('managed_service_time_entries_deliverable_idx').on(table.deliverableId) }));

export const platformFailedJobs = pgTable('platform_failed_jobs', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }), jobType: varchar('job_type', { length: 80 }).notNull(), sourceId: varchar('source_id', { length: 255 }).notNull(), status: varchar('status', { length: 20 }).default('FAILED').notNull(), failureCode: varchar('failure_code', { length: 80 }).notNull(), safeRetryKind: varchar('safe_retry_kind', { length: 80 }), attemptCount: integer('attempt_count').default(0).notNull(), nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }), lastFailedAt: timestamp('last_failed_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ sourceUnique: uniqueIndex('platform_failed_jobs_source_unique').on(table.jobType, table.sourceId), statusAttemptIdx: index('platform_failed_jobs_status_attempt_idx').on(table.status, table.nextAttemptAt) }));
export const platformSupportNotes = pgTable('platform_support_notes', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }), agencyUserId: uuid('agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }), category: varchar('category', { length: 30 }).notNull(), visibility: varchar('visibility', { length: 30 }).default('AGENCY_ONLY').notNull(), note: text('note').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantCreatedIdx: index('platform_support_notes_tenant_created_idx').on(table.tenantId, table.createdAt) }));
export const platformIncidents = pgTable('platform_incidents', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }), severity: varchar('severity', { length: 20 }).notNull(), status: varchar('status', { length: 20 }).default('OPEN').notNull(), title: varchar('title', { length: 180 }).notNull(), summary: text('summary'), startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(), resolvedAt: timestamp('resolved_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ statusSeverityIdx: index('platform_incidents_status_severity_idx').on(table.status, table.severity), tenantStartedIdx: index('platform_incidents_tenant_started_idx').on(table.tenantId, table.startedAt) }));
export const agencyExportJobs = pgTable('agency_export_jobs', {
  id: uuid('id').defaultRandom().primaryKey(), requestedByAgencyUserId: uuid('requested_by_agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }), exportType: varchar('export_type', { length: 40 }).notNull(), filtersJson: jsonb('filters_json').default({}).notNull(), status: varchar('status', { length: 20 }).default('PENDING').notNull(), storagePath: varchar('storage_path', { length: 500 }), rowCount: integer('row_count'), expiresAt: timestamp('expires_at', { withTimezone: true }), requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(), completedAt: timestamp('completed_at', { withTimezone: true }), failureCode: varchar('failure_code', { length: 80 }),
}, table => ({ statusRequestedIdx: index('agency_export_jobs_status_requested_idx').on(table.status, table.requestedAt), requestedByIdx: index('agency_export_jobs_requested_by_idx').on(table.requestedByAgencyUserId) }));

export const tenantActivationMilestones = pgTable('tenant_activation_milestones', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), milestoneKey: varchar('milestone_key', { length: 60 }).notNull(), sourceType: varchar('source_type', { length: 40 }).notNull(), sourceId: varchar('source_id', { length: 255 }), achievedAt: timestamp('achieved_at', { withTimezone: true }).defaultNow().notNull(), metadata: jsonb('metadata').default({}).notNull(),
}, table => ({ tenantMilestoneUnique: uniqueIndex('tenant_activation_milestones_tenant_key_unique').on(table.tenantId, table.milestoneKey), achievedIdx: index('tenant_activation_milestones_achieved_idx').on(table.milestoneKey, table.achievedAt) }));
export const tenantChurnRecords = pgTable('tenant_churn_records', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }), planVersionId: uuid('plan_version_id').references(() => platformPlanVersions.id, { onDelete: 'restrict' }), cancellationAt: timestamp('cancellation_at', { withTimezone: true }).notNull(), lifetimeDays: integer('lifetime_days').notNull(), monthlyValueMinor: integer('monthly_value_minor').notNull(), reason: varchar('reason', { length: 500 }).notNull(), competitor: varchar('competitor', { length: 255 }), productIssue: boolean('product_issue').default(false).notNull(), serviceIssue: boolean('service_issue').default(false).notNull(), priceIssue: boolean('price_issue').default(false).notNull(), businessClosure: boolean('business_closure').default(false).notNull(), failedPayment: boolean('failed_payment').default(false).notNull(), dataExportedAt: timestamp('data_exported_at', { withTimezone: true }), websiteTransferStatus: varchar('website_transfer_status', { length: 80 }).default('NOT_STARTED').notNull(), createdByAgencyUserId: uuid('created_by_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ tenantCancellationIdx: index('tenant_churn_records_tenant_cancellation_idx').on(table.tenantId, table.cancellationAt), cancellationIdx: index('tenant_churn_records_cancellation_idx').on(table.cancellationAt) }));

export const consentRecords = pgTable('consent_records', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }), authUserId: uuid('auth_user_id'), clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }),
  consentType: varchar('consent_type', { length: 80 }).notNull(), consentVersion: varchar('consent_version', { length: 40 }).notNull(), policyReference: varchar('policy_reference', { length: 500 }), wordingSnapshot: text('wording_snapshot').notNull(), status: varchar('status', { length: 20 }).notNull(), collectionSource: varchar('collection_source', { length: 80 }).notNull(),
  ipHash: varchar('ip_hash', { length: 64 }), userAgent: varchar('user_agent', { length: 500 }), evidenceMetadata: jsonb('evidence_metadata').default({}).notNull(), supersedesConsentId: uuid('supersedes_consent_id'), grantedAt: timestamp('granted_at', { withTimezone: true }), withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ subjectIdx: index('consent_records_subject_idx').on(table.tenantId, table.authUserId, table.clientId, table.consentType, table.createdAt) }));

export const privacyRequests = pgTable('privacy_requests', {
  id: uuid('id').defaultRandom().primaryKey(), publicReference: uuid('public_reference').defaultRandom().notNull().unique(), tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }), requestType: varchar('request_type', { length: 20 }).notNull(),
  subjectAuthUserId: uuid('subject_auth_user_id'), subjectClientId: uuid('subject_client_id').references(() => clients.id, { onDelete: 'restrict' }), subjectEmailHash: varchar('subject_email_hash', { length: 64 }), status: varchar('status', { length: 50 }).default('RECEIVED').notNull(), identityVerificationStatus: varchar('identity_verification_status', { length: 30 }).default('REQUIRED').notNull(),
  assignedAgencyUserId: uuid('assigned_agency_user_id').references(() => agencyUsers.id, { onDelete: 'set null' }), requestNotes: text('request_notes'), dueAt: timestamp('due_at', { withTimezone: true }).notNull(), completedAt: timestamp('completed_at', { withTimezone: true }), failureReason: varchar('failure_reason', { length: 500 }), decisionReason: varchar('decision_reason', { length: 1000 }), deletionStrategy: varchar('deletion_strategy', { length: 30 }), scheduledFor: timestamp('scheduled_for', { withTimezone: true }), legalHoldCheckedAt: timestamp('legal_hold_checked_at', { withTimezone: true }), retentionException: jsonb('retention_exception'), createdByAgencyUserId: uuid('created_by_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ queueIdx: index('privacy_requests_queue_idx').on(table.status, table.dueAt, table.id), subjectIdx: index('privacy_requests_subject_idx').on(table.tenantId, table.subjectAuthUserId, table.subjectClientId, table.createdAt) }));

export const privacyExportArtifacts = pgTable('privacy_export_artifacts', {
  id: uuid('id').defaultRandom().primaryKey(), requestId: uuid('request_id').notNull().unique().references(() => privacyRequests.id, { onDelete: 'cascade' }), storagePath: varchar('storage_path', { length: 1000 }).notNull(), format: varchar('format', { length: 20 }).notNull(), byteSize: integer('byte_size').notNull(), checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), downloadedAt: timestamp('downloaded_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ expiryIdx: index('privacy_export_expiry_idx').on(table.expiresAt) }));

export const legalHolds = pgTable('legal_holds', {
  id: uuid('id').defaultRandom().primaryKey(), tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }), subjectAuthUserId: uuid('subject_auth_user_id'), subjectClientId: uuid('subject_client_id').references(() => clients.id, { onDelete: 'restrict' }), reason: varchar('reason', { length: 1000 }).notNull(), legalBasis: varchar('legal_basis', { length: 500 }).notNull(), status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), startsAt: timestamp('starts_at', { withTimezone: true }).defaultNow().notNull(), endsAt: timestamp('ends_at', { withTimezone: true }), releasedAt: timestamp('released_at', { withTimezone: true }), createdByAgencyUserId: uuid('created_by_agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }), releasedByAgencyUserId: uuid('released_by_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ activeSubjectIdx: index('legal_holds_active_subject_idx').on(table.status, table.tenantId, table.subjectAuthUserId, table.subjectClientId) }));

export const retentionPolicies = pgTable('retention_policies', {
  id: uuid('id').defaultRandom().primaryKey(), publicReference: uuid('public_reference').defaultRandom().notNull().unique(), tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }), dataCategory: varchar('data_category', { length: 100 }).notNull(), retentionDays: integer('retention_days').notNull(), retentionTrigger: varchar('retention_trigger', { length: 80 }).notNull(), expiryAction: varchar('expiry_action', { length: 30 }).notNull(), legalBasis: varchar('legal_basis', { length: 500 }).notNull(), jurisdiction: varchar('jurisdiction', { length: 80 }), enabled: boolean('enabled').default(false).notNull(), dryRun: boolean('dry_run').default(true).notNull(), version: integer('version').default(1).notNull(), createdByAgencyUserId: uuid('created_by_agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }), approvedByAgencyUserId: uuid('approved_by_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }), lastExecutedAt: timestamp('last_executed_at', { withTimezone: true }), nextExecutionAt: timestamp('next_execution_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ scopeVersionUnique: uniqueIndex('retention_policy_scope_unique').on(table.tenantId, table.dataCategory, table.version), dueIdx: index('retention_policies_due_idx').on(table.enabled, table.nextExecutionAt) }));

export const retentionPolicyVersions = pgTable('retention_policy_versions', {
  id: uuid('id').defaultRandom().primaryKey(), policyId: uuid('policy_id').notNull().references(() => retentionPolicies.id, { onDelete: 'restrict' }), version: integer('version').notNull(), snapshot: jsonb('snapshot').notNull(), approvedByAgencyUserId: uuid('approved_by_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ policyVersionUnique: uniqueIndex('retention_policy_version_unique').on(table.policyId, table.version) }));

export const retentionRuns = pgTable('retention_runs', {
  id: uuid('id').defaultRandom().primaryKey(), policyId: uuid('policy_id').notNull().references(() => retentionPolicies.id, { onDelete: 'restrict' }), idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull().unique(), status: varchar('status', { length: 20 }).default('QUEUED').notNull(), dryRun: boolean('dry_run').notNull(), scannedCount: integer('scanned_count').default(0).notNull(), affectedCount: integer('affected_count').default(0).notNull(), skippedLegalHoldCount: integer('skipped_legal_hold_count').default(0).notNull(), report: jsonb('report').default({}).notNull(), failureCode: varchar('failure_code', { length: 100 }), startedAt: timestamp('started_at', { withTimezone: true }), completedAt: timestamp('completed_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({ queueIdx: index('retention_runs_queue_idx').on(table.status, table.createdAt, table.id) }));

export const integrationConnections=pgTable('integration_connections',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),connectedUserId:uuid('connected_user_id').references(()=>users.id,{onDelete:'set null'}),locationId:uuid('location_id').references(()=>locations.id,{onDelete:'set null'}),kind:varchar('kind',{length:30}).notNull(),provider:varchar('provider',{length:40}).notNull(),externalAccountId:varchar('external_account_id',{length:255}),externalResourceId:varchar('external_resource_id',{length:255}),externalResourceName:varchar('external_resource_name',{length:255}),tokenCiphertext:text('token_ciphertext'),tokenExpiresAt:timestamp('token_expires_at',{withTimezone:true}),grantedScopes:text('granted_scopes').array().default([]).notNull(),status:varchar('status',{length:40}).default('NOT_CONNECTED').notNull(),syncDirection:varchar('sync_direction',{length:20}).default('OUTBOUND').notNull(),settings:jsonb('settings').default({}).notNull(),providerMetadata:jsonb('provider_metadata').default({}).notNull(),lastSuccessfulSyncAt:timestamp('last_successful_sync_at',{withTimezone:true}),lastAttemptedSyncAt:timestamp('last_attempted_sync_at',{withTimezone:true}),lastSyncError:varchar('last_sync_error',{length:500}),webhookId:varchar('webhook_id',{length:255}),webhookExpiresAt:timestamp('webhook_expires_at',{withTimezone:true}),connectedByUserId:uuid('connected_by_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}),disconnectedAt:timestamp('disconnected_at',{withTimezone:true}),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
},t=>({tenantKindIdx:index('integration_connections_tenant_kind_idx').on(t.tenantId,t.kind,t.provider,t.status)}));
export const integrationEvents=pgTable('integration_events',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),integrationId:uuid('integration_id').references(()=>integrationConnections.id,{onDelete:'set null'}),provider:varchar('provider',{length:40}).notNull(),direction:varchar('direction',{length:20}).notNull(),localEntityType:varchar('local_entity_type',{length:50}).notNull(),localEntityId:varchar('local_entity_id',{length:255}).notNull(),externalEntityType:varchar('external_entity_type',{length:50}),externalEntityId:varchar('external_entity_id',{length:255}),operation:varchar('operation',{length:40}).notNull(),status:varchar('status',{length:25}).default('QUEUED').notNull(),attemptCount:integer('attempt_count').default(0).notNull(),idempotencyKey:varchar('idempotency_key',{length:255}).notNull(),requestId:varchar('request_id',{length:100}),startedAt:timestamp('started_at',{withTimezone:true}),completedAt:timestamp('completed_at',{withTimezone:true}),nextRetryAt:timestamp('next_retry_at',{withTimezone:true}),errorCode:varchar('error_code',{length:100}),safeErrorMessage:varchar('safe_error_message',{length:500}),providerMetadata:jsonb('provider_metadata').default({}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
},t=>({providerIdempotencyUnique:uniqueIndex('integration_events_provider_idempotency_unique').on(t.provider,t.idempotencyKey),queueIdx:index('integration_events_queue_idx').on(t.status,t.nextRetryAt,t.createdAt)}));
export const calendarFeeds=pgTable('calendar_feeds',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),scope:varchar('scope',{length:20}).notNull(),staffUserId:uuid('staff_user_id').references(()=>users.id,{onDelete:'cascade'}),locationId:uuid('location_id').references(()=>locations.id,{onDelete:'cascade'}),tokenHash:varchar('token_hash',{length:64}).notNull().unique(),bookingStatuses:text('booking_statuses').array().default([]).notNull(),privacyLevel:varchar('privacy_level',{length:20}).default('BUSY_ONLY').notNull(),createdByUserId:uuid('created_by_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),rotatedAt:timestamp('rotated_at',{withTimezone:true}),revokedAt:timestamp('revoked_at',{withTimezone:true}),
});
export const accountingMappings=pgTable('accounting_mappings',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),integrationId:uuid('integration_id').references(()=>integrationConnections.id,{onDelete:'cascade'}),mappingType:varchar('mapping_type',{length:40}).notNull(),localId:varchar('local_id',{length:255}).notNull(),externalId:varchar('external_id',{length:255}).notNull(),externalCode:varchar('external_code',{length:100}),metadata:jsonb('metadata').default({}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
},t=>({mappingUnique:uniqueIndex('accounting_mappings_scope_unique').on(t.tenantId,t.integrationId,t.mappingType,t.localId)}));
export const webhookSubscriptions=pgTable('webhook_subscriptions',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),name:varchar('name',{length:120}).notNull(),targetUrl:varchar('target_url',{length:2048}).notNull(),secretCiphertext:text('secret_ciphertext').notNull(),previousSecretCiphertext:text('previous_secret_ciphertext'),previousSecretValidUntil:timestamp('previous_secret_valid_until',{withTimezone:true}),enabled:boolean('enabled').default(true).notNull(),eventTypes:text('event_types').array().notNull(),apiVersion:varchar('api_version',{length:20}).default('2026-07-01').notNull(),description:varchar('description',{length:500}),customHeadersCiphertext:text('custom_headers_ciphertext'),allowedHost:varchar('allowed_host',{length:255}).notNull(),environment:varchar('environment',{length:20}).default('live').notNull(),createdByUserId:uuid('created_by_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}),lastSuccessfulDeliveryAt:timestamp('last_successful_delivery_at',{withTimezone:true}),lastFailedDeliveryAt:timestamp('last_failed_delivery_at',{withTimezone:true}),consecutiveFailureCount:integer('consecutive_failure_count').default(0).notNull(),disabledReason:varchar('disabled_reason',{length:500}),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
},t=>({tenantIdx:index('webhook_subscriptions_tenant_idx').on(t.tenantId,t.enabled)}));
export const apiCredentials=pgTable('api_credentials',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),name:varchar('name',{length:120}).notNull(),keyHash:varchar('key_hash',{length:64}).notNull().unique(),keyPrefix:varchar('key_prefix',{length:16}).notNull(),scopes:text('scopes').array().notNull(),environment:varchar('environment',{length:20}).default('live').notNull(),rateLimitTier:varchar('rate_limit_tier',{length:20}).default('STANDARD').notNull(),createdByUserId:uuid('created_by_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),lastUsedAt:timestamp('last_used_at',{withTimezone:true}),expiresAt:timestamp('expires_at',{withTimezone:true}),revokedAt:timestamp('revoked_at',{withTimezone:true}),
});
export const hardwareIntegrations=pgTable('hardware_integrations',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),locationId:uuid('location_id').notNull().references(()=>locations.id,{onDelete:'restrict'}),provider:varchar('provider',{length:40}).notNull(),deviceType:varchar('device_type',{length:40}).notNull(),externalDeviceId:varchar('external_device_id',{length:255}),deviceLabel:varchar('device_label',{length:120}).notNull(),status:varchar('status',{length:30}).default('OFFLINE').notNull(),connectionType:varchar('connection_type',{length:30}).notNull(),configuration:jsonb('configuration').default({}).notNull(),lastOnlineAt:timestamp('last_online_at',{withTimezone:true}),lastSuccessfulActionAt:timestamp('last_successful_action_at',{withTimezone:true}),lastError:varchar('last_error',{length:500}),enabled:boolean('enabled').default(true).notNull(),createdByUserId:uuid('created_by_user_id').notNull().references(()=>users.id,{onDelete:'restrict'}),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
},t=>({deviceUnique:uniqueIndex('hardware_integrations_device_unique').on(t.tenantId,t.provider,t.externalDeviceId)}));

export const formSubmissionDrafts=pgTable('form_submission_drafts',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),assignmentId:uuid('assignment_id').notNull().references(()=>formAssignments.id,{onDelete:'cascade'}).unique(),formVersionId:uuid('form_version_id').notNull().references(()=>formVersions.id,{onDelete:'restrict'}),resumeTokenHash:varchar('resume_token_hash',{length:64}).notNull().unique(),answersJson:jsonb('answers_json').default({}).notNull(),currentPage:integer('current_page').default(0).notNull(),completionPercentage:integer('completion_percentage').default(0).notNull(),revision:integer('revision').default(1).notNull(),language:varchar('language',{length:12}).default('en-GB').notNull(),timezone:varchar('timezone',{length:100}),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),lastSavedAt:timestamp('last_saved_at',{withTimezone:true}).defaultNow().notNull(),revokedAt:timestamp('revoked_at',{withTimezone:true}),
},t=>({expiryIdx:index('form_submission_drafts_expiry_idx').on(t.expiresAt)}));
export const formSubmissionAnswers=pgTable('form_submission_answers',{
 id:uuid('id').defaultRandom().primaryKey(),submissionId:uuid('submission_id').notNull().references(()=>clientFormSubmissions.id,{onDelete:'cascade'}),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),fieldId:uuid('field_id').notNull(),fieldKey:varchar('field_key',{length:120}).notNull(),fieldVersion:integer('field_version').default(1).notNull(),answerType:varchar('answer_type',{length:40}).notNull(),valueJson:jsonb('value_json'),displayValue:text('display_value'),validationState:varchar('validation_state',{length:20}).default('VALID').notNull(),sensitiveClassification:varchar('sensitive_classification',{length:30}).default('STANDARD').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
},t=>({submissionFieldUnique:uniqueIndex('form_submission_answers_submission_field_unique').on(t.submissionId,t.fieldKey)}));
export const formSubmissionFiles=pgTable('form_submission_files',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),assignmentId:uuid('assignment_id').notNull().references(()=>formAssignments.id,{onDelete:'cascade'}),submissionId:uuid('submission_id').references(()=>clientFormSubmissions.id,{onDelete:'cascade'}),fieldKey:varchar('field_key',{length:120}).notNull(),storagePath:varchar('storage_path',{length:1000}).notNull().unique(),originalName:varchar('original_name',{length:255}).notNull(),safeContentType:varchar('safe_content_type',{length:100}).notNull(),byteSize:integer('byte_size').notNull(),checksumSha256:varchar('checksum_sha256',{length:64}).notNull(),scanStatus:varchar('scan_status',{length:20}).default('PENDING').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),deletedAt:timestamp('deleted_at',{withTimezone:true}),
});
export const formTemplates=pgTable('form_templates',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').references(()=>tenants.id,{onDelete:'cascade'}),name:varchar('name',{length:160}).notNull(),category:varchar('category',{length:80}).notNull(),description:text('description').default('').notNull(),schemaJson:jsonb('schema_json').notNull(),themeJson:jsonb('theme_json').default({}).notNull(),version:integer('version').default(1).notNull(),isSystem:boolean('is_system').default(false).notNull(),createdByUserId:uuid('created_by_user_id').references(()=>users.id,{onDelete:'set null'}),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
},t=>({catalogIdx:index('form_templates_catalog_idx').on(t.tenantId,t.isSystem,t.category,t.name)}));
export const formAnalyticsEvents=pgTable('form_analytics_events',{
 id:uuid('id').defaultRandom().primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>tenants.id,{onDelete:'cascade'}),formId:uuid('form_id').notNull().references(()=>forms.id,{onDelete:'cascade'}),formVersionId:uuid('form_version_id').references(()=>formVersions.id,{onDelete:'set null'}),assignmentId:uuid('assignment_id').references(()=>formAssignments.id,{onDelete:'set null'}),eventType:varchar('event_type',{length:40}).notNull(),pageId:varchar('page_id',{length:120}),fieldKey:varchar('field_key',{length:120}),deviceType:varchar('device_type',{length:20}),source:varchar('source',{length:100}),campaign:varchar('campaign',{length:100}),language:varchar('language',{length:12}),durationMs:integer('duration_ms'),occurredAt:timestamp('occurred_at',{withTimezone:true}).defaultNow().notNull(),metadata:jsonb('metadata').default({}).notNull(),
},t=>({rollupIdx:index('form_analytics_rollup_idx').on(t.tenantId,t.formId,t.formVersionId,t.eventType,t.occurredAt)}));

export const knowledgePacks = pgTable('knowledge_packs', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  semanticVersion: text('semantic_version').notNull(),
  intendedScope: text('intended_scope').notNull(),
  status: text('status').default('DRAFT').notNull(),
  schemaVersion: integer('schema_version').default(1).notNull(),
  sourceDigestSha256: text('source_digest_sha256'),
  contentDigestSha256: text('content_digest_sha256'),
  ruleCount: integer('rule_count').default(0).notNull(),
  pagePlaybookCount: integer('page_playbook_count').default(0).notNull(),
  sectionPlaybookCount: integer('section_playbook_count').default(0).notNull(),
  sourceCount: integer('source_count').default(0).notNull(),
  findingCount: integer('finding_count').default(0).notNull(),
  conflictCount: integer('conflict_count').default(0).notNull(),
  revisionOfPackId: uuid('revision_of_pack_id')
    .references((): AnyPgColumn => knowledgePacks.id, { onDelete: 'restrict' }),
  supersededByPackId: uuid('superseded_by_pack_id')
    .references((): AnyPgColumn => knowledgePacks.id, { onDelete: 'restrict' }),
  createdByAgencyUserId: uuid('created_by_agency_user_id').notNull()
    .references(() => agencyUsers.id, { onDelete: 'restrict' }),
  approvedByAgencyUserId: uuid('approved_by_agency_user_id')
    .references(() => agencyUsers.id, { onDelete: 'restrict' }),
  activatedByAgencyUserId: uuid('activated_by_agency_user_id')
    .references(() => agencyUsers.id, { onDelete: 'restrict' }),
  retiredByAgencyUserId: uuid('retired_by_agency_user_id')
    .references(() => agencyUsers.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
}, table => ({
  versionUnique: uniqueIndex('knowledge_packs_version_unique')
    .on(table.intendedScope, table.semanticVersion),
  statusCreatedIdx: index('knowledge_packs_status_created_idx')
    .on(table.status, table.createdAt, table.id),
  revisionIdx: index('knowledge_packs_revision_idx').on(table.revisionOfPackId),
  supersededIdx: index('knowledge_packs_superseded_idx').on(table.supersededByPackId),
  createdByIdx: index('knowledge_packs_created_by_idx').on(table.createdByAgencyUserId),
  approvedByIdx: index('knowledge_packs_approved_by_idx').on(table.approvedByAgencyUserId),
  activatedByIdx: index('knowledge_packs_activated_by_idx').on(table.activatedByAgencyUserId),
  retiredByIdx: index('knowledge_packs_retired_by_idx').on(table.retiredByAgencyUserId),
}));

export const knowledgeSources = pgTable('knowledge_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  sourceId: text('source_id').notNull(),
  sourceTitle: text('source_title').notNull(),
  author: text('author'),
  editionOrVersion: text('edition_or_version'),
  sourceType: text('source_type').notNull(),
  topicDomainsJson: jsonb('topic_domains_json').default([]).notNull(),
  evidenceAuthority: text('evidence_authority').notNull(),
  supportCapability: text('support_capability').notNull(),
  strengthOfSupport: text('strength_of_support'),
  temporalClass: text('temporal_class').notNull(),
  citationLocationsJson: jsonb('citation_locations_json').default([]).notNull(),
  copyrightNotes: text('copyright_notes'),
  verifiedAt: date('verified_at'),
  reviewDueAt: date('review_due_at'),
  reviewNotes: text('review_notes'),
  contentDigestSha256: text('content_digest_sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  packIdentifierUnique: uniqueIndex('knowledge_sources_pack_identifier_unique')
    .on(table.knowledgePackId, table.sourceId),
  packCreatedIdx: index('knowledge_sources_pack_created_idx')
    .on(table.knowledgePackId, table.createdAt, table.id),
  typeIdx: index('knowledge_sources_type_idx')
    .on(table.sourceType, table.knowledgePackId),
}));

export const knowledgeRules = pgTable('knowledge_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  ruleId: text('rule_id').notNull(),
  ruleName: text('rule_name').notNull(),
  ruleScope: text('rule_scope').notNull(),
  domain: text('domain').notNull(),
  subcategory: text('subcategory').notNull(),
  principle: text('principle').notNull(),
  whyItMatters: text('why_it_matters'),
  implementationInstruction: text('implementation_instruction').notNull(),
  priority: text('priority').notNull(),
  validationType: text('validation_type').notNull(),
  publicationEffect: text('publication_effect').notNull(),
  enforcementAuthority: text('enforcement_authority').notNull(),
  requiredBusinessDataJson: jsonb('required_business_data_json').default([]).notNull(),
  prohibitedBehaviour: text('prohibited_behaviour'),
  antiPattern: text('anti_pattern'),
  deterministicTestDescription: text('deterministic_test_description'),
  aiReviewInstruction: text('ai_review_instruction'),
  humanReviewInstruction: text('human_review_instruction'),
  supportType: text('support_type'),
  temporalClass: text('temporal_class').notNull(),
  verificationSourceIdsJson: jsonb('verification_source_ids_json').default([]).notNull(),
  verifiedAt: date('verified_at'),
  reviewDueAt: date('review_due_at'),
  confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull(),
  notes: text('notes'),
  status: text('status').default('ACCEPTED').notNull(),
  contentDigestSha256: text('content_digest_sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  packIdentifierUnique: uniqueIndex('knowledge_rules_pack_identifier_unique')
    .on(table.knowledgePackId, table.ruleId),
  packOrderIdx: index('knowledge_rules_pack_order_idx').on(
    table.knowledgePackId,
    table.enforcementAuthority,
    table.publicationEffect,
    table.priority,
    table.domain,
    table.ruleId,
  ),
  packDomainIdx: index('knowledge_rules_pack_domain_idx')
    .on(table.knowledgePackId, table.domain, table.status),
  contentDigestIdx: index('knowledge_rules_content_digest_idx')
    .on(table.knowledgePackId, table.contentDigestSha256),
}));

export const knowledgeRulePageTypes = pgTable('knowledge_rule_page_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  knowledgeRuleId: uuid('knowledge_rule_id').notNull()
    .references(() => knowledgeRules.id, { onDelete: 'restrict' }),
  pageType: text('page_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  unique: uniqueIndex('knowledge_rule_page_types_unique')
    .on(table.knowledgeRuleId, table.pageType),
  packPageIdx: index('knowledge_rule_page_types_pack_page_idx')
    .on(table.knowledgePackId, table.pageType, table.knowledgeRuleId),
}));

export const knowledgeRuleSectionTypes = pgTable('knowledge_rule_section_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  knowledgeRuleId: uuid('knowledge_rule_id').notNull()
    .references(() => knowledgeRules.id, { onDelete: 'restrict' }),
  sectionType: text('section_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  unique: uniqueIndex('knowledge_rule_section_types_unique')
    .on(table.knowledgeRuleId, table.sectionType),
  packSectionIdx: index('knowledge_rule_section_types_pack_section_idx')
    .on(table.knowledgePackId, table.sectionType, table.knowledgeRuleId),
}));

export const knowledgeRuleConversionRoles = pgTable('knowledge_rule_conversion_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  knowledgeRuleId: uuid('knowledge_rule_id').notNull()
    .references(() => knowledgeRules.id, { onDelete: 'restrict' }),
  conversionRole: text('conversion_role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  unique: uniqueIndex('knowledge_rule_conversion_roles_unique')
    .on(table.knowledgeRuleId, table.conversionRole),
  packRoleIdx: index('knowledge_rule_conversion_roles_pack_role_idx')
    .on(table.knowledgePackId, table.conversionRole, table.knowledgeRuleId),
}));

export const knowledgeRuleSources = pgTable('knowledge_rule_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  knowledgeRuleId: uuid('knowledge_rule_id').notNull()
    .references(() => knowledgeRules.id, { onDelete: 'restrict' }),
  knowledgeSourceId: uuid('knowledge_source_id').notNull()
    .references(() => knowledgeSources.id, { onDelete: 'restrict' }),
  relationshipType: text('relationship_type').default('SUPPORT').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  unique: uniqueIndex('knowledge_rule_sources_unique').on(
    table.knowledgeRuleId,
    table.knowledgeSourceId,
    table.relationshipType,
  ),
  packRuleIdx: index('knowledge_rule_sources_pack_rule_idx')
    .on(table.knowledgePackId, table.knowledgeRuleId),
  sourceIdx: index('knowledge_rule_sources_source_idx')
    .on(table.knowledgeSourceId, table.knowledgeRuleId),
}));

export const knowledgePagePlaybooks = pgTable('knowledge_page_playbooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  pageType: text('page_type').notNull(),
  conversionRole: text('conversion_role').notNull(),
  contentDigestSha256: text('content_digest_sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  unique: uniqueIndex('knowledge_page_playbooks_unique')
    .on(table.knowledgePackId, table.pageType, table.conversionRole),
  packPageIdx: index('knowledge_page_playbooks_pack_page_idx')
    .on(table.knowledgePackId, table.pageType, table.conversionRole),
}));

export const knowledgeSectionPlaybooks = pgTable('knowledge_section_playbooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  pagePlaybookId: uuid('page_playbook_id').notNull()
    .references(() => knowledgePagePlaybooks.id, { onDelete: 'restrict' }),
  sectionType: text('section_type').notNull(),
  sectionOrderMin: integer('section_order_min').notNull(),
  sectionOrderMax: integer('section_order_max').notNull(),
  requirement: text('requirement').notNull(),
  userIntent: text('user_intent').notNull(),
  businessObjective: text('business_objective'),
  sectionPurpose: text('section_purpose').notNull(),
  requiredBusinessDataJson: jsonb('required_business_data_json').default([]).notNull(),
  copyInstruction: text('copy_instruction'),
  seoInstruction: text('seo_instruction'),
  trustInstruction: text('trust_instruction'),
  bookingInstruction: text('booking_instruction'),
  mobileInstruction: text('mobile_instruction'),
  accessibilityInstruction: text('accessibility_instruction'),
  allowedPrimaryCtaTypesJson: jsonb('allowed_primary_cta_types_json').default([]).notNull(),
  allowedSecondaryCtaTypesJson: jsonb('allowed_secondary_cta_types_json').default([]).notNull(),
  blockingConditionsJson: jsonb('blocking_conditions_json').default([]).notNull(),
  commonAntiPatternsJson: jsonb('common_anti_patterns_json').default([]).notNull(),
  ruleIdsJson: jsonb('rule_ids_json').default([]).notNull(),
  sourceIdsJson: jsonb('source_ids_json').default([]).notNull(),
  confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull(),
  notes: text('notes'),
  contentDigestSha256: text('content_digest_sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  unique: uniqueIndex('knowledge_section_playbooks_unique').on(
    table.pagePlaybookId,
    table.sectionType,
    table.sectionOrderMin,
    table.sectionOrderMax,
  ),
  packPageIdx: index('knowledge_section_playbooks_pack_page_idx').on(
    table.knowledgePackId,
    table.pagePlaybookId,
    table.sectionOrderMin,
    table.id,
  ),
  sectionIdx: index('knowledge_section_playbooks_section_idx')
    .on(table.sectionType, table.knowledgePackId),
}));

export const knowledgeImportRuns = pgTable('knowledge_import_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  importFormat: text('import_format').notNull(),
  sourceDigestSha256: text('source_digest_sha256').notNull(),
  status: text('status').default('STARTED').notNull(),
  sourceCount: integer('source_count').default(0).notNull(),
  ruleCount: integer('rule_count').default(0).notNull(),
  pagePlaybookCount: integer('page_playbook_count').default(0).notNull(),
  sectionPlaybookCount: integer('section_playbook_count').default(0).notNull(),
  rejectedRuleCount: integer('rejected_rule_count').default(0).notNull(),
  findingCount: integer('finding_count').default(0).notNull(),
  conflictCount: integer('conflict_count').default(0).notNull(),
  failureCode: text('failure_code'),
  requestedByAgencyUserId: uuid('requested_by_agency_user_id').notNull()
    .references(() => agencyUsers.id, { onDelete: 'restrict' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, table => ({
  packDigestUnique: uniqueIndex('knowledge_import_runs_pack_digest_unique')
    .on(table.knowledgePackId, table.sourceDigestSha256),
  packStartedIdx: index('knowledge_import_runs_pack_started_idx')
    .on(table.knowledgePackId, table.startedAt, table.id),
  requestedByIdx: index('knowledge_import_runs_requested_by_idx')
    .on(table.requestedByAgencyUserId),
}));

export const knowledgeImportFindings = pgTable('knowledge_import_findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  importRunId: uuid('import_run_id')
    .references(() => knowledgeImportRuns.id, { onDelete: 'restrict' }),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  code: text('code').notNull(),
  message: text('message').notNull(),
  blocksApproval: boolean('blocks_approval').default(false).notNull(),
  ruleId: text('rule_id'),
  sourceId: text('source_id'),
  pageType: text('page_type'),
  sectionType: text('section_type'),
  current: boolean('current').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  packCurrentIdx: index('knowledge_import_findings_pack_current_idx').on(
    table.knowledgePackId,
    table.current,
    table.blocksApproval,
    table.severity,
    table.createdAt,
    table.id,
  ),
  importIdx: index('knowledge_import_findings_import_idx')
    .on(table.importRunId, table.createdAt, table.id),
}));

export const knowledgeConflicts = pgTable('knowledge_conflicts', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  importRunId: uuid('import_run_id')
    .references(() => knowledgeImportRuns.id, { onDelete: 'restrict' }),
  conflictType: text('conflict_type').notNull(),
  severity: text('severity').notNull(),
  summary: text('summary').notNull(),
  ruleIdsJson: jsonb('rule_ids_json').default([]).notNull(),
  pageType: text('page_type'),
  sectionType: text('section_type'),
  status: text('status').default('OPEN').notNull(),
  resolutionReason: text('resolution_reason'),
  resolvedByAgencyUserId: uuid('resolved_by_agency_user_id')
    .references(() => agencyUsers.id, { onDelete: 'restrict' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  current: boolean('current').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  packCurrentIdx: index('knowledge_conflicts_pack_current_idx').on(
    table.knowledgePackId,
    table.current,
    table.status,
    table.severity,
    table.createdAt,
    table.id,
  ),
  importIdx: index('knowledge_conflicts_import_idx')
    .on(table.importRunId, table.createdAt, table.id),
  resolvedByIdx: index('knowledge_conflicts_resolved_by_idx')
    .on(table.resolvedByAgencyUserId),
}));

export const knowledgeRejectedRules = pgTable('knowledge_rejected_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  knowledgePackId: uuid('knowledge_pack_id').notNull()
    .references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  ruleId: text('rule_id').notNull(),
  ruleName: text('rule_name').notNull(),
  rejectionReason: text('rejection_reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  unique: uniqueIndex('knowledge_rejected_rules_unique')
    .on(table.knowledgePackId, table.ruleId),
  packIdx: index('knowledge_rejected_rules_pack_idx')
    .on(table.knowledgePackId, table.ruleId),
}));

// Phase 15.6C generation records retain only controlled structured provenance,
// safe findings and claim digests. Raw prompts, responses and credentials are
// deliberately absent from the database model.
export const siteGenerationRuns = pgTable('site_generation_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'restrict' }),
  siteVersionId: uuid('site_version_id').references(() => siteVersions.id, { onDelete: 'restrict' }),
  blueprintId: uuid('blueprint_id').notNull().references(() => siteBlueprints.id, { onDelete: 'restrict' }),
  blueprintRevision: integer('blueprint_revision').notNull(),
  templateVersionId: uuid('template_version_id').notNull().references(() => templateVersions.id, { onDelete: 'restrict' }),
  knowledgePackId: uuid('knowledge_pack_id').notNull().references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  knowledgePackSemanticVersion: text('knowledge_pack_semantic_version').notNull(),
  siteJobId: uuid('site_job_id').references(() => siteJobs.id, { onDelete: 'restrict' }),
  generationReason: text('generation_reason').notNull(),
  generatorVersion: text('generator_version').notNull(),
  providerKey: text('provider_key').notNull(),
  modelKey: text('model_key').notNull(),
  status: text('status').default('PENDING').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  sourceDataDigestSha256: text('source_data_digest_sha256').notNull(),
  generationContextDigestSha256: text('generation_context_digest_sha256'),
  promptTemplateVersion: text('prompt_template_version').notNull(),
  outputContentDigestSha256: text('output_content_digest_sha256'),
  pageCountPlanned: integer('page_count_planned').default(0).notNull(),
  pageCountCompleted: integer('page_count_completed').default(0).notNull(),
  sectionCountPlanned: integer('section_count_planned').default(0).notNull(),
  sectionCountCompleted: integer('section_count_completed').default(0).notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  repairAttemptCount: integer('repair_attempt_count').default(0).notNull(),
  failureCode: text('failure_code'),
  failureMessage: text('failure_message'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  requestedByAgencyUserId: uuid('requested_by_agency_user_id').notNull().references(() => agencyUsers.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  identityUnique: uniqueIndex('site_generation_runs_identity_unique').on(table.tenantId, table.idempotencyKey),
  siteCreatedIdx: index('site_generation_runs_site_created_idx').on(table.tenantId, table.siteId, table.createdAt),
  statusCreatedIdx: index('site_generation_runs_status_created_idx').on(table.status, table.createdAt),
  versionIdx: index('site_generation_runs_version_idx').on(table.siteVersionId),
}));

export const siteGenerationPageRuns = pgTable('site_generation_page_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  generationRunId: uuid('generation_run_id').notNull().references(() => siteGenerationRuns.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'restrict' }),
  siteVersionId: uuid('site_version_id').notNull().references(() => siteVersions.id, { onDelete: 'restrict' }),
  sitePageId: uuid('site_page_id').references(() => sitePages.id, { onDelete: 'restrict' }),
  plannedPageReference: uuid('planned_page_reference').defaultRandom().notNull(),
  blueprintPageId: uuid('blueprint_page_id').notNull().references(() => siteBlueprintPages.id, { onDelete: 'restrict' }),
  templateLayoutId: uuid('template_layout_id').notNull().references(() => templateLayouts.id, { onDelete: 'restrict' }),
  rendererKey: text('renderer_key').notNull(),
  status: text('status').default('PENDING').notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  repairAttemptCount: integer('repair_attempt_count').default(0).notNull(),
  generationContextDigestSha256: text('generation_context_digest_sha256'),
  outputContentDigestSha256: text('output_content_digest_sha256'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  failureCode: text('failure_code'),
  failureMessage: text('failure_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  blueprintUnique: uniqueIndex('site_generation_page_runs_blueprint_unique').on(table.generationRunId, table.blueprintPageId),
  plannedReferenceUnique: uniqueIndex('site_generation_page_runs_planned_reference_unique').on(table.generationRunId, table.plannedPageReference),
  runStatusIdx: index('site_generation_page_runs_run_status_idx').on(table.generationRunId, table.status, table.createdAt),
}));

export const siteGenerationSectionRuns = pgTable('site_generation_section_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  generationRunId: uuid('generation_run_id').notNull().references(() => siteGenerationRuns.id, { onDelete: 'restrict' }),
  pageRunId: uuid('page_run_id').notNull().references(() => siteGenerationPageRuns.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  siteSectionId: uuid('site_section_id').references(() => siteSections.id, { onDelete: 'restrict' }),
  previousSiteSectionId: uuid('previous_site_section_id').references(() => siteSections.id, { onDelete: 'restrict' }),
  previousContentJson: jsonb('previous_content_json'),
  previousActionsJson: jsonb('previous_actions_json'),
  sectionType: text('section_type').notNull(),
  status: text('status').default('PENDING').notNull(),
  regenerationInstructionDigestSha256: text('regeneration_instruction_digest_sha256'),
  outputContentDigestSha256: text('output_content_digest_sha256'),
  attemptCount: integer('attempt_count').default(0).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  pageStatusIdx: index('site_generation_section_runs_page_idx').on(table.pageRunId, table.status, table.createdAt),
}));

export const siteGenerationFindings = pgTable('site_generation_findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  generationRunId: uuid('generation_run_id').notNull().references(() => siteGenerationRuns.id, { onDelete: 'restrict' }),
  pageRunId: uuid('page_run_id').references(() => siteGenerationPageRuns.id, { onDelete: 'restrict' }),
  sectionRunId: uuid('section_run_id').references(() => siteGenerationSectionRuns.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  code: text('code').notNull(),
  message: text('message').notNull(),
  safeMetadataJson: jsonb('safe_metadata_json').default({}).notNull(),
  current: boolean('current').default(true).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedByAgencyUserId: uuid('resolved_by_agency_user_id').references(() => agencyUsers.id, { onDelete: 'restrict' }),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  runCurrentIdx: index('site_generation_findings_run_current_idx').on(table.generationRunId, table.current, table.severity, table.createdAt),
}));

export const siteGenerationClaims = pgTable('site_generation_claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  generationRunId: uuid('generation_run_id').notNull().references(() => siteGenerationRuns.id, { onDelete: 'restrict' }),
  pageRunId: uuid('page_run_id').references(() => siteGenerationPageRuns.id, { onDelete: 'restrict' }),
  sectionRunId: uuid('section_run_id').references(() => siteGenerationSectionRuns.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  claimType: text('claim_type').notNull(),
  claimStatus: text('claim_status').notNull(),
  claimTextDigestSha256: text('claim_text_digest_sha256').notNull(),
  factKeysJson: jsonb('fact_keys_json').default([]).notNull(),
  safeExcerpt: text('safe_excerpt'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  runStatusIdx: index('site_generation_claims_run_status_idx').on(table.generationRunId, table.claimStatus, table.createdAt),
}));

export const siteGenerationContexts = pgTable('site_generation_contexts', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicReference: uuid('public_reference').defaultRandom().notNull().unique(),
  generationRunId: uuid('generation_run_id').notNull().references(() => siteGenerationRuns.id, { onDelete: 'restrict' }),
  pageRunId: uuid('page_run_id').references(() => siteGenerationPageRuns.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  knowledgePackId: uuid('knowledge_pack_id').notNull().references(() => knowledgePacks.id, { onDelete: 'restrict' }),
  contextDigestSha256: text('context_digest_sha256').notNull(),
  promptTemplateVersion: text('prompt_template_version').notNull(),
  selectedRuleIdsJson: jsonb('selected_rule_ids_json').default([]).notNull(),
  missingBusinessDataKeysJson: jsonb('missing_business_data_keys_json').default([]).notNull(),
  safeContextSummaryJson: jsonb('safe_context_summary_json').default({}).notNull(),
  inputCharacterEstimate: integer('input_character_estimate').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  runIdx: index('site_generation_contexts_run_idx').on(table.generationRunId, table.createdAt),
}));
