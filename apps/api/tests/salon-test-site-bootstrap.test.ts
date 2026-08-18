import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bootstrapPath = new URL('../../../scripts/bootstrap-salon-test-site.ts', import.meta.url);
const blueprintEnginePath = new URL('../../../packages/site-blueprints/src/engine.ts', import.meta.url);
const [bootstrap, blueprintEngine] = await Promise.all([
  readFile(bootstrapPath, 'utf8'),
  readFile(blueprintEnginePath, 'utf8'),
]);

test('salon fixture contains a complete fictional hair-salon operating model', () => {
  for (const value of [
    'Aurelia Hair Studio',
    '24 Chapel Row, Leeds, UK',
    'LS1 4DY',
    'Amelia Ross',
    'Salon Director & Colourist',
    'Noor Ahmed',
    'Senior Stylist & Curl Specialist',
    'Chloe Bennett',
    'Stylist & Bridal Hair Artist',
    'Signature Cut & Finish',
    'Bespoke Balayage',
    'Root Colour Refresh',
    'Gloss & Tone',
    'Curly Cut & Define',
    'Bridal Hair Preview & Style',
    "'BUSINESS.CATEGORY': 'HAIR_SALON'",
  ]) assert.match(bootstrap, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('salon fixture deliberately produces ten total pages through governed builder logic', () => {
  assert.match(bootstrap, /TOTAL_SITE_PAGE_TARGET = 10/);
  assert.match(bootstrap, /NON_MARKETING_PAGE_COUNT = 2/);
  assert.match(bootstrap, /MARKETING_PAGE_LIMIT = TOTAL_SITE_PAGE_TARGET - NON_MARKETING_PAGE_COUNT/);
  assert.match(bootstrap, /targetMarketingPageCount: MARKETING_PAGE_LIMIT/);
  assert.match(bootstrap, /governedNonMarketingPages: \['POLICIES', 'BOOKING'\]/);
  assert.match(blueprintEngine, /const nonMarketing = candidates\.filter/);
  assert.match(blueprintEngine, /\.\.\.nonMarketing,/);
});

test('salon page plan uses the controlled KS Native luxury design and conversion-led page types', () => {
  for (const pageType of [
    'HOME',
    'SERVICE_HUB',
    'SERVICE_DETAIL',
    'ABOUT',
    'TEAM_HUB',
    'LOCATION_DETAIL',
    'CONTACT',
    'FAQ',
    'POLICIES',
    'BOOKING',
  ]) assert.match(bootstrap, new RegExp(`'${pageType}'`));
  assert.match(bootstrap, /source: 'KS_NATIVE'/);
  assert.match(bootstrap, /presetKey: 'LUXURY'/);
  assert.match(bootstrap, /defaultSectionVariant: 'editorial'/);
});

test('salon fixture stays guarded, non-indexable and human-review gated', () => {
  assert.match(bootstrap, /SALON_TEST_SITE_BOOTSTRAP_ENABLED/);
  assert.match(bootstrap, /allowIndexing: false/);
  assert.match(bootstrap, /Complete the mandatory human review in Site Studio before publication/);
  assert.doesNotMatch(bootstrap, /publication\.create\(/);
});
