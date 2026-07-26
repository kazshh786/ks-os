import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AddReviewParticipantSchema,
  BoundedRegenerationReasonSchema,
  CreateApprovalDecisionSchema,
  CreateChangeRequestSchema,
  CreateCommentSchema,
  CreateReviewCycleSchema,
  FactResponseSchema,
  REVIEW_TRANSITIONS,
  ReviewScopeSchema,
  ReviewTransitionActionSchema,
  SiteReviewPolicyError,
  assertParticipantCan,
  assertReadyForApproval,
  assertReviewTransition,
  assertSafeChangeRequest,
  compareStructuredSiteVersions,
  deriveReviewInvitationToken,
  digestReviewToken,
  evaluateReviewReadiness,
  invalidatedApprovalScopes,
  issueReviewToken,
  participantCan,
  resolveCommentAnchor,
  reviewTransitionTarget,
  summarizeReviewProgress,
  toAgencySafeValue,
  toClientSafeValue,
  tokenDigestMatches,
  validateReviewSession,
  type ComparableSiteVersion,
  type ReadinessSignals,
} from '../src/index.js';

const refs = Array.from({ length: 12 }, (_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const digest = 'a'.repeat(64);

test('review lifecycle exposes every controlled state and expected happy path', () => {
  const path = [
    'DRAFT',
    'INTERNAL_REVIEW',
    'READY_FOR_CLIENT_REVIEW',
    'CLIENT_REVIEW',
    'CLIENT_APPROVED',
    'AGENCY_FINAL_REVIEW',
    'AGENCY_APPROVED',
  ] as const;
  for (let index = 0; index < path.length - 1; index += 1) {
    assert.doesNotThrow(() => assertReviewTransition(path[index]!, path[index + 1]!));
  }
  assert.ok(Object.keys(REVIEW_TRANSITIONS).includes('CLIENT_CHANGES_REQUESTED'));
  assert.ok(Object.keys(REVIEW_TRANSITIONS).includes('SUPERSEDED'));
});

test('invalid lifecycle transitions and arbitrary browser status are rejected', () => {
  assert.throws(
    () => assertReviewTransition('DRAFT', 'AGENCY_APPROVED'),
    (error: unknown) => error instanceof SiteReviewPolicyError
      && error.code === 'SITE_REVIEW_TRANSITION_INVALID',
  );
  assert.equal(ReviewTransitionActionSchema.safeParse('AGENCY_APPROVED').success, false);
  assert.equal(reviewTransitionTarget('OPEN_INTERNAL_REVIEW'), 'INTERNAL_REVIEW');
});

test('active review states support cancellation or supersession without reopening terminal states', () => {
  for (const status of [
    'DRAFT',
    'INTERNAL_REVIEW',
    'CLIENT_REVIEW',
    'CLIENT_APPROVED',
  ] as const) {
    assert.doesNotThrow(() => assertReviewTransition(status, 'CANCELLED'));
    assert.doesNotThrow(() => assertReviewTransition(status, 'SUPERSEDED'));
  }
  assert.throws(() => assertReviewTransition('SUPERSEDED', 'CLIENT_REVIEW'));
});

test('client-optional policy has an explicit lifecycle path to agency final review', () => {
  assert.doesNotThrow(() =>
    assertReviewTransition('READY_FOR_CLIENT_REVIEW', 'AGENCY_FINAL_REVIEW'));
});

test('review scopes are finite and page or section scopes require anchors', () => {
  assert.equal(ReviewScopeSchema.safeParse('FULL_SITE').success, true);
  assert.equal(ReviewScopeSchema.safeParse('ARBITRARY').success, false);
  assert.equal(CreateReviewCycleSchema.safeParse({
    versionReference: refs[0],
    reviewScope: 'PAGE',
  }).success, false);
  assert.equal(CreateReviewCycleSchema.safeParse({
    versionReference: refs[0],
    reviewScope: 'SECTION',
    pageReference: refs[1],
    sectionReference: refs[2],
  }).success, true);
});

test('participant identities are strictly matched to their participant type', () => {
  const base = {
    displayName: 'Reviewer',
    email: 'reviewer@example.test',
    role: 'CLIENT_REVIEWER' as const,
  };
  assert.equal(AddReviewParticipantSchema.safeParse({
    ...base,
    participantType: 'TENANT_USER',
    tenantUserReference: refs[0],
  }).success, true);
  assert.equal(AddReviewParticipantSchema.safeParse({
    ...base,
    participantType: 'TENANT_USER',
    agencyUserReference: refs[0],
  }).success, false);
  assert.equal(AddReviewParticipantSchema.safeParse({
    ...base,
    participantType: 'EXTERNAL_REVIEWER',
    role: 'AGENCY_OWNER',
  }).success, false);
  assert.equal(AddReviewParticipantSchema.safeParse({
    ...base,
    participantType: 'AGENCY_USER',
    agencyUserReference: refs[0],
  }).success, false);
  assert.equal(AddReviewParticipantSchema.safeParse({
    ...base,
    participantType: 'TENANT_USER',
    tenantUserReference: refs[0],
    role: 'AGENCY_REVIEWER',
  }).success, false);
});

test('view-only and fact-verifier participants cannot mutate general review content', () => {
  assert.equal(participantCan('VIEW_ONLY', 'READ'), true);
  assert.equal(participantCan('VIEW_ONLY', 'COMMENT'), false);
  assert.equal(participantCan('FACT_VERIFIER', 'FACT'), true);
  assert.equal(participantCan('FACT_VERIFIER', 'CHANGE_REQUEST'), false);
  assert.throws(() => assertParticipantCan('VIEW_ONLY', 'COMMENT'));
});

test('comments accept bounded plain text and stable structured anchors', () => {
  const parsed = CreateCommentSchema.parse({
    body: 'Please clarify the service duration.',
    anchor: {
      pagePublicReference: refs[0],
      sectionPublicReference: refs[1],
      fieldPath: 'content.items[0].description',
      contentDigest: digest,
      textExcerpt: 'service duration',
      startOffset: 4,
      endOffset: 20,
    },
  });
  assert.equal(parsed.anchor?.fieldPath, 'content.items[0].description');
});

test('comments reject raw HTML, scripts, executable links and oversized text', () => {
  for (const body of [
    '<strong>unsafe</strong>',
    '<script>alert(1)</script>',
    '[click](javascript:alert(1))',
    'iframe this page',
    'x'.repeat(2_001),
  ]) {
    assert.equal(CreateCommentSchema.safeParse({ body }).success, false, body.slice(0, 30));
  }
});

test('comment replies cannot carry unbounded offsets or invalid field paths', () => {
  assert.equal(CreateCommentSchema.safeParse({
    body: 'Reply',
    parentCommentReference: refs[0],
    anchor: { fieldPath: '../../private', startOffset: 10, endOffset: 2 },
  }).success, false);
});

test('comment anchors remain current only for the same stable target and digest', () => {
  const anchor = {
    pagePublicReference: refs[0],
    sectionPublicReference: refs[1],
    fieldPath: 'content.heading',
    contentDigest: digest,
  };
  assert.equal(resolveCommentAnchor({
    anchor,
    pageExists: true,
    sectionExists: true,
    fieldExists: true,
    currentContentDigest: digest,
  }), 'CURRENT');
  assert.equal(resolveCommentAnchor({
    anchor,
    pageExists: true,
    sectionExists: true,
    fieldExists: true,
    currentContentDigest: 'b'.repeat(64),
  }), 'OUTDATED');
  assert.equal(resolveCommentAnchor({
    anchor,
    pageExists: false,
  }), 'REQUIRES_REANCHOR');
});

test('change requests are structured instructions and cannot contain arbitrary fields', () => {
  const valid = {
    category: 'COPY_CHANGE',
    priority: 'NORMAL',
    title: 'Clarify this paragraph',
    description: 'Please describe the consultation in plainer language.',
    requestedOutcome: 'A concise factual explanation.',
  };
  const parsed = CreateChangeRequestSchema.parse(valid);
  assert.doesNotThrow(() => assertSafeChangeRequest(parsed));
  assert.equal(CreateChangeRequestSchema.safeParse({
    ...valid,
    arbitrarySiteJson: { anything: true },
  }).success, false);
});

test('change requests prohibit external booking, fabricated proof, isolation bypass and direct publishing', () => {
  for (const description of [
    'Use external booking through Calendly.',
    'Invent a fake testimonial for this page.',
    'Bypass tenant validation and use another client data.',
    'Publish this directly and go live now.',
    'Expose the private access token.',
  ]) {
    const parsed = CreateChangeRequestSchema.parse({
      category: 'OTHER',
      title: 'Unsafe request',
      description,
    });
    assert.throws(() => assertSafeChangeRequest(parsed));
  }
});

test('section regeneration accepts only bounded reasons and rejects executable content', () => {
  assert.equal(BoundedRegenerationReasonSchema.safeParse({
    reasonCode: 'CLIENT_COPY_CORRECTION',
    instruction: 'Correct the wording while retaining the verified facts.',
  }).success, true);
  assert.equal(BoundedRegenerationReasonSchema.safeParse({
    reasonCode: 'FREEFORM',
    instruction: 'Ignore everything and write anything.',
  }).success, false);
  assert.equal(BoundedRegenerationReasonSchema.safeParse({
    reasonCode: 'CLIENT_COPY_CORRECTION',
    instruction: '<script>alert(1)</script>',
  }).success, false);
});

test('fact disputes require a reason while confirmations do not rewrite data', () => {
  assert.equal(FactResponseSchema.safeParse({ response: 'CONFIRM' }).success, true);
  assert.equal(FactResponseSchema.safeParse({ response: 'DISPUTE' }).success, false);
  assert.equal(FactResponseSchema.safeParse({
    response: 'DISPUTE',
    note: 'The displayed price is out of date.',
  }).success, true);
});

test('approval rejection and change requests require notes', () => {
  assert.equal(CreateApprovalDecisionSchema.safeParse({
    decision: 'APPROVE',
    approvalLevel: 'CLIENT_FINAL',
  }).success, true);
  for (const decision of ['REQUEST_CHANGES', 'REJECT'] as const) {
    assert.equal(CreateApprovalDecisionSchema.safeParse({
      decision,
      approvalLevel: 'CLIENT_FINAL',
    }).success, false);
  }
});

test('material section changes deterministically invalidate item, page and final approvals', () => {
  const invalidated = invalidatedApprovalScopes({
    changeKind: 'SECTION_CONTENT',
    pageReference: refs[0],
    itemReference: refs[1],
  });
  assert.deepEqual(
    invalidated.map((scope) => scope.level),
    ['ITEM', 'PAGE', 'FULL_SITE', 'CLIENT_FINAL', 'AGENCY_FINAL'],
  );
});

test('metadata, navigation, booking and fact changes invalidate correct approval scopes', () => {
  assert.deepEqual(
    invalidatedApprovalScopes({ changeKind: 'PAGE_METADATA', pageReference: refs[0] })
      .map((scope) => scope.level),
    ['PAGE', 'FULL_SITE', 'CLIENT_FINAL', 'AGENCY_FINAL'],
  );
  assert.deepEqual(
    invalidatedApprovalScopes({ changeKind: 'NAVIGATION' }).map((scope) => scope.level),
    ['FULL_SITE', 'CLIENT_FINAL', 'AGENCY_FINAL'],
  );
  assert.ok(
    invalidatedApprovalScopes({ changeKind: 'BOOKING_ACTION', pageReference: refs[0] })
      .some((scope) => scope.level === 'PAGE'),
  );
  assert.ok(
    invalidatedApprovalScopes({ changeKind: 'VERIFIED_FACT', itemReference: refs[1] })
      .some((scope) => scope.level === 'ITEM'),
  );
  assert.deepEqual(invalidatedApprovalScopes({ changeKind: 'OPERATIONAL_ONLY' }), []);
});

const readySignals: ReadinessSignals = {
  versionComplete: true,
  versionSuperseded: false,
  generationFailed: false,
  openBlockingFindingCount: 0,
  prohibitedClaimCount: 0,
  invalidBookingActionCount: 0,
  externalBookingActionCount: 0,
  missingRequiredPageCount: 0,
  missingRequiredSectionCount: 0,
  disputedRequiredFactCount: 0,
  unverifiedRequiredFactCount: 0,
  openRequiredChangeRequestCount: 0,
  staleApprovalCount: 0,
  clientApproverPresent: true,
  agencyApproverPresent: true,
  previewAvailable: true,
  crossTenantReferenceCount: 0,
  openCommentCount: 0,
  openChangeRequestCount: 0,
  disputedFactCount: 0,
  unresolvedFindingCount: 0,
  contentDigest: digest,
};

test('review readiness allows a complete validated version and reports stable counts', () => {
  const readiness = evaluateReviewReadiness(readySignals);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.blockingReasons, []);
  assert.equal(readiness.openBlockingItemCount, 0);
  assert.equal(readiness.versionCompleteness, 'COMPLETE');
  assert.doesNotThrow(() => assertReadyForApproval(readiness));
});

test('every important unsafe readiness signal produces a stable blocking code', () => {
  const cases: Array<[keyof ReadinessSignals, unknown, string]> = [
    ['versionComplete', false, 'VERSION_INCOMPLETE'],
    ['versionSuperseded', true, 'VERSION_SUPERSEDED'],
    ['generationFailed', true, 'GENERATION_FAILED'],
    ['openBlockingFindingCount', 1, 'OPEN_BLOCKING_FINDING'],
    ['prohibitedClaimCount', 1, 'PROHIBITED_CLAIM'],
    ['invalidBookingActionCount', 1, 'INVALID_BOOKING_ACTION'],
    ['externalBookingActionCount', 1, 'EXTERNAL_BOOKING_ACTION'],
    ['missingRequiredPageCount', 1, 'MISSING_REQUIRED_PAGE'],
    ['missingRequiredSectionCount', 1, 'MISSING_REQUIRED_SECTION'],
    ['disputedRequiredFactCount', 1, 'DISPUTED_REQUIRED_FACT'],
    ['unverifiedRequiredFactCount', 1, 'UNVERIFIED_REQUIRED_FACT'],
    ['openRequiredChangeRequestCount', 1, 'OPEN_REQUIRED_CHANGE_REQUEST'],
    ['staleApprovalCount', 1, 'STALE_APPROVAL'],
    ['clientApproverPresent', false, 'MISSING_CLIENT_APPROVER'],
    ['agencyApproverPresent', false, 'MISSING_AGENCY_APPROVER'],
    ['previewAvailable', false, 'PREVIEW_UNAVAILABLE'],
    ['crossTenantReferenceCount', 1, 'CROSS_TENANT_REFERENCE'],
  ];
  for (const [key, value, code] of cases) {
    const readiness = evaluateReviewReadiness({ ...readySignals, [key]: value });
    assert.equal(readiness.ready, false, key);
    assert.ok(readiness.openBlockingItemCount > 0, key);
    assert.ok(readiness.blockingReasons.includes(code as never), key);
    assert.throws(() => assertReadyForApproval(readiness), SiteReviewPolicyError);
  }
});

test('review tokens are cryptographically random and only their digest is persisted', () => {
  const first = issueReviewToken();
  const second = issueReviewToken();
  assert.match(first.token, /^ksr_[A-Za-z0-9_-]{43}$/);
  assert.match(first.digestSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.digestSha256, second.digestSha256);
  assert.equal(first.digestSha256.includes(first.token), false);
  assert.equal(tokenDigestMatches(first.token, first.digestSha256), true);
  assert.equal(tokenDigestMatches(second.token, first.digestSha256), false);
});

test('review session validation binds cycle, site and exact version', () => {
  const issued = issueReviewToken();
  const stored = {
    tokenDigestSha256: issued.digestSha256,
    reviewCycleReference: refs[0]!,
    siteReference: refs[1]!,
    versionReference: refs[2]!,
    participantReference: refs[3]!,
    participantRole: 'CLIENT_APPROVER' as const,
    purpose: 'CLIENT_REVIEW' as const,
    allowedScope: 'FULL_SITE' as const,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  };
  assert.equal(validateReviewSession({
    token: issued.token,
    stored,
    expectedReviewCycleReference: refs[0],
    expectedSiteReference: refs[1],
    expectedVersionReference: refs[2],
    now: new Date('2029-01-01T00:00:00.000Z'),
  }).participantReference, refs[3]);
  for (const mismatch of [
    { expectedReviewCycleReference: refs[4] },
    { expectedSiteReference: refs[4] },
    { expectedVersionReference: refs[4] },
  ]) {
    assert.throws(() => validateReviewSession({
      token: issued.token,
      stored,
      now: new Date('2029-01-01T00:00:00.000Z'),
      ...mismatch,
    }), SiteReviewPolicyError);
  }
});

test('expired and revoked review sessions are rejected', () => {
  const issued = issueReviewToken();
  const base = {
    tokenDigestSha256: issued.digestSha256,
    reviewCycleReference: refs[0]!,
    siteReference: refs[1]!,
    versionReference: refs[2]!,
    participantReference: refs[3]!,
    participantRole: 'CLIENT_REVIEWER' as const,
    purpose: 'CLIENT_REVIEW' as const,
    allowedScope: 'FULL_SITE' as const,
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  };
  assert.throws(() => validateReviewSession({
    token: issued.token,
    stored: base,
    now: new Date('2028-01-01T00:00:00.000Z'),
  }));
  assert.throws(() => validateReviewSession({
    token: issued.token,
    stored: { ...base, expiresAt: new Date('2030-01-01T00:00:00.000Z'), revokedAt: new Date() },
    now: new Date('2028-01-01T00:00:00.000Z'),
  }));
});

test('invitation tokens are keyed, versioned and produce digest-only storage values', () => {
  const token = deriveReviewInvitationToken({
    invitationReference: refs[0]!,
    reviewCycleReference: refs[1]!,
    reviewRevision: 2,
    secret: 's'.repeat(32),
  });
  assert.match(token, /^ksri_/);
  assert.match(digestReviewToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(
    token,
    deriveReviewInvitationToken({
      invitationReference: refs[0]!,
      reviewCycleReference: refs[1]!,
      reviewRevision: 3,
      secret: 's'.repeat(32),
    }),
  );
});

function version(overrides: Partial<ComparableSiteVersion> = {}): ComparableSiteVersion {
  return {
    tenantReference: refs[0]!,
    siteReference: refs[1]!,
    versionReference: refs[2]!,
    pages: [{
      publicReference: refs[3]!,
      slug: 'home',
      displayOrder: 0,
      metadata: { title: 'Home' },
      navigation: { label: 'Home' },
      bookingAction: { type: 'KS_OS_BOOKING', label: 'Book' },
      internalLinks: [],
      structuredDataInputs: [],
      assetReferences: [],
      sections: [{
        publicReference: refs[4]!,
        sectionType: 'HERO',
        displayOrder: 0,
        content: { heading: 'Welcome' },
      }],
    }],
    ...overrides,
  };
}

test('structured version comparison detects added and removed pages', () => {
  const previous = version();
  const added = version({
    versionReference: refs[5],
    pages: [
      ...previous.pages,
      {
        ...previous.pages[0]!,
        publicReference: refs[6]!,
        slug: 'about',
      },
    ],
  });
  assert.equal(compareStructuredSiteVersions(previous, added).summary.ADDED, 1);
  assert.equal(compareStructuredSiteVersions(added, previous).summary.REMOVED, 1);
});

test('structured comparison detects changed metadata, booking, links and section fields', () => {
  const previous = version();
  const current = structuredClone(previous);
  current.versionReference = refs[5]!;
  current.pages[0]!.metadata = { title: 'New home' };
  current.pages[0]!.bookingAction = { type: 'KS_OS_BOOKING', label: 'Book now' };
  current.pages[0]!.internalLinks = [refs[6]];
  current.pages[0]!.sections[0]!.content = { heading: 'Hello' };
  const paths = compareStructuredSiteVersions(previous, current).changes
    .map((change) => change.fieldPath);
  assert.ok(paths.some((path) => path?.startsWith('metadata')));
  assert.ok(paths.some((path) => path?.startsWith('bookingAction')));
  assert.ok(paths.some((path) => path?.startsWith('internalLinks')));
  assert.ok(paths.some((path) => path?.startsWith('content')));
});

test('structured comparison detects moved sections and changed slugs', () => {
  const previous = version();
  const current = structuredClone(previous);
  current.versionReference = refs[5]!;
  current.pages[0]!.slug = 'welcome';
  current.pages[0]!.sections[0]!.displayOrder = 4;
  const comparison = compareStructuredSiteVersions(previous, current);
  assert.ok(comparison.changes.some((change) =>
    change.changeType === 'MOVED' && change.targetType === 'SECTION'));
  assert.ok(comparison.changes.some((change) => change.fieldPath === 'slug'));
});

test('structured comparison detects added, removed and changed review facts', () => {
  const previous = version();
  const current = structuredClone(previous);
  previous.facts = [
    {
      matchKey: 'SERVICE_PRICE:service-1',
      publicReference: refs[6]!,
      factType: 'SERVICE_PRICE',
      value: '£50.00',
    },
    {
      matchKey: 'PHONE:tenant',
      publicReference: refs[7]!,
      factType: 'PHONE',
      value: '020 0000 0000',
    },
  ];
  current.facts = [
    {
      matchKey: 'SERVICE_PRICE:service-1',
      publicReference: refs[8]!,
      factType: 'SERVICE_PRICE',
      value: '£55.00',
    },
    {
      matchKey: 'EMAIL:tenant',
      publicReference: refs[9]!,
      factType: 'EMAIL',
      value: 'hello@example.test',
    },
  ];
  const comparison = compareStructuredSiteVersions(previous, current);
  assert.ok(comparison.changes.some((change) =>
    change.targetType === 'FACT'
    && change.changeType === 'CHANGED'
    && change.factReference === refs[8]));
  assert.ok(comparison.changes.some((change) =>
    change.targetType === 'FACT' && change.changeType === 'REMOVED'));
  assert.ok(comparison.changes.some((change) =>
    change.targetType === 'FACT' && change.changeType === 'ADDED'));
});

test('structured comparison detects agency-only generation finding changes', () => {
  const previous = version();
  const current = structuredClone(previous);
  previous.findings = [{
    matchKey: 'BOOKING:INVALID_ACTION:0',
    publicReference: refs[6]!,
    code: 'INVALID_ACTION',
    value: { severity: 'WARNING' },
  }];
  current.findings = [{
    matchKey: 'BOOKING:INVALID_ACTION:0',
    publicReference: refs[7]!,
    code: 'INVALID_ACTION',
    value: { severity: 'ERROR' },
  }];
  const comparison = compareStructuredSiteVersions(previous, current);
  assert.ok(comparison.changes.some((change) =>
    change.targetType === 'GENERATION_FINDING'
    && change.changeType === 'CHANGED'
    && change.findingReference === refs[7]));
});

test('structured comparison rejects cross-tenant and cross-site inputs', () => {
  assert.throws(
    () => compareStructuredSiteVersions(version(), version({ tenantReference: refs[8] })),
    (error: unknown) => error instanceof SiteReviewPolicyError
      && error.code === 'SITE_REVIEW_COMPARISON_CROSS_TENANT',
  );
  assert.throws(
    () => compareStructuredSiteVersions(version(), version({ siteReference: refs[8] })),
    (error: unknown) => error instanceof SiteReviewPolicyError
      && error.code === 'SITE_REVIEW_COMPARISON_CROSS_SITE',
  );
});

test('structured comparison limits large output while retaining a full digest and summary', () => {
  const previous = version();
  const current = structuredClone(previous);
  current.versionReference = refs[5]!;
  current.pages[0]!.metadata = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`field${index}`, index]),
  );
  const comparison = compareStructuredSiteVersions(previous, current, 5);
  assert.equal(comparison.truncated, true);
  assert.equal(comparison.changes.length, 5);
  assert.match(comparison.digestSha256, /^[a-f0-9]{64}$/);
});

