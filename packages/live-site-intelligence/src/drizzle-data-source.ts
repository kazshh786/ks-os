import {
  and,
  asc,
  bookingChannelSchedules,
  eq,
  getDatabase,
  gt,
  inArray,
  locations,
  lte,
  services,
  serviceLocations,
  siteLiveAvailabilitySummaries,
  siteLiveCampaigns,
  siteLocationClosures,
  siteLocationOperatingHours,
  sites,
  staffLocations,
  staffServiceAssignments,
  tenants,
  users,
} from '@ks-os/database';
import {
  PublicLiveSiteDataSchema,
  type LiveSiteResolutionInput,
} from './contracts.js';
import {
  resolveOpeningHoursSchedule,
  resolveOpeningState,
} from './opening-hours.js';
import { isSnapshotBoundAvailability, type LiveSiteDataSource } from './resolver.js';

const PUBLIC_WEEKDAYS = [
  'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY',
  'THURSDAY', 'FRIDAY', 'SATURDAY',
] as const;

function publicMoney(amountMinor: number, currency: string) {
  return {
    amountMinor,
    currency,
    formatted: new Intl.NumberFormat('en-GB', { style: 'currency', currency })
      .format(amountMinor / 100),
  };
}

/**
 * The only database adapter exposed to public site components. Every query is
 * tenant/site scoped and bounded by public references already present in the
 * validated snapshot. PERSONAL or internal operational fields never enter the DTO.
 */
export class DrizzleLiveSiteDataSource implements LiveSiteDataSource {
  constructor(private readonly database = getDatabase()) {}

