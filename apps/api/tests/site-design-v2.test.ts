import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { UpdateSiteStudioSectionContentSchema } from '@ks-os/contracts';

const serviceSource = await readFile(new URL(
  '../src/modules/sites/site-design.service.ts',
  import.meta.url,
), 'utf8');
const librarySource = await readFile(new URL(
  '../src/modules/sites/design-library.service.ts',
  import.meta.url,
), 'utf8');

test('Site Studio content editing exposes controlled copy and imagery only', () => {
  assert.equal(UpdateSiteStudioSectionContentSchema.safeParse({
    patch: {
      heading: 'A controlled heading',
      body: 'Verified and editable public copy.',
      imageAssetReference: '11111111-1111-4111-8111-111111111111',
    },
  }).success, true);
  for (const patch of [
    { componentKey: 'hero-full-bleed-v1' },
    { primaryAction: { type: 'EXTERNAL_URL', url: 'https://example.test' } },
    { type: 'RICH_TEXT' },
    { body: '<script>alert(1)</script>' },
  ]) assert.equal(UpdateSiteStudioSectionContentSchema.safeParse({ patch }).success, false);
});

test('Site Studio changes invalidate browser-backed review readiness', () => {
  assert.match(serviceSource, /\['DESIGN_COMPLETE', 'READY_FOR_REVIEW'\]\.includes\(context\.generationStatus/);
  assert.match(serviceSource, /context\.generationStatus === 'READY_FOR_REVIEW'/);
  assert.match(serviceSource, /status:\s*'DESIGN_COMPLETE'/);
  assert.match(serviceSource, /qualityRerunRequired:\s*Boolean/);
  assert.doesNotMatch(serviceSource, /sitePublication|publicationPerformed:\s*true/);
});

test('Design Library V2 approval rejects disabled or incompatible component keys', () => {
  assert.match(librarySource, /component\.status !== 'ACTIVE'/);
  assert.match(librarySource, /!component\.supportedPageTypes\.includes\(pageType\.data\)/);
  assert.match(librarySource, /!component\.compatibleSectionTypes\.includes\(sectionType\.data\)/);
  assert.match(librarySource, /registryVersion === SITE_COMPONENT_REGISTRY_VERSION/);
});
