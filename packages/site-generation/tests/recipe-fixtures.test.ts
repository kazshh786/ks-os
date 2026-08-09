import assert from 'node:assert/strict';
import test from 'node:test';
import type { SiteSectionType } from '@ks-os/site-schema';
import { validatePageCompositionPlan } from '../src/index.js';
import { recipeCompositionFixtures, recipeFixturePageReferences } from './fixtures/recipe-composition-plans.js';

test('all 16 named page recipes have passing fixture composition plans', () => {
  assert.equal(recipeCompositionFixtures.length, 16);
  for (const fixture of recipeCompositionFixtures) {
    const findings = validatePageCompositionPlan({
      output: fixture.output,
      page: fixture.page,
      template: fixture.template,
      approvedPageReferences: Object.values(recipeFixturePageReferences),
    });
    assert.deepEqual(findings, [], `${fixture.page.pageType}: ${JSON.stringify(findings)}`);
  }
  const home = recipeCompositionFixtures.find(fixture => fixture.page.pageType === 'HOME')!;
  assert.equal(home.output.selectedComponents.length, 14);
  assert.ok(home.output.selectedComponents.some(selection => selection.sectionType === 'TESTIMONIALS'));
  assert.ok(home.output.selectedComponents.some(selection => selection.sectionType === 'GALLERY'));
});

test('representative fixtures exercise meaningful component diversity', () => {
  const groups: Record<string, readonly SiteSectionType[]> = {
    HERO: ['HERO'], SERVICES: ['FEATURED_SERVICES', 'SERVICE_GRID'], BENEFITS: ['BENEFITS'],
    PROCESS: ['PROCESS'], TEAM: ['TEAM', 'STAFF_PROFILE'], GALLERY: ['GALLERY', 'RESULTS'],
    CTA: ['BOOKING_CTA', 'FINAL_CTA'],
  };
  for (const [group, types] of Object.entries(groups)) {
    const keys = new Set(recipeCompositionFixtures.flatMap(fixture => fixture.output.selectedComponents)
      .filter(selection => types.includes(selection.sectionType))
      .map(selection => selection.componentKey));
    assert.ok(keys.size >= 3, `${group} exercised only ${keys.size} component variants`);
  }
});
