import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  bookingAnalyticsEvents,
  bookingHolds,
  bookingPageForms,
  bookingPageSlugHistory,
  bookingPages,
  forms,
  getDatabase,
  locations,
  services,
  staffServiceAssignments,
  tenants,
  users,
} from '@ks-os/database';
import {
  BookingPageResponseSchema,
  BookingPageThemeSchema,
  type BookingPageResponse,
  type BookingPageUpdate,
  type CreateBookingHold,
  type PublicBookingAnalyticsEventSchema,
} from '@ks-os/contracts';
import { calculateAvailability } from '../availability/availability.service.js';
import { env } from '../../config/env.js';
import {
  bookingPublicUrl,
  deterministicPublicToken,
  hashAnalyticsSession,
  hashPublicToken,
  normaliseBookingSlug,
  RESERVED_BOOKING_SLUGS,
} from './booking-page.utils.js';

type AnalyticsEventInput = typeof PublicBookingAnalyticsEventSchema._type;
type DatabaseLike = ReturnType<typeof getDatabase> | any;

const DEFAULT_THEME = BookingPageThemeSchema.parse({});
const DEFAULT_RULES = {
  minimumNoticeMinutes: 60,
  maximumFutureDays: 90,
  slotIntervalMinutes: 30,
  allowAnyStaff: true,
  allowGuestBooking: true,
  customerNotesEnabled: true,
};
const DEFAULT_PAYMENT = { mode: 'PAY_LATER', depositPercentage: 0, promotionCodesEnabled: false, giftCardsEnabled: false };
const DEFAULT_INTAKE = { requiredBeforeConfirmation: false, allowCompleteAfterBooking: true, showEstimatedTime: true };
const DEFAULT_CANCELLATION = { customerCancellationEnabled: true, customerReschedulingEnabled: true, minimumNoticeMinutes: 1_440, policyText: '' };
const DEFAULT_SEO = { title: '', description: '', socialTitle: '', socialDescription: '', socialImageUrl: null, allowIndexing: true, canonicalUrl: null };

function publicOrigin(): string {
  return env.PUBLIC_APP_ORIGIN || env.FRONTEND_ORIGIN || 'http://localhost:3000';
}

function tokenSecret(): string {
  return env.BOOKING_RATE_LIMIT_SALT || 'local-booking-token-secret-change-before-production';
}

function mergeObject<T extends object>(value: unknown, fallback: T): T {
  return { ...fallback, ...(value && typeof value === 'object' ? value as Partial<T> : {}) };
}

export class BookingPageService {
  async ensureForTenant(tenantId: string, db: DatabaseLike = getDatabase()) {
    const [existing] = await db.select().from(bookingPages).where(eq(bookingPages.tenantId, tenantId)).limit(1);
    if (existing) return existing;
    const [tenant] = await db.select({ id: tenants.id, name: tenants.name, subdomain: tenants.subdomain })
      .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw Object.assign(new Error('Business not found.'), { code: 'TENANT_NOT_FOUND', statusCode: 404 });
    await db.execute(sql`SELECT ks_ensure_default_booking_page(${tenant.id}::uuid, ${tenant.name}::text, ${tenant.subdomain}::text)`);
    const [created] = await db.select().from(bookingPages).where(eq(bookingPages.tenantId, tenantId)).limit(1);
    if (!created) throw new Error('Booking page could not be created.');
    return created;
  }

