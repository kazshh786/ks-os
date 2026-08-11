import {
  and,
  eq,
  getDatabase,
  inArray,
  isNull,
  locations,
  serviceLocations,
  services,
  sitePublicationPointers,
  siteRenderSnapshots,
  siteWaitlistEntries,
  sites,
  staffServiceAssignments,
  users,
} from '@ks-os/database';
import {
  CreatePublicWaitlistRequestSchema,
  PublicWaitlistContextSchema,
  PublicWaitlistEligibilityResponseSchema,
  PublicWaitlistResponseSchema,
  type CreatePublicWaitlistRequest,
  type PublicWaitlistContext,
  type PublicWaitlistEligibilityResponse,
  type PublicWaitlistResponse,
} from '@ks-os/contracts';
import { DrizzleLiveSiteDataSource } from '@ks-os/live-site-intelligence/database';
import { validatePublishedSnapshot } from '@ks-os/site-schema';
import { BookingPageService } from '../bookings/booking-page.service.js';

type Database = ReturnType<typeof getDatabase>;

const confirmationMessage = "You're on the waitlist. We'll contact you if a suitable appointment becomes available." as const;
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export interface ResolvedPublicWaitlistContext {
  tenantId: string;
  tenantTimezone: string;
  siteId: string;
  serviceId: string;
  serviceActive: boolean;
  waitlistEnabled: boolean;
  waitlistEligible: boolean;
  bookingEligible: boolean;
  locationId?: string;
  staffUserId?: string;
}

export interface PublicWaitlistStore {
  resolveContext(input: {
    identifier: string;
    host?: string;
    request: PublicWaitlistContext;
    now: Date;
  }): Promise<ResolvedPublicWaitlistContext | null>;
  persist(
    context: ResolvedPublicWaitlistContext,
    request: CreatePublicWaitlistRequest,
  ): Promise<{ requestReference: string; duplicate: boolean }>;
}

