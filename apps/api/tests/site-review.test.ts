import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { capabilitiesForAgencyRole } from '@ks-os/contracts';

const migrationUrl = new URL(
  '../../../packages/database/migrations/20260726090000_phase_15_7a_site_review_workflows.sql',
  import.meta.url,
);
const serviceUrl = new URL('../src/modules/sites/site-review.service.ts', import.meta.url);
const agencyRoutesUrl = new URL('../src/modules/sites/site-review.routes.ts', import.meta.url);
const clientRoutesUrl = new URL('../src/routes/public/site-review.ts', import.meta.url);
const appUrl = new URL('../src/app.ts', import.meta.url);
const emailServiceUrl = new URL('../src/modules/email/email.service.ts', import.meta.url);
const rendererRuntimeUrl = new URL('../../sites/src/lib/runtime.ts', import.meta.url);
const rendererRepositoryUrl = new URL('../../sites/src/lib/repository.ts', import.meta.url);
const manifestUrl = new URL('../../../packages/database/src/manifest.ts', import.meta.url);
const schemaUrl = new URL('../../../packages/database/src/schema.ts', import.meta.url);

const [
  migration,
  service,
  agencyRoutes,
  clientRoutes,
  app,
  emailService,
  rendererRuntime,
  rendererRepository,
  manifest,
  schema,
] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(serviceUrl, 'utf8'),
  readFile(agencyRoutesUrl, 'utf8'),
  readFile(clientRoutesUrl, 'utf8'),
  readFile(appUrl, 'utf8'),
  readFile(emailServiceUrl, 'utf8'),
  readFile(rendererRuntimeUrl, 'utf8'),
  readFile(rendererRepositoryUrl, 'utf8'),
  readFile(manifestUrl, 'utf8'),
  readFile(schemaUrl, 'utf8'),
]);