  toResponse(page: typeof bookingPages.$inferSelect): BookingPageResponse {
    const response = {
      id: page.id,
      publicSlug: page.publicSlug,
      publicUrl: bookingPublicUrl(publicOrigin(), page.publicSlug),
      previewUrl: bookingPublicUrl(publicOrigin(), page.publicSlug, true),
      title: page.title,
      description: page.description,
      enabled: page.enabled,
      published: page.published,
      logoUrl: page.logoUrl,
      coverImageUrl: page.coverImageUrl,
      layout: page.layout,
      theme: mergeObject(page.themeJson, DEFAULT_THEME),
      defaultLanguage: page.defaultLanguage,
      supportedLanguages: page.supportedLanguages,
      defaultLocationId: page.defaultLocationId,
      allowedLocationIds: page.allowedLocationIds,
      allowedServiceIds: page.allowedServiceIds,
      allowedStaffIds: page.allowedStaffIds,
      bookingRules: mergeObject(page.bookingRules, DEFAULT_RULES),
      paymentSettings: mergeObject(page.paymentSettings, DEFAULT_PAYMENT),
      intakeFormSettings: mergeObject(page.intakeFormSettings, DEFAULT_INTAKE),
      cancellationSettings: mergeObject(page.cancellationSettings, DEFAULT_CANCELLATION),
      seoSettings: mergeObject(page.seoSettings, DEFAULT_SEO),
      analyticsSettings: mergeObject(page.analyticsSettings, { enabled: true }),
      customDomain: page.customDomain,
      customDomainStatus: page.customDomainStatus,
      publishedAt: page.publishedAt?.toISOString() || null,
      updatedAt: page.updatedAt.toISOString(),
    };
    return BookingPageResponseSchema.parse(response);
  }

  async getSettings(tenantId: string): Promise<BookingPageResponse> {
    return this.toResponse(await this.ensureForTenant(tenantId));
  }

