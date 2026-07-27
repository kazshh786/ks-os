import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserAuditPageResultSchema,
  CreateSiteQualityRunSchema,
  DEFAULT_SITE_QUALITY_POLICY,
  DisabledSiteQualityAiReviewProvider,
  FakeSiteQualityAiReviewProvider,
  SITE_QUALITY_VIEWPORTS,
  SiteQualityAuditTypeSchema,
  assertFindingMayBeWaived,
  checksForAuditType,
  compareQualityRuns,
  evaluatePublicationReadiness,
  findingsFromBrowserResult,
  qualityCheckRegistry,
  toClientSafeQualitySummary,
} from '../src/index.js';

const refs = Array.from({ length: 8 }, (_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const digest = 'a'.repeat(64);

function browserResult(overrides: Record<string, unknown> = {}) {
  return BrowserAuditPageResultSchema.parse({
    pageReference: refs[0],
    path: '/',
    viewport: 'STANDARD_MOBILE',
    httpStatus: 200,
    title: 'A useful page title',
    metaDescription: 'A useful page description.',
    canonicalHref: 'https://example.test/',
    robots: 'noindex, nofollow',
    cacheControl: 'private, no-store',
    xRobotsTag: 'noindex, nofollow, noarchive',
    canonicalUsesPreviewHostname: false,
    htmlLanguage: 'en-GB',
    h1Count: 1,
    mainContentPresent: true,
    structuredDataTypes: ['WebSite', 'Organization'],
    internalLinks: ['/services'],
    brokenInternalLinks: [],
    imageCount: 1,
    imagesMissingAlt: 0,
    imagesMissingDimensions: 0,
    oversizedImageCount: 0,
    horizontalOverflowPixels: 0,
    clippedInteractiveCount: 0,
    obscuredInteractiveCount: 0,
    undersizedTouchTargetCount: 0,
    primaryBookingVisible: true,
    primaryBookingKeyboardReachable: true,
    focusTrapDetected: false,
    externalBookingDestinationCount: 0,
    consoleErrorCount: 0,
    failedCriticalResourceCount: 0,
    accessibilityViolations: [],
    performanceMetrics: [],
    evidenceDigestSha256: digest,
    browserVersion: 'FAKE_BROWSER_V1',
    capturedAt: new Date('2026-07-27T00:00:00.000Z'),
    ...overrides,
  });
}

const readinessBase = {
  qualityRunReference: refs[0],
  qualityRunStatus: 'READY',
  qualityRunGateStatus: 'READY' as const,
  runSiteVersionDigestSha256: digest,
  currentSiteVersionDigestSha256: digest,
  siteVersionComplete: true,
  siteVersionSuperseded: false,
  runStale: false,
  agencyApprovalCurrent: true,
  clientApprovalRequired: false,
  clientApprovalCurrent: true,
  approvalFreshness: 'CURRENT' as const,
  qualityPolicyVersion: DEFAULT_SITE_QUALITY_POLICY.version,
  knowledgePackVersion: '1.0.0',
  findings: [],
  staleWaiverCount: 0,
  unresolvedReviewCount: 0,
  unresolvedFactCount: 0,
  humanReviewIncompleteCount: 0,
};

test('server-owned registry is finite, versioned and includes every quality method', () => {
  const checks = qualityCheckRegistry();
  assert.ok(checks.length >= 25);
  assert.equal(new Set(checks.map(check => check.checkId)).size, checks.length);
  for (const method of [
    'DETERMINISTIC',
    'RENDERED_BROWSER',
    'MIXED',
    'AI_REVIEW',
    'HUMAN_REVIEW',
  ]) {
    assert.ok(checks.some(check => check.validationMethod === method));
  }
  assert.ok(checks.every(check => check.engineVersion === '15.8.0'));
});

test('unknown audit types and browser-submitted policy fields are rejected', () => {
  assert.equal(SiteQualityAuditTypeSchema.safeParse('ARBITRARY').success, false);
  assert.equal(CreateSiteQualityRunSchema.safeParse({
    siteVersionReference: refs[0],
    auditType: 'FULL_SITE_QUALITY',
    reason: 'MANUAL_RECHECK',
    checkDefinitions: [{ allowEverything: true }],
  }).success, false);
});

test('full quality includes critical booking, accessibility and approval checks', () => {
  const ids = new Set(checksForAuditType('FULL_SITE_QUALITY').map(check => check.checkId));
  assert.ok(ids.has('KSQ_BOOKING_NATIVE_ONLY'));
  assert.ok(ids.has('KSQ_A11Y_PRIMARY_KEYBOARD'));
  assert.ok(ids.has('KSQ_REVIEW_APPROVAL_FRESH'));
  assert.ok(ids.has('KSQ_HUMAN_TRUST_REVIEW'));
});

test('all five stable mobile, tablet and desktop viewports are required', () => {
  assert.deepEqual(
    SITE_QUALITY_VIEWPORTS.map(viewport => [viewport.key, viewport.width, viewport.height]),
    [
      ['SMALL_MOBILE', 320, 568],
      ['STANDARD_MOBILE', 390, 844],
      ['TABLET_PORTRAIT', 768, 1024],
      ['DESKTOP', 1440, 900],
      ['WIDE_DESKTOP', 1920, 1080],
    ],
  );
});

test('clean bounded browser evidence creates no finding', () => {
  assert.deepEqual(findingsFromBrowserResult(browserResult(), digest), []);
});

test('render, canonical, no-store and preview-host failures are blocking', () => {
  const findings = findingsFromBrowserResult(browserResult({
    httpStatus: 500,
    mainContentPresent: false,
    canonicalHref: 'https://preview.example.test/wrong',
    canonicalUsesPreviewHostname: true,
    robots: 'index, follow',
    cacheControl: 'public',
    xRobotsTag: null,
  }), digest);
  assert.ok(findings.some(finding => finding.code === 'RENDER_FAILURE'));
  assert.ok(findings.some(finding => finding.code === 'PREVIEW_CANONICAL_LEAK'));
  assert.ok(findings.some(finding => finding.code === 'PREVIEW_INDEXABLE'));
  assert.ok(findings.some(finding => finding.code === 'PREVIEW_CACHE_OR_HEADER_UNSAFE'));
  assert.ok(findings.filter(finding => finding.publicationEffect === 'BLOCK').length >= 4);
});

test('missing H1, broken links and missing structured data produce explicit warnings', () => {
  const findings = findingsFromBrowserResult(browserResult({
    h1Count: 0,
    brokenInternalLinks: ['/missing'],
    structuredDataTypes: [],
  }), digest);
  assert.ok(findings.some(finding => finding.code === 'PRIMARY_HEADING_COUNT_INVALID'));
  assert.ok(findings.some(finding => finding.code === 'BROKEN_INTERNAL_LINK'));
  assert.ok(findings.some(finding => finding.code === 'STRUCTURED_DATA_MISSING'));
});

test('keyboard traps, missing alternatives and mobile overflow are blocking', () => {
  const findings = findingsFromBrowserResult(browserResult({
    focusTrapDetected: true,
    primaryBookingKeyboardReachable: false,
    imagesMissingAlt: 1,
    horizontalOverflowPixels: 40,
    clippedInteractiveCount: 1,
    primaryBookingVisible: false,
  }), digest);
  for (const code of [
    'PRIMARY_JOURNEY_FOCUS_TRAP',
    'CRITICAL_KEYBOARD_FAILURE',
    'IMAGE_ALTERNATIVE_MISSING',
    'RESPONSIVE_LAYOUT_BROKEN',
    'UNUSABLE_BOOKING_FLOW',
  ]) {
    assert.ok(findings.some(finding => finding.code === code));
  }
});

test('client exceptions, oversized images and missing dimensions create explicit lab findings', () => {
  const findings = findingsFromBrowserResult(browserResult({
    consoleErrorCount: 2,
    oversizedImageCount: 1,
    imagesMissingDimensions: 1,
  }), digest);
  for (const code of [
    'CLIENT_SIDE_EXCEPTION',
    'OVERSIZED_IMAGE',
    'IMAGE_DIMENSIONS_MISSING',
  ]) {
    const finding = findings.find(value => value.code === code);
    assert.ok(finding);
    assert.equal(finding.publicationEffect, 'WARNING');
  }
});

test('external booking destinations are non-waivable', () => {
  const [finding] = findingsFromBrowserResult(browserResult({
    externalBookingDestinationCount: 1,
  }), digest).filter(value => value.code === 'EXTERNAL_BOOKING_DESTINATION');
  assert.ok(finding);
  assert.equal(finding.waivable, false);
  assert.throws(() => assertFindingMayBeWaived({
    code: finding.code,
    definitionWaivable: true,
    findingWaivable: true,
    status: 'OPEN',
  }));
});

test('an explicitly permitted warning can be waived while resolved findings cannot', () => {
  assert.doesNotThrow(() => assertFindingMayBeWaived({
    code: 'LAB_PERFORMANCE_WARNING',
    definitionWaivable: true,
    findingWaivable: true,
    status: 'OPEN',
  }));
  assert.throws(() => assertFindingMayBeWaived({
    code: 'LAB_PERFORMANCE_WARNING',
    definitionWaivable: true,
    findingWaivable: true,
    status: 'RESOLVED',
  }));
});

test('a clean exact run can become READY and does not publish', () => {
  const result = evaluatePublicationReadiness(readinessBase);
  assert.equal(result.ready, true);
  assert.equal(result.status, 'READY');
  assert.equal('publicationPerformed' in result, false);
});

test('warnings produce READY_WITH_WARNINGS without becoming blockers', () => {
  const result = evaluatePublicationReadiness({
    ...readinessBase,
    findings: [{
      code: 'LAB_PERFORMANCE_WARNING',
      category: 'PERFORMANCE' as const,
      publicationEffect: 'WARNING' as const,
      waivable: true,
      status: 'OPEN' as const,
    }],
  });
  assert.equal(result.ready, true);
  assert.equal(result.status, 'READY_WITH_WARNINGS');
});

test('stale digest, approval, human review and native booking failures block readiness', () => {
  const result = evaluatePublicationReadiness({
    ...readinessBase,
    currentSiteVersionDigestSha256: 'b'.repeat(64),
    agencyApprovalCurrent: false,
    approvalFreshness: 'STALE',
    humanReviewIncompleteCount: 1,
    findings: [{
      code: 'INVALID_NATIVE_BOOKING',
      category: 'BOOKING_INTEGRITY' as const,
      publicationEffect: 'BLOCK' as const,
      waivable: false,
      status: 'OPEN' as const,
    }],
  });
  assert.equal(result.ready, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockingReasons.some(reason => reason.code === 'SITE_DIGEST_CHANGED'));
  assert.ok(result.blockingReasons.some(reason => reason.code === 'INVALID_NATIVE_BOOKING'));
});

test('AI findings cannot override a deterministic blocker', () => {
  const result = evaluatePublicationReadiness({
    ...readinessBase,
    findings: [{
      code: 'CROSS_TENANT_REFERENCE',
      category: 'PUBLICATION_READINESS' as const,
      publicationEffect: 'BLOCK' as const,
      waivable: false,
      status: 'OPEN' as const,
    }, {
      code: 'AI_REVIEW_CLEAN',
      category: 'TRUST_AND_FACTUAL_INTEGRITY' as const,
      publicationEffect: 'RECOMMENDATION' as const,
      waivable: true,
      status: 'RESOLVED' as const,
    }],
  });
  assert.equal(result.ready, false);
});

test('fake AI provider is deterministic and disabled provider fails closed', async () => {
  const fake = new FakeSiteQualityAiReviewProvider({
    providerKey: 'FAKE',
    modelKey: 'FAKE_V1',
    reviewVersion: '1',
    inputDigestSha256: digest,
    outputDigestSha256: 'b'.repeat(64),
    findings: [],
    humanReviewRequired: true,
  });
  const input = {
    qualityRunReference: refs[0],
    siteVersionDigestSha256: digest,
    knowledgePackDigestSha256: 'b'.repeat(64),
    policyVersion: 'KS_OS_PUBLICATION_POLICY_V1',
    selectedRuleIds: [],
    safePageSummaries: [],
  };
  assert.deepEqual((await fake.review(input)).findings, []);
  await assert.rejects(() => new DisabledSiteQualityAiReviewProvider().review(input));
});

test('same-site comparison detects new, resolved, recurring and severity changes', () => {
  const shared = {
    checkId: 'KSQ_TEST_CHECK',
    code: 'TEST_FINDING',
    status: 'OPEN',
  };
  const result = compareQualityRuns({
    left: {
      reference: refs[0],
      tenantReference: refs[1],
      siteReference: refs[2],
      gateStatus: 'BLOCKED',
      findings: [
        { ...shared, reference: refs[3], severity: 'WARNING' },
        { ...shared, code: 'RESOLVED_FINDING', reference: refs[4], severity: 'WARNING' },
      ],
    },
    right: {
      reference: refs[5],
      tenantReference: refs[1],
      siteReference: refs[2],
      gateStatus: 'READY_WITH_WARNINGS',
      findings: [
        { ...shared, reference: refs[6], severity: 'BLOCKING' },
        { ...shared, code: 'NEW_FINDING', reference: refs[7], severity: 'WARNING' },
      ],
    },
  });
  assert.equal(result.newFindings.length, 1);
  assert.equal(result.resolvedFindings.length, 1);
  assert.equal(result.recurringFindings.length, 1);
  assert.equal(result.severityChanges.length, 1);
  assert.equal(result.publicationReadinessChanged, true);
});

test('comparison rejects cross-tenant and unrelated-site runs', () => {
  for (const changed of ['tenantReference', 'siteReference'] as const) {
    assert.throws(() => compareQualityRuns({
      left: {
        reference: refs[0],
        tenantReference: refs[1],
        siteReference: refs[2],
        gateStatus: 'READY',
        findings: [],
      },
      right: {
        reference: refs[3],
        tenantReference: changed === 'tenantReference' ? refs[4] : refs[1],
        siteReference: changed === 'siteReference' ? refs[5] : refs[2],
        gateStatus: 'READY',
        findings: [],
      },
    }));
  }
});

test('client-safe summary excludes internal and security findings by default', () => {
  const result = toClientSafeQualitySummary({
    status: 'CHANGES_REQUIRED',
    requiredClientActions: ['Confirm opening hours'],
    missingFacts: 1,
    missingAssets: 0,
    bookingStatus: 'READY',
    accessibilityStatus: 'WARNING',
    findings: [{
      reference: refs[0],
      category: 'PUBLICATION_READINESS',
      code: 'CROSS_TENANT_REFERENCE',
      message: 'Internal isolation detail',
      clientVisible: true,
    }, {
      reference: refs[1],
      category: 'ASSET_READINESS',
      code: 'MISSING_CLIENT_ASSET',
      message: 'Please provide a logo.',
      clientVisible: true,
    }],
  });
  assert.equal(result.changesRequiringConfirmation.length, 1);
  assert.equal(result.changesRequiringConfirmation[0]?.code, 'MISSING_CLIENT_ASSET');
  assert.doesNotMatch(JSON.stringify(result), /CROSS_TENANT_REFERENCE/);
});
