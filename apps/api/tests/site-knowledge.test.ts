import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { capabilitiesForAgencyRole } from '@ks-os/contracts';
import { buildApp } from '../src/app.js';

const AGENCY_USER_ID = '55555555-5555-4555-8555-555555555555';
const PACK_REFERENCE = '66666666-6666-4666-8666-666666666666';

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/20260725130000_phase_15_6b_expert_knowledge_engine.sql',
    import.meta.url,
  ),
  'utf8',
);
const serviceSource = readFileSync(
  new URL('../src/modules/sites/knowledge-pack.service.ts', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(
  new URL('../src/modules/sites/knowledge-pack.routes.ts', import.meta.url),
  'utf8',
);
const cliSource = readFileSync(
  new URL('../src/cli/import-knowledge-pack.ts', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../src/app.ts', import.meta.url),
  'utf8',
);
const siteJobContracts = readFileSync(
  new URL(
    '../../../packages/site-jobs/src/contracts.ts',
    import.meta.url,
  ),
  'utf8',
);
const migrationManifest = readFileSync(
  new URL('../../../packages/database/src/manifest.ts', import.meta.url),
  'utf8',
);

function tenantContextApp() {
  return buildApp({
    beforeRegister(app) {
      app.addHook('onRequest', async request => {
        request.applicationContext = 'TENANT';
        request.auth = {
          authUserId: AGENCY_USER_ID,
          tenantUserId: AGENCY_USER_ID,
          membershipReference: AGENCY_USER_ID,
          email: 'owner@tenant.example',
          tenantId: AGENCY_USER_ID,
          businessReference: AGENCY_USER_ID,
          tenantName: 'Tenant',
          tenantSubdomain: 'tenant',
          role: 'owner',
          permissions: [],
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
          agencyUserId: AGENCY_USER_ID,
          agencyUserReference: AGENCY_USER_ID,
          authUserId: AGENCY_USER_ID,
          email: 'support@agency.example',
          displayName: 'Support administrator',
          role: 'SUPPORT_ADMINISTRATOR',
          capabilities: capabilitiesForAgencyRole('SUPPORT_ADMINISTRATOR'),
          assuranceLevel: 'aal2',
          authSessionId: AGENCY_USER_ID,
          expiresAt: '2026-07-25T12:00:00.000Z',
          mfaRequired: false,
        };
      });
    },
  });
}

test('tenant users cannot create or read internal knowledge packs', async () => {
  const app = tenantContextApp();
  const requests = [
    {
      method: 'POST' as const,
      url: '/api/v1/agency/knowledge-packs',
      payload: {
        name: 'Forbidden tenant pack',
        semanticVersion: '1.0.0',
        intendedScope: 'PUBLIC_SITE',
      },
    },
    {
      method: 'GET' as const,
      url: '/api/v1/agency/knowledge-packs',
    },
    {
      method: 'GET' as const,
      url: `/api/v1/agency/knowledge-packs/${PACK_REFERENCE}/sources`,
    },
  ];
  for (const request of requests) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 403);
    assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  }
  await app.close();
});

test('read-only agency support cannot approve or activate packs', async () => {
  const app = supportAgencyApp();
  for (const action of ['approve', 'activate']) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/agency/knowledge-packs/${PACK_REFERENCE}/${action}`,
      payload: { reason: 'Only agency governance may perform this action.' },
    });
    assert.equal(response.statusCode, 403);
    assert.match(response.body, /AGENCY_FORBIDDEN/);
  }
  await app.close();
});

test('knowledge capabilities separate read, edit, import and governance', () => {
  const support = capabilitiesForAgencyRole('SUPPORT_ADMINISTRATOR');
  const fulfilment = capabilitiesForAgencyRole('FULFILMENT_ADMINISTRATOR');
  const administrator = capabilitiesForAgencyRole('AGENCY_ADMINISTRATOR');

  assert.ok(support.includes('sites.knowledge.read'));
  assert.equal(support.includes('sites.knowledge.manage'), false);
  assert.ok(fulfilment.includes('sites.knowledge.manage'));
  assert.ok(fulfilment.includes('sites.knowledge.import'));
  assert.equal(fulfilment.includes('sites.knowledge.approve'), false);
  assert.equal(fulfilment.includes('sites.knowledge.activate'), false);
  assert.ok(administrator.includes('sites.knowledge.approve'));
  assert.ok(administrator.includes('sites.knowledge.activate'));
});

test('an authorised agency administrator has the pack-creation path', () => {
  const administrator = capabilitiesForAgencyRole('AGENCY_ADMINISTRATOR');
  assert.ok(administrator.includes('sites.knowledge.manage'));
  assert.match(
    routeSource,
    /app\.post\('\/knowledge-packs'[\s\S]*?sites\.knowledge\.manage/,
  );
  assert.match(serviceSource, /insert\(knowledgePacks\)/);
  assert.match(serviceSource, /KNOWLEDGE_PACK_CREATED/);
});

test('the agency route set exposes the complete governance workflow', () => {
  for (const fragment of [
    '/knowledge-packs',
    '/knowledge-packs/:packReference',
    '/knowledge-packs/:packReference/import',
    '/knowledge-packs/:packReference/imports',
    '/knowledge-packs/:packReference/findings',
    '/knowledge-packs/:packReference/rules',
    '/knowledge-packs/:packReference/rules/:ruleId',
    '/knowledge-packs/:packReference/page-playbooks',
    '/knowledge-packs/:packReference/sources',
    '/knowledge-packs/:packReference/conflicts',
    '/knowledge-packs/:packReference/validate',
    '/knowledge-packs/:packReference/approve',
    '/knowledge-packs/:packReference/activate',
    '/knowledge-packs/:packReference/retire',
    '/knowledge-packs/:packReference/revise',
    '/knowledge-packs/:packReference/compare/:otherPackReference',
  ]) {
    assert.ok(routeSource.includes(fragment), `${fragment} must be registered`);
  }
});

test('knowledge management is mounted only beneath the agency API', () => {
  assert.match(
    appSource,
    /register\(agencyKnowledgePackRoutes,\s*\{\s*prefix: '\/api\/v1\/agency'/,
  );
  assert.doesNotMatch(appSource, /register\(agencyKnowledgePackRoutes,\s*\{\s*prefix: '\/api\/v1\/public'/);
  assert.doesNotMatch(routeSource, /\/public\//);
});

test('knowledge tables use public references, relational applicability and provenance', () => {
  for (const table of [
    'knowledge_packs',
    'knowledge_sources',
    'knowledge_rules',
    'knowledge_rule_page_types',
    'knowledge_rule_section_types',
    'knowledge_rule_conversion_roles',
    'knowledge_rule_sources',
    'knowledge_page_playbooks',
    'knowledge_section_playbooks',
    'knowledge_import_runs',
    'knowledge_import_findings',
    'knowledge_conflicts',
    'knowledge_rejected_rules',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(migration, /public_reference uuid NOT NULL UNIQUE/);
  assert.match(migration, /REFERENCES knowledge_rules\(id\)/);
  assert.match(migration, /REFERENCES knowledge_sources\(id\)/);
});

test('database invariants enforce one active pack and immutable approved content', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX knowledge_packs_one_active_scope_idx[\s\S]*WHERE status = 'ACTIVE'/,
  );
  assert.match(migration, /Invalid knowledge-pack transition/);
  assert.match(migration, /Approved knowledge-pack content is immutable/);
  assert.match(
    migration,
    /OLD\.status = 'APPROVED' AND NEW\.status IN \('ACTIVE', 'RETIRED'\)/,
  );
  assert.match(
    migration,
    /OLD\.status = 'ACTIVE' AND NEW\.status IN \('RETIRED', 'SUPERSEDED'\)/,
  );
});

test('database access is server-only and browser roles are revoked', () => {
  const rlsCount = migration.match(/ENABLE ROW LEVEL SECURITY/g)?.length ?? 0;
  assert.equal(rlsCount, 13);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /TO service_role/);
  assert.doesNotMatch(migration, /CREATE POLICY/);
});

test('activation serialises scope changes and verifies exactly one active row', () => {
  assert.match(serviceSource, /knowledge-active-scope:/);
  assert.match(serviceSource, /pg_advisory_xact_lock/);
  assert.match(serviceSource, /status: 'SUPERSEDED'/);
  assert.match(serviceSource, /active\.length !== 1/);
  assert.match(serviceSource, /KNOWLEDGE_PACK_ACTIVE_INVARIANT_FAILED/);
});

test('approval checks stored validation findings and critical conflicts', () => {
  assert.match(serviceSource, /blocksApproval, true/);
  assert.match(serviceSource, /knowledgeConflicts\.severity, 'CRITICAL'/);
  assert.match(serviceSource, /KNOWLEDGE_PACK_APPROVAL_BLOCKED/);
  assert.match(serviceSource, /content_digest_sha256/);
});

test('imports are transactional, digest-idempotent and require revisions for changes', () => {
  assert.match(serviceSource, /this\.database\.transaction/);
  assert.match(serviceSource, /knowledge-import:/);
  assert.match(serviceSource, /idempotentReplay: true/);
  assert.match(serviceSource, /KNOWLEDGE_PACK_REVISION_REQUIRED/);
  assert.match(serviceSource, /KNOWLEDGE_PACK_REVISION_CREATED/);
});

test('all required knowledge lifecycle audit events are emitted', () => {
  for (const event of [
    'KNOWLEDGE_PACK_CREATED',
    'KNOWLEDGE_PACK_IMPORT_STARTED',
    'KNOWLEDGE_PACK_IMPORT_COMPLETED',
    'KNOWLEDGE_PACK_IMPORT_FAILED',
    'KNOWLEDGE_RULE_UPDATED',
    'KNOWLEDGE_CONFLICT_RESOLVED',
    'KNOWLEDGE_PACK_VALIDATED',
    'KNOWLEDGE_PACK_APPROVED',
    'KNOWLEDGE_PACK_ACTIVATED',
    'KNOWLEDGE_PACK_RETIRED',
    'KNOWLEDGE_PACK_REVISION_CREATED',
  ]) {
    assert.match(serviceSource, new RegExp(event));
  }
  assert.doesNotMatch(serviceSource, /metadata:\s*\{\s*(principle|implementationInstruction|sourceText)/);
});

test('agency responses use safe public shapes without database IDs or source files', () => {
  assert.match(serviceSource, /reference: pack\.publicReference/);
  assert.doesNotMatch(serviceSource, /return\s+\{\s*id:\s*pack\.id/);
  assert.doesNotMatch(serviceSource, /(rawSource|sourceFile|pdfBytes|fileContents)/i);
  assert.doesNotMatch(routeSource, /(rawSource|sourceFile|pdfBytes|fileContents)/i);
});

test('the local import command accepts runtime paths and blocks remote databases by default', () => {
  assert.match(cliSource, /--directory/);
  for (const flag of [
    '--sources',
    '--platform-rules',
    '--expert-rules',
    '--playbooks',
    '--rejected-rules',
    '--validate-only',
  ]) {
    assert.match(cliSource, new RegExp(flag));
  }
  assert.match(cliSource, /Remote database imports are blocked/);
  assert.match(cliSource, /KNOWLEDGE_IMPORT_ALLOW_REMOTE_DEVELOPMENT/);
  assert.match(cliSource, /KNOWLEDGE_IMPORT_ALLOWED_PROJECT_REF/);
  assert.doesNotMatch(cliSource, /validation_report_v3\.md/);
  assert.doesNotMatch(cliSource, /[A-Z]:\\\\Users\\\\/);
});

test('small imports stay synchronous and never place raw content in site-job payloads', () => {
  assert.doesNotMatch(siteJobContracts, /IMPORT_KNOWLEDGE_PACK/);
  assert.doesNotMatch(serviceSource, /siteJobs|enqueueSiteJob/);
  assert.doesNotMatch(serviceSource, /payloadJson/);
});

test('the implementation has no NotebookLM, model-provider or external import dependency', () => {
  const implementation = `${serviceSource}\n${routeSource}\n${cliSource}`;
  assert.doesNotMatch(
    implementation,
    /(notebooklm|gemini|openai|anthropic|claude|google drive|embedding|vector database)/i,
  );
  assert.doesNotMatch(implementation, /\bfetch\s*\(/);
});

test('the additive migration is ordered after Phase 15.6A', () => {
  assert.match(
    migrationManifest,
    /20260725090000_phase_15_6a_site_worker_foundation\.sql',[\s\S]*?order: 31,[\s\S]*?20260725130000_phase_15_6b_expert_knowledge_engine\.sql',[\s\S]*?order: 32/,
  );
});
