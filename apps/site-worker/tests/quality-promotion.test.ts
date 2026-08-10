import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateV2BrowserPromotionEvidence,
  V2_PROMOTION_VIEWPORTS,
} from '../src/quality-promotion.js';

function completeInput() {
  const expectedPageIds = ['page-1', 'page-2'];
  return {
    expectedPageIds,
    evidence: expectedPageIds.flatMap(pageId => V2_PROMOTION_VIEWPORTS.map(viewport => ({ pageId, viewport }))),
    pageRuns: expectedPageIds.map(pageId => ({
      pageId, status: 'READY', blockingCount: 0, failureCode: null,
      viewportResults: Object.fromEntries(V2_PROMOTION_VIEWPORTS.map(viewport => [viewport, { status: 'READY' }])),
    })),
    preReviewBlockingCount: 0,
  };
}

test('V2 promotion requires every planned page at 390, 768 and 1440 with zero blockers', () => {
  const result = evaluateV2BrowserPromotionEvidence(completeInput());
  assert.equal(result.complete, true);
  assert.equal(result.requiredEvidenceCount, 6);
});

test('one evidence row cannot promote a full site', () => {
  const input = completeInput();
  input.evidence = input.evidence.slice(0, 1);
  assert.equal(evaluateV2BrowserPromotionEvidence(input).complete, false);
});

test('partial viewport failure, missing page run or blocker prevents promotion', () => {
  const partial = completeInput();
  partial.pageRuns[0]!.failureCode = 'QUALITY_CATEGORY_PARTIAL_FAILURE';
  assert.equal(evaluateV2BrowserPromotionEvidence(partial).complete, false);

  const missing = completeInput();
  missing.pageRuns.pop();
  assert.equal(evaluateV2BrowserPromotionEvidence(missing).complete, false);

  const blocked = completeInput();
  blocked.preReviewBlockingCount = 1;
  assert.equal(evaluateV2BrowserPromotionEvidence(blocked).complete, false);
});
