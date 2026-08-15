import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { applyGovernedEntityAssetBindings } from '@ks-os/site-generation';
import {
  buildGovernedSiteAssetProjection,
  governedImageDimensions,
  governedSiteAssetKind,
  governedSiteAssetReference,
  governedSiteAssetUrl,
  isGovernedSiteAssetAiEligible,
  isGovernedSiteAssetPubliclyDeliverable,
} from '../src/modules/sites/governed-site-asset-policy.js';

const serviceSource = await readFile(new URL(
  '../src/modules/sites/governed-site-asset.service.ts',
  import.meta.url,
), 'utf8');
const generationSource = await readFile(new URL(
  '../src/modules/sites/site-generation.service.ts',
  import.meta.url,
), 'utf8');
const assetLibrarySource = await readFile(new URL(
  '../src/modules/provisioning/asset-library.service.ts',
  import.meta.url,
), 'utf8');
const factFindingSource = await readFile(new URL(
  '../src/modules/provisioning/fact-finding.service.ts',
  import.meta.url,
), 'utf8');
const publicRouteSource = await readFile(new URL(
  '../src/routes/public/site-assets.ts',
  import.meta.url,
), 'utf8').catch(() => '');
const migration = await readFile(new URL(
  '../../../packages/database/migrations/20260815090000_governed_site_asset_projection.sql',
  import.meta.url,
), 'utf8');
const manifest = await readFile(new URL(
  '../../../packages/database/src/manifest.ts',
  import.meta.url,
), 'utf8');

const eligible = {
  uploadStatus: 'UPLOADED',
  agencyReviewStatus: 'APPROVED',
  publicUsePermission: true,
  aiUsePermission: true,
  copyrightConfirmed: true,
  consentStatus: 'CONFIRMED',
  malwareScanStatus: 'CLEAN',
  assetCategory: 'TEAM_PHOTO',
  mimeType: 'image/webp',
};

test('AI selection and public delivery are distinct governed policies', () => {
  assert.equal(isGovernedSiteAssetAiEligible(eligible), true);
  assert.equal(isGovernedSiteAssetPubliclyDeliverable(eligible), true);
  assert.equal(isGovernedSiteAssetAiEligible({ ...eligible, aiUsePermission: false }), false);
  assert.equal(isGovernedSiteAssetPubliclyDeliverable({ ...eligible, aiUsePermission: false }), true);
  for (const change of [
    { uploadStatus: 'PENDING_UPLOAD' },
    { agencyReviewStatus: 'PENDING' },
    { publicUsePermission: false },
    { copyrightConfirmed: false },
    { consentStatus: 'REQUIRED' },
    { malwareScanStatus: 'INFECTED' },
    { assetCategory: 'POLICY_DOCUMENT' },
    { mimeType: 'application/pdf' },
  ]) {
    assert.equal(isGovernedSiteAssetAiEligible({ ...eligible, ...change }), false);
    assert.equal(isGovernedSiteAssetPubliclyDeliverable({ ...eligible, ...change }), false);
  }
});

test('logo, team, location, service and result categories map to generator asset classes', () => {
  assert.equal(governedSiteAssetKind('LOGO'), 'LOGO');
  assert.equal(governedSiteAssetKind('TEAM_PHOTO'), 'STAFF');
  assert.equal(governedSiteAssetKind('LOCATION_PHOTO'), 'LOCATION');
  assert.equal(governedSiteAssetKind('SERVICE_PHOTO'), 'SERVICE');
  assert.equal(governedSiteAssetKind('RESULT_PHOTO'), 'RESULT');
  assert.equal(governedSiteAssetKind('BRAND_GUIDE'), null);
});

test('site asset identity and render URL are deterministic, site-scoped and stable', () => {
  const uploadReference = '00000000-0000-4000-8000-000000000001';
  const first = governedSiteAssetReference('site-a', uploadReference);
  assert.equal(first, governedSiteAssetReference('site-a', uploadReference));
  assert.notEqual(first, governedSiteAssetReference('site-b', uploadReference));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const url = governedSiteAssetUrl({
    publicOrigin: 'https://app.example.com',
    siteReference: 'site-reference',
    assetReference: first,
    uploadReference,
  });
  assert.equal(
    url,
    `https://app.example.com/api/v1/public/site-assets/site-reference/${first}/${uploadReference}`,
  );
  assert.doesNotMatch(url, /token=|signature=|expires=/i);
});

