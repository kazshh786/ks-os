import assert from 'node:assert/strict';
import test from 'node:test';
import { listNativeLayoutManifests } from '@ks-os/site-templates';
import { auditV2TemplateReadiness } from '../src/modules/sites/v2-template-readiness.js';

function readyFixture() {
  const expectedLayouts = listNativeLayoutManifests().map(manifest => ({
    semanticKey: manifest.semanticKey,
    pageTypes: manifest.pageTypes,
  }));
  const layouts = expectedLayouts.map((expected, index) => ({
    id: `layout-${index}`, semanticKey: expected.semanticKey, status: 'APPROVED',
    sectionManifest: [{ sectionType: 'HEADER' }], rendererStatus: 'READY',
    rendererKey: `${expected.semanticKey}-v1`, rendererVersion: 1,
    compiledRendererVersion: 1, compiledRendererPageTypes: expected.pageTypes,
  }));
  return {
    manifest: { componentRegistryVersion: 2, generationPipelineVersion: 2 },
    analysisStatus: 'APPROVED', expectedLayouts, layouts,
    pageTypesByLayoutId: new Map(layouts.map((layout, index) => [layout.id, new Set(expectedLayouts[index]!.pageTypes)])),
    sectionLayoutIds: new Set(layouts.map(layout => layout.id)),
  };
}

test('V2 generation readiness requires all 13 layouts and all 16 page-type mappings', () => {
  const fixture = readyFixture();
  const result = auditV2TemplateReadiness(fixture);
  assert.equal(fixture.expectedLayouts.length, 13);
  assert.equal(new Set(fixture.expectedLayouts.flatMap(layout => layout.pageTypes)).size, 16);
  assert.deepEqual(result, { ready: true, failures: [] });
});

test('V2 readiness fails closed for a missing layout, renderer, sections or compatibility', () => {
  const missing = readyFixture();
  missing.layouts.pop();
  assert.equal(auditV2TemplateReadiness(missing).ready, false);

  const renderer = readyFixture();
  renderer.layouts[0]!.rendererStatus = 'UNMAPPED';
  assert.equal(auditV2TemplateReadiness(renderer).ready, false);

  const sections = readyFixture();
  sections.sectionLayoutIds.delete(sections.layouts[0]!.id);
  assert.equal(auditV2TemplateReadiness(sections).ready, false);

  const compatibility = readyFixture();
  compatibility.pageTypesByLayoutId.set(compatibility.layouts[0]!.id, new Set());
  assert.equal(auditV2TemplateReadiness(compatibility).ready, false);
});
