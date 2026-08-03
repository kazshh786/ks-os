import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { capabilitiesForAgencyRole } from '@ks-os/contracts';
import { buildApp } from '../src/app.js';

const AGENCY_USER_ID = '11111111-1111-4111-8111-111111111111';
const REFERENCE = '22222222-2222-4222-8222-222222222222';

const urls = {
  migration: new URL('../../../packages/database/migrations/20260726130000_phase_15_7b_unified_provisioning_site_studio.sql', import.meta.url),
  provisioningService: new URL('../src/modules/provisioning/provisioning.service.ts', import.meta.url),
  factService: new URL('../src/modules/provisioning/fact-finding.service.ts', import.meta.url),
  agencyFactRoutes: new URL('../src/modules/provisioning/fact-finding.routes.ts', import.meta.url),
  publicFactRoutes: new URL('../src/routes/public/fact-finding.ts', import.meta.url),
  studioService: new URL('../src/modules/sites/site-studio.service.ts', import.meta.url),
  provisioningWorker: new URL('../../site-worker/src/postgres-provisioning-executor.ts', import.meta.url),
  finalization: new URL('../../site-worker/src/provisioning-finalization.ts', import.meta.url),
  workerHandlers: new URL('../../site-worker/src/handlers.ts', import.meta.url),
  app: new URL('../src/app.ts', import.meta.url),
};
const sources = Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([key, url]) => [key, await readFile(url, 'utf8')])));

function tenantContextApp() {
  return buildApp({
    beforeRegister(app) {
      app.addHook('onRequest', async request => {
        request.applicationContext = 'TENANT';
        request.auth = {
          authUserId: AGENCY_USER_ID, tenantUserId: AGENCY_USER_ID, membershipReference: AGENCY_USER_ID,
          email: 'owner@tenant.example', tenantId: AGENCY_USER_ID, businessReference: AGENCY_USER_ID,
          tenantName: 'Tenant', tenantSubdomain: 'tenant', role: 'owner', permissions: [],
        };
      });
    },
  });
}

function supportAgencyApp() {
  return buildApp({
    beforeRegister(app) {
      app.addHook('onRequest', async request => {
        request.applicationContext = 'AGENCY';
        request.agencyAuth = {
          agencyUserId: AGENCY_USER_ID, agencyUserReference: AGENCY_USER_ID, authUserId: AGENCY_USER_ID,
          email: 'support@agency.example', displayName: 'Support', role: 'SUPPORT_ADMINISTRATOR',
          capabilities: capabilitiesForAgencyRole('SUPPORT_ADMINISTRATOR'), assuranceLevel: 'aal2',
          authSessionId: AGENCY_USER_ID, expiresAt: '2099-07-26T12:00:00.000Z', mfaRequired: false,
        };
      });
    },
  });
}

test('Phase 15.7B migration is additive and contains no destructive data operation', () => {
  assert.doesNotMatch(sources.migration, /DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
  assert.match(sources.migration, /CREATE TABLE IF NOT EXISTS provisioning_runs/);
  assert.match(sources.migration, /CREATE TABLE IF NOT EXISTS production_briefs/);
});

test('all Phase 15.7B private tables enable RLS and revoke browser roles', () => {
  for (const table of [
    'fact_finding_templates', 'fact_finding_questionnaires', 'fact_finding_responses',
    'fact_finding_uploads', 'production_briefs', 'production_brief_facts',
    'provisioning_drafts', 'provisioning_runs', 'provisioning_run_steps',
    'provisioning_activity', 'provisioning_record_links',
  ]) {
    assert.match(sources.migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'i'));
  }
  assert.match(sources.migration, /REVOKE ALL ON TABLE[\s\S]*FROM anon, authenticated/i);
  assert.doesNotMatch(sources.migration, /GRANT .* TO (?:anon|authenticated)/i);
});

test('locked production briefs and started provisioning drafts are database-immutable', () => {
  assert.match(sources.migration, /LOCKED_FOR_PROVISIONING/);
  assert.match(sources.migration, /production_briefs_locked_immutable/);
  assert.match(sources.migration, /ks_validate_provisioning_brief_pin/);
  assert.match(sources.migration, /production_brief_facts_append_only/);
});

test('provisioning run and step identities have database uniqueness guarantees', () => {
  assert.match(sources.migration, /UNIQUE\(tenant_id, idempotency_key\)/);
  assert.match(sources.migration, /UNIQUE\(identity_digest_sha256\)/);
  assert.match(sources.migration, /UNIQUE\(provisioning_run_id, step_key\)/);
  assert.match(sources.migration, /UNIQUE\(provisioning_run_id, record_type, record_public_reference\)/);
});

