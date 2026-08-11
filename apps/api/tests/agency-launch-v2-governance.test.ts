import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  deriveFactFindingInvitationToken,
  digestFactFindingToken,
  verifyFactFindingInvitationToken,
} from '@ks-os/fact-finding';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('discovery invitation material is high entropy, signed and stored only as a digest', () => {
  const references = {
    invitationReference: '10000000-0000-4000-8000-000000000001',
    questionnaireReference: '10000000-0000-4000-8000-000000000002',
    participantReference: '10000000-0000-4000-8000-000000000003',
  };
  const secret = '0'.repeat(64);
  const token = deriveFactFindingInvitationToken({ ...references, secret });

  assert.ok(token.length >= 64);
  assert.deepEqual(verifyFactFindingInvitationToken(token, secret), references);
  assert.equal(verifyFactFindingInvitationToken(`${token.slice(0, -1)}x`, secret), null);
  assert.match(digestFactFindingToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(digestFactFindingToken(token), token);

  const service = read('../src/modules/provisioning/fact-finding.service.ts');
  const email = read('../src/modules/email/email.service.ts');
  const emailSafety = read('../src/modules/email/email-safety.ts');
  assert.match(service, /tokenDigestSha256: digestFactFindingToken\(invitationToken\)/);
  assert.match(email, /deriveFactFindingInvitationToken/);
  assert.match(emailSafety, /requireText\('questionnaireReference'\)/);
  assert.doesNotMatch(emailSafety.slice(emailSafety.indexOf("case 'fact-finding-invitation'")), /requireText\('invitationToken'\)/);
});

test('expired, revoked and cross-tenant discovery access fails closed', () => {
  const service = read('../src/modules/provisioning/fact-finding.service.ts');

  assert.match(service, /row\.invitation\.expiresAt\.getTime\(\) <= Date\.now\(\)/);
  assert.match(service, /isNull\(factFindingSessions\.revokedAt\)/);
  assert.match(service, /row\.expiresAt\.getTime\(\) <= Date\.now\(\)/);
  assert.match(service, /eq\(factFindingInvitations\.tenantId, factFindingQuestionnaires\.tenantId\)/);
  assert.match(service, /eq\(factFindingParticipants\.tenantId, factFindingQuestionnaires\.tenantId\)/);
  assert.match(service, /eq\(factFindingSessions\.tenantId, factFindingQuestionnaires\.tenantId\)/);
  assert.match(service, /eq\(factFindingParticipants\.tenantId, factFindingSessions\.tenantId\)/);
  assert.match(service, /status: 'REVOKED', revokedAt: now/);
});

test('public discovery is rate limited, no-store and noindex', () => {
  const routes = read('../src/routes/public/fact-finding.ts');

  assert.match(routes, /Cache-Control', 'private, no-store, max-age=0/);
  assert.match(routes, /X-Robots-Tag', 'noindex, nofollow, noarchive/);
  assert.equal((routes.match(/rateLimit:/g) || []).length, 8);
  assert.match(routes, /FACT_FINDING_RESPONSE_REFERENCE_MISMATCH/);
});

test('consent is a separately governed tenant record unavailable to browser roles', () => {
  const migration = read('../../../packages/database/migrations/20260811190000_agency_launch_v2.sql');

  assert.match(migration, /CREATE TABLE public\.fact_finding_consent_records/);
  assert.match(migration, /questionnaire_id uuid NOT NULL REFERENCES public\.fact_finding_questionnaires/);
  assert.match(migration, /ALTER TABLE public\.fact_finding_consent_records ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.fact_finding_consent_records FROM anon, authenticated/);
  for (const functionName of [
    'ks_validate_fact_finding_consent_ownership',
    'ks_limit_fact_finding_consent_mutation',
    'ks_prevent_fact_finding_consent_delete',
  ]) {
    const definition = migration.slice(migration.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`));
    assert.match(definition, /LANGUAGE plpgsql\s+SET search_path = public, pg_temp\s+AS \$\$/);
    assert.match(migration, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${functionName}\\(\\) FROM PUBLIC, anon, authenticated`));
  }
  assert.match(migration, /fact-finding consent scope must match its exact response version/);
});

test('provisioning pauses at the human blueprint approval gate', () => {
  const worker = read('../../site-worker/src/postgres-provisioning-executor.ts');
  const approvalGate = worker.slice(
    worker.indexOf('private async approveBlueprint'),
    worker.indexOf('private async generateSite'),
  );

  assert.match(approvalGate, /HUMAN_BLUEPRINT_APPROVAL_REQUIRED/);
  assert.match(approvalGate, /status: 'ACTION_REQUIRED'/);
  assert.doesNotMatch(approvalGate, /siteBlueprints\)\.set\(\{\s*status: 'APPROVED'/);
  assert.match(worker, /step === 'APPROVE_BLUEPRINT'/);
  assert.match(worker, /'ACTION_REQUIRED',\s*\);/);
  assert.match(worker, /draft blueprint requires agency approval/);
});

test('website generation requires the exact approved Search Intelligence revision', () => {
  const generation = read('../src/modules/sites/site-generation.service.ts');

  assert.match(generation, /eq\(siteSearchStrategies\.blueprintId, context\.blueprintId\)/);
  assert.match(generation, /eq\(siteSearchStrategies\.blueprintRevision, context\.blueprintRevision\)/);
  assert.match(generation, /eq\(siteSearchStrategies\.status, 'APPROVED'\)/);
  assert.match(generation, /APPROVED_SEARCH_INTELLIGENCE_REQUIRED/);
  assert.match(generation, /validateSearchIntelligencePlan/);
  assert.match(generation, /siteSearchResearchEvidence/);
  assert.match(generation, /evidence,/);
  assert.match(generation, /filter\(finding => finding\.blocking\)/);
  assert.match(generation, /SEARCH_INTELLIGENCE_NOT_READY/);

  const service = read('../src/modules/sites/search-intelligence.service.ts');
  assert.match(service, /validateSearchIntelligenceResearchReadiness/);
  assert.match(service, /SEARCH_INTELLIGENCE_RESEARCH_REQUIRED/);
});