test('governed image dimensions are read from verified bytes', () => {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.writeUInt32BE(1200, 16);
  png.writeUInt32BE(800, 20);
  assert.deepEqual(governedImageDimensions(png, 'image/png'), { width: 1200, height: 800 });

  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBP', 8, 'ascii');
  webp.write('VP8X', 12, 'ascii');
  webp.writeUIntLE(639, 24, 3);
  webp.writeUIntLE(479, 27, 3);
  assert.deepEqual(governedImageDimensions(webp, 'image/webp'), { width: 640, height: 480 });
  assert.equal(governedImageDimensions(Buffer.from('%PDF-1.7'), 'application/pdf'), null);
});

function png(width = 1200, height = 800) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('approved uploads materialize deterministically and preserve explicit entity bindings', () => {
  const bytes = png();
  const upload = {
    ...eligible,
    id: '10000000-0000-4000-8000-000000000001',
    tenantId: '10000000-0000-4000-8000-000000000002',
    publicReference: '10000000-0000-4000-8000-000000000003',
    safeFilename: 'team.png',
    mimeType: 'image/png',
    byteSize: bytes.byteLength,
    digestSha256: createHash('sha256').update(bytes).digest('hex'),
    boundStaffUserId: '10000000-0000-4000-8000-000000000004',
    boundStaffReference: '10000000-0000-4000-8000-000000000005',
  };
  const projected = buildGovernedSiteAssetProjection({
    tenantId: upload.tenantId,
    siteId: '10000000-0000-4000-8000-000000000006',
    siteReference: '10000000-0000-4000-8000-000000000007',
    businessName: 'Luma Beauty Studio',
    publicOrigin: 'https://app.example.com',
    bytes,
    upload,
  });
  assert.equal(projected.ok, true);
  if (!projected.ok) return;
  assert.equal(projected.value.kind, 'STAFF');
  assert.equal(projected.value.entityReference, upload.boundStaffReference);
  assert.equal(projected.value.width, 1200);
  assert.equal(projected.value.height, 800);
  assert.match(projected.value.storagePath, /\/api\/v1\/public\/site-assets\//);
});

test('cross-tenant or unresolved entity bindings cannot materialize', () => {
  const bytes = png();
  const upload = {
    ...eligible,
    id: '10000000-0000-4000-8000-000000000001',
    tenantId: '10000000-0000-4000-8000-000000000002',
    publicReference: '10000000-0000-4000-8000-000000000003',
    safeFilename: 'team.png',
    mimeType: 'image/png',
    byteSize: bytes.byteLength,
    digestSha256: createHash('sha256').update(bytes).digest('hex'),
    boundStaffUserId: '10000000-0000-4000-8000-000000000004',
    boundStaffReference: null,
  };
  const context = {
    siteId: '10000000-0000-4000-8000-000000000006',
    siteReference: '10000000-0000-4000-8000-000000000007',
    businessName: 'Luma Beauty Studio',
    publicOrigin: 'https://app.example.com',
    bytes,
  };
  assert.deepEqual(buildGovernedSiteAssetProjection({
    ...context,
    tenantId: '20000000-0000-4000-8000-000000000002',
    upload,
  }), { ok: false, reason: 'TENANT_MISMATCH' });
  assert.deepEqual(buildGovernedSiteAssetProjection({
    ...context,
    tenantId: upload.tenantId,
    upload,
  }), { ok: false, reason: 'ENTITY_BINDING_INVALID' });
});

test('logo, staff and service bindings enter entity fields without guessing unbound imagery', () => {
  const logo = '10000000-0000-4000-8000-000000000010';
  const staffImage = '10000000-0000-4000-8000-000000000011';
  const genericTeam = '10000000-0000-4000-8000-000000000012';
  const serviceImage = '10000000-0000-4000-8000-000000000013';
  const staffReference = '10000000-0000-4000-8000-000000000020';
  const serviceReference = '10000000-0000-4000-8000-000000000021';
  const bound = applyGovernedEntityAssetBindings({
    assets: [
      { publicReference: logo, assetClass: 'LOGO' },
      { publicReference: staffImage, assetClass: 'STAFF', entityReference: staffReference },
      { publicReference: genericTeam, assetClass: 'STAFF' },
      { publicReference: serviceImage, assetClass: 'SERVICE', entityReference: serviceReference },
    ],
    availableAssetReferences: new Set([logo, staffImage, genericTeam, serviceImage]),
    business: { name: 'Luma' },
    staff: [{ publicReference: staffReference, name: 'Maya' }],
    services: [{ publicReference: serviceReference, name: 'Facial' }],
  });
  assert.equal(bound.business.logoAssetReference, logo);
  assert.equal(bound.staff[0]!.imageAssetReference, staffImage);
  assert.equal(bound.services[0]!.imageAssetReference, serviceImage);
  assert.notEqual(bound.staff[0]!.imageAssetReference, genericTeam);
});

test('materialisation enforces tenant ownership and every governance predicate in SQL', () => {
  for (const binding of [
    /eq\(factFindingUploads\.tenantId, input\.tenantId\)/,
    /uploadStatus, 'UPLOADED'/,
    /agencyReviewStatus, 'APPROVED'/,
    /publicUsePermission, true/,
    /aiUsePermission, true/,
    /copyrightConfirmed, true/,
    /GOVERNED_SITE_ASSET_CONSENT_STATUSES/,
    /GOVERNED_SITE_ASSET_SCAN_STATUSES/,
    /GOVERNED_SITE_ASSET_CATEGORIES/,
    /GOVERNED_SITE_ASSET_MIME_TYPES/,
  ]) assert.match(serviceSource, binding);
  assert.match(serviceSource, /eq\(siteAssets\.siteId, input\.siteId\)/);
  assert.match(serviceSource, /sourceFactFindingUploadId: candidate\.uploadId/);
  assert.match(serviceSource, /onConflictDoNothing\(\)/);
});

test('generation consumes materialized assets and public delivery rechecks governance', () => {
  assert.match(generationSource, /GovernedSiteAssetService/);
  assert.match(generationSource, /assetCandidates/);
  assert.match(generationSource, /assetReferences/);
  for (const guard of [
    /siteAssets\.publicReference/,
    /factFindingUploads\.publicReference/,
    /factFindingUploads\.tenantId/,
    /factFindingUploads\.agencyReviewStatus/,
    /factFindingUploads\.publicUsePermission/,
    /factFindingUploads\.copyrightConfirmed/,
  ]) assert.match(publicRouteSource, guard);
  assert.doesNotMatch(publicRouteSource, /aiUsePermission/);
});

test('the site asset projection has one governed source identity and generator-safe kinds', () => {
  assert.match(manifest, /20260815090000_governed_site_asset_projection\.sql[\s\S]*order: 77/);
  assert.match(migration, /source_fact_finding_upload_id uuid/);
  assert.match(migration, /REFERENCES fact_finding_uploads\(id\)/);
  assert.match(migration, /site_assets_site_source_upload_unique/);
  assert.match(migration, /site_assets_source_upload_idx/);
  assert.match(migration, /bound_staff_user_id/);
  assert.match(migration, /bound_service_id/);
  assert.match(migration, /asset_input_json/);
  for (const kind of ['STAFF', 'LOCATION', 'SERVICE', 'RESULT']) {
    assert.match(migration, new RegExp(`'${kind}'`));
  }
  assert.doesNotMatch(migration, /signed_url|token=|DELETE FROM|TRUNCATE/i);
});

test('permission and review changes update the same projected asset lifecycle', () => {
  assert.match(assetLibrarySource, /isGovernedSiteAssetPubliclyDeliverable\(record\)/);
  assert.match(assetLibrarySource, /status: siteAssetStatus/);
  assert.match(assetLibrarySource, /ASSET_ENTITY_BINDING_IMMUTABLE/);
  assert.match(factFindingSource, /isGovernedSiteAssetPubliclyDeliverable\(record\)/);
  assert.match(factFindingSource, /status: siteAssetStatus/);
  assert.match(factFindingSource, /sourceFactFindingUploadId, record\.id/);
});