test('Phase 15.7A migration is additive and preserves the existing approval and change-request aggregates', () => {
  assert.match(migration, /ALTER TABLE site_approvals[\s\S]*ADD COLUMN IF NOT EXISTS review_cycle_id/);
  assert.match(migration, /ALTER TABLE site_change_requests[\s\S]*ADD COLUMN IF NOT EXISTS review_cycle_id/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
  assert.match(schema, /export const siteApprovals/);
  assert.match(schema, /export const siteChangeRequests/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS site_review_change_requests/);
});

test('all new review records have RLS, browser grants revoked and service-role access explicit', () => {
  const tables = [
    'site_review_cycles',
    'site_review_participants',
    'site_review_items',
    'site_review_comments',
    'site_change_request_events',
    'site_fact_verifications',
    'site_approval_decisions',
    'site_review_invitations',
    'site_review_sessions',
    'site_review_activity',
  ];
  for (const table of tables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*FROM anon, authenticated/);
  assert.doesNotMatch(migration, /GRANT .* TO (?:anon|authenticated)/);
  assert.match(migration, /TO service_role/);
});

test('migration pins exact version, generation provenance and immutable content digest', () => {
  for (const field of [
    'site_version_id',
    'generation_run_id',
    'blueprint_id',
    'blueprint_revision',
    'template_version_id',
    'knowledge_pack_id',
    'knowledge_pack_semantic_version',
    'pinned_content_digest_sha256',
    'review_revision',
  ]) assert.match(migration, new RegExp(field));
  assert.match(migration, /SITE_REVIEW_PINNED_CONTEXT_IMMUTABLE/);
  assert.match(migration, /SITE_REVIEW_PROVENANCE_INVALID/);
  assert.match(migration, /SITE_REVIEW_PUBLISHED_VERSION_FORBIDDEN/);
});

test('database lifecycle permits explicit transitions and rejects arbitrary status changes', () => {
  for (const status of [
    'INTERNAL_REVIEW',
    'INTERNAL_CHANGES_REQUIRED',
    'READY_FOR_CLIENT_REVIEW',
    'CLIENT_REVIEW',
    'CLIENT_CHANGES_REQUESTED',
    'CLIENT_APPROVED',
    'AGENCY_FINAL_REVIEW',
    'AGENCY_APPROVED',
    'REJECTED',
    'CANCELLED',
    'SUPERSEDED',
  ]) assert.match(migration, new RegExp(status));
  assert.match(migration, /SITE_REVIEW_TRANSITION_INVALID/);
  assert.match(migration, /SITE_REVIEW_CLIENT_APPROVAL_REQUIRED/);
  assert.match(agencyRoutes, /ReviewTransitionActionSchema|OPEN_INTERNAL_REVIEW/);
  assert.match(service, /SITE_REVIEW_CLIENT_APPROVAL_REQUIRED/);
  assert.doesNotMatch(agencyRoutes, /status:\s*z\.string/);
});

test('cycle cancellation and supersession revoke invitations, sessions and preview JTIs', () => {
  assert.match(migration, /ks_revoke_site_review_access/);
  assert.match(migration, /UPDATE site_review_invitations[\s\S]*status = 'REVOKED'/);
  assert.match(migration, /INSERT INTO site_preview_token_revocations/);
  assert.match(migration, /UPDATE site_review_sessions[\s\S]*revoked_at = now\(\)/);
});

test('comment persistence enforces bounded non-executable text and stable version ownership', () => {
  assert.match(migration, /char_length\(body\) BETWEEN 1 AND 2000/);
  assert.match(migration, /javascript\[\[:space:\]\]\*:/);
  assert.match(migration, /SITE_REVIEW_PAGE_OWNERSHIP_INVALID/);
  assert.match(migration, /SITE_REVIEW_SECTION_OWNERSHIP_INVALID/);
  assert.match(migration, /SITE_REVIEW_COMMENT_PARENT_INVALID/);
  assert.match(migration, /anchor_status[\s\S]*OUTDATED[\s\S]*REQUIRES_REANCHOR/);
});

test('change requests cannot directly mutate content and only use controlled regeneration handlers', () => {
  assert.match(service, /AgencySiteGenerationService/);
  assert.match(service, /\.regenerateSection\(/);
  assert.match(service, /\.regeneratePage\(/);
  assert.match(service, /BoundedRegenerationReasonSchema/);
  assert.match(service, /SITE_REVIEW_CHANGE_REQUEST_UNSAFE/);
  assert.doesNotMatch(agencyRoutes, /site-json|arbitrary-prompt|generic-prompt|\/publish/);
  assert.doesNotMatch(clientRoutes, /regenerate|site-json|template|layout|seo.*patch|publish/i);
});

test('fact verification maps public facts to tenant-owned services, staff, locations and claims', () => {
  for (const code of [
    'SITE_REVIEW_FACT_SOURCE_INVALID',
    'SITE_REVIEW_FACT_GENERATED_CLAIM_INVALID',
  ]) assert.match(service, new RegExp(code));
  assert.match(service, /eq\(services\.tenantId, context\.tenantId\)/);
  assert.match(service, /eq\(users\.tenantId, context\.tenantId\)/);
  assert.match(service, /eq\(locations\.tenantId, context\.tenantId\)/);
  assert.match(service, /UNSUPPORTED', 'PROHIBITED/);
  assert.match(service, /status === 'DISPUTED'[\s\S]*siteChangeRequests/);
});

test('approval decisions are version, revision and digest bound and remain visible after invalidation', () => {
  for (const field of [
    'site_version_id',
    'review_revision',
    'content_digest_sha256',
    'open_blocking_item_count',
    'open_change_request_count',
    'invalidated_at',
    'invalidation_reason',
  ]) assert.match(migration, new RegExp(field));
  assert.match(service, /invalidateApprovals/);
  assert.match(service, /SITE_APPROVAL_INVALIDATED/);
  assert.match(service, /assertReadyForApproval/);
  assert.doesNotMatch(service, /sitePublicationEvents|status:\s*'PUBLISHED'|status:\s*'LIVE'/);
});

test('review readiness covers version, generation, claims, booking, facts, participants and preview', () => {
  for (const signal of [
    'versionComplete',
    'versionSuperseded',
    'generationFailed',
    'openBlockingFindingCount',
    'prohibitedClaimCount',
    'invalidBookingActionCount',
    'externalBookingActionCount',
    'missingRequiredPageCount',
    'missingRequiredSectionCount',
    'disputedRequiredFactCount',
    'unverifiedRequiredFactCount',
    'openRequiredChangeRequestCount',
    'staleApprovalCount',
    'clientApproverPresent',
    'agencyApproverPresent',
    'previewAvailable',
  ]) assert.match(service, new RegExp(signal));
  assert.match(service, /sourceContentDigestSha256/);
  assert.match(migration, /source_content_digest_sha256/);
  assert.match(migration, /site_render_snapshots_version_kind_source_digest_idx/);
  assert.match(
    service,
    /participant\.role === 'CLIENT_APPROVER'[\s\S]*\['INVITED', 'ACTIVE'\]\.includes\(participant\.status\)/,
  );
  assert.match(
    service,
    /factConfirmationRequired[\s\S]*\['CLIENT_APPROVED', 'AGENCY_FINAL_REVIEW', 'AGENCY_APPROVED'\]/,
  );
  assert.match(service, /unverifiedRequiredFactCount: factConfirmationRequired/);
});

test('agency surface includes every bounded Phase 15.7A workflow route', () => {
  const routeSuffixes = [
    'review-cycles',
    'open-internal-review',
    'request-internal-changes',
    'ready-for-client',
    'start-client-review',
    'final-review',
    'approve',
    'reject',
    'cancel',
    'readiness',
    'items',
    'comments',
    'change-requests',
    'regenerate-section',
    'regenerate-page',
    'facts',
    'participants',
    'invite',
    'revoke',
    'preview-session',
    'preview-sessions',
    'approvals',
    'activity',
    'compare',
  ];
  for (const suffix of routeSuffixes) assert.match(agencyRoutes, new RegExp(suffix));
  assert.match(app, /agencySiteReviewRoutes/);
});

test('agency capabilities separate read, management, comment, approval, facts and comparison', () => {
  const platform = capabilitiesForAgencyRole('PLATFORM_OWNER');
  for (const capability of [
    'sites.review.read',
    'sites.review.create',
    'sites.review.manage',
    'sites.review.invite',
    'sites.review.comment',
    'sites.review.resolve',
    'sites.review.approve',
    'sites.review.reject',
    'sites.review.change_requests',
    'sites.review.fact_verification',
    'sites.review.compare',
  ] as const) assert.ok(platform.includes(capability));
  const support = capabilitiesForAgencyRole('SUPPORT_ADMINISTRATOR');
  assert.ok(support.includes('sites.review.read'));
  assert.equal(support.includes('sites.review.approve'), false);
  const fulfilment = capabilitiesForAgencyRole('FULFILMENT_ADMINISTRATOR');
  assert.ok(fulfilment.includes('sites.review.manage'));
  assert.equal(fulfilment.includes('sites.review.approve'), false);
});

test('client review surface is narrowly scoped and derives authority from session context', () => {
  for (const route of [
    '/session',
    '/site',
    '/pages',
    '/comments',
    '/change-requests',
    '/facts',
    '/summary',
    '/request-changes',
    '/approve',
    '/reject',
    '/compare',
  ]) assert.match(clientRoutes, new RegExp(route.replace('/', '\\/')));
  assert.match(clientRoutes, /clientContext\(token\)/);
  assert.match(service, /tokenDigestSha256/);
  assert.doesNotMatch(clientRoutes, /tenantReference|tenantId|siteReference.*request\.body|versionReference.*request\.body/);
  assert.doesNotMatch(clientRoutes, /\/publish|\/domains|\/templates|\/generation/);
});

test('client review responses are no-store and noindex and logs redact raw session material', () => {
  assert.match(clientRoutes, /private, no-store, max-age=0/);
  assert.match(clientRoutes, /noindex, nofollow, noarchive/);
  assert.match(app, /req\.headers\["x-site-review-session"\]/);
  assert.match(app, /req\.url/);
  assert.match(app, /\*\.token/);
  assert.match(app, /\*\.invitationToken/);
  assert.match(app, /\*\.sessionToken/);
  assert.match(app, /\*\.previewUrl/);
  assert.doesNotMatch(service, /console\.(?:log|info|debug).*token/i);
});

test('agency reviewers receive expiring cycle-bound preview sessions that they can revoke', () => {
  assert.match(agencyRoutes, /createAgencyPreviewSession/);
  assert.match(agencyRoutes, /revokeAgencyPreviewSession/);
  assert.match(service, /purpose: 'AGENCY_REVIEW'/);
  assert.match(service, /reviewCycleReference: cycle\.publicReference/);
  assert.match(service, /versionReference: cycle\.versionReference/);
  assert.match(service, /previewTokenJti/);
  assert.match(service, /SITE_REVIEW_SESSION_REVOKED/);
  assert.match(agencyRoutes, /private, no-store, max-age=0/);
  assert.match(agencyRoutes, /noindex, nofollow, noarchive/);
});

test('review tokens are digest-only, expiring, revocable and positively bound to renderer sessions', () => {
  assert.match(migration, /token_digest_sha256 text NOT NULL UNIQUE/);
  assert.doesNotMatch(migration, /raw_token|token_plaintext|preview_token text/);
  assert.match(migration, /preview_token_jti uuid NOT NULL UNIQUE/);
  assert.match(service, /issueReviewToken/);
  assert.match(service, /expiresAt/);
  assert.match(rendererRuntime, /payload\.reviewCycleReference/);
  assert.match(rendererRuntime, /isReviewPreviewSessionActive/);
  assert.match(rendererRepository, /siteReviewSessions\.previewTokenJti/);
  assert.match(rendererRepository, /siteReviewCycles\.publicReference/);
  assert.match(rendererRepository, /siteVersions\.publicReference/);
});

test('renderer preview remains no-store, noindex and never canonicalises the preview URL', () => {
  assert.match(rendererRuntime, /NO_STORE/);
  assert.match(rendererRuntime, /preview: true/);
  assert.doesNotMatch(
    rendererRuntime.match(/export async function handlePreviewRequest[\s\S]*?export async function handleSitemapRequest/)?.[0] ?? '',
    /canonicalRedirect/,
  );
});

test('client-safe shaping excludes internal IDs, provider details, prompts and provenance', () => {
  assert.match(service, /toClientSafeValue/);
  assert.doesNotMatch(clientRoutes, /generationFindings|providerKey|modelKey|prompt|provenance|licen[cs]e|infrastructure/i);
  assert.doesNotMatch(clientRoutes, /siteReviewCycles\.id|sitePages\.id|siteSections\.id/);
});

test('client comparison prefers immutable adjacent review snapshots and includes fact changes', () => {
  assert.match(service, /comparePreviousReviewRevision/);
  assert.match(service, /context\.reviewRevision - 1/);
  assert.match(service, /siteRenderSnapshots\.sourceContentDigestSha256/);
  assert.match(service, /validatePublishedSnapshot/);
  assert.match(service, /fromReviewRevision/);
  assert.match(service, /targetType === 'FACT'/);
  assert.match(service, /targetType !== 'GENERATION_FINDING'/);
  assert.match(service, /findingRows\.map/);
});

test('invitations and reminders use the existing outbox with idempotency and late cancellation checks', () => {
  assert.match(service, /this\.email\.enqueueEmail/);
  assert.match(service, /site-review-invitation/);
  assert.match(service, /site-review-notification/);
  assert.match(service, /site-review-invite:\$\{cycle\.publicReference\}/);
  assert.match(service, /:reminder:1/);
  assert.match(emailService, /site_review_invitation/);
  assert.match(emailService, /SITE_REVIEW_NOTIFICATION_NO_LONGER_APPLICABLE/);
  assert.match(emailService, /siteReviewCycles\.status/);
  assert.match(emailService, /deriveReviewInvitationToken/);
  assert.match(service, /\['QUEUED', 'SENT', 'OPENED', 'ACCEPTED'\]/);
  assert.match(service, /includeReviewLink/);
  assert.doesNotMatch(
    emailService.match(/inArray\(siteReviewCycles\.status,[\s\S]*?\]\)/)?.[0] ?? '',
    /CLIENT_APPROVED|AGENCY_APPROVED|CANCELLED|SUPERSEDED/,
  );
  assert.doesNotMatch(service, /resend\.emails\.send/);
});

test('outbox data stores safe references while raw invitation token is derived only during rendering', () => {
  const enqueueBlock = service.match(/templateKey: 'site-review-invitation'[\s\S]*?relatedEntityId: invitation\.id/)?.[0] ?? '';
  assert.match(enqueueBlock, /invitationReference/);
  assert.match(enqueueBlock, /reviewReference/);
  assert.doesNotMatch(enqueueBlock, /invitationToken|sessionToken|tokenDigest/);
  assert.match(emailService, /const token = deriveReviewInvitationToken/);
});

test('review audit and activity include required safe event names without comment bodies', () => {
  for (const event of [
    'SITE_REVIEW_CYCLE_CREATED',
    'SITE_REVIEW_INTERNAL_STARTED',
    'SITE_REVIEW_INTERNAL_CHANGES_REQUESTED',
    'SITE_REVIEW_READY_FOR_CLIENT',
    'SITE_REVIEW_CLIENT_STARTED',
    'SITE_REVIEW_CLIENT_APPROVED',
    'SITE_REVIEW_CLIENT_REJECTED',
    'SITE_REVIEW_CLIENT_CHANGES_REQUESTED',
    'SITE_REVIEW_AGENCY_APPROVED',
    'SITE_REVIEW_REJECTED',
    'SITE_REVIEW_CANCELLED',
    'SITE_REVIEW_SUPERSEDED',
    'SITE_REVIEW_PARTICIPANT_ADDED',
    'SITE_REVIEW_INVITATION_SENT',
    'SITE_REVIEW_INVITATION_REVOKED',
    'SITE_REVIEW_COMMENT_ADDED',
    'SITE_REVIEW_COMMENT_RESOLVED',
    'SITE_CHANGE_REQUEST_CREATED',
    'SITE_CHANGE_REQUEST_ACCEPTED',
    'SITE_CHANGE_REQUEST_REJECTED',
    'SITE_CHANGE_REQUEST_RESOLVED',
    'SITE_FACT_CONFIRMED',
    'SITE_FACT_DISPUTED',
    'SITE_APPROVAL_INVALIDATED',
  ]) assert.match(service, new RegExp(event));
  assert.doesNotMatch(service, /metadata:\s*\{[^}]*body|safeMetadataJson:\s*\{[^}]*description/s);
});

test('review decisions and activity cannot be deleted, while invalidation remains auditable', () => {
  assert.match(migration, /site_change_request_events_append_only/);
  assert.match(migration, /site_approval_decisions_no_delete/);
  assert.match(migration, /site_review_activity_append_only/);
  assert.match(migration, /site_approval_decisions[\s\S]*invalidated_at/);
});

test('migration ordering is registered after Phase 15.6C without applying it', () => {
  assert.match(manifest, /20260726090000_phase_15_7a_site_review_workflows\.sql/);
  assert.match(manifest, /order: 34/);
  const phase156 = manifest.indexOf('20260725180000_phase_15_6c_generation_runtime.sql');
  const phase157 = manifest.indexOf('20260726090000_phase_15_7a_site_review_workflows.sql');
  assert.ok(phase157 > phase156);
});

test('Phase 15.7A contains no publishing, infrastructure provider, external booking or general CMS endpoint', () => {
  const combined = `${migration}\n${service}\n${agencyRoutes}\n${clientRoutes}`;
  assert.doesNotMatch(combined, /Vercel|Cloudflare|IONOS|Plausible|PostHog|Search Console/i);
  assert.doesNotMatch(combined, /sitePublicationEvents|PREPARE_PUBLICATION|PUBLISH_SITE|status:\s*'PUBLISHED'/);
  assert.doesNotMatch(combined, /\/publish|generic.*site.*json|arbitrary.*html|arbitrary.*css|arbitrary.*javascript/i);
  assert.doesNotMatch(combined, /calendly.*client|fresha.*client|external booking integration/i);
});
