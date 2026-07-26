import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SiteActionSchema,
  assertSiteBlueprintLayoutsCompatible,
  assertSitePageCreationAllowed,
  calculateSiteEntitlementSummary,
  resolveKsOsBookingUrl,
  sitePageConsumesMarketingEntitlement,
  sitePageEntitlementKind,
  sitePlanEntitlements,
  siteVersionIsEditable,
} from '@ks-os/contracts';
import { buildApp } from '../src/app.js';
import {
  NativeSiteBookingService,
  type NativeBookingReferenceRepository,
} from '../src/modules/sites/native-booking.service.js';

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/20260724090000_phase_15_0_15_2_website_foundation.sql',
    import.meta.url,
  ),
  'utf8',
);
const siteServiceSource = readFileSync(
  new URL('../src/modules/sites/site.service.ts', import.meta.url),
  'utf8',
);
const siteRoutesSource = readFileSync(
  new URL('../src/modules/sites/site.routes.ts', import.meta.url),
  'utf8',
);
const siteBlueprintServiceSource = readFileSync(
  new URL('../src/modules/sites/site-blueprint.service.ts', import.meta.url),
  'utf8',
);

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_REFERENCE = '22222222-2222-4222-8222-222222222222';
const SITE_REFERENCE = '33333333-3333-4333-8333-333333333333';
const SERVICE_REFERENCE = '44444444-4444-4444-8444-444444444444';
const LOCATION_REFERENCE = '55555555-5555-4555-8555-555555555555';
const STAFF_REFERENCE = '66666666-6666-4666-8666-666666666666';
const CROSS_TENANT_REFERENCE = '77777777-7777-4777-8777-777777777777';

class FakeBookingRepository implements NativeBookingReferenceRepository {
  async findTenant(tenantId: string, tenantReference: string) {
    if (tenantId !== TENANT_ID || tenantReference !== TENANT_REFERENCE) return null;
    return {
      id: TENANT_ID,
      businessReference: TENANT_REFERENCE,
      subdomain: 'tenant-a',
    };
  }

  async serviceBelongsToTenant(tenantId: string, publicReference: string) {
    return tenantId === TENANT_ID && publicReference === SERVICE_REFERENCE;
  }

  async locationBelongsToTenant(tenantId: string, publicReference: string) {
    return tenantId === TENANT_ID && publicReference === LOCATION_REFERENCE;
  }

  async staffBelongsToTenant(tenantId: string, publicReference: string) {
    return tenantId === TENANT_ID && publicReference === STAFF_REFERENCE;
  }
}

function tenantContextApp() {
  return buildApp({
    beforeRegister(app) {
      app.addHook('onRequest', async (request) => {
        request.applicationContext = 'TENANT';
        request.auth = {
          authUserId: TENANT_ID,
          tenantUserId: TENANT_ID,
          membershipReference: TENANT_REFERENCE,
          email: 'owner@tenant-a.example',
          tenantId: TENANT_ID,
          businessReference: TENANT_REFERENCE,
          tenantName: 'Tenant A',
          tenantSubdomain: 'tenant-a',
          role: 'owner',
          permissions: [],
        };
      });
    },
  });
}

test('1. Core resolves to 10 initial marketing pages', () => {
  assert.equal(sitePlanEntitlements('CORE').initialMarketingPages, 10);
});

test('2. Growth resolves to 20 initial marketing pages', () => {
  assert.equal(sitePlanEntitlements('GROWTH').initialMarketingPages, 20);
});

test('3. Scale resolves to 30 initial marketing pages', () => {
  assert.equal(sitePlanEntitlements('SCALE').initialMarketingPages, 30);
});

test('4. Core resolves to one monthly page opportunity', () => {
  assert.equal(sitePlanEntitlements('CORE').monthlyMarketingPages, 1);
});

test('5. Growth resolves to two monthly page opportunities', () => {
  assert.equal(sitePlanEntitlements('GROWTH').monthlyMarketingPages, 2);
});

test('6. Scale resolves to three monthly page opportunities', () => {
  assert.equal(sitePlanEntitlements('SCALE').monthlyMarketingPages, 3);
});