  async resolveBatch(input: LiveSiteResolutionInput) {
    const now = input.now ? new Date(input.now) : new Date();
    const [scope] = await this.database.select({
      tenantId: tenants.id,
      currency: tenants.currency,
      siteId: sites.id,
    }).from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .where(and(
        eq(sites.publicReference, input.siteReference),
        eq(tenants.businessReference, input.tenantReference),
      )).limit(1);
    if (!scope) throw new Error('LIVE_SITE_SCOPE_NOT_FOUND');

    const serviceFilter = input.serviceReferences.length
      ? and(eq(services.tenantId, scope.tenantId), inArray(services.publicReference, input.serviceReferences))
      : undefined;
    const staffFilter = input.staffReferences.length
      ? and(eq(users.tenantId, scope.tenantId), inArray(users.publicReference, input.staffReferences))
      : undefined;
    const locationFilter = input.locationReferences.length
      ? and(eq(locations.tenantId, scope.tenantId), inArray(locations.publicReference, input.locationReferences))
      : undefined;

    const [serviceRows, staffRows, locationRows, assignmentRows, serviceLocationRows,
      staffLocationRows, scheduleRows, hoursRows, closureRows, availabilityRows, campaignRows] = await Promise.all([
      serviceFilter ? this.database.select({
        id: services.id,
        reference: services.publicReference,
        duration: services.duration,
        price: services.price,
        discount: services.discount,
        active: services.isActive,
        publicPriceEnabled: services.publicPriceEnabled,
        waitlistEnabled: services.waitlistEnabled,
        temporaryUnavailableUntil: services.temporaryUnavailableUntil,
      }).from(services).where(serviceFilter) : Promise.resolve([]),
      staffFilter ? this.database.select({
        id: users.id,
        reference: users.publicReference,
        status: users.accountStatus,
        bookingEnabled: users.bookingEnabled,
      }).from(users).where(staffFilter) : Promise.resolve([]),
      locationFilter ? this.database.select({
        id: locations.id,
        reference: locations.publicReference,
        active: locations.isActive,
        timezone: locations.timezone,
      }).from(locations).where(locationFilter) : Promise.resolve([]),
      this.database.select({
        serviceId: staffServiceAssignments.serviceId,
        staffId: staffServiceAssignments.staffUserId,
        active: staffServiceAssignments.isActive,
      }).from(staffServiceAssignments).where(eq(staffServiceAssignments.tenantId, scope.tenantId)),
      this.database.select({
        serviceId: serviceLocations.serviceId,
        locationId: serviceLocations.locationId,
      }).from(serviceLocations).where(eq(serviceLocations.tenantId, scope.tenantId)),
      this.database.select({
        staffId: staffLocations.staffUserId,
        locationId: staffLocations.locationId,
      }).from(staffLocations).where(eq(staffLocations.tenantId, scope.tenantId)),
      this.database.select({
        staffId: bookingChannelSchedules.userId,
        dayOfWeek: bookingChannelSchedules.dayOfWeek,
        opensAt: bookingChannelSchedules.startTime,
        closesAt: bookingChannelSchedules.endTime,
      }).from(bookingChannelSchedules).where(and(
        eq(bookingChannelSchedules.tenantId, scope.tenantId),
        eq(bookingChannelSchedules.bookingChannel, 'in_shop'),
      )).orderBy(asc(bookingChannelSchedules.dayOfWeek), asc(bookingChannelSchedules.startTime)),
      this.database.select({
        locationId: siteLocationOperatingHours.locationId,
        dayOfWeek: siteLocationOperatingHours.dayOfWeek,
        opensAt: siteLocationOperatingHours.opensAt,
        closesAt: siteLocationOperatingHours.closesAt,
      }).from(siteLocationOperatingHours).where(eq(siteLocationOperatingHours.tenantId, scope.tenantId)),
      this.database.select({
        locationId: siteLocationClosures.locationId,
        publicLabel: siteLocationClosures.publicLabel,
      }).from(siteLocationClosures).where(and(
        eq(siteLocationClosures.tenantId, scope.tenantId),
        lte(siteLocationClosures.startsAt, now),
        gt(siteLocationClosures.endsAt, now),
      )),
      this.database.select({
        serviceReference: services.publicReference,
        staffReference: users.publicReference,
        locationReference: locations.publicReference,
        state: siteLiveAvailabilitySummaries.state,
        message: siteLiveAvailabilitySummaries.publicMessage,
        nextAvailableAt: siteLiveAvailabilitySummaries.nextAvailableAt,
        computedAt: siteLiveAvailabilitySummaries.computedAt,
        expiresAt: siteLiveAvailabilitySummaries.expiresAt,
      }).from(siteLiveAvailabilitySummaries)
        .innerJoin(services, eq(siteLiveAvailabilitySummaries.serviceId, services.id))
        .leftJoin(users, eq(siteLiveAvailabilitySummaries.staffUserId, users.id))
        .leftJoin(locations, eq(siteLiveAvailabilitySummaries.locationId, locations.id))
        .where(and(
          eq(siteLiveAvailabilitySummaries.tenantId, scope.tenantId),
          eq(siteLiveAvailabilitySummaries.siteId, scope.siteId),
          gt(siteLiveAvailabilitySummaries.expiresAt, now),
        )),
      this.database.select({
        reference: siteLiveCampaigns.publicReference,
        message: siteLiveCampaigns.message,
        placement: siteLiveCampaigns.placement,
        actionLabel: siteLiveCampaigns.actionLabel,
        serviceReference: siteLiveCampaigns.serviceReference,
        locationReference: siteLiveCampaigns.locationReference,
        staffReference: siteLiveCampaigns.staffReference,
        startsAt: siteLiveCampaigns.startsAt,
        endsAt: siteLiveCampaigns.endsAt,
      }).from(siteLiveCampaigns).where(and(
        eq(siteLiveCampaigns.tenantId, scope.tenantId),
        eq(siteLiveCampaigns.siteId, scope.siteId),
        eq(siteLiveCampaigns.status, 'APPROVED'),
        eq(siteLiveCampaigns.audience, 'PUBLIC'),
        lte(siteLiveCampaigns.startsAt, now),
        gt(siteLiveCampaigns.endsAt, now),
      )).orderBy(asc(siteLiveCampaigns.startsAt), asc(siteLiveCampaigns.publicReference)),
    ]);

    const serviceById = new Map(serviceRows.map(row => [row.id, row]));
    const staffById = new Map(staffRows.map(row => [row.id, row]));
    const locationById = new Map(locationRows.map(row => [row.id, row]));
    // Existing tenants predate explicit multi-location assignments. An empty
    // assignment table means globally eligible within the tenant; once any
    // explicit rows exist, only those canonical rows are honoured.
    const effectiveServiceLocationRows = serviceLocationRows.length ? serviceLocationRows
      : serviceRows.flatMap(service => locationRows.map(location => ({ serviceId: service.id, locationId: location.id })));
    const effectiveStaffLocationRows = staffLocationRows.length ? staffLocationRows
      : staffRows.flatMap(staff => locationRows.map(location => ({ staffId: staff.id, locationId: location.id })));
    const serviceStaff = new Map<string, Set<string>>();
    const staffServices = new Map<string, Set<string>>();
    for (const link of assignmentRows) {
      const service = serviceById.get(link.serviceId);
      const staff = staffById.get(link.staffId);
      if (!link.active || !service || !staff || staff.status !== 'ACTIVE' || !staff.bookingEnabled) continue;
      (serviceStaff.get(service.id) ?? serviceStaff.set(service.id, new Set()).get(service.id)!).add(staff.reference);
      (staffServices.get(staff.id) ?? staffServices.set(staff.id, new Set()).get(staff.id)!).add(service.reference);
    }
    const serviceLocationReferences = new Map<string, Set<string>>();
    for (const link of effectiveServiceLocationRows) {
      const service = serviceById.get(link.serviceId);
      const location = locationById.get(link.locationId);
      if (!service || !location || !location.active) continue;
      (serviceLocationReferences.get(service.id)
        ?? serviceLocationReferences.set(service.id, new Set()).get(service.id)!).add(location.reference);
    }
    const staffLocationReferences = new Map<string, Set<string>>();
    const locationStaffReferences = new Map<string, Set<string>>();
    for (const link of effectiveStaffLocationRows) {
      const staff = staffById.get(link.staffId);
      const location = locationById.get(link.locationId);
      if (!staff || !location || !location.active) continue;
      (staffLocationReferences.get(staff.id)
        ?? staffLocationReferences.set(staff.id, new Set()).get(staff.id)!).add(location.reference);
      if (staff.status === 'ACTIVE' && staff.bookingEnabled) {
        (locationStaffReferences.get(location.id)
          ?? locationStaffReferences.set(location.id, new Set()).get(location.id)!).add(staff.reference);
      }
    }
    const locationServiceReferences = new Map<string, Set<string>>();
    for (const link of effectiveServiceLocationRows) {
      const service = serviceById.get(link.serviceId);
      const location = locationById.get(link.locationId);
      if (!service || !location || !service.active) continue;
      (locationServiceReferences.get(location.id)
        ?? locationServiceReferences.set(location.id, new Set()).get(location.id)!).add(service.reference);
    }

    const serviceByReference = new Map(serviceRows.map(row => [row.reference, row]));
    const resolvedServices = input.serviceReferences.map(reference => {
      const service = serviceByReference.get(reference);
      if (!service) return {
        publicReference: reference,
        exists: false,
        active: false,
        bookingEligible: false,
        staffReferences: [],
        locationReferences: [],
        waitlistEligible: false,
      };
      const staffReferences = [...(serviceStaff.get(service.id) ?? [])];
      const locationReferences = [...(serviceLocationReferences.get(service.id) ?? [])];
      const temporarilyUnavailable = Boolean(service.temporaryUnavailableUntil
        && service.temporaryUnavailableUntil.getTime() > now.getTime());
      const bookingEligible = service.active && !temporarilyUnavailable && staffReferences.length > 0
        && (!input.locationReferences.length || locationReferences.length > 0);
      const amountMinor = Math.max(0, service.price - service.discount);
      return {
        publicReference: service.reference,
        exists: true,
        active: service.active,
        bookingEligible,
        durationMinutes: service.duration > 0 ? service.duration : undefined,
        publicPrice: service.publicPriceEnabled ? publicMoney(amountMinor, scope.currency) : undefined,
        staffReferences,
        locationReferences,
        waitlistEligible: service.active && service.waitlistEnabled && !bookingEligible,
      };
    });

    const staffByReference = new Map(staffRows.map(row => [row.reference, row]));
    const resolvedStaff = input.staffReferences.map(reference => {
      const staff = staffByReference.get(reference);
      if (!staff) return {
        publicReference: reference,
        active: false,
        bookingEligible: false,
        serviceReferences: [],
        locationReferences: [],
      };
      return {
      publicReference: staff.reference,
      active: staff.status === 'ACTIVE',
      bookingEligible: staff.status === 'ACTIVE' && staff.bookingEnabled
        && (staffServices.get(staff.id)?.size ?? 0) > 0,
      serviceReferences: [...(staffServices.get(staff.id) ?? [])],
      locationReferences: [...(staffLocationReferences.get(staff.id) ?? [])],
      };
    });

    const locationByReference = new Map(locationRows.map(row => [row.reference, row]));
    const resolvedLocations = input.locationReferences.map(reference => {
      const location = locationByReference.get(reference);
      if (!location) return {
        publicReference: reference,
        active: false,
        bookingEligible: false,
        serviceReferences: [],
        staffReferences: [],
        opening: { state: 'UNKNOWN' as const, label: 'Hours unavailable', source: 'UNAVAILABLE' as const },
        openingHours: [],
      };
      const assignedStaff = new Set(effectiveStaffLocationRows
        .filter(link => link.locationId === location.id)
        .map(link => link.staffId));
      const bookingHours = scheduleRows.filter(row => assignedStaff.has(row.staffId));
      const canonicalHours = hoursRows.filter(row => row.locationId === location.id);
      const schedule = resolveOpeningHoursSchedule(canonicalHours, bookingHours);
      const staffReferences = [...(locationStaffReferences.get(location.id) ?? [])];
      const serviceReferences = [...(locationServiceReferences.get(location.id) ?? [])];
      return {
        publicReference: location.reference,
        active: location.active,
        bookingEligible: location.active && staffReferences.length > 0 && serviceReferences.length > 0,
        serviceReferences,
        staffReferences,
        opening: resolveOpeningState({
          now,
          timezone: location.timezone,
          active: location.active,
          canonicalHours,
          bookingHours,
          closure: closureRows.find(row => row.locationId === location.id),
        }),
        openingHours: schedule.rows.map(hours => ({
          day: PUBLIC_WEEKDAYS[hours.dayOfWeek]!,
          opens: hours.opens,
          closes: hours.closes,
        })),
      };
    });

    const availability = availabilityRows
      .filter(row => isSnapshotBoundAvailability(row, input))
      .map(row => ({
        serviceReference: row.serviceReference,
        ...(row.staffReference ? { staffReference: row.staffReference } : {}),
        ...(row.locationReference ? { locationReference: row.locationReference } : {}),
        state: row.state,
        message: row.message,
        ...(row.nextAvailableAt ? { nextAvailableAt: row.nextAvailableAt.toISOString() } : {}),
        computedAt: row.computedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      }));
    const deceptiveUrgency = /\b(?:only\s+\d+|slots?\s+left|last\s+chance|hurry)\b/i;
    const campaigns = campaignRows
      .filter(row => !deceptiveUrgency.test(row.message)
        && (!row.serviceReference || input.serviceReferences.includes(row.serviceReference))
        && (!row.staffReference || input.staffReferences.includes(row.staffReference))
        && (!row.locationReference || input.locationReferences.includes(row.locationReference)))
      .map(row => ({
        publicReference: row.reference,
        active: true,
        message: row.message,
        placement: row.placement,
        action: {
          type: 'KS_OS_BOOKING' as const,
          label: row.actionLabel,
          ...(row.serviceReference ? { serviceReference: row.serviceReference } : {}),
          ...(row.locationReference ? { locationReference: row.locationReference } : {}),
          ...(row.staffReference ? { staffReference: row.staffReference } : {}),
          campaignReference: row.reference,
        },
        serviceReferences: row.serviceReference ? [row.serviceReference] : [],
        locationReferences: row.locationReference ? [row.locationReference] : [],
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
      }));

    return PublicLiveSiteDataSchema.parse({
      schemaVersion: 1,
      dataClass: 'LIVE',
      siteReference: input.siteReference,
      resolvedAt: now.toISOString(),
      services: resolvedServices,
      staff: resolvedStaff,
      locations: resolvedLocations,
      availability,
      campaigns,
      warnings: [
        ...(serviceRows.some(service => !service.publicPriceEnabled)
          ? [{ code: 'PUBLIC_PRICE_DISABLED' as const, dependency: 'SERVICE_STATE' as const }]
          : []),
        ...resolvedLocations
        .filter(location => location.opening.state === 'UNKNOWN')
        .map(() => ({ code: 'OPENING_STATE_UNKNOWN' as const, dependency: 'OPENING_STATE' as const })),
      ],
      telemetry: {
        cacheClass: 'LIVE_FAST',
        cacheHit: false,
        fallbackActivated: false,
        queryCount: 12,
        resolutionMs: 0,
      },
    });
  }
}
