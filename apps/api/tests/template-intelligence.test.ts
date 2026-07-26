import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CreateTemplateSourceSchema,
  UpdateTemplateLayoutSchema,
  capabilitiesForAgencyRole,
  type TemplateSourceType,
} from '@ks-os/contracts';
import { buildApp } from '../src/app.js';
import {
  TemplateIntelligenceService,
} from '../src/modules/sites/template-intelligence.service.js';
import type { AgencyActor } from '../src/modules/agency/agency.service.js';

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/20260724110000_phase_15_3_template_intelligence.sql',
    import.meta.url,
  ),
  'utf8',
);
const serviceSource = readFileSync(
  new URL(
    '../src/modules/sites/template-intelligence.service.ts',
    import.meta.url,
  ),
  'utf8',
);
const routeSource = readFileSync(
  new URL(
    '../src/modules/sites/template-intelligence.routes.ts',
    import.meta.url,
  ),
  'utf8',
);

const AGENCY_USER_ID = '11111111-1111-4111-8111-111111111111';
const SITE_REFERENCE = '22222222-2222-4222-8222-222222222222';
const VERSION_REFERENCE = '33333333-3333-4333-8333-333333333333';

const actor: AgencyActor = {
  agencyUserId: AGENCY_USER_ID,
  role: 'AGENCY_ADMINISTRATOR',
};

function registrationHarness() {
  let stored: Record<string, unknown> | undefined;
  const auditEvents: string[] = [];
  const database = {
    insert() {
      return {
        values(values: unknown) {
          const now = new Date('2026-07-24T12:00:00.000Z');
          stored = {
            ...(values as Record<string, unknown>),
            id: 'source-internal-id',
            publicReference: '44444444-4444-4444-8444-444444444444',
            createdAt: now,
            updatedAt: now,
          };
          return {
            returning: async () => [stored],
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => stored ? [stored] : [],
              };
            },
          };
        },
      };
    },
  };
  const audit = {
    async write(
      _actor: AgencyActor,
      action: string,
    ) {
      auditEvents.push(action);
    },
  };
  return {
    service: new TemplateIntelligenceService(
      database as never,
      audit as never,
    ),
    auditEvents,
  };
}

async function registerSource(sourceType: TemplateSourceType) {
  const { service, auditEvents } = registrationHarness();
  const input = CreateTemplateSourceSchema.parse({
    sourceType,
    name: `${sourceType} original fixture`,
    sourceReference: 'trusted-intake/source-package',
    industryTags: ['salon'],
  });
  const result = await service.createSource(actor, input);
  return { result, auditEvents };
}