test('7. Booking system pages do not consume marketing entitlement', () => {
  assert.equal(sitePageConsumesMarketingEntitlement('BOOKING'), false);
});

test('8. Initial page creation beyond the plan allowance is rejected', () => {
  const summary = calculateSiteEntitlementSummary({
    planKey: 'CORE',
    initialMarketingPagesUsed: 10,
    monthlyMarketingPagesUsed: 0,
  });
  assert.throws(
    () => assertSitePageCreationAllowed({
      pageType: 'HOME',
      allocation: 'INITIAL',
      summary,
    }),
    /allowance of 10 has been reached/,
  );
});

test('9. Monthly page creation beyond entitlement is rejected', () => {
  const summary = calculateSiteEntitlementSummary({
    planKey: 'CORE',
    initialMarketingPagesUsed: 0,
    monthlyMarketingPagesUsed: 1,
  });
  assert.throws(
    () => assertSitePageCreationAllowed({
      pageType: 'AFTERCARE_GUIDE',
      allocation: 'MONTHLY',
      summary,
    }),
    /allowance of 1 has been reached/,
  );
});

test('10. A tenant context cannot read an arbitrary agency-managed site', async () => {
  const app = tenantContextApp();
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/agency/sites/${SITE_REFERENCE}`,
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  await app.close();
});

test('11. A tenant context cannot mutate another tenant site', async () => {
  const app = tenantContextApp();
  const response = await app.inject({
    method: 'PATCH',
    url: `/api/v1/agency/sites/${SITE_REFERENCE}`,
    payload: { displayName: 'Unauthorised change' },
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  await app.close();
});

test('12. Published site versions cannot be edited or deleted', () => {
  assert.equal(siteVersionIsEditable('PUBLISHED'), false);
  assert.match(migration, /Published site versions are immutable/);
  assert.match(migration, /site_versions_prevent_published_mutation/);
});

test('13. Draft site versions are editable by the agency service', () => {
  assert.equal(siteVersionIsEditable('DRAFT'), true);
  assert.match(siteServiceSource, /version\.status !== 'DRAFT'/);
  assert.match(siteRoutesSource, /agencyActor\(request, 'sites\.manage'\)/);
});

test('14. Every agency site mutation creates a platform audit event', () => {
  for (const action of [
    'SITE_CREATED',
    'SITE_UPDATED',
    'SITE_VERSION_CREATED',
    'SITE_PAGE_CREATED',
    'SITE_PAGE_UPDATED',
  ]) {
    assert.match(siteServiceSource, new RegExp(`'${action}'`));
  }
  assert.match(siteBlueprintServiceSource, /'SITE_BLUEPRINT_UPDATED'/);
  assert.match(siteServiceSource, /this\.audit\.write/);
});

test('15. Tenant owners cannot access the agency site-creation endpoint', async () => {
  const app = tenantContextApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/agency/sites',
    payload: {
      tenantReference: TENANT_REFERENCE,
      displayName: 'Tenant A website',
    },
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  await app.close();
});

test('16. Native booking CTA rejects arbitrary external URLs', () => {
  assert.equal(SiteActionSchema.safeParse({
    type: 'KS_OS_BOOKING',
    label: 'Book now',
    url: 'https://example.external-booking.test/book',
  }).success, false);
});

test('17. Booking URL generation never exposes the internal tenant ID', () => {
  const url = resolveKsOsBookingUrl({
    publicOrigin: 'https://app.ks-os.example',
    tenantReference: TENANT_REFERENCE,
    tenantSubdomain: 'tenant-a',
    serviceReference: SERVICE_REFERENCE,
  });
  assert.equal(url.includes(TENANT_ID), false);
  assert.match(url, /\/book\/tenant-a/);
});

test('18. Service preselection rejects a cross-tenant reference', async () => {
  const service = new NativeSiteBookingService(
    new FakeBookingRepository(),
    'https://app.ks-os.example',
  );
  await assert.rejects(
    service.resolveForTenant({
      tenantId: TENANT_ID,
      tenantReference: TENANT_REFERENCE,
      action: {
        type: 'KS_OS_BOOKING',
        label: 'Book',
        serviceReference: CROSS_TENANT_REFERENCE,
      },
    }),
    (error: unknown) =>
      error instanceof Error
      && 'code' in error
      && error.code === 'BOOKING_SERVICE_TENANT_MISMATCH',
  );
});

test('19. Location preselection rejects a cross-tenant reference', async () => {
  const service = new NativeSiteBookingService(
    new FakeBookingRepository(),
    'https://app.ks-os.example',
  );
  await assert.rejects(
    service.resolveForTenant({
      tenantId: TENANT_ID,
      tenantReference: TENANT_REFERENCE,
      action: {
        type: 'KS_OS_BOOKING',
        label: 'Book',
        locationReference: CROSS_TENANT_REFERENCE,
      },
    }),
    (error: unknown) =>
      error instanceof Error
      && 'code' in error
      && error.code === 'BOOKING_LOCATION_TENANT_MISMATCH',
  );
});

test('20. Staff preselection rejects a cross-tenant reference', async () => {
  const service = new NativeSiteBookingService(
    new FakeBookingRepository(),
    'https://app.ks-os.example',
  );
  await assert.rejects(
    service.resolveForTenant({
      tenantId: TENANT_ID,
      tenantReference: TENANT_REFERENCE,
      action: {
        type: 'KS_OS_BOOKING',
        label: 'Book',
        staffReference: CROSS_TENANT_REFERENCE,
      },
    }),
    (error: unknown) =>
      error instanceof Error
      && 'code' in error
      && error.code === 'BOOKING_STAFF_TENANT_MISMATCH',
  );
});

test('21. Booking URL uses the configured public origin', async () => {
  const service = new NativeSiteBookingService(
    new FakeBookingRepository(),
    'https://booking.ks-os.example',
  );
  const url = await service.resolveForTenant({
    tenantId: TENANT_ID,
    tenantReference: TENANT_REFERENCE,
    action: {
      type: 'KS_OS_BOOKING',
      label: 'Book',
      serviceReference: SERVICE_REFERENCE,
      locationReference: LOCATION_REFERENCE,
      staffReference: STAFF_REFERENCE,
      campaignReference: 'summer-2026',
    },
  });
  assert.match(url, /^https:\/\/booking\.ks-os\.example\/book\/tenant-a/);
  assert.doesNotMatch(url, /localhost/);
});

test('22. Duplicate idempotent site creation reuses the existing site', () => {
  assert.match(migration, /creation_idempotency_key varchar\(120\)/);
  assert.match(
    siteServiceSource,
    /existing\.creationIdempotencyKey === input\.idempotencyKey/,
  );
  assert.match(siteServiceSource, /return this\.getById\(existing\.id, tx\)/);
});

test('23. A blueprint rejects an incompatible layout assignment', () => {
  const layoutReference = '88888888-8888-4888-8888-888888888888';
  const compatibility = new Map([
    [layoutReference, new Set(['HOME'])],
  ]);
  assert.throws(
    () => assertSiteBlueprintLayoutsCompatible([
      {
        layoutReference,
        pageType: 'SERVICE_DETAIL',
      },
    ], compatibility),
    /is not approved for SERVICE_DETAIL/,
  );
});

test('24. BOOKING is functional and excluded from page allowance', () => {
  assert.equal(sitePageEntitlementKind('BOOKING'), 'FUNCTIONAL');
  const exhausted = calculateSiteEntitlementSummary({
    planKey: 'CORE',
    initialMarketingPagesUsed: 10,
    monthlyMarketingPagesUsed: 1,
  });
  assert.doesNotThrow(() => assertSitePageCreationAllowed({
    pageType: 'BOOKING',
    allocation: 'INITIAL',
    summary: exhausted,
  }));
});

test('25. Published versions remain available for future rollback', () => {
  assert.match(
    migration,
    /previous_version_id uuid REFERENCES site_versions\(id\) ON DELETE RESTRICT/,
  );
  assert.match(migration, /event_type IN \('PUBLISH','ROLLBACK'\)/);
  assert.match(migration, /Published site versions cannot be deleted/);
  assert.doesNotMatch(migration, /DELETE FROM site_versions/i);
});
