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
  siteQualityAuditSessions,
  siteQualityRuns,
  sitePages,
  sitePathRedirects,
  sitePublicationPointers,
  siteRenderSnapshots,
  siteReviewCycles,
  siteReviewParticipants,
  siteReviewSessions,
  sites,
  siteVersions,
  templateVersions,
} from '@ks-os/database';
import {
  calculatePublishedSnapshotDigest,
  validatePublishedSnapshot,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import type { PublicLiveSiteData } from '@ks-os/live-site-intelligence';

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
  resolveLiveSiteData?(snapshot: PublishedSiteSnapshot): Promise<PublicLiveSiteData>;
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
  isQualityAuditSessionActive?(input: {
    jti: string;
    qualityRunReference: string;
    siteReference: string;
    versionReference: string;
    requestedPath: string;
  }): Promise<boolean>;
  resolvePathRedirect?(input: {
    siteReference: string;
    sourcePath: string;
  }): Promise<{ targetPath: string; statusCode: 308 } | null>;
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

  async resolveHostname(hostname: string, _fallbackDomain: string) {
    const [domain] = await this.database
      .select({
        siteReference: sites.publicReference,
        siteStatus: sites.status,
        domainStatus: siteDomains.status,
        domainType: siteDomains.domainType,
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
        matchKind: domain.domainType === 'FALLBACK' ? 'FALLBACK' as const : 'CUSTOM' as const,
        domainStatus: domain.domainStatus === 'ACTIVE' ? 'ACTIVE' as const : 'INACTIVE' as const,
      };
    }

    return null;
  }

  async resolvePathRedirect(input: { siteReference: string; sourcePath: string }) {
    const [redirect] = await this.database.select({
      targetPath: sitePathRedirects.targetPath,
      statusCode: sitePathRedirects.statusCode,
    }).from(sitePathRedirects)
      .innerJoin(sites, eq(sitePathRedirects.siteId, sites.id))
      .where(and(
        eq(sites.publicReference, input.siteReference),
        eq(sitePathRedirects.sourcePath, input.sourcePath),
        eq(sitePathRedirects.active, true),
      )).limit(1);
    return redirect?.statusCode === 308
      ? { targetPath: redirect.targetPath, statusCode: 308 as const }
      : null;
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
      .innerJoin(
        sitePublicationPointers,
        eq(sitePublicationPointers.activeSnapshotId, siteRenderSnapshots.id),
      )
      .innerJoin(sites, eq(siteRenderSnapshots.siteId, sites.id))
      .innerJoin(siteVersions, eq(siteRenderSnapshots.siteVersionId, siteVersions.id))
      .innerJoin(templateVersions, eq(siteRenderSnapshots.templateVersionId, templateVersions.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(sitePublicationPointers.siteId, sites.id),
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

  async isQualityAuditSessionActive(input: {
    jti: string;
    qualityRunReference: string;
    siteReference: string;
    versionReference: string;
    requestedPath: string;
  }) {
    const [session] = await this.database
      .select({
        id: siteQualityAuditSessions.id,
      })
      .from(siteQualityAuditSessions)
      .innerJoin(
        siteQualityRuns,
        eq(siteQualityAuditSessions.qualityRunId, siteQualityRuns.id),
      )
      .innerJoin(sites, eq(siteQualityAuditSessions.siteId, sites.id))
      .innerJoin(
        siteVersions,
        eq(siteQualityAuditSessions.siteVersionId, siteVersions.id),
      )
      .innerJoin(sitePages, and(
        eq(sitePages.siteId, sites.id),
        eq(sitePages.versionId, siteVersions.id),
      ))
      .where(and(
        eq(siteQualityAuditSessions.tokenJti, input.jti),
        eq(siteQualityRuns.publicReference, input.qualityRunReference),
        eq(sites.publicReference, input.siteReference),
        eq(siteVersions.publicReference, input.versionReference),
        eq(siteQualityAuditSessions.status, 'ACTIVE'),
        isNull(siteQualityAuditSessions.revokedAt),
        gt(siteQualityAuditSessions.expiresAt, new Date()),
        eq(
          siteQualityAuditSessions.contentDigestSha256,
          siteQualityRuns.siteVersionDigestSha256,
        ),
        eq(
          siteQualityAuditSessions.contentDigestSha256,
          siteVersions.generationContentDigestSha256,
        ),
        inArray(siteQualityRuns.status, [
          'PREPARING',
          'RENDERING',
          'RUNNING_DETERMINISTIC_CHECKS',
          'RUNNING_BROWSER_CHECKS',
          'RUNNING_AI_REVIEW',
          'EVALUATING',
        ]),
        eq(
          sitePages.slug,
          input.requestedPath === '/'
            ? 'home'
            : input.requestedPath.replace(/^\/+|\/+$/g, ''),
        ),
      ))
      .limit(1);
    if (!session) return false;
    await this.database.update(siteQualityAuditSessions).set({
      lastAccessedAt: new Date(),
    }).where(eq(siteQualityAuditSessions.id, session.id));
    return true;
  }
}
