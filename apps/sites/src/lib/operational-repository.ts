import {
  getDatabase,
  sql,
} from '@ks-os/database';
import {
  LiveSiteDataResolver,
} from '@ks-os/live-site-intelligence';
import { DrizzleLiveSiteDataSource } from '@ks-os/live-site-intelligence/database';
import {
  validatePublishedSnapshot,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import {
  DrizzlePublicSiteRepository,
  type PublicSiteRepository,
  type ResolvedPublicSite,
} from './repository.js';

type ActiveDomain = {
  hostname: string;
  domain_type: 'FALLBACK' | 'CUSTOM';
  domain_role: 'CANONICAL' | 'ALIAS' | 'FALLBACK';
  updated_at: Date | string;
};

/**
 * Published snapshots remain content-integrity checked and immutable. This
 * decorator resolves hostname/indexation governance and exposes LIVE data as
 * a separate public DTO. Search indexing is enabled only after an active custom canonical
 * hostname exists and the exact site version has been published after that
 * hostname was promoted. Preview content is never promoted or served here;
 * only the publication pointer can select a public snapshot.
 */
export class OperationalPublicSiteRepository implements PublicSiteRepository {
  private readonly liveResolver: LiveSiteDataResolver;

  constructor(
    private readonly base: PublicSiteRepository = new DrizzlePublicSiteRepository(),
    private readonly database = getDatabase(),
  ) {
    this.liveResolver = new LiveSiteDataResolver(new DrizzleLiveSiteDataSource(database));
  }

  async resolveHostname(hostname: string, fallbackDomain: string): Promise<ResolvedPublicSite | null> {
    return this.base.resolveHostname(hostname, fallbackDomain);
  }

  async loadPublishedSnapshot(siteReference: string) {
    const published = await this.base.loadPublishedSnapshot(siteReference);
    return published ? this.applyDomains(published, false) : null;
  }

  async loadPreviewSnapshot(siteReference: string, versionReference: string) {
    const snapshot = await this.base.loadPreviewSnapshot(siteReference, versionReference);
    return snapshot ? this.applyDomains(snapshot, true) : null;
  }

  resolveLiveSiteData(snapshot: PublishedSiteSnapshot) {
    return this.liveResolver.resolve({
      siteReference: snapshot.siteReference,
      tenantReference: snapshot.booking.tenantReference,
      serviceReferences: snapshot.services.map(service => service.publicReference),
      staffReferences: snapshot.staff.map(staff => staff.publicReference),
      locationReferences: snapshot.locations.map(location => location.publicReference),
    });
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

  resolvePathRedirect(input: { siteReference: string; sourcePath: string }) {
    return this.base.resolvePathRedirect
      ? this.base.resolvePathRedirect(input)
      : Promise.resolve(null);
  }

  private supportsRawQueries() {
    return typeof (this.database as unknown as { execute?: unknown }).execute === 'function';
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

}
