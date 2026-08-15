import { and, eq, inArray } from 'drizzle-orm';
import {
  factFindingUploads,
  getDatabase,
  services,
  siteAssets,
  users,
} from '@ks-os/database';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import {
  GOVERNED_SITE_ASSET_CATEGORIES,
  GOVERNED_SITE_ASSET_CONSENT_STATUSES,
  GOVERNED_SITE_ASSET_MIME_TYPES,
  GOVERNED_SITE_ASSET_SCAN_STATUSES,
  buildGovernedSiteAssetProjection,
  governedSiteAssetReference,
  type GovernedSiteAssetProjection,
} from './governed-site-asset-policy.js';

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export type GovernedSiteAssetCandidate = GovernedSiteAssetProjection;

export class GovernedSiteAssetService {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  ) {}

  async prepare(input: {
    tenantId: string;
    siteId: string;
    siteReference: string;
    businessName: string;
  }): Promise<GovernedSiteAssetCandidate[]> {
    const rows = await this.database.select({
      id: factFindingUploads.id,
      tenantId: factFindingUploads.tenantId,
      publicReference: factFindingUploads.publicReference,
      storageBucket: factFindingUploads.storageBucket,
      storagePath: factFindingUploads.storagePath,
      safeFilename: factFindingUploads.safeFilename,
      mimeType: factFindingUploads.mimeType,
      byteSize: factFindingUploads.byteSize,
      digestSha256: factFindingUploads.digestSha256,
      assetCategory: factFindingUploads.assetCategory,
      uploadStatus: factFindingUploads.uploadStatus,
      agencyReviewStatus: factFindingUploads.agencyReviewStatus,
      publicUsePermission: factFindingUploads.publicUsePermission,
      aiUsePermission: factFindingUploads.aiUsePermission,
      copyrightConfirmed: factFindingUploads.copyrightConfirmed,
      consentStatus: factFindingUploads.consentStatus,
      malwareScanStatus: factFindingUploads.malwareScanStatus,
      boundStaffUserId: factFindingUploads.boundStaffUserId,
      boundStaffReference: users.publicReference,
      boundServiceId: factFindingUploads.boundServiceId,
      boundServiceReference: services.publicReference,
    }).from(factFindingUploads)
      .leftJoin(users, and(
        eq(factFindingUploads.boundStaffUserId, users.id),
        eq(factFindingUploads.tenantId, users.tenantId),
      ))
      .leftJoin(services, and(
        eq(factFindingUploads.boundServiceId, services.id),
        eq(factFindingUploads.tenantId, services.tenantId),
      ))
      .where(and(
      eq(factFindingUploads.tenantId, input.tenantId),
      eq(factFindingUploads.uploadStatus, 'UPLOADED'),
      eq(factFindingUploads.agencyReviewStatus, 'APPROVED'),
      eq(factFindingUploads.publicUsePermission, true),
      eq(factFindingUploads.aiUsePermission, true),
      eq(factFindingUploads.copyrightConfirmed, true),
      inArray(factFindingUploads.consentStatus, GOVERNED_SITE_ASSET_CONSENT_STATUSES),
      inArray(factFindingUploads.malwareScanStatus, GOVERNED_SITE_ASSET_SCAN_STATUSES),
      inArray(factFindingUploads.assetCategory, GOVERNED_SITE_ASSET_CATEGORIES),
      inArray(factFindingUploads.mimeType, GOVERNED_SITE_ASSET_MIME_TYPES),
      ));
    if (!rows.length) return [];

    const references = rows.map(row =>
      governedSiteAssetReference(input.siteId, row.publicReference));
    const existing = await this.database.select({ reference: siteAssets.publicReference })
      .from(siteAssets).where(and(
        eq(siteAssets.tenantId, input.tenantId),
        eq(siteAssets.siteId, input.siteId),
        inArray(siteAssets.publicReference, references),
      ));
    const existingReferences = new Set(existing.map(row => row.reference));
    const missingRows = rows.filter(row => !existingReferences.has(
      governedSiteAssetReference(input.siteId, row.publicReference),
    ));
    if (!missingRows.length) return [];
    const publicOrigin = this.environment.PUBLIC_APP_ORIGIN || this.environment.FRONTEND_ORIGIN;
    if (!publicOrigin) {
      throw fail(
        503,
        'GOVERNED_SITE_ASSET_ORIGIN_UNAVAILABLE',
        'The stable public asset origin is not configured.',
      );
    }
    const candidates: GovernedSiteAssetCandidate[] = [];

    for (const row of missingRows) {
      const { data, error } = await getSupabaseAdmin().storage
        .from(row.storageBucket)
        .download(row.storagePath);
      if (error || !data) {
        throw fail(
          503,
          'GOVERNED_SITE_ASSET_UNAVAILABLE',
          'An approved website asset could not be read from governed storage.',
        );
      }
      const bytes = Buffer.from(await data.arrayBuffer());
      const projection = buildGovernedSiteAssetProjection({
        tenantId: input.tenantId,
        siteId: input.siteId,
        siteReference: input.siteReference,
        businessName: input.businessName,
        publicOrigin,
        bytes,
        upload: row,
      });
      if (!projection.ok) {
        throw fail(
          409,
          projection.reason === 'ENTITY_BINDING_INVALID'
            ? 'GOVERNED_SITE_ASSET_BINDING_INVALID'
            : 'GOVERNED_SITE_ASSET_INVALID',
          projection.reason === 'ENTITY_BINDING_INVALID'
            ? 'An approved website asset has an invalid or cross-tenant entity binding.'
            : 'An approved website asset no longer matches its governed upload evidence.',
        );
      }
      candidates.push(projection.value);
    }
    return candidates;
  }

  async materialize(
    transaction: Transaction,
    input: { tenantId: string; siteId: string; versionId: string },
    candidates: readonly GovernedSiteAssetCandidate[],
  ) {
    if (!candidates.length) return [];
    return transaction.insert(siteAssets).values(candidates.map(candidate => ({
      publicReference: candidate.publicReference,
      tenantId: input.tenantId,
      siteId: input.siteId,
      versionId: input.versionId,
      sourceFactFindingUploadId: candidate.uploadId,
      kind: candidate.kind,
      storagePath: candidate.storagePath,
      mimeType: candidate.mimeType,
      altText: candidate.altText,
      width: candidate.width,
      height: candidate.height,
      status: 'READY',
    }))).onConflictDoNothing().returning({ reference: siteAssets.publicReference });
  }
}
