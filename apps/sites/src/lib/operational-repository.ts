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
  sql,
  tenants,
  users,
} from '@ks-os/database';
import {
  calculatePublishedSnapshotDigest,
  validatePublishedSnapshot,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import {
  DrizzlePublicSiteRepository,
  PublicSnapshotIntegrityError,
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

const STAGING_SITE_STATUSES = new Set([
  'DRAFT',
  'GENERATING',
  'INTERNAL_REVIEW',
  'CLIENT_REVIEW',
  'APPROVED',
]);

function clock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function priceText(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(Math.max(0, minor) / 100);
}

type ActiveDomain = {
  hostname: string;
  domain_type: 'FALLBACK' | 'CUSTOM';
  domain_role: 'CANONICAL' | 'ALIAS' | 'FALLBACK';
  updated_at: Date | string;
};

type PreviewRow = {
  snapshot_reference: string;
  snapshot_kind: string;
  schema_version: number;
  digest: string;
  content_json: unknown;
  site_reference: string;
  version_reference: string;
  template_version_reference: string;
};

/**
 * Published snapshots remain content-integrity checked and immutable. This
 * decorator overlays only operational booking and hostname data at request
 * time. A managed fallback hostname can serve the latest governed preview as
 * a shareable staging site, but it is always noindex/nofollow. Search indexing
 * is enabled only after an active custom canonical hostname exists and the
 * exact site version has been published after that hostname was promoted.
 */
export class OperationalPublicSiteRepository implements PublicSiteRepository {
  private readonly stagingSiteReferences = new Set<string>();

  constructor(
    private readonly base: PublicSiteRepository = new DrizzlePublicSiteRepository(),
    private readonly database = getDatabase(),
  ) {}

  async resolveHostname(hostname: string, fallbackDomain: string): Promise<ResolvedPublicSite | null> {
    const resolved = await this.base.resolveHostname(hostname, fallbackDomain);
    if (!resolved) return null;
    if (resolved.matchKind === 'FALLBACK' && STAGING_SITE_STATUSES.has(resolved.siteStatus)) {
      this.stagingSiteReferences.add(resolved.siteReference);
      return { ...resolved, siteStatus: 'LIVE' };
    }
    return resolved;
  }

  async loadPublishedSnapshot(siteReference: string) {
    const published = await this.base.loadPublishedSnapshot(siteReference);
    if (published) return this.hydrate(await this.applyDomains(published, false));
    if (!this.stagingSiteReferences.has(siteReference)) return null;
    const preview = await this.latestPreview(siteReference);
    if (!preview) return null;
    const staging = validatePublishedSnapshot({
      ...preview,
      visibility: 'PUBLISHED',
      siteStatus: 'LIVE',
      versionStatus: 'PUBLISHED',
      publishedAt: new Date().toISOString(),
      pages: preview.pages.map(page => ({
        ...page,
        indexable: false,
        seo: { ...page.seo, index: false, follow: false },
      })),
    });
    return this.hydrate(await this.applyDomains(staging, true));
  }

  async loadPreviewSnapshot(siteReference: string, versionReference: string) {
    const snapshot = await this.base.loadPreviewSnapshot(siteReference, versionReference);
    return snapshot ? this.hydrate(await this.applyDomains(snapshot, true)) : null;
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

  private supportsRawQueries() {
    return typeof (this.database as unknown as { execute?: unknown }).execute === 'function';
  }

  private async latestPreview(siteReference: string): Promise<PublishedSiteSnapshot | null> {
    if (!this.supportsRawQueries()) return null;
    const result = await this.database.execute(sql<PreviewRow>`
      select
        snapshot.public_reference as snapshot_reference,
        snapshot.snapshot_kind,
        snapshot.schema_version,
        snapshot.content_digest_sha256 as digest,
        snapshot.content_json,
        site.public_reference as site_reference,
        version.public_reference as version_reference,
        template.public_reference as template_version_reference
      from site_render_snapshots snapshot
      join sites site on site.id = snapshot.site_id
      join site_versions version on version.id = snapshot.site_version_id
      join template_versions template on template.id = snapshot.template_version_id
      where site.public_reference = ${siteReference}::uuid
        and snapshot.snapshot_kind = 'PREVIEW'
        and template.status = 'APPROVED'
      order by version.version_number desc, snapshot.revision desc
      limit 1
    `);
    const rows = (Array.isArray(result) ? result : result.rows) as PreviewRow[];
    const row = rows[0];
    if (!row) return null;
    try {
      const snapshot = validatePublishedSnapshot(row.content_json);
      if (
        snapshot.publicReference !== row.snapshot_reference
        || snapshot.siteReference !== row.site_reference
        || snapshot.versionReference !== row.version_reference
        || snapshot.templateVersionReference !== row.template_version_reference
        || snapshot.schemaVersion !== row.schema_version
        || snapshot.visibility !== row.snapshot_kind
        || calculatePublishedSnapshotDigest(snapshot) !== row.digest
      ) {
        throw new PublicSnapshotIntegrityError();
      }
      return snapshot;
    } catch (error) {
      if (error instanceof PublicSnapshotIntegrityError) throw error;
      throw new PublicSnapshotIntegrityError();
    }
  }

  private async activeDomains(siteReference: string): Promise<ActiveDomain[]> {
    if (!this.supportsRawQueries()) return [];
    const result = await this.database.execute(sql<ActiveDomain>`
      select domain.hostname, domain.domain_type, domain.domain_role, domain.updated_at
      from site_domains domain
      join sites site on site.id = domain.site_id
      where site.public_reference = ${siteReference}::uuid
        and domain.status = 'ACTIVE'
        and domain.ownership_status = 'VERIFIED'
        and domain.ssl_status = 'ACTIVE'
      order by
        case domain.domain_role when 'CANONICAL' then 0 when 'ALIAS' then 1 else 2 end,
        domain.created_at asc
    `);
    return (Array.isArray(result) ? result : result.rows) as ActiveDomain[];
  }

  private async applyDomains(snapshot: PublishedSiteSnapshot, preview: boolean): Promise<PublishedSiteSnapshot> {
    const domains = await this.activeDomains(snapshot.siteReference);
    if (!domains.length) return snapshot;
    const canonicalCustom = domains.find(domain =>
      domain.domain_type === 'CUSTOM' && domain.domain_role === 'CANONICAL');
    const fallback = domains.find(domain => domain.domain_type === 'FALLBACK');
    const canonicalHostname = canonicalCustom?.hostname || fallback?.hostname || snapshot.canonicalHostname;
    const domainActivatedAt = canonicalCustom ? new Date(canonicalCustom.updated_at).getTime() : Number.NaN;
    const publishedAt = snapshot.publishedAt ? Date.parse(snapshot.publishedAt) : Number.NaN;
    const indexingAllowed = Boolean(canonicalCustom)
      && !preview
      && Number.isFinite(domainActivatedAt)
      && Number.isFinite(publishedAt)
      && publishedAt >= domainActivatedAt;
    return validatePublishedSnapshot({
      ...snapshot,
      canonicalHostname,
      domains: domains.map(domain => ({
        hostname: domain.hostname,
        kind: domain.domain_type,
        status: 'ACTIVE',
        primary: domain.hostname === canonicalHostname,
      })),
      pages: snapshot.pages.map(page => ({
        ...page,
        indexable: indexingAllowed ? page.indexable : false,
        seo: {
          ...page.seo,
          index: indexingAllowed ? page.seo.index : false,
          follow: indexingAllowed ? page.seo.follow : false,
        },
      })),
    });
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

    return validatePublishedSnapshot({
      ...snapshot,
      services: snapshot.services.map(service => {
        const live = liveServices.get(service.publicReference);
        if (!live) return { ...service, bookingEnabled: false };
        return {
          ...service,
          name: live.name,
          shortDescription: live.description?.trim() || service.shortDescription,
          durationMinutes: live.duration > 0 ? live.duration : service.durationMinutes,
          priceText: priceText(Math.max(0, live.price - live.discount), tenant.currency),
          bookingEnabled: live.active && eligible.has(live.reference),
        };
      }),
      locations: snapshot.locations.map(location => ({
        ...location,
        openingHours: hoursByLocation.get(location.publicReference) ?? location.openingHours,
      })),
    });
  }
}
