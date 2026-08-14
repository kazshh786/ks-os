export const V2_PROMOTION_VIEWPORTS = [
  'STANDARD_MOBILE',
  'TABLET_PORTRAIT',
  'DESKTOP',
] as const;

export interface BrowserPromotionEvidence {
  pageId: string | null;
  viewport: string | null;
}

export interface BrowserPromotionPageRun {
  pageId: string;
  status: string;
  blockingCount: number;
  failureCode: string | null;
  viewportResults: unknown;
}

export function evaluateV2BrowserPromotionEvidence(input: {
  expectedPageIds: readonly string[];
  evidence: readonly BrowserPromotionEvidence[];
  pageRuns: readonly BrowserPromotionPageRun[];
  preReviewBlockingCount: number;
}) {
  const failures: string[] = [];
  const expected = new Set(input.expectedPageIds);
  const evidencePairs = new Set(input.evidence.map(item => `${item.pageId ?? ''}:${item.viewport ?? ''}`));
  const pageRuns = new Map(input.pageRuns.map(run => [run.pageId, run]));
  if (!expected.size) failures.push('No planned pages were available for browser promotion.');
  if (input.preReviewBlockingCount !== 0) failures.push('Blocking pre-review findings remain.');
  for (const pageId of expected) {
    const pageRun = pageRuns.get(pageId);
    if (!pageRun) {
      failures.push(`Page ${pageId} has no browser page run.`);
      continue;
    }
    if (pageRun.status !== 'READY' || pageRun.failureCode || pageRun.blockingCount !== 0) {
      failures.push(`Page ${pageId} did not complete cleanly.`);
    }
    const viewportResults = pageRun.viewportResults && typeof pageRun.viewportResults === 'object'
      ? pageRun.viewportResults as Record<string, { status?: unknown }>
      : {};
    for (const viewport of V2_PROMOTION_VIEWPORTS) {
      if (viewportResults[viewport]?.status !== 'READY') {
        failures.push(`Page ${pageId} has no successful ${viewport} page result.`);
      }
      if (!evidencePairs.has(`${pageId}:${viewport}`)) {
        failures.push(`Page ${pageId} has no ${viewport} browser evidence.`);
      }
    }
  }
  for (const pageRun of input.pageRuns) {
    if (!expected.has(pageRun.pageId)) failures.push(`Browser page run ${pageRun.pageId} is outside the planned page set.`);
  }
  return {
    complete: failures.length === 0,
    expectedPageCount: expected.size,
    requiredViewportCount: V2_PROMOTION_VIEWPORTS.length,
    requiredEvidenceCount: expected.size * V2_PROMOTION_VIEWPORTS.length,
    failures,
  } as const;
}
