import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSearchIntelligencePlan } from '@ks-os/site-generation';
import { buildBlueprintSearchIntelligenceDraft } from '../src/modules/sites/search-intelligence-draft.js';
import { assertSearchIntelligenceResearchApprovable } from '../src/modules/sites/search-intelligence.service.js';

const reference = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

test('approved blueprint context produces one unapproved governed brief per page', () => {
  const pages = Array.from({ length: 17 }, (_, index) => ({
    reference: reference(100 + index),
    pageType: index === 0 ? 'HOME' : index === 16 ? 'BOOKING' : 'SERVICE_DETAIL',
    title: index === 0 ? 'Home' : index === 16 ? 'Book now' : `Service ${index}`,
    proposedSlug: index === 0 ? '/' : index === 16 ? '/book' : `/services/service-${index}`,
    sortOrder: index,
  }));
  const result = buildBlueprintSearchIntelligenceDraft({
    siteReference: reference(1),
    blueprintReference: reference(2),
    blueprintRevision: 3,
    strategyVersion: 1,
    generatedByAgencyUserReference: reference(3),
    pages,
    generatedAt: '2026-08-11T12:00:00.000Z',
  });

  assert.equal(result.strategy.status, 'DRAFT');
  assert.equal(result.briefs.length, 17);
  assert.equal(result.briefs.every(brief => brief.status === 'DRAFT'), true);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.strategy.provenance.researchEvidenceReferences, []);
  assert.equal(result.strategy.provenance.providerKey, 'ks-os-governed-draft');
  assert.equal(new Set(result.briefs.map(brief => brief.blueprintPageReference)).size, 17);
  assert.equal(new Set(result.briefs.map(brief => brief.pageReference)).size, 17);

  const findings = validateSearchIntelligencePlan({
    strategy: result.strategy,
    briefs: result.briefs,
    evidence: result.evidence,
    plannedPages: result.briefs.map(brief => ({
      blueprintPageReference: brief.blueprintPageReference,
      pageReference: brief.pageReference,
      pageType: brief.pageType,
    })),
  });
  assert.equal(findings.some(finding => [
    'PAGE_SEO_BRIEF_MISSING',
    'PAGE_SEO_BRIEF_BINDING_MISMATCH',
    'INTERNAL_LINK_TARGET_NOT_PLANNED',
    'ORPHAN_PAGE',
    'KEYWORD_CANNIBALISATION',
  ].includes(finding.code)), false);
  assert.equal(findings.some(finding => finding.code === 'SEARCH_STRATEGY_NOT_APPROVED'), true);
  assert.equal(findings.some(finding => finding.code === 'PAGE_SEO_BRIEF_NOT_APPROVED'), true);
  assert.equal(findings.some(finding => finding.code === 'SEARCH_INTELLIGENCE_RESEARCH_REQUIRED'), true);
  assert.throws(
    () => assertSearchIntelligenceResearchApprovable(result),
    (cause: unknown) => cause instanceof Error
      && (cause as Error & { code?: string }).code === 'SEARCH_INTELLIGENCE_RESEARCH_REQUIRED',
  );
});