  private async assertScopedIds(tenantId: string, update: BookingPageUpdate, db: DatabaseLike) {
    const checks: Array<Promise<void>> = [];
    if (update.allowedServiceIds?.length) checks.push((async () => {
      const rows = await db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, tenantId), inArray(services.id, update.allowedServiceIds!)));
      if (rows.length !== new Set(update.allowedServiceIds).size) throw Object.assign(new Error('One or more services do not belong to this business.'), { code: 'INVALID_SERVICE_SCOPE', statusCode: 400 });
    })());
    if (update.allowedStaffIds?.length) checks.push((async () => {
      const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), inArray(users.id, update.allowedStaffIds!)));
      if (rows.length !== new Set(update.allowedStaffIds).size) throw Object.assign(new Error('One or more team members do not belong to this business.'), { code: 'INVALID_STAFF_SCOPE', statusCode: 400 });
    })());
    if (update.allowedLocationIds?.length) checks.push((async () => {
      const rows = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), inArray(locations.id, update.allowedLocationIds!)));
      if (rows.length !== new Set(update.allowedLocationIds).size) throw Object.assign(new Error('One or more locations do not belong to this business.'), { code: 'INVALID_LOCATION_SCOPE', statusCode: 400 });
    })());
    await Promise.all(checks);
  }

  async updateSettings(tenantId: string, actingUserId: string, update: BookingPageUpdate): Promise<BookingPageResponse> {
    const db = getDatabase();
    return db.transaction(async tx => {
      const page = await this.ensureForTenant(tenantId, tx);
      await this.assertScopedIds(tenantId, update, tx);
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (update.publicSlug && update.publicSlug !== page.publicSlug) {
        const slug = normaliseBookingSlug(update.publicSlug);
        if (RESERVED_BOOKING_SLUGS.has(slug) || slug !== update.publicSlug) {
          throw Object.assign(new Error('That booking-page address is reserved or invalid.'), { code: 'SLUG_RESERVED', statusCode: 409 });
        }
        const [collision] = await tx.select({ id: bookingPages.id }).from(bookingPages)
          .where(and(eq(bookingPages.publicSlug, slug), sql`${bookingPages.id} <> ${page.id}::uuid`)).limit(1);
        if (collision) throw Object.assign(new Error('That booking-page address is already in use.'), { code: 'SLUG_CONFLICT', statusCode: 409 });
        await tx.insert(bookingPageSlugHistory).values({
          bookingPageId: page.id,
          tenantId,
          previousSlug: page.publicSlug,
          changedByUserId: actingUserId,
          redirectUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000),
        }).onConflictDoNothing();
        values.publicSlug = slug;
      }
      const direct: Array<[keyof BookingPageUpdate, string]> = [
        ['title', 'title'], ['description', 'description'], ['enabled', 'enabled'],
        ['logoUrl', 'logoUrl'], ['coverImageUrl', 'coverImageUrl'], ['layout', 'layout'],
        ['defaultLanguage', 'defaultLanguage'], ['supportedLanguages', 'supportedLanguages'],
        ['defaultLocationId', 'defaultLocationId'], ['allowedLocationIds', 'allowedLocationIds'],
        ['allowedServiceIds', 'allowedServiceIds'], ['allowedStaffIds', 'allowedStaffIds'],
      ];
      for (const [inputKey, columnKey] of direct) if (inputKey in update) values[columnKey] = update[inputKey];
      if (update.theme) values.themeJson = update.theme;
      if (update.bookingRules) values.bookingRules = update.bookingRules;
      if (update.paymentSettings) values.paymentSettings = update.paymentSettings;
      if (update.intakeFormSettings) values.intakeFormSettings = update.intakeFormSettings;
      if (update.cancellationSettings) values.cancellationSettings = update.cancellationSettings;
      if (update.seoSettings) values.seoSettings = update.seoSettings;
      if (update.analyticsSettings) values.analyticsSettings = update.analyticsSettings;
      const [saved] = await tx.update(bookingPages).set(values).where(and(eq(bookingPages.id, page.id), eq(bookingPages.tenantId, tenantId))).returning();
      return this.toResponse(saved);
    });
  }

  async setPublished(tenantId: string, published: boolean): Promise<BookingPageResponse> {
    const db = getDatabase();
    const page = await this.ensureForTenant(tenantId, db);
    if (published) {
      const [service] = await db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, tenantId), eq(services.isActive, true))).limit(1);
      const [staff] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.accountStatus, 'ACTIVE'), eq(users.bookingEnabled, true))).limit(1);
      if (!service || !staff) throw Object.assign(new Error('Add at least one active service and bookable team member before publishing.'), { code: 'BOOKING_PAGE_INCOMPLETE', statusCode: 409 });
    }
    const [saved] = await db.update(bookingPages).set({ published, enabled: published, publishedAt: published ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(bookingPages.id, page.id), eq(bookingPages.tenantId, tenantId))).returning();
    return this.toResponse(saved);
  }

  async configureCustomDomain(tenantId: string, domain: string | null) {
    const db = getDatabase();
    const page = await this.ensureForTenant(tenantId, db);
    if (!domain) {
      const [saved] = await db.update(bookingPages).set({
        customDomain: null,
        customDomainStatus: 'NOT_CONFIGURED',
        customDomainVerificationTokenHash: null,
        canonicalDomain: null,
        updatedAt: new Date(),
      }).where(and(eq(bookingPages.id, page.id), eq(bookingPages.tenantId, tenantId))).returning();
      return { page: this.toResponse(saved), verification: null };
    }
    const [collision] = await db.select({ id: bookingPages.id }).from(bookingPages)
      .where(and(sql`lower(${bookingPages.customDomain}) = ${domain.toLowerCase()}`, sql`${bookingPages.id} <> ${page.id}::uuid`)).limit(1);
    if (collision) throw Object.assign(new Error('That custom domain is already connected to another booking page.'), { code: 'DOMAIN_CONFLICT', statusCode: 409 });
    const verificationToken = deterministicPublicToken('booking-domain', randomUUID(), tokenSecret());
    const [saved] = await db.update(bookingPages).set({
      customDomain: domain.toLowerCase(),
      customDomainStatus: 'PENDING',
      customDomainVerificationTokenHash: hashPublicToken(verificationToken, tokenSecret()),
      canonicalDomain: null,
      updatedAt: new Date(),
    }).where(and(eq(bookingPages.id, page.id), eq(bookingPages.tenantId, tenantId))).returning();
    return {
      page: this.toResponse(saved),
      verification: {
        type: 'TXT',
        name: `_ksos-booking.${domain.toLowerCase()}`,
        value: verificationToken,
        status: 'PENDING',
        message: 'Add this DNS record, then complete verification through the deployment domain provider.',
      },
    };
  }

  async resolvePublicPage(identifier: string, host?: string) {
    const db = getDatabase();
    const safeHost = host?.split(':')[0]?.toLowerCase();
    const directConditions = [eq(bookingPages.publicSlug, identifier)];
    if (safeHost) directConditions.push(and(eq(bookingPages.customDomain, safeHost), eq(bookingPages.customDomainStatus, 'VERIFIED')) as any);
    const [direct] = await db.select({ page: bookingPages, tenant: tenants }).from(bookingPages)
      .innerJoin(tenants, eq(tenants.id, bookingPages.tenantId))
      .where(and(
        or(...directConditions),
        eq(bookingPages.enabled, true),
        eq(bookingPages.published, true),
        eq(tenants.isActive, true),
        eq(tenants.lifecycleStatus, 'ACTIVE'),
      )).limit(1);
    if (direct) return { ...direct, redirectSlug: null as string | null };
    const [historic] = await db.select({ history: bookingPageSlugHistory, page: bookingPages, tenant: tenants })
      .from(bookingPageSlugHistory)
      .innerJoin(bookingPages, eq(bookingPages.id, bookingPageSlugHistory.bookingPageId))
      .innerJoin(tenants, eq(tenants.id, bookingPages.tenantId))
      .where(and(eq(bookingPageSlugHistory.previousSlug, identifier), or(isNull(bookingPageSlugHistory.redirectUntil), gt(bookingPageSlugHistory.redirectUntil, new Date())), eq(bookingPages.enabled, true), eq(bookingPages.published, true), eq(tenants.isActive, true)))
      .limit(1);
    return historic ? { page: historic.page, tenant: historic.tenant, redirectSlug: historic.page.publicSlug } : null;
  }

  async publicCatalog(identifier: string, host?: string) {
    const resolved = await this.resolvePublicPage(identifier, host);
    if (!resolved) return null;
    const { page, tenant, redirectSlug } = resolved;
    const db = getDatabase();
    const serviceRows = await db.select({ id: services.id, name: services.name, description: services.description, duration: services.duration, price: services.price, discount: services.discount, requiresDeposit: services.requiresDeposit })
      .from(services).where(and(eq(services.tenantId, tenant.id), eq(services.isActive, true), page.allowedServiceIds.length ? inArray(services.id, page.allowedServiceIds) : undefined));
    const staffRows = await db.select({ id: users.id, name: users.name, role: users.jobTitle, imageUrl: users.profileImageUrl, bio: users.bio })
      .from(users).where(and(eq(users.tenantId, tenant.id), eq(users.accountStatus, 'ACTIVE'), eq(users.bookingEnabled, true), page.allowedStaffIds.length ? inArray(users.id, page.allowedStaffIds) : undefined));
    const assignments = staffRows.length && serviceRows.length ? await db.select({ staffId: staffServiceAssignments.staffUserId, serviceId: staffServiceAssignments.serviceId })
      .from(staffServiceAssignments).where(and(eq(staffServiceAssignments.tenantId, tenant.id), eq(staffServiceAssignments.isActive, true), inArray(staffServiceAssignments.staffUserId, staffRows.map(row => row.id)), inArray(staffServiceAssignments.serviceId, serviceRows.map(row => row.id)))) : [];
    const locationRows = await db.select({ id: locations.id, name: locations.name, address: locations.address, postcode: locations.postcode, timezone: locations.timezone, isPrimary: locations.isPrimary })
      .from(locations).where(and(eq(locations.tenantId, tenant.id), eq(locations.isActive, true), page.allowedLocationIds.length ? inArray(locations.id, page.allowedLocationIds) : undefined));
    const linkedForms = await db.select({ id: forms.id, title: forms.title, description: forms.description, formType: forms.formType, required: bookingPageForms.required, completionStage: bookingPageForms.completionStage, serviceId: bookingPageForms.serviceId, staffId: bookingPageForms.staffUserId, locationId: bookingPageForms.locationId })
      .from(bookingPageForms).innerJoin(forms, eq(forms.id, bookingPageForms.formId))
      .where(and(eq(bookingPageForms.bookingPageId, page.id), eq(forms.status, 'PUBLISHED')));
    return {
      page: this.toResponse(page),
      redirectSlug,
      tenant: { name: tenant.name, timezone: tenant.timezone, currency: tenant.currency, colors: { primary: tenant.primaryColor, secondary: tenant.secondaryColor, accent: tenant.accentColor } },
      paymentMode: tenant.defaultPaymentMode,
      bookingChannels: [{ id: 'in_shop', label: 'At the business' }, { id: 'mobile', label: 'Mobile appointment' }],
      services: serviceRows.map(row => ({ ...row, price: Math.max(0, row.price - (row.discount || 0)) })),
      staff: staffRows.map(row => ({ ...row, serviceIds: assignments.filter(item => item.staffId === row.id).map(item => item.serviceId) })),
      locations: locationRows,
      intakeForms: linkedForms,
    };
  }

  async createHold(identifier: string, input: CreateBookingHold, host?: string) {
    const resolved = await this.resolvePublicPage(identifier, host);
    if (!resolved) throw Object.assign(new Error('Booking page not found.'), { code: 'BOOKING_SITE_NOT_FOUND', statusCode: 404 });
    const { page, tenant } = resolved;
    const db = getDatabase();
    const rawToken = deterministicPublicToken(`booking-hold:${page.id}`, input.idempotencyKey, tokenSecret());
    const sessionHash = hashPublicToken(rawToken, tokenSecret());
    const holdMinutes = env.BOOKING_SLOT_HOLD_MINUTES;
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenant.id}:${input.staffId}:${input.startTime}`}::text, 0))`);
      await tx.update(bookingHolds).set({ status: 'EXPIRED', releasedAt: new Date() }).where(and(eq(bookingHolds.status, 'ACTIVE'), lt(bookingHolds.expiresAt, new Date())));
      const [existing] = await tx.select().from(bookingHolds).where(and(eq(bookingHolds.bookingPageId, page.id), eq(bookingHolds.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) return this.holdResponse(existing, rawToken);
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tenant.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(input.startTime));
      const availability = await calculateAvailability({ tenantId: tenant.id, serviceId: input.serviceId, staffId: input.staffId, date: localDate, bookingChannel: input.bookingChannel }, { locationId: input.locationId, resourceId: input.resourceId, database: tx });
      const slot = availability.slots.find(item => item.staffId === input.staffId && item.start === input.startTime);
      if (!slot) throw Object.assign(new Error('That time is no longer available.'), { code: 'SLOT_UNAVAILABLE', statusCode: 409 });
      const [conflictingHold] = await tx.select({ id: bookingHolds.id }).from(bookingHolds).where(and(
        eq(bookingHolds.tenantId, tenant.id), eq(bookingHolds.staffUserId, input.staffId), eq(bookingHolds.status, 'ACTIVE'), gt(bookingHolds.expiresAt, new Date()), lt(bookingHolds.startTime, new Date(slot.end)), gt(bookingHolds.endTime, new Date(slot.start)),
      )).limit(1);
      if (conflictingHold) throw Object.assign(new Error('That time is temporarily reserved.'), { code: 'SLOT_HELD', statusCode: 409 });
      const [hold] = await tx.insert(bookingHolds).values({
        tenantId: tenant.id, bookingPageId: page.id, serviceId: input.serviceId, staffUserId: input.staffId,
        locationId: input.locationId || null, resourceId: input.resourceId || null, customerSessionHash: sessionHash,
        startTime: new Date(slot.start), endTime: new Date(slot.end), idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(Date.now() + holdMinutes * 60_000),
      }).returning();
      return this.holdResponse(hold, rawToken);
    });
  }

  private holdResponse(hold: typeof bookingHolds.$inferSelect, token: string) {
    const remainingSeconds = Math.max(1, Math.ceil((hold.expiresAt.getTime() - Date.now()) / 1_000));
    return { id: hold.id, token, startTime: hold.startTime.toISOString(), endTime: hold.endTime.toISOString(), expiresAt: hold.expiresAt.toISOString(), remainingSeconds };
  }

  async releaseHold(identifier: string, holdId: string, token: string, host?: string) {
    const resolved = await this.resolvePublicPage(identifier, host);
    if (!resolved) return false;
    const expectedHash = hashPublicToken(token, tokenSecret());
    const [released] = await getDatabase().update(bookingHolds).set({ status: 'RELEASED', releasedAt: new Date() })
      .where(and(eq(bookingHolds.id, holdId), eq(bookingHolds.bookingPageId, resolved.page.id), eq(bookingHolds.customerSessionHash, expectedHash), eq(bookingHolds.status, 'ACTIVE'))).returning({ id: bookingHolds.id });
    return Boolean(released);
  }

  async validateHoldForBooking(tx: DatabaseLike, pageId: string, input: { holdId?: string; holdToken?: string; serviceId: string; staffId: string; startTime: string; locationId?: string | null }) {
    if (!input.holdId && !input.holdToken) return null;
    if (!input.holdId || !input.holdToken) throw Object.assign(new Error('The slot reservation is incomplete.'), { code: 'INVALID_HOLD', statusCode: 400 });
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.holdId}::text, 0))`);
    const [hold] = await tx.select().from(bookingHolds).where(and(eq(bookingHolds.id, input.holdId), eq(bookingHolds.bookingPageId, pageId))).limit(1);
    if (!hold || hold.customerSessionHash !== hashPublicToken(input.holdToken, tokenSecret())) throw Object.assign(new Error('The slot reservation is invalid.'), { code: 'INVALID_HOLD', statusCode: 409 });
    if (hold.status !== 'ACTIVE' || hold.expiresAt <= new Date()) throw Object.assign(new Error('The slot reservation has expired.'), { code: 'HOLD_EXPIRED', statusCode: 409 });
    if (hold.serviceId !== input.serviceId || hold.staffUserId !== input.staffId || hold.startTime.toISOString() !== input.startTime || (hold.locationId || null) !== (input.locationId || null)) {
      throw Object.assign(new Error('The booking does not match the reserved slot.'), { code: 'HOLD_MISMATCH', statusCode: 409 });
    }
    return hold;
  }

  async consumeHold(tx: DatabaseLike, holdId: string, appointmentId: string) {
    await tx.update(bookingHolds).set({ status: 'CONSUMED', consumedAppointmentId: appointmentId, consumedAt: new Date() }).where(and(eq(bookingHolds.id, holdId), eq(bookingHolds.status, 'ACTIVE')));
  }

  async recordAnalytics(identifier: string, event: AnalyticsEventInput, host?: string, appointmentId?: string) {
    const resolved = await this.resolvePublicPage(identifier, host);
    if (!resolved || mergeObject(resolved.page.analyticsSettings, { enabled: true }).enabled === false) return false;
    await getDatabase().insert(bookingAnalyticsEvents).values({
      tenantId: resolved.tenant.id,
      bookingPageId: resolved.page.id,
      sessionHash: hashAnalyticsSession(event.sessionId, tokenSecret()),
      eventType: event.event,
      serviceId: event.serviceId,
      staffUserId: event.staffId,
      locationId: event.locationId,
      appointmentId,
      bookingSource: event.source,
      sourceMedium: event.medium,
      sourceCampaign: event.campaign,
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
    });
    return true;
  }

  async analyticsSummary(tenantId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
    const result = await getDatabase().execute(sql`
      SELECT event_type, count(*)::int AS count
      FROM booking_analytics_events
      WHERE tenant_id = ${tenantId}::uuid AND occurred_at >= ${since.toISOString()}::timestamptz
      GROUP BY event_type
    `);
    const counts = Object.fromEntries((result.rows as Array<{ event_type: string; count: number }>).map(row => [row.event_type, Number(row.count)]));
    const views = counts.PAGE_VIEW || 0;
    const completions = counts.BOOKING_COMPLETED || 0;
    return { days, counts, conversionRate: views ? Math.round((completions / views) * 10_000) / 100 : 0 };
  }
}