function localDate(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(candidate => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function validPreferredDate(value: string | undefined, now: Date, timezone: string) {
  if (!value) return true;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const today = new Date(`${localDate(now, timezone)}T12:00:00.000Z`);
  const maximum = new Date(today);
  maximum.setUTCDate(maximum.getUTCDate() + 730);
  return parsed >= today && parsed <= maximum;
}

export class DrizzlePublicWaitlistStore implements PublicWaitlistStore {
  private readonly bookingPages = new BookingPageService();
  private readonly liveDataSource: DrizzleLiveSiteDataSource;

  constructor(private readonly database: Database = getDatabase()) {
    this.liveDataSource = new DrizzleLiveSiteDataSource(database);
  }

  async resolveContext(input: {
    identifier: string;
    host?: string;
    request: PublicWaitlistContext;
    now: Date;
  }): Promise<ResolvedPublicWaitlistContext | null> {
    const resolved = await this.bookingPages.resolvePublicPage(input.identifier, input.host);
    if (!resolved) return null;
    const { page, tenant } = resolved;
    const [site, service] = await Promise.all([
      this.database.select({
        id: sites.id,
        publicReference: sites.publicReference,
        snapshotContent: siteRenderSnapshots.contentJson,
      }).from(sites)
        .innerJoin(sitePublicationPointers, and(
          eq(sitePublicationPointers.siteId, sites.id),
          eq(sitePublicationPointers.tenantId, sites.tenantId),
        ))
        .innerJoin(siteRenderSnapshots, and(
          eq(siteRenderSnapshots.id, sitePublicationPointers.activeSnapshotId),
          eq(siteRenderSnapshots.siteId, sites.id),
          eq(siteRenderSnapshots.tenantId, sites.tenantId),
        )).where(and(
        eq(sites.tenantId, tenant.id),
        eq(sites.status, 'LIVE'),
      )).limit(1).then(rows => rows[0]),
      this.database.select({
        id: services.id,
        active: services.isActive,
        waitlistEnabled: services.waitlistEnabled,
      }).from(services).where(and(
        eq(services.tenantId, tenant.id),
        eq(services.publicReference, input.request.serviceReference),
      )).limit(1).then(rows => rows[0]),
    ]);
    if (!site || !service) return null;
    const snapshot = validatePublishedSnapshot(site.snapshotContent);
    if (snapshot.siteReference !== site.publicReference
      || snapshot.booking.tenantReference !== tenant.businessReference
      || !snapshot.services.some(candidate => candidate.publicReference === input.request.serviceReference)
      || (input.request.locationReference
        && !snapshot.locations.some(candidate => candidate.publicReference === input.request.locationReference))
      || (input.request.staffReference
        && !snapshot.staff.some(candidate => candidate.publicReference === input.request.staffReference))) {
      return null;
    }
    if (page.allowedServiceIds.length && !page.allowedServiceIds.includes(service.id)) return null;

    let staffUserId: string | undefined;
    if (input.request.staffReference) {
      const [staff] = await this.database.select({ id: users.id }).from(users).where(and(
        eq(users.tenantId, tenant.id),
        eq(users.publicReference, input.request.staffReference),
        eq(users.accountStatus, 'ACTIVE'),
        eq(users.bookingEnabled, true),
        page.allowedStaffIds.length ? inArray(users.id, page.allowedStaffIds) : undefined,
      )).limit(1);
      if (!staff) return null;
      const [assignment] = await this.database.select({ id: staffServiceAssignments.id })
        .from(staffServiceAssignments).where(and(
          eq(staffServiceAssignments.tenantId, tenant.id),
          eq(staffServiceAssignments.staffUserId, staff.id),
          eq(staffServiceAssignments.serviceId, service.id),
          eq(staffServiceAssignments.isActive, true),
        )).limit(1);
      if (!assignment) return null;
      staffUserId = staff.id;
    }

    let locationId: string | undefined;
    if (input.request.locationReference) {
      const [location] = await this.database.select({ id: locations.id }).from(locations).where(and(
        eq(locations.tenantId, tenant.id),
        eq(locations.publicReference, input.request.locationReference),
        eq(locations.isActive, true),
        page.allowedLocationIds.length ? inArray(locations.id, page.allowedLocationIds) : undefined,
      )).limit(1);
      if (!location) return null;
      const [anyExplicitServiceLocation] = await this.database
        .select({ serviceId: serviceLocations.serviceId }).from(serviceLocations)
        .where(and(
          eq(serviceLocations.tenantId, tenant.id),
          eq(serviceLocations.serviceId, service.id),
        )).limit(1);
      if (anyExplicitServiceLocation) {
        const [link] = await this.database.select({ serviceId: serviceLocations.serviceId })
          .from(serviceLocations).where(and(
            eq(serviceLocations.tenantId, tenant.id),
            eq(serviceLocations.serviceId, service.id),
            eq(serviceLocations.locationId, location.id),
          )).limit(1);
        if (!link) return null;
      }
      locationId = location.id;
    }

    const live = await this.liveDataSource.resolveBatch({
      siteReference: site.publicReference,
      tenantReference: tenant.businessReference,
      serviceReferences: snapshot.services.map(candidate => candidate.publicReference),
      staffReferences: snapshot.staff.map(candidate => candidate.publicReference),
      locationReferences: snapshot.locations.map(candidate => candidate.publicReference),
      now: input.now.toISOString(),
    });
    const liveService = live.services.find(candidate =>
      candidate.publicReference === input.request.serviceReference);
    if (!liveService) return null;
    return {
      tenantId: tenant.id,
      tenantTimezone: tenant.timezone,
      siteId: site.id,
      serviceId: service.id,
      serviceActive: service.active && liveService.active,
      waitlistEnabled: service.waitlistEnabled,
      waitlistEligible: liveService.waitlistEligible,
      bookingEligible: liveService.bookingEligible,
      ...(locationId ? { locationId } : {}),
      ...(staffUserId ? { staffUserId } : {}),
    };
  }

  async persist(
    context: ResolvedPublicWaitlistContext,
    request: CreatePublicWaitlistRequest,
  ) {
    const clientName = request.customer.name.trim();
    const clientEmail = request.customer.email.trim().toLowerCase();
    const clientPhone = request.customer.phone?.trim() || null;
    return this.database.transaction(async tx => {
      const [inserted] = await tx.insert(siteWaitlistEntries).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        serviceId: context.serviceId,
        locationId: context.locationId ?? null,
        staffUserId: context.staffUserId ?? null,
        campaignReference: request.campaignReference ?? null,
        clientName,
        clientEmail,
        clientPhone,
        preferredDate: request.preferredDate ?? null,
        status: 'PENDING',
        idempotencyKey: request.idempotencyKey,
      }).onConflictDoNothing().returning({
        requestReference: siteWaitlistEntries.publicReference,
      });
      if (inserted) return { requestReference: inserted.requestReference, duplicate: false };

      const selection = {
        requestReference: siteWaitlistEntries.publicReference,
        siteId: siteWaitlistEntries.siteId,
        serviceId: siteWaitlistEntries.serviceId,
        locationId: siteWaitlistEntries.locationId,
        staffUserId: siteWaitlistEntries.staffUserId,
        campaignReference: siteWaitlistEntries.campaignReference,
        clientName: siteWaitlistEntries.clientName,
        clientEmail: siteWaitlistEntries.clientEmail,
        clientPhone: siteWaitlistEntries.clientPhone,
        preferredDate: siteWaitlistEntries.preferredDate,
      };
      const [sameKey] = await tx.select(selection).from(siteWaitlistEntries).where(and(
        eq(siteWaitlistEntries.tenantId, context.tenantId),
        eq(siteWaitlistEntries.idempotencyKey, request.idempotencyKey),
      )).limit(1);
      if (sameKey) {
        const sameRequest = sameKey.siteId === context.siteId
          && sameKey.serviceId === context.serviceId
          && sameKey.locationId === (context.locationId ?? null)
          && sameKey.staffUserId === (context.staffUserId ?? null)
          && sameKey.campaignReference === (request.campaignReference ?? null)
          && sameKey.clientName === clientName
          && sameKey.clientEmail === clientEmail
          && sameKey.clientPhone === clientPhone
          && sameKey.preferredDate === (request.preferredDate ?? null);
        if (!sameRequest) {
          throw fail(409, 'WAITLIST_IDEMPOTENCY_CONFLICT', 'This waitlist request changed while it was being submitted.');
        }
        return { requestReference: sameKey.requestReference, duplicate: true };
      }

      const [duplicate] = await tx.select(selection).from(siteWaitlistEntries).where(and(
        eq(siteWaitlistEntries.tenantId, context.tenantId),
        eq(siteWaitlistEntries.siteId, context.siteId),
        eq(siteWaitlistEntries.serviceId, context.serviceId),
        eq(siteWaitlistEntries.clientEmail, clientEmail),
        context.locationId ? eq(siteWaitlistEntries.locationId, context.locationId) : isNull(siteWaitlistEntries.locationId),
        context.staffUserId ? eq(siteWaitlistEntries.staffUserId, context.staffUserId) : isNull(siteWaitlistEntries.staffUserId),
        request.preferredDate ? eq(siteWaitlistEntries.preferredDate, request.preferredDate) : isNull(siteWaitlistEntries.preferredDate),
        eq(siteWaitlistEntries.status, 'PENDING'),
      )).limit(1);
      if (duplicate) return { requestReference: duplicate.requestReference, duplicate: true };
      throw fail(409, 'WAITLIST_REQUEST_CONFLICT', 'This waitlist request could not be safely reconciled.');
    });
  }
}

