import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractSearchResearch, searchResearchFileMatchesMime } from '../src/modules/sites/search-research-parser.js';

const provisioningRoutes = readFileSync(new URL('../src/modules/provisioning/provisioning.routes.ts', import.meta.url), 'utf8');
const searchRoutes = readFileSync(new URL('../src/modules/sites/search-intelligence.routes.ts', import.meta.url), 'utf8');
const searchService = readFileSync(new URL('../src/modules/sites/search-research-inbox.service.ts', import.meta.url), 'utf8');
const searchIntelligenceService = readFileSync(new URL('../src/modules/sites/search-intelligence.service.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../packages/database/migrations/20260812130000_search_research_inbox.sql', import.meta.url), 'utf8');
const assetUi = readFileSync(new URL('../../web/src/features/agency/AgencyClientAssetLibraryPage.tsx', import.meta.url), 'utf8');
const researchUi = readFileSync(new URL('../../web/src/features/agency/AgencyClientSearchResearchPage.tsx', import.meta.url), 'utf8');
const onboardingUi = readFileSync(new URL('../../web/src/features/agency/AgencyWorkspaceOnboardingPage.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../../web/src/layouts/AgencyLayout.tsx', import.meta.url), 'utf8');

test('CSV and JSON keyword research is extracted deterministically without inventing metrics', () => {
  const csv = Buffer.from('Keyword,Search Volume,KD,Clicks,Impressions,Position\nlaser hair removal,2400,31,80,1200,7.2\nlaser aftercare,,,,,\n');
  assert.equal(searchResearchFileMatchesMime(csv, 'text/csv'), true);
  const extracted = extractSearchResearch(csv, 'text/csv');
  assert.equal(extracted.keywordCount, 2);
  assert.equal(extracted.metricRowCount, 1);
  assert.deepEqual(extracted.rows[0], {
    keyword: 'laser hair removal',
    monthlySearchVolume: 2400,
    keywordDifficulty: 31,
    clicks: 80,
    impressions: 1200,
    position: 7.2,
  });
  assert.deepEqual(extracted.rows[1], { keyword: 'laser aftercare' });

  const json = Buffer.from(JSON.stringify({ rows: [{ query: 'beauty clinic blackburn', impressions: 90 }] }));
  assert.equal(searchResearchFileMatchesMime(json, 'application/json'), true);
  assert.deepEqual(extractSearchResearch(json, 'application/json').rows[0], { keyword: 'beauty clinic blackburn', impressions: 90 });
});

test('PDF research is retained for human review without pretending prose is structured keyword evidence', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj <<>> stream\nBT (Competitor notes and keyword ideas) Tj ET\nendstream\nendobj\n%%EOF');
  assert.equal(searchResearchFileMatchesMime(pdf, 'application/pdf'), true);
  const extracted = extractSearchResearch(pdf, 'application/pdf');
  assert.equal(extracted.keywordCount, 0);
  assert.match(extracted.warnings.join(' '), /structured keyword rows are not inferred|CSV, XLSX or JSON/i);
});

test('client assets have tenant-scoped upload, completion and permissions routes', () => {
  assert.match(provisioningRoutes, /tenants\/:tenantReference\/assets'/);
  assert.match(provisioningRoutes, /tenants\/:tenantReference\/assets\/:uploadReference\/complete/);
  assert.match(provisioningRoutes, /tenants\/:tenantReference\/assets\/:uploadReference\/permissions/);
  assert.match(provisioningRoutes, /FactFindingUploadSchema/);
  assert.match(assetUi, /Brand and assets/);
  assert.match(assetUi, /Copyright \/ usage rights confirmed/);
  assert.match(assetUi, /Allow public website use/);
  assert.match(assetUi, /Allow as AI design\/generation input/);
  assert.match(assetUi, /Approve asset/);
  assert.match(onboardingUi, /view=assets/);
});

test('search research sources require explicit extraction review and apply actions', () => {
  assert.match(searchRoutes, /search-intelligence\/research-sources/);
  assert.match(searchRoutes, /research-sources\/:sourceReference\/complete/);
  assert.match(searchRoutes, /research-sources\/:sourceReference\/apply/);
  assert.match(searchRoutes, /research-sources\/:sourceReference\/reject/);
  assert.match(searchService, /eq\(siteSearchStrategies\.status, 'DRAFT'\)/);
  assert.match(searchService, /SEARCH_RESEARCH_SOURCE_NOT_APPLICABLE/);
  assert.match(searchService, /deterministic-file-extraction-v1/);
  assert.doesNotMatch(searchService, /status:\s*'APPROVED'/);
  assert.match(researchUi, /Add to search strategy/);
  assert.match(researchUi, /Nothing will be approved automatically/);
  assert.match(researchUi, /Google Search Console/);
  assert.match(researchUi, /Not connected/);
  assert.match(layout, /view=research/);
});

test('research updates repin every draft page brief to the new strategy digest', () => {
  assert.doesNotMatch(searchService, /if \(!imported\.length\) return item/);
  assert.match(searchService, /strategyDigestSha256: strategy\.provenance\.outputDigestSha256/);
  assert.match(searchService, /outputDigestSha256: pageSeoBriefDigest\(draftBrief\)/);
  assert.match(searchIntelligenceService, /canRepairResearchPin/);
  assert.match(searchIntelligenceService, /providerKey === 'ks-os-research-inbox'/);
  assert.match(searchIntelligenceService, /outputDigestSha256: approved\.provenance\.outputDigestSha256/);
});

test('research source persistence is private and tenant/site scoped', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.site_search_research_sources/);
  assert.match(migration, /site_search_research_sources_scope_guard/);
  assert.match(migration, /strategy\.site_id = NEW\.site_id/);
  assert.match(migration, /strategy\.tenant_id = NEW\.tenant_id/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.site_search_research_sources FROM anon, authenticated/);
  assert.match(migration, /CHECK \(status IN \('PENDING_UPLOAD','EXTRACTED','APPLIED','REJECTED','QUARANTINED'\)\)/);
});
