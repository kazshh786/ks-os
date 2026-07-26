import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BlueprintGenerationRequestSchema,
  capabilitiesForAgencyRole,
} from '@ks-os/contracts';
import { buildApp } from '../src/app.js';

const SITE_REFERENCE = '33333333-3333-4333-8333-333333333333';
const BLUEPRINT_REFERENCE = '44444444-4444-4444-8444-444444444444';
const AGENCY_USER_ID = '55555555-5555-4555-8555-555555555555';
const TEMPLATE_REFERENCE = '66666666-6666-4666-8666-666666666666';

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/20260724130000_phase_15_4_site_blueprint_engine.sql',
    import.meta.url,
  ),
  'utf8',
);
const serviceSource = readFileSync(
  new URL('../src/modules/sites/site-blueprint.service.ts', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(
  new URL('../src/modules/sites/site-blueprint.routes.ts', import.meta.url),
  'utf8',
);
const legacyRouteSource = readFileSync(
  new URL('../src/modules/sites/site.routes.ts', import.meta.url),
  'utf8',
);

function tenantContextApp() {
  return buildApp({
    beforeRegister(app) {
      app.addHook('onRequest', async (request) => {
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

test('blueprint management endpoints reject tenant contexts', async () => {
  const app = tenantContextApp();
  for (const request of [
    {
      method: 'GET' as const,
      url: `/api/v1/agency/sites/${SITE_REFERENCE}/blueprints`,
    },
    {
      method: 'POST' as const,
      url: `/api/v1/agency/sites/${SITE_REFERENCE}/blueprints/generate`,
      payload: { templateVersionReference: TEMPLATE_REFERENCE },
    },
    {
      method: 'POST' as const,
      url: `/api/v1/agency/sites/${SITE_REFERENCE}/blueprints/${BLUEPRINT_REFERENCE}/approve`,
      payload: { expectedRevision: 1, reason: 'Tenant cannot approve this plan.' },
    },
  ]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 403);
    assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  }
  await app.close();
});

test('read-only support agency role cannot approve a blueprint', async () => {
  const app = supportAgencyApp();
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agency/sites/${SITE_REFERENCE}/blueprints/${BLUEPRINT_REFERENCE}/approve`,
    payload: { expectedRevision: 1, reason: 'Support cannot approve this plan.' },
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AGENCY_FORBIDDEN/);
  await app.close();
});

test('agency capability allocation separates read, manage and approve', () => {
  const support = capabilitiesForAgencyRole('SUPPORT_ADMINISTRATOR');
  const fulfilment = capabilitiesForAgencyRole('FULFILMENT_ADMINISTRATOR');
  const administrator = capabilitiesForAgencyRole('AGENCY_ADMINISTRATOR');
  assert.ok(support.includes('sites.blueprints.read'));
  assert.equal(support.includes('sites.blueprints.manage'), false);
  assert.ok(fulfilment.includes('sites.blueprints.manage'));
  assert.equal(fulfilment.includes('sites.blueprints.approve'), false);
  assert.ok(administrator.includes('sites.blueprints.approve'));
});

test('generation request rejects browser authority over tenant and entitlement data', () => {
  assert.equal(BlueprintGenerationRequestSchema.safeParse({
    templateVersionReference: TEMPLATE_REFERENCE,
    tenantId: AGENCY_USER_ID,
    pageCount: 99,
    services: [],
    compatibleLayouts: [],
  }).success, false);
});

test('all required blueprint routes are agency-only capability guarded', () => {
  for (const fragment of [
    '/blueprints',
    '/blueprints/generate',
    '/validation',
    '/action-items',
    '/pages',
    '/reorder',
    '/validate',
    '/approve',
    '/reject',
    '/revise',
  ]) {
    assert.match(routeSource, new RegExp(fragment.replace('/', '\\/')));
  }
  assert.match(routeSource, /sites\.blueprints\.read/);
  assert.match(routeSource, /sites\.blueprints\.manage/);
  assert.match(routeSource, /sites\.blueprints\.approve/);
});

test('legacy browser-authored blueprint replacement route is retired', () => {
  assert.doesNotMatch(legacyRouteSource, /put\('\/:siteReference\/blueprint'/);
  assert.doesNotMatch(legacyRouteSource, /SiteBlueprintSchema\.parse/);
});

test('blueprint queries bind public references to both site and tenant', () => {
  assert.match(serviceSource, /eq\(siteBlueprints\.siteId, site\.id\)/);
  assert.match(serviceSource, /eq\(siteBlueprints\.tenantId, site\.tenantId\)/);
  assert.match(serviceSource, /eq\(siteBlueprintPages\.tenantId, site\.tenantId\)/);
});

test('generation resolves business records and entitlements server-side', () => {
  assert.match(serviceSource, /blueprintMarketingAllowance/);
  assert.match(serviceSource, /this\.sourceData\(site\)/);
  assert.match(serviceSource, /createTemplateCompatibilityService/);
  assert.match(serviceSource, /createTemplateLicenceGuard/);
});

test('generation is transactionally idempotent and site-lock scoped', () => {
  assert.match(serviceSource, /pg_advisory_xact_lock/);
  assert.match(serviceSource, /sourceDataDigest/);
  assert.match(serviceSource, /idempotentReplay: true/);
  assert.match(migration, /site_blueprint_generation_runs_site_digest_idx/);
});

test('ownership-critical page mappings use indexed relational foreign keys', () => {
  assert.match(migration, /service_id uuid[\s\S]*REFERENCES services\(id\)/);
  assert.match(migration, /location_id uuid[\s\S]*REFERENCES locations\(id\)/);
  assert.match(migration, /staff_user_id uuid[\s\S]*REFERENCES users\(id\)/);
  assert.match(migration, /site_blueprint_pages_blueprint_service_unique/);
  assert.match(migration, /site_blueprint_pages_blueprint_location_unique/);
  assert.match(migration, /site_blueprint_pages_blueprint_staff_unique/);
});

test('approved blueprint and child architecture are database immutable', () => {
  assert.match(migration, /Approved site blueprints are immutable/);
  assert.match(migration, /Approved site blueprint architecture is immutable/);
  assert.match(migration, /site_blueprints_prevent_approved_mutation/);
  assert.match(migration, /site_blueprint_pages_prevent_approved_mutation/);
});

test('new blueprint control-plane tables use RLS and no browser grants', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE %I FROM anon, authenticated/);
  assert.match(migration, /site_blueprint_action_items/);
  assert.match(migration, /site_blueprint_generation_runs/);
});

test('all required blueprint mutations emit platform audit events', () => {
  for (const action of [
    'SITE_BLUEPRINT_GENERATED',
    'SITE_BLUEPRINT_UPDATED',
    'SITE_BLUEPRINT_PAGE_ADDED',
    'SITE_BLUEPRINT_PAGE_UPDATED',
    'SITE_BLUEPRINT_PAGE_REMOVED',
    'SITE_BLUEPRINT_REORDERED',
    'SITE_BLUEPRINT_VALIDATED',
    'SITE_BLUEPRINT_APPROVED',
    'SITE_BLUEPRINT_REJECTED',
    'SITE_BLUEPRINT_REVISION_CREATED',
    'SITE_BLUEPRINT_ACTION_ITEM_RESOLVED',
  ]) {
    assert.match(serviceSource, new RegExp(action));
  }
  assert.match(serviceSource, /this\.audit\.write/);
});

test('API views select public references instead of returning internal IDs', () => {
  assert.match(serviceSource, /reference: siteBlueprints\.publicReference/);
  assert.match(serviceSource, /reference: siteBlueprintPages\.publicReference/);
  assert.doesNotMatch(routeSource, /tenantId/);
});

test('approval invokes full validation before recording the actor', () => {
  assert.match(serviceSource, /assertBlueprintValidForApproval\(result\)/);
  assert.match(serviceSource, /approvedByAgencyUserId: actor\.agencyUserId/);
  assert.match(serviceSource, /SITE_BLUEPRINT_APPROVED/);
});
