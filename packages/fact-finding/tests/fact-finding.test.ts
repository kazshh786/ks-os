import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FactFindingUploadSchema,
  QuestionnaireQuestionSchema,
  assertClientCanSaveResponse,
  assertQuestionCanBeRemoved,
  buildProductionBriefData,
  completionForQuestions,
  createFactFindingToken,
  deriveFactFindingInvitationToken,
  digestFactFindingToken,
  evaluateProductionBriefReadiness,
  questionIsVisible,
  toClientSafeFactFindingDto,
  verifyFactFindingInvitationToken,
} from '../src/index.js';

const reference = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, '0')}`;
const baseQuestion = (overrides: Record<string, unknown> = {}) => QuestionnaireQuestionSchema.parse({
  reference: reference(1),
  key: 'TRADING_NAME',
  label: 'Trading name',
  questionType: 'SHORT_TEXT',
  fieldMapping: 'BUSINESS.TRADING_NAME',
  required: true,
  systemRequired: true,
  publicUseAllowed: true,
  bookingUseAllowed: true,
  generationUseAllowed: true,
  agencyVerificationRequired: true,
  conditions: [],
  options: [],
  displayOrder: 0,
  ...overrides,
});

const readySignals = {
  legalBusinessName: true,
  tradingName: true,
  publicContact: true,
  validLocation: true,
  validRemoteServiceConfiguration: false,
  bookableServiceCount: 1,
  invalidServiceDurationCount: 0,
  invalidServicePriceCount: 0,
  staffRequired: true,
  eligibleStaffCount: 1,
  validAvailability: true,
  bookingPolicyPresent: true,
  requiredFormsPresent: true,
  unverifiedCredentialCount: 0,
  unverifiedTestimonialCount: 0,
  unverifiedResultCount: 0,
  brandDirectionPresent: true,
  requiredAssetMissingCount: 0,
  optionalAssetMissingCount: 0,
  unresolvedClarificationCount: 0,
  unapprovedPublicFactCount: 0,
  unsafeUploadCount: 0,
  approvedFactCount: 12,
  unverifiedFactCount: 0,
  answeredQuestionCount: 12,
  visibleQuestionCount: 12,
};

describe('fact-finding questionnaire policy', () => {
  it('prohibits removal of a system-required question', () => {
    assert.throws(() => assertQuestionCanBeRemoved(baseQuestion()), { code: 'SYSTEM_REQUIRED_QUESTION' });
  });

  it('allows removal of an optional agency-selected question', () => {
    assert.doesNotThrow(() => assertQuestionCanBeRemoved(baseQuestion({ required: false, systemRequired: false })));
  });

  for (const status of ['INVITED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED']) {
    it(`allows client progress while questionnaire is ${status}`, () => {
      assert.doesNotThrow(() => assertClientCanSaveResponse({ questionnaireStatus: status, question: baseQuestion(), answer: 'KS Studio' }));
    });
  }

  for (const status of ['DRAFT', 'SUBMITTED', 'AGENCY_REVIEW', 'APPROVED', 'CANCELLED', 'SUPERSEDED']) {
    it(`rejects client changes while questionnaire is ${status}`, () => {
      assert.throws(() => assertClientCanSaveResponse({ questionnaireStatus: status, question: baseQuestion(), answer: 'Changed' }), { code: 'QUESTIONNAIRE_NOT_EDITABLE' });
    });
  }

  it('rejects an uncontrolled nested answer shape', () => {
    assert.throws(() => assertClientCanSaveResponse({ questionnaireStatus: 'IN_PROGRESS', question: baseQuestion(), answer: { arbitrary: { deeply: true } } }), { code: 'ANSWER_INVALID' });
  });

  const conditionCases = [
    ['EQUALS', 'yes', 'yes', true],
    ['NOT_EQUALS', 'yes', 'no', true],
    ['INCLUDES', 'hair', ['hair', 'beauty'], true],
    ['GREATER_THAN', 10, 11, true],
    ['LESS_THAN', 10, 9, true],
    ['IS_ANSWERED', undefined, 'present', true],
  ] as const;
  for (const [operator, expected, actual, result] of conditionCases) {
    it(`evaluates ${operator} conditional visibility`, () => {
      const controllingReference = reference(2);
      const question = baseQuestion({ conditions: [{ questionReference: controllingReference, operator, ...(operator === 'IS_ANSWERED' ? {} : { value: expected }) }] });
      assert.equal(questionIsVisible(question, new Map([[controllingReference, actual]])), result);
    });
  }

  it('hides a question when any condition fails', () => {
    const controllingReference = reference(2);
    const question = baseQuestion({ conditions: [{ questionReference: controllingReference, operator: 'EQUALS', value: true }] });
    assert.equal(questionIsVisible(question, new Map([[controllingReference, false]])), false);
  });

  it('enforces visible required answers and calculates completion', () => {
    const optional = baseQuestion({ reference: reference(3), key: 'DESCRIPTION', required: false, systemRequired: false, displayOrder: 1 });
    const result = completionForQuestions([baseQuestion(), optional], new Map([[reference(3), { status: 'ANSWERED', answer: 'Description' }]]));
    assert.deepEqual(result.missingRequiredQuestionReferences, [reference(1)]);
    assert.equal(result.complete, false);
    assert.equal(result.completionPercentage, 50);
  });
});

describe('fact-finding upload boundaries', () => {
  const valid = {
    fileName: 'salon.jpg', mimeType: 'image/jpeg', byteSize: 1024,
    digestSha256: 'a'.repeat(64), category: 'LOCATION_PHOTO', publicUsePermission: true,
    aiUsePermission: false, copyrightConfirmed: true, consentStatus: 'CONFIRMED',
  };
  it('accepts an allow-listed image with copyright and consent metadata', () => {
    assert.equal(FactFindingUploadSchema.parse(valid).consentStatus, 'CONFIRMED');
  });
  for (const invalid of [
    { ...valid, mimeType: 'application/x-msdownload' },
    { ...valid, byteSize: 20 * 1024 * 1024 + 1 },
    { ...valid, fileName: '../secret.jpg' },
    { ...valid, copyrightConfirmed: false },
  ]) {
    it(`rejects unsafe upload input ${JSON.stringify(invalid).slice(0, 45)}`, () => {
      assert.equal(FactFindingUploadSchema.safeParse(invalid).success, false);
    });
  }
});

describe('production brief construction', () => {
  const fact = (overrides: Record<string, unknown> = {}) => ({
    responseReference: reference(10), questionnaireReference: reference(11), questionReference: reference(12),
    mapping: 'SERVICE.NAME' as const, dataClassification: 'PUBLIC_FACT' as const, approvedValue: 'Signature Cut', valueDigestSha256: 'b'.repeat(64),
    submittedByReference: reference(13), submittedAt: '2026-07-26T10:00:00.000Z',
    reviewedByReference: reference(14), approvedAt: '2026-07-26T11:00:00.000Z',
    publicUseEligible: true, bookingUseEligible: true, generationUseEligible: true, ...overrides,
  });
  const asset = (overrides: Record<string, unknown> = {}) => ({
    assetReference: reference(20), category: 'LOCATION_PHOTO', digestSha256: 'c'.repeat(64),
    publicUsePermission: true, aiUsePermission: false, consentStatus: 'CONFIRMED',
    agencyReviewStatus: 'APPROVED' as const, ...overrides,
  });

  it('uses exact approved service names in canonical and copy contexts', () => {
    const built = buildProductionBriefData({ facts: [fact()], assets: [] });
    assert.deepEqual(built.data.verifiedFacts['SERVICE.NAME'], ['Signature Cut']);
    assert.equal(built.data.copyContext['SERVICE.NAME'], 'Signature Cut');
  });
  it('excludes facts with no approved use from every generation context', () => {
    const built = buildProductionBriefData({ facts: [fact({ publicUseEligible: false, bookingUseEligible: false, generationUseEligible: false })], assets: [] });
    assert.deepEqual(built.data.verifiedFacts, {});
    assert.deepEqual(built.data.copyContext, {});
    assert.deepEqual(built.data.provenance, []);
  });
  it('excludes PRIVATE_OPERATIONAL and CONSENT values even if eligibility flags are incorrectly asserted', () => {
    const built = buildProductionBriefData({
      facts: [
        fact({ dataClassification: 'PRIVATE_OPERATIONAL', approvedValue: 'private notes' }),
        fact({ responseReference: reference(15), dataClassification: 'CONSENT', approvedValue: true }),
      ],
      assets: [],
    });
    assert.deepEqual(built.data.verifiedFacts, {});
    assert.deepEqual(built.data.copyContext, {});
    assert.deepEqual(built.data.provenance, []);
  });
  it('retains per-fact provenance without copying approved values into provenance', () => {
    const built = buildProductionBriefData({ facts: [fact()], assets: [] });
    assert.equal(built.data.provenance[0].responseReference, reference(10));
    assert.equal('approvedValue' in built.data.provenance[0], false);
  });
  it('produces a deterministic content digest', () => {
    const left = buildProductionBriefData({ facts: [fact()], assets: [asset()] });
    const right = buildProductionBriefData({ facts: [fact()], assets: [asset()] });
    assert.equal(left.contentDigestSha256, right.contentDigestSha256);
    assert.match(left.contentDigestSha256, /^[a-f0-9]{64}$/);
  });
  it('records approved upload usage without inventing a stock-image permission', () => {
    const image = buildProductionBriefData({ facts: [], assets: [asset()] }).data.imageBrief[0];
    assert.equal(image.existingApprovedAsset, true);
    assert.equal(image.stockImagePermitted, false);
    assert.equal(image.aiGeneratedImagePermitted, false);
  });
  it('keeps unapproved assets out of the brief contract', () => {
    const built = buildProductionBriefData({ facts: [], assets: [asset({ agencyReviewStatus: 'PENDING' }) as never] });
    assert.deepEqual(built.data.assetReferences, []);
  });
  it('keeps imagery without publication permission or confirmed consent out of generation', () => {
    const built = buildProductionBriefData({ facts: [], assets: [
      asset({ publicUsePermission: false }),
      asset({ assetReference: reference(21), consentStatus: 'REQUIRED' }),
    ] });
    assert.deepEqual(built.data.assetReferences, []);
    assert.deepEqual(built.data.imageBrief, []);
  });
});

describe('production brief readiness', () => {
  it('is ready only when all blocking signals are satisfied', () => {
    assert.equal(evaluateProductionBriefReadiness(readySignals).readyForProvisioning, true);
  });
  const blockers = [
    ['legalBusinessName', false, 'MISSING_LEGAL_BUSINESS_NAME'],
    ['tradingName', false, 'MISSING_TRADING_NAME'],
    ['publicContact', false, 'MISSING_PUBLIC_CONTACT'],
    ['bookableServiceCount', 0, 'NO_BOOKABLE_SERVICE'],
    ['invalidServiceDurationCount', 1, 'INVALID_SERVICE_DURATION'],
    ['invalidServicePriceCount', 1, 'INVALID_SERVICE_PRICE'],
    ['eligibleStaffCount', 0, 'NO_ELIGIBLE_STAFF'],
    ['validAvailability', false, 'NO_VALID_AVAILABILITY'],
    ['bookingPolicyPresent', false, 'MISSING_BOOKING_POLICY'],
    ['requiredFormsPresent', false, 'MISSING_REQUIRED_FORM'],
    ['unverifiedCredentialCount', 1, 'UNVERIFIED_CREDENTIAL'],
    ['unverifiedTestimonialCount', 1, 'UNVERIFIED_TESTIMONIAL'],
    ['unverifiedResultCount', 1, 'UNVERIFIED_RESULT'],
    ['brandDirectionPresent', false, 'MISSING_BRAND_DIRECTION'],
    ['requiredAssetMissingCount', 1, 'MISSING_REQUIRED_ASSET'],
    ['unresolvedClarificationCount', 1, 'UNRESOLVED_CLARIFICATION'],
    ['unapprovedPublicFactCount', 1, 'UNAPPROVED_PUBLIC_FACT'],
    ['unsafeUploadCount', 1, 'UNSAFE_UPLOAD'],
  ] as const;
  for (const [key, value, code] of blockers) {
    it(`blocks readiness with ${code}`, () => {
      const result = evaluateProductionBriefReadiness({ ...readySignals, [key]: value });
      assert.equal(result.readyForProvisioning, false);
      assert.ok(result.blockingIssues.includes(code));
    });
  }
  it('treats an optional missing asset as a warning', () => {
    const result = evaluateProductionBriefReadiness({ ...readySignals, optionalAssetMissingCount: 1 });
    assert.equal(result.readyForProvisioning, true);
    assert.deepEqual(result.warnings, ['OPTIONAL_ASSET_MISSING']);
  });
});

describe('fact-finding token and DTO security', () => {
  it('round-trips a signed invitation token', () => {
    const secret = 's'.repeat(64);
    const token = deriveFactFindingInvitationToken({ invitationReference: reference(1), questionnaireReference: reference(2), participantReference: reference(3), secret });
    assert.deepEqual(verifyFactFindingInvitationToken(token, secret), { invitationReference: reference(1), questionnaireReference: reference(2), participantReference: reference(3) });
  });
  it('rejects a tampered invitation token', () => {
    const secret = 's'.repeat(64);
    const token = deriveFactFindingInvitationToken({ invitationReference: reference(1), questionnaireReference: reference(2), participantReference: reference(3), secret });
    assert.equal(verifyFactFindingInvitationToken(`${token}x`, secret), null);
  });
  it('creates opaque random session material and one-way digests it', () => {
    const token = createFactFindingToken();
    assert.ok(token.length >= 32);
    assert.match(digestFactFindingToken(token), /^[a-f0-9]{64}$/);
    assert.notEqual(digestFactFindingToken(token), token);
  });
  it('removes internal identifiers, tokens, digests, and storage paths recursively', () => {
    const safe = toClientSafeFactFindingDto({ reference: reference(1), tenantId: 'private', invitationToken: 'private', nested: { storagePath: 'private', label: 'safe' } }) as any;
    assert.deepEqual(safe, { reference: reference(1), nested: { label: 'safe' } });
  });
});
