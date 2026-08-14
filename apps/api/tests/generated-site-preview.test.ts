import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const api = (path: string) => readFileSync(resolve(process.cwd(), `src/${path}`), 'utf8');
const web = (path: string) => readFileSync(resolve(process.cwd(), `../web/src/${path}`), 'utf8');

test('agency generated-site preview uses the latest immutable PREVIEW snapshot without a review-cycle gate', () => {
  const source = api('modules/sites/site.routes.ts');

  assert.match(source, /post\('\/:siteReference\/preview-link'/);
  assert.match(source, /agencyActor\(request, 'sites\.read'\)/);
  assert.match(source, /eq\(siteRenderSnapshots\.snapshotKind, 'PREVIEW'\)/);
  assert.match(source, /orderBy\(desc\(siteRenderSnapshots\.createdAt\), desc\(siteRenderSnapshots\.revision\)\)/);
  assert.match(source, /purpose: 'AGENCY_REVIEW'/);
  assert.match(source, /ttlSeconds = 3_600/);
  assert.match(source, /PUBLIC_SITES_PREVIEW_ORIGIN/);
  assert.match(source, /SITE_PREVIEW_NOT_READY/);
  assert.doesNotMatch(source, /preview-link[\s\S]{0,4000}reviewCycleReference/);
});

test('Site Studio exposes preview separately from publication readiness', () => {
  const source = web('features/agency/SitePublishingPanel.tsx');

  assert.match(source, /Preview generated site/);
  assert.match(source, /\/preview-link/);
  assert.match(source, /latest available secure rendered preview/i);
  assert.match(source, /does not publish the site/i);
  assert.match(source, /Quality, review, payments and publication remain separate gates for going live/i);
  assert.match(source, /window\.open\('about:blank', '_blank'\)/);
});
