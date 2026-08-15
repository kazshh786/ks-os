import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  governedImageDimensions,
  governedSiteAssetKind,
  governedSiteAssetReference,
  governedSiteAssetUrl,
  isGovernedSiteAssetEligible,
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

test('only fully governed approved public image uploads are website eligible', () => {
  assert.equal(isGovernedSiteAssetEligible(eligible), true);
  for (const change of [
    { uploadStatus: 'PENDING_UPLOAD' },
    { agencyReviewStatus: 'PENDING' },
    { publicUsePermission: false },
    { aiUsePermission: false },
    { copyrightConfirmed: false },
    { consentStatus: 'REQUIRED' },
    { malwareScanStatus: 'INFECTED' },
    { assetCategory: 'POLICY_DOCUMENT' },
    { mimeType: 'application/pdf' },
  ]) assert.equal(isGovernedSiteAssetEligible({ ...eligible, ...change }), false);
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
});

test('the site asset projection has one governed source identity and generator-safe kinds', () => {
  assert.match(manifest, /20260815090000_governed_site_asset_projection\.sql[\s\S]*order: 77/);
  assert.match(migration, /source_fact_finding_upload_id uuid/);
  assert.match(migration, /REFERENCES fact_finding_uploads\(id\)/);
  assert.match(migration, /site_assets_site_source_upload_unique/);
  assert.match(migration, /site_assets_source_upload_idx/);
  for (const kind of ['STAFF', 'LOCATION', 'SERVICE', 'RESULT']) {
    assert.match(migration, new RegExp(`'${kind}'`));
  }
  assert.doesNotMatch(migration, /signed_url|token=|DELETE FROM|TRUNCATE/i);
});

test('permission and review changes update the same projected asset lifecycle', () => {
  assert.match(
    assetLibrarySource,
    /status: 'REJECTED'[\s\S]*sourceFactFindingUploadId, record\.id/,
  );
  assert.match(factFindingSource, /isGovernedSiteAssetEligible\(record\)/);
  assert.match(factFindingSource, /status: siteAssetStatus/);
  assert.match(factFindingSource, /sourceFactFindingUploadId, record\.id/);
});
