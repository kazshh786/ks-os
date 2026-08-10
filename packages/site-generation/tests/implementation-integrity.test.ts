import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { listSiteComponents } from '@ks-os/site-components';
import {
  buildSiteComponentImplementationAudit,
  generatedSectionResponseJsonSchema,
} from '../src/index.js';

const designLibraryCss = await readFile(
  new URL('../../../apps/sites/public/design-library.css', import.meta.url),
  'utf8',
);

test('all 123 active component capabilities are implemented with no registry or CSS orphans', () => {
  const report = buildSiteComponentImplementationAudit({ designLibraryCss });
  assert.equal(report.activeComponentCount, 123);
  assert.equal(report.fullyImplementedCount, 23);
  assert.equal(report.intentionalVisualVariantCount, 100);
  assert.equal(report.invalidRegistryCapabilityCount, 0);
  assert.ok(report.entries.every(entry => entry.failures.length === 0));

  const registryKeys = new Set(report.entries.map(entry => entry.componentKey));
  const cssKeys = new Set([...designLibraryCss.matchAll(/\.component-([a-z0-9-]+-v[1-9][0-9]*)/g)]
    .map(match => match[1]!));
  assert.deepEqual([...cssKeys].filter(key => !registryKeys.has(key)), []);
  assert.deepEqual([...registryKeys].filter(key => !cssKeys.has(key)), []);
});

test('each component is represented by a closed provider response schema', () => {
  for (const component of listSiteComponents()) {
    const schema = generatedSectionResponseJsonSchema({
      sectionType: component.sectionType,
      componentKeys: [component.componentKey],
    });
    assert.equal(schema.additionalProperties, false);
    const properties = schema.properties as Record<string, unknown>;
    assert.deepEqual((properties.componentKey as { enum: string[] }).enum, [component.componentKey]);
    assert.ok(component.contentSlots.every(slot => slot in properties));
  }
});
