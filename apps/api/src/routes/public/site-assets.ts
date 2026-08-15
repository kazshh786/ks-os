import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  factFindingUploads,
  getDatabase,
  siteAssets,
  sites,
} from '@ks-os/database';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import {
  GOVERNED_SITE_ASSET_CATEGORIES,
  GOVERNED_SITE_ASSET_CONSENT_STATUSES,
  GOVERNED_SITE_ASSET_MIME_TYPES,
  GOVERNED_SITE_ASSET_SCAN_STATUSES,
  governedSiteAssetReference,
} from '../../modules/sites/governed-site-asset-policy.js';

const Params = z.object({
  siteReference: z.string().uuid(),
  assetReference: z.string().uuid(),
  uploadReference: z.string().uuid(),
}).strict();

export default async function publicSiteAssetRoutes(app: FastifyInstance) {
  app.get('/:siteReference/:assetReference/:uploadReference', async (request, reply) => {
    const params = Params.parse(request.params);
    const database = getDatabase();
    const [asset] = await database.select({
      siteId: siteAssets.siteId,
      storageBucket: factFindingUploads.storageBucket,
      storagePath: factFindingUploads.storagePath,
      mimeType: factFindingUploads.mimeType,
      byteSize: factFindingUploads.byteSize,
      digestSha256: factFindingUploads.digestSha256,
    }).from(siteAssets)
      .innerJoin(sites, and(
        eq(siteAssets.siteId, sites.id),
        eq(siteAssets.tenantId, sites.tenantId),
      ))
      .innerJoin(factFindingUploads, and(
        eq(factFindingUploads.id, siteAssets.sourceFactFindingUploadId),
        eq(factFindingUploads.tenantId, siteAssets.tenantId),
      ))
      .where(and(
        eq(sites.publicReference, params.siteReference),
        eq(siteAssets.publicReference, params.assetReference),
        eq(siteAssets.status, 'READY'),
        eq(factFindingUploads.publicReference, params.uploadReference),
        eq(factFindingUploads.uploadStatus, 'UPLOADED'),
        eq(factFindingUploads.agencyReviewStatus, 'APPROVED'),
        eq(factFindingUploads.publicUsePermission, true),
        eq(factFindingUploads.copyrightConfirmed, true),
        inArray(factFindingUploads.consentStatus, GOVERNED_SITE_ASSET_CONSENT_STATUSES),
        inArray(factFindingUploads.malwareScanStatus, GOVERNED_SITE_ASSET_SCAN_STATUSES),
        inArray(factFindingUploads.assetCategory, GOVERNED_SITE_ASSET_CATEGORIES),
        inArray(factFindingUploads.mimeType, GOVERNED_SITE_ASSET_MIME_TYPES),
      )).limit(1);
    if (!asset || governedSiteAssetReference(asset.siteId, params.uploadReference)
      !== params.assetReference) {
      return reply.code(404).send({
        error: { code: 'PUBLIC_SITE_ASSET_NOT_FOUND', message: 'Website asset not found.' },
      });
    }
    const etag = `"sha256-${asset.digestSha256}"`;
    if (request.headers['if-none-match'] === etag) {
      return reply.code(304).header('etag', etag).send();
    }
    const { data, error } = await getSupabaseAdmin().storage
      .from(asset.storageBucket)
      .download(asset.storagePath);
    if (error || !data) {
      request.log.error({ error, assetReference: params.assetReference }, 'Governed site asset download failed.');
      return reply.code(503).send({
        error: { code: 'PUBLIC_SITE_ASSET_UNAVAILABLE', message: 'Website asset is temporarily unavailable.' },
      });
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.byteLength !== asset.byteSize
      || createHash('sha256').update(bytes).digest('hex') !== asset.digestSha256) {
      request.log.error({ assetReference: params.assetReference }, 'Governed site asset evidence changed.');
      return reply.code(503).send({
        error: { code: 'PUBLIC_SITE_ASSET_UNAVAILABLE', message: 'Website asset is temporarily unavailable.' },
      });
    }
    return reply
      .header('content-type', asset.mimeType)
      .header('content-length', String(bytes.byteLength))
      .header('cache-control', 'public, max-age=300, stale-while-revalidate=600')
      .header('etag', etag)
      .header('x-content-type-options', 'nosniff')
      .send(bytes);
  });
}
