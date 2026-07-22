import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_REVIEW_INVITATION_MESSAGE, ReviewInvitationRuleCreateSchema, ReviewReplySchema,
} from '@ks-os/contracts';
import { effectiveCapabilities } from '@ks-os/auth';
import {
  decryptProviderCredentials, deriveProviderReference, deriveReviewInvitationToken, encryptProviderCredentials,
  hashPublicToken, testProviderLink, validateGoogleReviewUrl, validateTrustpilotReviewUrl, validateTrustpilotSourceUrl,
} from '../src/modules/reputation/reputation.security.js';
import {
  evaluateReviewEligibility, providersForMode, reviewInvitationIdempotencyKey, selectScopedConfiguration,
} from '../src/modules/reputation/reputation.policy.js';
import { TrustpilotProvider } from '../src/modules/reputation/reputation.providers.js';

const migration = readFileSync(new URL('../../../packages/database/migrations/20260720170000_phase_10_6_external_reviews.sql', import.meta.url), 'utf8');
const invitationSource = readFileSync(new URL('../src/modules/reputation/review-invitation.service.ts', import.meta.url), 'utf8');
const reputationSource = readFileSync(new URL('../src/modules/reputation/reputation.service.ts', import.meta.url), 'utf8');
const automationRoutesSource = readFileSync(new URL('../src/modules/automations/automation.routes.ts', import.meta.url), 'utf8');
const twilioWebhookSource = readFileSync(new URL('../src/modules/webhooks/twilio/twilio-webhook.routes.ts', import.meta.url), 'utf8');

const eligible = {
  status: 'COMPLETED', tenantActive: true, hasClient: true, isTest: false, isInternal: false,
  explicitlyExcluded: false, channel: 'EMAIL' as const, hasEmail: true, hasSms: false,
  hasCustomerPortal: false,
};

test('completed genuine appointments are eligible without sentiment fields', () => {
  assert.deepEqual(evaluateReviewEligibility({ ...eligible, refunded: true, complaintRecorded: true } as any), { eligible: true, reason: null });
});

test('cancelled, no-show, test and internal appointments are excluded neutrally', () => {
  assert.equal(evaluateReviewEligibility({ ...eligible, status: 'CANCELLED' }).eligible, false);
  assert.equal(evaluateReviewEligibility({ ...eligible, status: 'NO_SHOW' }).eligible, false);
  assert.equal(evaluateReviewEligibility({ ...eligible, isTest: true }).reason, 'TEST_APPOINTMENT');
  assert.equal(evaluateReviewEligibility({ ...eligible, isInternal: true }).reason, 'INTERNAL_APPOINTMENT');
});

test('SMS review requests require explicit marketing opt-in and respect STOP suppression', () => {
  assert.equal(evaluateReviewEligibility({ ...eligible, channel: 'SMS', hasEmail: false, hasSms: true, smsMarketingStatus: 'UNKNOWN' }).eligible, false);
  assert.equal(evaluateReviewEligibility({ ...eligible, channel: 'SMS', hasEmail: false, hasSms: true, smsMarketingStatus: 'OPTED_IN', smsTransactionalStatus: 'OPTED_OUT' }).eligible, false);
  assert.equal(evaluateReviewEligibility({ ...eligible, channel: 'SMS', hasEmail: false, hasSms: true, smsMarketingStatus: 'OPTED_IN', smsTransactionalStatus: 'OPTED_IN' }).eligible, true);
});

test('location-specific configuration wins and fallback is explicit', () => {
  const rows = [{ id: 'tenant', locationId: null }, { id: 'branch', locationId: 'branch-a' }];
  assert.equal(selectScopedConfiguration(rows, 'branch-a')?.id, 'branch');
  assert.equal(selectScopedConfiguration(rows, 'branch-b')?.id, 'tenant');
  assert.equal(selectScopedConfiguration(rows.filter((row) => row.locationId), 'branch-b'), null);
});

test('BOTH always produces equal Google and Trustpilot choices', () => {
  assert.deepEqual(providersForMode('BOTH'), ['GOOGLE', 'TRUSTPILOT']);
});

