import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CreateProvisioningDraftSchema,
  PROVISIONING_STEPS,
  StartProvisioningRunSchema,
  assertProvisioningTransition,
  canTransitionProvisioning,
  canonicalStepIdempotencyKey,
  combinedReadiness,
  evaluateProvisioningReadiness,
  provisioningIdentity,
  provisioningIsTerminal,
  toSafeProvisioningDto,
} from '../src/index.js';

const reference = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, '0')}`;
const draft = {
  productionBriefReference: reference(1),
  planVersionReference: reference(2),
  workspace: { name: 'KS Studio', subdomain: 'ks-studio', timezone: 'Europe/London', currency: 'GBP' },
  templateVersionReference: reference(3),
  pagePlan: { requestedPageTypes: ['HOME', 'SERVICE_HUB', 'BOOKING'], preferredLayoutReferences: {} },
  paymentPreference: { allowPayLater: true, onlinePaymentsRequested: false, depositCollectionRequested: false },
};
const ready = {
  productionBriefLocked: true, productionBriefReady: true, planResolved: true,
  entitlementPageLimit: 8, requestedMarketingPageCount: 4,
  approvedTemplate: true, templateLicensed: true,
  locationCount: 1, approvedRemoteServiceConfiguration: false,
  bookableServiceCount: 1, eligibleStaffCount: 1, staffRequired: true,
  validAvailability: true, bookingConfigurationPresent: true,
  nativeBookingOnly: true, validBookingPath: true, requiredFormsPresent: true,
  paymentStatus: 'READY' as const, payLaterAllowed: true,
};

describe('provisioning input contracts', () => {
  it('accepts a controlled provisioning draft', () => assert.equal(CreateProvisioningDraftSchema.safeParse(draft).success, true));
  for (const invalid of [
    { ...draft, tenantId: reference(99) },
    { ...draft, workspace: { ...draft.workspace, subdomain: 'Invalid Host!' } },
    { ...draft, workspace: { ...draft.workspace, currency: 'gbp' } },
    { ...draft, pagePlan: { ...draft.pagePlan, requestedPageTypes: ['ARBITRARY_PAGE'] } },
    { ...draft, paymentPreference: { ...draft.paymentPreference, provider: 'EXTERNAL' } },
  ]) {
    it('rejects an untrusted or uncontrolled draft field', () => assert.equal(CreateProvisioningDraftSchema.safeParse(invalid).success, false));
  }
  it('requires a durable client idempotency key', () => {
    assert.equal(StartProvisioningRunSchema.safeParse({ provisioningDraftReference: reference(1), idempotencyKey: 'short' }).success, false);
    assert.equal(StartProvisioningRunSchema.safeParse({ provisioningDraftReference: reference(1), idempotencyKey: 'agency-ui:stable-key-123' }).success, true);
  });
  it('defines the complete ordered provisioning ledger', () => {
    assert.equal(PROVISIONING_STEPS.length, 25);
    assert.equal(PROVISIONING_STEPS[0], 'VALIDATE_DRAFT');
    assert.equal(PROVISIONING_STEPS.at(-1), 'RECORD_AUDIT');
  });
});

describe('provisioning lifecycle', () => {
  const valid = [
    ['QUEUED', 'PROVISIONING_TENANT'], ['PROVISIONING_TENANT', 'PROVISIONING_BUSINESS'],
    ['PROVISIONING_BUSINESS', 'PROVISIONING_SERVICES'], ['PROVISIONING_SERVICES', 'PROVISIONING_STAFF'],
    ['PROVISIONING_STAFF', 'PROVISIONING_AVAILABILITY'], ['PROVISIONING_AVAILABILITY', 'PROVISIONING_BOOKING'],
    ['PROVISIONING_BOOKING', 'PROVISIONING_FORMS'], ['PROVISIONING_FORMS', 'PROVISIONING_PAYMENTS'],
    ['PROVISIONING_PAYMENTS', 'PLANNING_SITE'], ['PLANNING_SITE', 'GENERATING_SITE'],
    ['GENERATING_SITE', 'VALIDATING_SITE'], ['VALIDATING_SITE', 'CREATING_REVIEW'],
    ['CREATING_REVIEW', 'READY'], ['PARTIALLY_FAILED', 'QUEUED'], ['ACTION_REQUIRED', 'QUEUED'],
    ['CANCEL_REQUESTED', 'CANCELLED'],
  ] as const;
  for (const [from, to] of valid) {
    it(`allows ${from} to ${to}`, () => assert.equal(canTransitionProvisioning(from, to), true));
  }
  for (const [from, to] of [['READY', 'QUEUED'], ['CANCELLED', 'QUEUED'], ['QUEUED', 'READY'], ['GENERATING_SITE', 'READY']] as const) {
    it(`rejects ${from} to ${to}`, () => assert.throws(() => assertProvisioningTransition(from, to), { code: 'INVALID_PROVISIONING_TRANSITION' }));
  }
  it('treats only READY and CANCELLED as terminal', () => {
    assert.equal(provisioningIsTerminal('READY'), true);
    assert.equal(provisioningIsTerminal('CANCELLED'), true);
    assert.equal(provisioningIsTerminal('FAILED'), false);
    assert.equal(provisioningIsTerminal('PARTIALLY_FAILED'), false);
  });
});

describe('provisioning readiness', () => {
  it('is ready with canonical booking, approved template, and locked brief', () => assert.equal(evaluateProvisioningReadiness(ready).ready, true));
  const blockers = [
    ['productionBriefLocked', false, 'PRODUCTION_BRIEF_NOT_LOCKED'],
    ['productionBriefReady', false, 'PRODUCTION_BRIEF_NOT_READY'],
    ['planResolved', false, 'PLAN_NOT_RESOLVED'],
    ['requestedMarketingPageCount', 9, 'PAGE_ENTITLEMENT_EXCEEDED'],
    ['approvedTemplate', false, 'TEMPLATE_NOT_APPROVED'],
    ['templateLicensed', false, 'TEMPLATE_LICENCE_INVALID'],
    ['locationCount', 0, 'NO_VALID_LOCATION'],
    ['bookableServiceCount', 0, 'NO_BOOKABLE_SERVICE'],
    ['eligibleStaffCount', 0, 'NO_ELIGIBLE_STAFF'],
    ['validAvailability', false, 'NO_VALID_AVAILABILITY'],
    ['bookingConfigurationPresent', false, 'BOOKING_CONFIGURATION_MISSING'],
    ['nativeBookingOnly', false, 'EXTERNAL_BOOKING_FORBIDDEN'],
    ['validBookingPath', false, 'BOOKING_PATH_INVALID'],
    ['requiredFormsPresent', false, 'REQUIRED_FORM_MISSING'],
  ] as const;
  for (const [key, value, code] of blockers) {
    it(`blocks ${code}`, () => {
      const result = evaluateProvisioningReadiness({ ...ready, [key]: value });
      assert.equal(result.ready, false);
      assert.ok(result.blockingIssues.some(issue => issue.code === code));
    });
  }
  it('permits an approved remote-only business without a physical location', () => {
    assert.equal(evaluateProvisioningReadiness({ ...ready, locationCount: 0, approvedRemoteServiceConfiguration: true }).ready, true);
  });
  it('keeps pay-later provisioning available while payment onboarding needs action', () => {
    const result = evaluateProvisioningReadiness({ ...ready, paymentStatus: 'ACTION_REQUIRED' });
    assert.equal(result.ready, true);
    assert.equal(result.warnings[0].code, 'PAYMENT_ACTION_REQUIRED');
  });
  it('blocks restricted payment state when pay later is unavailable', () => {
    const result = evaluateProvisioningReadiness({ ...ready, paymentStatus: 'RESTRICTED', payLaterAllowed: false });
    assert.ok(result.blockingIssues.some(issue => issue.code === 'PAYMENT_NOT_READY'));
  });
  it('reports publication as not started until publishing has its own live state', () => {
    const result = combinedReadiness({ workspaceReady: true, bookingReady: true, websiteReady: true, reviewReady: true, paymentStatus: 'READY', blockingIssues: [], warnings: [] });
    assert.equal(result.publication, 'NOT_STARTED');
    assert.equal(result.ready, true);
  });
  it('uses canonical booking readiness as proof that a stale provisioning run did create the workspace', () => {
    const result = combinedReadiness({ workspaceReady: false, bookingReady: true, websiteReady: true, reviewReady: true, paymentStatus: 'READY', blockingIssues: [], warnings: [] });
    assert.equal(result.workspace, 'READY');
    assert.equal(result.ready, true);
  });
  it('does not report a partially ready workspace as ready', () => {
    const result = combinedReadiness({ workspaceReady: true, bookingReady: true, websiteReady: false, reviewReady: false, paymentStatus: 'ACTION_REQUIRED', blockingIssues: [], warnings: [] });
    assert.equal(result.ready, false);
    assert.equal(result.website, 'ACTION_REQUIRED');
  });
});

describe('provisioning idempotency and safe output', () => {
  const identityInput = { draftReference: reference(1), productionBriefReference: reference(2), productionBriefDigestSha256: 'a'.repeat(64), idempotencyKey: 'agency-ui:stable-key-123' };
  it('derives a deterministic provisioning identity', () => assert.equal(provisioningIdentity(identityInput), provisioningIdentity(identityInput)));
  it('changes identity when the locked brief digest changes', () => assert.notEqual(provisioningIdentity(identityInput), provisioningIdentity({ ...identityInput, productionBriefDigestSha256: 'b'.repeat(64) })));
  it('derives one stable key per run step', () => {
    assert.equal(canonicalStepIdempotencyKey(reference(1), 'CREATE_SERVICES'), `provisioning:${reference(1)}:CREATE_SERVICES`);
    assert.notEqual(canonicalStepIdempotencyKey(reference(1), 'CREATE_SERVICES'), canonicalStepIdempotencyKey(reference(1), 'CREATE_SITE'));
  });
  it('removes private identifiers and operational secrets recursively', () => {
    const safe = toSafeProvisioningDto({ reference: reference(1), tenantId: 'private', payload: { secret: 'private' }, steps: [{ key: 'READY', internalId: 'private' }] }) as any;
    assert.deepEqual(safe, { reference: reference(1), steps: [{ key: 'READY' }] });
  });
});