export class PublicWaitlistService {
  constructor(
    private readonly store: PublicWaitlistStore = new DrizzlePublicWaitlistStore(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async eligibility(
    identifier: string,
    input: unknown,
    host?: string,
  ): Promise<PublicWaitlistEligibilityResponse> {
    const request = PublicWaitlistContextSchema.parse(input);
    const context = await this.store.resolveContext({
      identifier,
      host,
      request,
      now: this.clock(),
    });
    return PublicWaitlistEligibilityResponseSchema.parse({
      waitlistEligible: Boolean(context
        && context.serviceActive
        && context.waitlistEnabled
        && context.waitlistEligible
        && !context.bookingEligible),
    });
  }

  async join(identifier: string, input: unknown, host?: string): Promise<PublicWaitlistResponse> {
    const request = CreatePublicWaitlistRequestSchema.parse(input);
    const now = this.clock();
    const context = await this.store.resolveContext({ identifier, host, request, now });
    if (!context) {
      throw fail(404, 'WAITLIST_CONTEXT_NOT_FOUND', 'This waitlist option is not available.');
    }
    if (!context.serviceActive || !context.waitlistEnabled) {
      throw fail(409, 'WAITLIST_NOT_ENABLED', 'This service is not accepting waitlist requests.');
    }
    if (context.bookingEligible || !context.waitlistEligible) {
      throw fail(409, 'WAITLIST_NOT_ELIGIBLE', 'This service is currently available to book.');
    }
    if (!validPreferredDate(request.preferredDate, now, context.tenantTimezone)) {
      throw fail(400, 'WAITLIST_DATE_INVALID', 'Choose a preferred date within the next two years.');
    }
    await this.store.persist(context, request);
    return PublicWaitlistResponseSchema.parse({
      status: 'PENDING',
      message: confirmationMessage,
    });
  }
}