test('idempotency is deterministic and migration enforces one invitation per experience', () => {
  const key = reviewInvitationIdempotencyKey('tenant', 'appointment', 'BOTH', 3);
  assert.equal(key, reviewInvitationIdempotencyKey('tenant', 'appointment', 'BOTH', 3));
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS review_invitations_one_experience_unique/i);
  assert.match(migration, /tenant_id, appointment_id, provider/i);
  assert.match(invitationSource, /status='QUEUED'[\s\S]+updated_at<=now\(\)-interval '10 minutes'/i);
});

test('Google accepts supported review links and rejects unsafe or unrelated URLs', () => {
  assert.match(validateGoogleReviewUrl('https://g.page/r/example/review'), /^https:/);
  assert.match(validateGoogleReviewUrl('https://search.google.com/local/writereview?placeid=abc123'), /^https:/);
  assert.throws(() => validateGoogleReviewUrl('https://evil.example/review'), /supported Google/i);
  assert.throws(() => validateGoogleReviewUrl('javascript:alert(1)'), /HTTPS|invalid/i);
  assert.throws(() => validateGoogleReviewUrl('https://user:pass@g.page/r/example/review'), /credential-free HTTPS/i);
});

test('Trustpilot accepts supported profile/evaluation URLs and rejects impostors', () => {
  assert.match(validateTrustpilotReviewUrl('https://www.trustpilot.com/review/example.com'), /^https:/);
  assert.match(validateTrustpilotReviewUrl('https://uk.trustpilot.com/evaluate/example.com'), /^https:/);
  assert.throws(() => validateTrustpilotReviewUrl('https://trustpilot.example/review/example.com'), /supported Trustpilot/i);
  assert.match(validateTrustpilotSourceUrl('https://www.trustpilot.com/reviews/507f191e810c19729de860ea'), /^https:/);
  assert.throws(() => validateTrustpilotSourceUrl('https://www.trustpilot.com/evaluate/example.com'), /source link/i);
});

test('manual link testing follows only revalidated provider redirects', async () => {
  const fetcher = async () => new Response(null, { status: 204 });
  assert.equal((await testProviderLink('GOOGLE', 'https://g.page/r/example/review', fetcher as any)).ok, true);
  const unsafeRedirect = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/review' } });
  await assert.rejects(() => testProviderLink('GOOGLE', 'https://g.page/r/example/review', unsafeRedirect as any), /supported Google/i);
});

test('Trustpilot review sync follows official page tokens and preserves provider source links', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', (async (input: string | URL | Request) => {
    const url = String(input); urls.push(url);
    if (url.includes('/reviews/r1/web-links')) return Response.json({ reviewUrl: 'https://www.trustpilot.com/reviews/r1' });
    if (url.includes('/reviews/r2/web-links')) return Response.json({ reviewUrl: 'https://www.trustpilot.com/reviews/r2' });
    if (url.includes('pageToken=next-token')) return Response.json({ reviews: [{ id: 'r2', stars: 4, isVerified: true }] });
    return Response.json({ reviews: [{ id: 'r1', stars: 5, isVerified: false }], nextPageToken: 'next-token' });
  }) as typeof fetch);
  const result = await new TrustpilotProvider().listReviews({ apiKey: 'api-key-value', accessToken: 'access-token-value' }, 'business-unit', 'en-GB');
  assert.deepEqual(result.reviews.map((review) => review.sourceUrl), [
    'https://www.trustpilot.com/reviews/r1', 'https://www.trustpilot.com/reviews/r2',
  ]);
  assert.equal(urls.filter((url) => url.includes('/all-reviews')).length, 2);
  assert.ok(urls.some((url) => url.includes('pageToken=next-token')));
});

test('neutral templates reject ratings gates, incentives, manipulation and HTML', () => {
  const base = { name: 'Review policy', providerMode: 'BOTH', channel: 'EMAIL', delayMinutes: 1440, privateContactEnabled: true };
  assert.equal(ReviewInvitationRuleCreateSchema.parse({ ...base, messageTemplate: DEFAULT_REVIEW_INVITATION_MESSAGE }).providerMode, 'BOTH');
  for (const messageTemplate of ['Leave a five-star review for a free gift. There is no obligation and please share honest feedback.', 'Share a positive review. There is no obligation and we value honest feedback.', '<b>We value your honest feedback.</b> There is no obligation to leave a review.']) {
    assert.equal(ReviewInvitationRuleCreateSchema.safeParse({ ...base, messageTemplate }).success, false);
  }
});

