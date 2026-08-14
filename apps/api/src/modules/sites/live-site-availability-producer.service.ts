import {
  and,
  asc,
  bookingPages,
  eq,
  getDatabase,
  gt,
  inArray,
  isNull,
  services,
  siteLiveAvailabilitySummaries,
  sitePublicationPointers,
  siteRenderSnapshots,
  sites,
  tenants,
} from '@ks-os/database';
import { validatePublishedSnapshot } from '@ks-os/site-schema';
import {
  calculateAvailability,
  type AvailabilityCalculationOptions,
} from '../availability/availability.service.js';
import type { AvailabilityQuery, AvailabilityResult } from '@ks-os/contracts';

type Database = ReturnType<typeof getDatabase>;
type AvailabilityCalculator = (
  input: AvailabilityQuery,
  options?: AvailabilityCalculationOptions,
) => Promise<AvailabilityResult>;

const HORIZON_DAYS = 7;
const SUMMARY_TTL_MS = 5 * 60_000;

function finiteNonnegative(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
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

function datesFrom(now: Date, timezone: string, days: number) {
  const cursor = new Date(`${localDate(now, timezone)}T12:00:00.000Z`);
  return Array.from({ length: days }, () => {
    const date = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return date;
  });
}

export function summariseAvailability(input: {
  now: Date;
  timezone: string;
  firstAvailableAt?: Date;
  horizonDays?: number;
}) {
  const expiresAt = new Date(input.now.getTime() + SUMMARY_TTL_MS);
  if (!input.firstAvailableAt) {
    return {
      state: 'UNAVAILABLE' as const,
      publicMessage: `No online appointments are available in the next ${input.horizonDays ?? HORIZON_DAYS} days`,
      nextAvailableAt: null,
      computedAt: input.now,
      expiresAt,
    };
  }
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: input.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(input.firstAvailableAt);
  return {
    state: 'NEXT_AVAILABLE' as const,
    publicMessage: `Next online appointment: ${formatted}`,
    nextAvailableAt: input.firstAvailableAt,
    computedAt: input.now,
    expiresAt,
  };
}

/**
 * Produces only short-lived, non-granular summaries for services already
 * present in the exact published snapshot. Raw slots and occupancy counts are
 * never persisted in the Live Site Intelligence DTO source.
 */
export class LiveSiteAvailabilityProducer {
  private siteCursor: string | undefined;
  private readonly serviceCursorBySite = new Map<string, string>();

  constructor(
    private readonly database: Database = getDatabase(),
    private readonly calculator: AvailabilityCalculator = calculateAvailability,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async run(siteLimit = 5, serviceLimit = 20) {
    const boundedSiteLimit = Math.max(1, Math.min(100, Math.trunc(siteLimit)));
    const boundedServiceLimit = Math.max(1, Math.min(1_000, Math.trunc(serviceLimit)));
    const loadScopes = (cursor?: string) => this.database.select({
        tenantId: tenants.id,
        timezone: tenants.timezone,
        siteId: sites.id,
        siteReference: sites.publicReference,
        snapshotContent: siteRenderSnapshots.contentJson,
        allowedServiceIds: bookingPages.allowedServiceIds,
        bookingRules: bookingPages.bookingRules,
      }).from(sitePublicationPointers)
        .innerJoin(siteRenderSnapshots, eq(sitePublicationPointers.activeSnapshotId, siteRenderSnapshots.id))
        .innerJoin(sites, eq(sitePublicationPointers.siteId, sites.id))
        .innerJoin(tenants, eq(sites.tenantId, tenants.id))
        .innerJoin(bookingPages, and(
          eq(bookingPages.tenantId, tenants.id),
          eq(bookingPages.enabled, true),
          eq(bookingPages.published, true),
        ))
        .where(and(
          eq(siteRenderSnapshots.snapshotKind, 'PUBLISHED'),
          cursor ? gt(sites.publicReference, cursor) : undefined,
        ))
        .orderBy(asc(sites.publicReference))
        .limit(boundedSiteLimit);
    let scopes = await loadScopes(this.siteCursor);
    if (!scopes.length && this.siteCursor) {
      this.siteCursor = undefined;
      scopes = await loadScopes();
    }
    this.siteCursor = scopes.length === boundedSiteLimit
      ? scopes.at(-1)?.siteReference
      : undefined;

    let producedCount = 0;
    let failedCount = 0;
    let consideredCount = 0;
    for (const [scopeIndex, scope] of scopes.entries()) {
      if (consideredCount >= boundedServiceLimit) break;
      const snapshot = validatePublishedSnapshot(scope.snapshotContent);
      const snapshotServices = snapshot.services
        .filter(service => service.bookingEnabled);
      if (!snapshotServices.length) continue;
      const previousServiceReference = this.serviceCursorBySite.get(scope.siteId);
      const previousServiceIndex = previousServiceReference
        ? snapshotServices.findIndex(service => service.publicReference === previousServiceReference)
        : -1;
      const publishedServices = previousServiceIndex >= 0
        ? [
          ...snapshotServices.slice(previousServiceIndex + 1),
          ...snapshotServices.slice(0, previousServiceIndex + 1),
        ]
        : snapshotServices;
      const remainingSites = scopes.length - scopeIndex;
      const scopeAttemptLimit = Math.max(
        1,
        Math.ceil((boundedServiceLimit - consideredCount) / remainingSites),
      );
      let scopeAttemptCount = 0;
      const serviceRows = await this.database.select({
        id: services.id,
        publicReference: services.publicReference,
        active: services.isActive,
        temporaryUnavailableUntil: services.temporaryUnavailableUntil,
      }).from(services).where(and(
        eq(services.tenantId, scope.tenantId),
        inArray(services.publicReference, publishedServices.map(service => service.publicReference)),
      ));
      const byReference = new Map(serviceRows.map(service => [service.publicReference, service]));
      const currentSummaries = serviceRows.length
        ? await this.database.select({
          serviceId: siteLiveAvailabilitySummaries.serviceId,
          expiresAt: siteLiveAvailabilitySummaries.expiresAt,
        }).from(siteLiveAvailabilitySummaries).where(and(
          eq(siteLiveAvailabilitySummaries.tenantId, scope.tenantId),
          eq(siteLiveAvailabilitySummaries.siteId, scope.siteId),
          inArray(siteLiveAvailabilitySummaries.serviceId, serviceRows.map(service => service.id)),
          isNull(siteLiveAvailabilitySummaries.staffUserId),
          isNull(siteLiveAvailabilitySummaries.locationId),
        ))
        : [];
      const currentSummaryByService = new Map(currentSummaries.map(summary =>
        [summary.serviceId, summary]));
      const allowed = new Set(scope.allowedServiceIds ?? []);
      const rules = (scope.bookingRules ?? {}) as {
        minimumNoticeMinutes?: unknown;
        maximumFutureDays?: unknown;
      };
      const now = this.clock();
      const earliest = now.getTime()
        + finiteNonnegative(rules.minimumNoticeMinutes, 0) * 60_000;
      const maximumFutureDays = Math.max(1, finiteNonnegative(rules.maximumFutureDays, 90));
      const horizonDays = Math.min(HORIZON_DAYS, Math.ceil(maximumFutureDays));
      const latest = now.getTime() + maximumFutureDays * 86_400_000;
      const dates = datesFrom(now, scope.timezone, horizonDays);

      for (const publishedService of publishedServices) {
        const service = byReference.get(publishedService.publicReference);
        if (!service || !service.active || (allowed.size > 0 && !allowed.has(service.id))) continue;
        const currentSummary = currentSummaryByService.get(service.id);
        if (currentSummary && currentSummary.expiresAt.getTime() > now.getTime() + 60_000) continue;
        consideredCount += 1;
        scopeAttemptCount += 1;
        this.serviceCursorBySite.set(scope.siteId, service.publicReference);
        try {
          let firstAvailableAt: Date | undefined;
          const temporarilyUnavailable = service.temporaryUnavailableUntil
            && service.temporaryUnavailableUntil.getTime() > now.getTime();
          if (!temporarilyUnavailable) {
            for (const date of dates) {
              const availability = await this.calculator({
                tenantId: scope.tenantId,
                serviceId: service.id,
                staffId: 'any',
                bookingChannel: 'in_shop',
                date,
              }, { database: this.database });
              const slot = availability.slots.find(candidate => {
                const start = Date.parse(candidate.start);
                return start >= earliest && start <= latest;
              });
              if (slot) {
                firstAvailableAt = new Date(slot.start);
                break;
              }
            }
          }
          const summary = temporarilyUnavailable
            ? {
              state: 'UNAVAILABLE' as const,
              publicMessage: 'Online booking is temporarily unavailable',
              nextAvailableAt: null,
              computedAt: now,
              expiresAt: new Date(now.getTime() + SUMMARY_TTL_MS),
            }
            : summariseAvailability({
              now,
              timezone: scope.timezone,
              firstAvailableAt,
              horizonDays,
            });
          await this.database.insert(siteLiveAvailabilitySummaries).values({
            tenantId: scope.tenantId,
            siteId: scope.siteId,
            serviceId: service.id,
            staffUserId: null,
            locationId: null,
            ...summary,
          }).onConflictDoUpdate({
            target: [
              siteLiveAvailabilitySummaries.siteId,
              siteLiveAvailabilitySummaries.serviceId,
              siteLiveAvailabilitySummaries.staffUserId,
              siteLiveAvailabilitySummaries.locationId,
            ],
            set: { ...summary, updatedAt: now },
          });
          producedCount += 1;
        } catch {
          // Preserve the prior bounded row until its normal expiry. A failed
          // producer cycle must never manufacture an unavailable result.
          failedCount += 1;
        }
        if (consideredCount >= boundedServiceLimit || scopeAttemptCount >= scopeAttemptLimit) break;
      }
    }
    return {
      sitesScanned: scopes.length,
      servicesConsidered: consideredCount,
      producedCount,
      failedCount,
    };
  }
}