test('client-safe shaping removes internal identifiers and provider details recursively', () => {
  const shaped = toClientSafeValue({
    reference: refs[0],
    id: refs[1],
    tenantId: refs[2],
    providerKey: 'gemini',
    promptContents: 'private',
    nested: [{
      pageReference: refs[3],
      internalAgencyNotes: 'private',
      knowledgeProvenance: ['private'],
      title: 'Public',
    }],
  }) as Record<string, unknown>;
  assert.equal(shaped.reference, refs[0]);
  assert.equal('id' in shaped, false);
  assert.equal('tenantId' in shaped, false);
  assert.equal('providerKey' in shaped, false);
  assert.deepEqual(shaped.nested, [{ pageReference: refs[3], title: 'Public' }]);
});

test('agency-safe shaping retains provenance but removes IDs, tokens, prompts and evidence', () => {
  const shaped = toAgencySafeValue({
    reference: refs[0],
    id: refs[1],
    tenantId: refs[2],
    knowledgeProvenance: { packReference: refs[3] },
    promptContents: 'private',
    tokenDigestSha256: digest,
    privateEvidenceReference: refs[4],
  }) as Record<string, unknown>;
  assert.deepEqual(shaped, {
    reference: refs[0],
    knowledgeProvenance: { packReference: refs[3] },
  });
});

test('review summaries are deterministic and bounded', () => {
  assert.deepEqual(summarizeReviewProgress({
    totalItems: 4,
    approvedItems: 2,
    openComments: 3,
    openChangeRequests: 1,
    disputedFacts: 1,
  }), {
    totalItems: 4,
    approvedItems: 2,
    completionPercentage: 50,
    openComments: 3,
    openChangeRequests: 1,
    disputedFacts: 1,
  });
});