test('provisioning resolves tenant, plan, template, brief, and site server-side', () => {
  assert.match(sources.provisioningService, /resolveDraftReferences/);
  assert.match(sources.provisioningService, /tenantPlanAssignments/);
  assert.match(sources.provisioningService, /LOCKED_FOR_PROVISIONING/);
  assert.doesNotMatch(sources.provisioningService, /input\.tenantId/);
});

test('worker validates the locked brief snapshot before using approved facts', () => {
  assert.match(sources.provisioningWorker, /assertPinnedPayload/);
  assert.match(sources.provisioningWorker, /factSetDigest !== run\.factSetDigest/);
  assert.match(sources.provisioningWorker, /productionBriefFacts/);
  assert.doesNotMatch(sources.provisioningWorker, /factFindingResponseVersions/);
});

test('worker creates canonical services, locations, staff, eligibility, availability, forms and native booking', () => {
  for (const required of [
    'createLocations', 'createServices', 'createStaff', 'staffServices', 'locationServices',
    'staffSchedules', 'bookingConfiguration', 'formsAndPolicies', 'bookingPages',
  ]) assert.match(sources.provisioningWorker, new RegExp(required));
  assert.match(sources.finalization, /KS_OS_BOOKING/);
});

test('worker rejects ambiguous eligibility instead of inventing cross-record relationships', () => {
  assert.match(sources.provisioningWorker, /must explicitly map eligible services to staff/);
  assert.match(sources.provisioningWorker, /must explicitly map services to locations/);
});

test('PROVISION_WORKSPACE is a durable registered site-worker job', () => {
  assert.match(sources.workerHandlers, /PROVISION_WORKSPACE/);
  assert.match(sources.workerHandlers, /WorkspaceProvisioningJobExecutor/);
  assert.match(sources.provisioningWorker, /pg_advisory_xact_lock/);
});

test('successful generation creates an internal review and private preview but never publishes', () => {
  assert.match(sources.finalization, /siteReviewCycles/);
  assert.match(sources.finalization, /siteReviewSessions/);
  assert.match(sources.finalization, /INTERNAL_PREVIEW/);
  assert.match(sources.finalization, /INTERNAL_REVIEW/);
  assert.doesNotMatch(sources.finalization, /status:\s*'PUBLISHED'|publish\s*\(/i);
});

test('Site Studio resolves native booking destinations on the server', () => {
  assert.match(sources.studioService, /NativeSiteBookingService/);
  assert.match(sources.studioService, /resolveForTenant/);
  assert.match(sources.studioService, /serviceLocations/);
  assert.match(sources.studioService, /staffServiceAssignments/);
});

test('Site Studio reads Phase 15.9 publication state and has no inline publish mutation', () => {
  assert.match(sources.studioService, /sitePublicationPointers/);
  assert.match(sources.studioService, /sitePublicationRuns/);
  assert.doesNotMatch(sources.studioService, /async\s+publish|\.publish\(/i);
});

test('fact-finding invitations use the existing email outbox rather than live delivery', () => {
  assert.match(sources.factService, /emailOutbox/);
  assert.doesNotMatch(sources.factService, /resend\.emails\.send|sendgrid|sendMail\(/i);
});

test('fact-finding exposes bounded agency and session-scoped public routes only', () => {
  assert.match(sources.app, /publicFactFindingRoutes, \{ prefix: '\/api\/v1\/fact-finding' \}/);
  assert.match(sources.app, /agencyFactFindingRoutes, \{ prefix: '\/api\/v1\/agency\/fact-finding' \}/);
  assert.doesNotMatch(sources.publicFactRoutes, /publish|generate.*ai|agency.*notes/i);
});

test('tenant context cannot access agency provisioning, fact-finding, or Site Studio', async () => {
  const app = tenantContextApp();
  for (const request of [
    { method: 'GET' as const, url: `/api/v1/agency/provisioning-drafts/${REFERENCE}` },
    { method: 'GET' as const, url: `/api/v1/agency/fact-finding/questionnaires/${REFERENCE}` },
    { method: 'GET' as const, url: `/api/v1/agency/sites/${REFERENCE}/studio` },
  ]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 403);
    assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  }
  await app.close();
});

test('read-only support agency cannot execute provisioning', async () => {
  const app = supportAgencyApp();
  const response = await app.inject({ method: 'POST', url: '/api/v1/agency/provisioning-runs', payload: { provisioningDraftReference: REFERENCE, idempotencyKey: 'support-cannot-run-1234' } });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AGENCY_FORBIDDEN/);
  await app.close();
});

test('public fact-finding response path must match the controlled question reference', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'PATCH', url: `/api/v1/fact-finding/responses/${REFERENCE}`,
    payload: { questionReference: AGENCY_USER_ID, answer: 'No cross-record addressing', source: 'CLIENT_PROVIDED' },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /FACT_FINDING_RESPONSE_REFERENCE_MISMATCH/);
  await app.close();
});