test('reply privacy validation blocks contact, appointment and medical details', () => {
  assert.equal(ReviewReplySchema.safeParse({ reply: 'Thank you for sharing your feedback. We appreciate you taking the time.' }).success, true);
  assert.equal(ReviewReplySchema.safeParse({ reply: 'Please email client@example.com about your treatment.' }).success, false);
});

test('credential envelopes use authenticated encryption and do not contain plaintext', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const envelope = encryptProviderCredentials({ accessToken: 'super-secret-token' }, key);
  assert.doesNotMatch(envelope, /super-secret-token/);
  assert.deepEqual(decryptProviderCredentials(envelope, key), { accessToken: 'super-secret-token' });
  assert.throws(() => decryptProviderCredentials(envelope, Buffer.alloc(32, 8).toString('base64')), /could not be opened/i);
});

test('public invitation tokens are unlinkable, hash-only and deterministic for delivery', () => {
  const secret = 'x'.repeat(32); const invitationId = '8bc7c625-d118-4c98-9db1-5e73387f9c4e';
  const token = deriveReviewInvitationToken(invitationId, secret);
  assert.equal(token, deriveReviewInvitationToken(invitationId, secret));
  assert.equal(hashPublicToken(token).length, 64);
  assert.notEqual(hashPublicToken(token), token);
  assert.doesNotMatch(token, /8bc7c625/);
  assert.match(deriveProviderReference('tenant:appointment:BOTH:v1', secret), /^ksos_[a-f0-9]{32}$/);
});

test('migration enables RLS and revokes browser roles on every reputation table', () => {
  for (const table of ['review_provider_connections','review_provider_location_mappings','review_oauth_states','review_invitation_rules','review_invitations','external_reviews']) assert.match(migration, new RegExp('ALTER TABLE ' + table + ' ENABLE ROW LEVEL SECURITY', 'i'));
  assert.match(migration, /REVOKE ALL[\s\S]+FROM anon, authenticated/i);
});

test('click tracking cannot claim a submitted review and no sensitive provider metadata is sent', () => {
  assert.match(invitationSource, /reviewSubmitted: false/);
  assert.doesNotMatch(invitationSource, /REVIEW_SUBMITTED/);
  assert.doesNotMatch(invitationSource, /medicalNotes|formAnswers|internalNote|treatmentDetails/);
});

test('connection responses remove encrypted credentials and providers never fall back to mock data', () => {
  assert.match(reputationSource, /encryptedCredentialsReference: _secret/);
  assert.doesNotMatch(reputationSource, /mockReview|mockData|fallbackToMock/i);
});

test('staff have no reputation access by default and can only receive explicit read access', () => {
  assert.equal(effectiveCapabilities('staff').some((capability) => capability.startsWith('REPUTATION_')), false);
  const explicitlyGranted = effectiveCapabilities('staff', 'MANAGER', { REPUTATION_VIEW: true, REPUTATION_REPLY: true });
  assert.equal(explicitlyGranted.includes('REPUTATION_VIEW'), true);
  assert.equal(explicitlyGranted.includes('REPUTATION_REPLY'), false);
});

test('background sync and delivery retries reuse the existing automation worker with bounded leases', () => {
  assert.match(automationRoutesSource, /reputation\.syncDueConnections\(\)/);
  assert.match(reputationSource, /last_sync_at<=now\(\)-interval '6 hours'/i);
  assert.match(reputationSource, /last_error_code IS NOT NULL AND updated_at<=now\(\)-interval '15 minutes'/i);
  assert.match(invitationSource, /status='QUEUED'[\s\S]+interval '10 minutes'/i);
});

test('provider callbacks and STOP suppression update review invitations in the same tenant', () => {
  assert.match(twilioWebhookSource, /status:'SUPPRESSED',failureCode:'RECIPIENT_OPTED_OUT'/);
  assert.match(twilioWebhookSource, /eq\(reviewInvitations\.tenantId,client\.tenantId\)/);
});