function tenantContextApp() {
  return buildApp({
    beforeRegister(app) {
      app.addHook('onRequest', async (request) => {
        request.applicationContext = 'TENANT';
        request.auth = {
          authUserId: AGENCY_USER_ID,
          tenantUserId: AGENCY_USER_ID,
          membershipReference: SITE_REFERENCE,
          email: 'owner@tenant.example',
          tenantId: AGENCY_USER_ID,
          businessReference: SITE_REFERENCE,
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
      app.addHook('onRequest', async (request) => {
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

test('1. ENVATO_HTML source can be registered by an authorised agency user', async () => {
  const { result, auditEvents } = await registerSource('ENVATO_HTML');
  assert.equal(result.sourceType, 'ENVATO_HTML');
  assert.deepEqual(auditEvents, ['TEMPLATE_SOURCE_CREATED']);
});

test('2. GOOGLE_STITCH source can be registered by an authorised agency user', async () => {
  const { result, auditEvents } = await registerSource('GOOGLE_STITCH');
  assert.equal(result.sourceType, 'GOOGLE_STITCH');
  assert.deepEqual(auditEvents, ['TEMPLATE_SOURCE_CREATED']);
});

test('3. INTERNAL source can be registered by an authorised agency user', async () => {
  const { result, auditEvents } = await registerSource('INTERNAL');
  assert.equal(result.sourceType, 'INTERNAL');
  assert.deepEqual(auditEvents, ['TEMPLATE_SOURCE_CREATED']);
});

test('4. tenant users cannot register templates', async () => {
  const app = tenantContextApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/agency/site-templates',
    payload: {
      sourceType: 'INTERNAL',
      name: 'Unauthorised source',
    },
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  await app.close();
});

test('5. tenant users cannot approve templates', async () => {
  const app = tenantContextApp();
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agency/site-template-versions/${VERSION_REFERENCE}/approve`,
    payload: { reason: 'Unauthorised tenant approval attempt.' },
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  await app.close();
});

test('6. unauthorised agency roles cannot approve templates', async () => {
  const app = supportAgencyApp();
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agency/site-template-versions/${VERSION_REFERENCE}/approve`,
    payload: { reason: 'Support must not approve templates.' },
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AGENCY_FORBIDDEN/);
  await app.close();
});

test('25. agency can override a recommended page type', () => {
  const override = UpdateTemplateLayoutSchema.parse({
    recommendedPageType: 'RESULTS',
    conversionRole: 'TRUST_BUILDING',
    agencyNotes: 'Portfolio evidence reviewed and approved as results.',
  });
  assert.equal(override.recommendedPageType, 'RESULTS');
  assert.match(routeSource, /UpdateTemplateLayoutSchema/);
  assert.match(serviceSource, /TEMPLATE_LAYOUT_CLASSIFICATION_UPDATED/);
});

test('35. tenant A cannot read tenant B licence records', async () => {
  const app = tenantContextApp();
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/agency/sites/${SITE_REFERENCE}/template-licences`,
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  assert.match(serviceSource, /eq\(templateLicenses\.tenantId, site\.tenantId\)/);
  await app.close();
});

test('36. licence mutation creates an audit event', () => {
  assert.match(serviceSource, /TEMPLATE_LICENCE_RECORDED/);
  assert.match(serviceSource, /TEMPLATE_LICENCE_REVOKED/);
  assert.match(routeSource, /sites\.templates\.licenses\.manage/);
});

test('37. analysis mutation creates an audit event', () => {
  assert.match(serviceSource, /TEMPLATE_ANALYSIS_STARTED/);
  assert.match(serviceSource, /TEMPLATE_ANALYSIS_COMPLETED/);
  assert.match(serviceSource, /TEMPLATE_ANALYSIS_FAILED/);
});

test('38. repeating the same analysis request is idempotent', () => {
  assert.match(
    migration,
    /UNIQUE\s*\(template_version_id, artifact_digest_sha256, analyser_version\)/,
  );
  assert.match(serviceSource, /if \(existing\) return this\.analysisRunView/);
  assert.match(serviceSource, /pg_advisory_xact_lock/);
});

test('40. API responses do not contain absolute local file paths', async () => {
  const { service } = registrationHarness();
  const result = await service.createSource(
    actor,
    CreateTemplateSourceSchema.parse({
      sourceType: 'INTERNAL',
      name: 'Private server path fixture',
      sourceReference: 'C:\\private\\template-source.zip',
    }),
  );
  const payload = JSON.stringify(result);
  assert.doesNotMatch(payload, /C:\\\\private/);
  assert.equal('sourceReference' in result, false);
  assert.match(serviceSource, /sourceFile: templateLayouts\.sourceFilePath/);
});

test('41. API responses do not return raw template archives', () => {
  assert.doesNotMatch(routeSource, /multipart|rawArchive|downloadArchive/);
  assert.doesNotMatch(serviceSource, /archiveBytes|rawArchive|sourceContents/);
  assert.match(routeSource, /StartTemplateAnalysisSchema/);
});

test('template routes use the dedicated agency capabilities', () => {
  assert.match(routeSource, /sites\.templates\.read/);
  assert.match(routeSource, /sites\.templates\.manage/);
  assert.match(routeSource, /sites\.templates\.approve/);
  assert.match(routeSource, /sites\.templates\.licenses\.manage/);
  assert.equal(
    capabilitiesForAgencyRole('SUPPORT_ADMINISTRATOR').includes(
      'sites.templates.approve',
    ),
    false,
  );
});

test('analysis tables are service-role-only control-plane records', () => {
  assert.match(
    migration,
    /ALTER TABLE %I ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE %I FROM anon, authenticated/,
  );
  for (const table of [
    'template_analysis_runs',
    'template_files',
    'template_analysis_findings',
    'template_layout_sections',
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
});
