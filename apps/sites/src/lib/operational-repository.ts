import {
  and,
  asc,
  bookingChannelSchedules,
  eq,
  getDatabase,
  locations,
  services,
  staffLocations,
  staffServiceAssignments,
  tenants,
  users,
} from '@ks-os/database';
import type { PublishedSiteSnapshot } from '@ks-os/site-schema';
import {
  DrizzlePublicSiteRepository,
  type PublicSiteRepository,
  type ResolvedPublicSite,
} from './repository.js';

const days = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

function clock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function priceText(minor: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(Math.max(0, minor) / 100);
}

/**
 * Published snapshots remain integrity-checked and immutable. This decorator
 * overlays only booking-owned operational data at request time so hours,
 * prices and bookability do not become stale between website publications.
 * New services are deliberately not appended: an agency operator must first
 * provision and review their dedicated website page.
 */
export class OperationalPublicSiteRepository implements PublicSiteRepository {
  constructor(
    private readonly base: PublicSiteRepository = new DrizzlePublicSiteRepository(),
    private readonly database = getDatabase(),
  ) {}

  resolveHostname(hostname: string, fallbackDomain: string): Promise<ResolvedPublicSite | null> {
    return this.base.resolveHostname(hostname, fallbackDomain);
  }

  async loadPublishedSnapshot(siteReference: string) {
    const snapshot = await this.base.loadPublishedSnapshot(siteReference);
    return snapshot ? this.hydrate(snapshot) : null;
  }

  async loadPreviewSnapshot(siteReference: string, versionReference: string) {
    const snapshot = await this.base.loadPreviewSnapshot(siteReference, versionReference);
    return snapshot ? this.hydrate(snapshot) : null;
  }

  isPreviewTokenRevoked(input: {
    jti: string;
    siteReference: string;
    versionReference: string;
  }) {
    return this.base.isPreviewTokenRevoked(input);
  }

  isReviewPreviewSessionActive(input: {
    jti: string;
    reviewCycleReference: string;
    siteReference: string;
    versionReference: string;
    requestedPath: string;
  }) {
    return this.base.isReviewPreviewSessionActive
      ? this.base.isReviewPreviewSessionActive(input)
      : Promise.resolve(false);
  }

  isQualityAuditSessionActive(input: {
    jti: string;
    qualityRunReference: string;
    siteReference: string;
    versionReference: string;
    requestedPath: string;
  }) {
    return this.base.isQualityAuditSessionActive
      ? this.base.isQualityAuditSessionActive(input)
      : Promise.resolve(false);
  }

  private async hydrate(snapshot: PublishedSiteSnapshot): Promise<PublishedSiteSnapshot> {
    const [tenant] = await this.database.select({
      id: tenants.id,
      currency: tenants.currency,
    }).from(tenants)
      .where(eq(tenants.businessReference, snapshot.booking.tenantReference))
      .limit(1);
    if (!tenant) return snapshot;

    const [serviceRows, eligibleRows, locationRows, scheduleRows, locationLinks] = await Promise.all([
      this.database.select({
        reference: services.publicReference,
        name: services.name,
        description: services.description,
        duration: services.duration,
        price: services.price,
        discount: services.discount,
        active: services.isActive,
      }).from(services).where(eq(services.tenantId, tenant.id)),
      this.database.select({ serviceReference: services.publicReference })
        .from(staffServiceAssignments)
        .innerJoin(services, eq(staffServiceAssignments.serviceId, services.id))
        .innerJoin(users, eq(staffServiceAssignments.staffUserId, users.id))
        .where(and(
          eq(staffServiceAssignments.tenantId, tenant.id),
          eq(staffServiceAssignments.isActive, true),
          eq(services.isActive, true),
          eq(users.accountStatus, 'ACTIVE'),
          eq(users.bookingEnabled, true),
        )),
      this.database.select({
        id: locations.id,
        reference: locations.publicReference,
      }).from(locations).where(and(
        eq(locations.tenantId, tenant.id),
        eq(locations.isActive, true),
      )),
      this.database.select({
        staffId: bookingChannelSchedules.userId,
        dayOfWeek: bookingChannelSchedules.dayOfWeek,
        startTime: bookingChannelSchedules.startTime,
        endTime: bookingChannelSchedules.endTime,
      }).from(bookingChannelSchedules)
        .innerJoin(users, eq(bookingChannelSchedules.userId, users.id))
        .where(and(
          eq(bookingChannelSchedules.tenantId, tenant.id),
          eq(bookingChannelSchedules.bookingChannel, 'in_shop'),
          eq(users.accountStatus, 'ACTIVE'),
          eq(users.bookingEnabled, true),
        ))
        .orderBy(asc(bookingChannelSchedules.dayOfWeek), asc(bookingChannelSchedules.startTime)),
      this.database.select({
        locationId: staffLocations.locationId,
        staffId: staffLocations.staffUserId,
      }).from(staffLocations).where(eq(staffLocations.tenantId, tenant.id)),
    ]);

    const eligible = new Set(eligibleRows.map(row => row.serviceReference));
    const liveServices = new Map(serviceRows.map(row => [row.reference, row]));
    const staffByLocation = new Map<string, Set<string>>();
    for (const link of locationLinks) {
      const set = staffByLocation.get(link.locationId) ?? new Set<string>();
      set.add(link.staffId);
      staffByLocation.set(link.locationId, set);
    }

    const hoursByLocation = new Map<string, PublishedSiteSnapshot['locations'][number]['openingHours']>();
    for (const location of locationRows) {
      const assignedStaff = staffByLocation.get(location.id);
      const relevant = scheduleRows.filter(row => !assignedStaff?.size || assignedStaff.has(row.staffId));
      const openingHours = days.slice(1).concat(days[0]).map(day => {
        const dayIndex = days.indexOf(day);
        const ranges = relevant
          .filter(row => row.dayOfWeek === dayIndex)
          .map(row => ({ opens: clock(row.startTime), closes: clock(row.endTime) }))
          .filter((range): range is { opens: string; closes: string } => Boolean(range.opens && range.closes));
        return {
          day,
          opens: ranges.length ? ranges.map(range => range.opens).sort()[0]! : null,
          closes: ranges.length ? ranges.map(range => range.closes).sort().at(-1)! : null,
        };
      });
      hoursByLocation.set(location.reference, openingHours);
    }

    return {
      ...snapshot,
      services: snapshot.services.map(service => {
        const live = liveServices.get(service.publicReference);
        if (!live) return { ...service, bookingEnabled: false };
        return {
          ...service,
          name: live.name,
          shortDescription: live.description?.trim() || service.shortDescription,
          durationMinutes: live.duration > 0 ? live.duration : service.durationMinutes,
          priceText: priceText(Math.max(0, live.price - live.discount)),
          bookingEnabled: live.active && eligible.has(live.reference),
        };
      }),
      locations: snapshot.locations.map(location => ({
        ...location,
        openingHours: hoursByLocation.get(location.publicReference) ?? location.openingHours,
      })),
    };
  }
}
