import type { SiteStatus } from '@ks-os/contracts';
import {
  and,
  desc,
  eq,
  getDatabase,
  gt,
  inArray,
  isNull,
  siteDomains,
  sitePreviewTokenRevocations,
  sitePages,
  siteRenderSnapshots,
  siteReviewCycles,
  siteReviewParticipants,
  siteReviewSessions,
  sites,
  siteVersions,
  templateVersions,
  tenants,
} from '@ks-os/database';
import {
  calculatePublishedSnapshotDigest,
  validatePublishedSnapshot,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import { managedFallbackSubdomain } from './hostname.js';

export interface ResolvedPublicSite {
  siteReference: string;
  siteStatus: SiteStatus;
  matchedHostname: string;
  matchKind: 'CUSTOM' | 'FALLBACK';
  domainStatus: 'ACTIVE' | 'INACTIVE';
}

export interface PublicSiteRepository {
  resolveHostname(
    hostname: string,
    fallbackDomain: string,
  ): Promise<ResolvedPublicSite | null>;
  loadPublishedSnapshot(siteReference: string): Promise<PublishedSiteSnapshot | null>;
  loadPreviewSnapshot(
    siteReference: string,
    versionReference: string,
  ): Promise<PublishedSiteSnapshot | null>;
  isPreviewTokenRevoked(input: {
    jti: string;
    siteReference: string;
    versionReference: string;
  }): Promise<boolean>;
  isReviewPreviewSessionActive?(input: {
    jti: string;
    reviewCycleReference: string;
    siteReference: string;
    versionReference: string;
    requestedPath: string;
  }): Promise<boolean>;
}

export class PublicSnapshotIntegrityError extends Error {
  readonly code = 'PUBLIC_SNAPSHOT_INTEGRITY_FAILED';

  constructor() {
    super('The published website snapshot failed integrity validation.');
    this.name = 'PublicSnapshotIntegrityError';
  }
}

type SnapshotRow = {
  snapshotReference: string;
  snapshotKind: string;
  schemaVersion: number;
  digest: string;
  content: unknown;
  siteReference: string;
  versionReference: string;
  templateVersionReference: string;
};

function validateSnapshotRow(row: SnapshotRow): PublishedSiteSnapshot {
  try {
    const snapshot = validatePublishedSnapshot(row.content);
    if (
      snapshot.publicReference !== row.snapshotReference
      || snapshot.siteReference !== row.siteReference
      || snapshot.versionReference !== row.versionReference
      || snapshot.templateVersionReference !== row.templateVersionReference
      || snapshot.schemaVersion !== row.schemaVersion
      || snapshot.visibility !== row.snapshotKind
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

export class DrizzlePublicSiteRepository implements PublicSiteRepository {
  constructor(private readonly database = getDatabase()) {}

  async resolveHostname(hostname: string, fallbackDomain: string) {
    const [domain] = await this.database
      .select({
        siteReference: sites.publicReference,
        siteStatus: sites.status,
        domainStatus: siteDomains.status,
      })
      .from(siteDomains)
      .innerJoin(sites, eq(siteDomains.siteId, sites.id))
      .where(eq(siteDomains.hostname, hostname))
      .limit(1);

    if (domain) {
      return {
        siteReference: domain.siteReference,
        siteStatus: domain.siteStatus as SiteStatus,
        matchedHostname: hostname,
        matchKind: 'CUSTOM' as const,
        domainStatus: domain.domainStatus === 'ACTIVE' ? 'ACTIVE' as const : 'INACTIVE' as const,
      };
    }

    const subdomain = managedFallbackSubdomain(hostname, fallbackDomain);
    if (!subdomain) return null;
    const [fallback] = await this.database
      .select({
        siteReference: sites.publicReference,
        siteStatus: sites.status,
      })
      .from(tenants)
      .innerJoin(sites, eq(sites.tenantId, tenants.id))
      .where(and(
        eq(tenants.subdomain, subdomain),
        eq(tenants.isActive, true),
      ))
      .limit(1);
    if (!fallback) return null;
    return {
      siteReference: fallback.siteReference,
      siteStatus: fallback.siteStatus as SiteStatus,
      matchedHostname: hostname,
      matchKind: 'FALLBACK' as const,
      domainStatus: 'ACTIVE' as const,
    };
  }

  async loadPublishedSnapshot(siteReference: string) {
    const [row] = await this.database
      .select({
        snapshotReference: siteRenderSnapshots.publicReference,
        snapshotKind: siteRenderSnapshots.snapshotKind,
        schemaVersion: siteRenderSnapshots.schemaVersion,
        digest: siteRenderSnapshots.contentDigestSha256,
        content: siteRenderSnapshots.contentJson,
        siteReference: sites.publicReference,
        versionReference: siteVersions.publicReference,
        templateVersionReference: templateVersions.publicReference,
      })
      .from(siteRenderSnapshots)
      .innerJoin(sites, eq(siteRenderSnapshots.siteId, sites.id))
      .innerJoin(siteVersions, eq(siteRenderSnapshots.siteVersionId, siteVersions.id))
      .innerJoin(templateVersions, eq(siteRenderSnapshots.templateVersionId, templateVersions.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteRenderSnapshots.siteVersionId, sites.publishedVersionId),
        eq(siteRenderSnapshots.snapshotKind, 'PUBLISHED'),
        eq(siteVersions.status, 'PUBLISHED'),
        eq(templateVersions.status, 'APPROVED'),
      ))
      .orderBy(desc(siteRenderSnapshots.revision))
      .limit(1);
    return row ? validateSnapshotRow(row) : null;
  }

  async loadPreviewSnapshot(siteReference: string, versionReference: string) {
    const [row] = await this.database
      .select({
        snapshotReference: siteRenderSnapshots.publicReference,
        snapshotKind: siteRenderSnapshots.snapshotKind,
        schemaVersion: siteRenderSnapshots.schemaVersion,
        digest: siteRenderSnapshots.contentDigestSha256,
        content: siteRenderSnapshots.contentJson,
        siteReference: sites.publicReference,
        versionReference: siteVersions.publicReference,
        templateVersionReference: templateVersions.publicReference,
      })
      .from(siteRenderSnapshots)
      .innerJoin(sites, eq(siteRenderSnapshots.siteId, sites.id))
      .innerJoin(siteVersions, eq(siteRenderSnapshots.siteVersionId, siteVersions.id))
      .innerJoin(templateVersions, eq(siteRenderSnapshots.templateVersionId, templateVersions.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteVersions.publicReference, versionReference),
        inArray(siteRenderSnapshots.snapshotKind, ['PREVIEW', 'PUBLISHED']),
        eq(templateVersions.status, 'APPROVED'),
      ))
      .orderBy(desc(siteRenderSnapshots.snapshotKind), desc(siteRenderSnapshots.revision))
      .limit(1);
    return row ? validateSnapshotRow(row) : null;
  }

  async isPreviewTokenRevoked(input: {
    jti: string;
    siteReference: string;
    versionReference: string;
  }) {
    const [revocation] = await this.database
      .select({ id: sitePreviewTokenRevocations.id })
      .from(sitePreviewTokenRevocations)
      .innerJoin(sites, eq(sitePreviewTokenRevocations.siteId, sites.id))
      .innerJoin(
        siteVersions,
        eq(sitePreviewTokenRevocations.siteVersionId, siteVersions.id),
      )
      .where(and(
        eq(sitePreviewTokenRevocations.tokenJti, input.jti),
        eq(sites.publicReference, input.siteReference),
        eq(siteVersions.publicReference, input.versionReference),
      ))
      .limit(1);
    return Boolean(revocation);
  }

  async isReviewPreviewSessionActive(input: {
    jti: string;
    reviewCycleReference: string;
    siteReference: string;
    versionReference: string;
    requestedPath: string;
  }) {
    const [session] = await this.database
      .select({
        id: siteReviewSessions.id,
        reviewScope: siteReviewCycles.reviewScope,
        scopedPageSlug: sitePages.slug,
      })
      .from(siteReviewSessions)
      .innerJoin(
        siteReviewCycles,
        eq(siteReviewSessions.reviewCycleId, siteReviewCycles.id),
      )
      .innerJoin(
        siteReviewParticipants,
        eq(siteReviewSessions.participantId, siteReviewParticipants.id),
      )
      .innerJoin(sites, eq(siteReviewSessions.siteId, sites.id))
      .innerJoin(
        siteVersions,
        eq(siteReviewSessions.siteVersionId, siteVersions.id),
      )
      .leftJoin(sitePages, eq(siteReviewCycles.scopedPageId, sitePages.id))
      .where(and(
        eq(siteReviewSessions.previewTokenJti, input.jti),
        eq(siteReviewCycles.publicReference, input.reviewCycleReference),
        eq(sites.publicReference, input.siteReference),
        eq(siteVersions.publicReference, input.versionReference),
        isNull(siteReviewSessions.revokedAt),
        gt(siteReviewSessions.expiresAt, new Date()),
        eq(siteReviewParticipants.status, 'ACTIVE'),
        inArray(siteReviewCycles.status, [
          'INTERNAL_REVIEW',
          'READY_FOR_CLIENT_REVIEW',
          'CLIENT_REVIEW',
          'CLIENT_CHANGES_REQUESTED',
          'CLIENT_APPROVED',
          'AGENCY_FINAL_REVIEW',
        ]),
      ))
      .limit(1);
    if (!session) return false;
    if (session.reviewScope === 'FACTS_ONLY') return false;
    if (!['PAGE', 'SECTION'].includes(session.reviewScope)) return true;
    if (!session.scopedPageSlug) return false;
    const scopedPath = session.scopedPageSlug === 'home'
      ? '/'
      : `/${session.scopedPageSlug.replace(/^\/+|\/+$/g, '')}`;
    return scopedPath === input.requestedPath;
  }
}
