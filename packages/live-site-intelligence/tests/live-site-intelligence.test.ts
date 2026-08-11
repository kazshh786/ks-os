import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BoundedLiveSiteCache,
  LiveConditionRuleV1Schema,
  LiveSiteDataResolver,
  PublicLiveSiteDataSchema,
  assessSiteImpact,
  eligibleLiveRecommendations,
  evaluateLiveRule,
  liveSiteCacheControl,
  type LiveSiteDataSource,
  type LiveSiteResolutionInput,
  type PublicLiveSiteData,
} from '../src/index.js';

const refs = {
  tenant: '10000000-0000-4000-8000-000000000001',
  site: '10000000-0000-4000-8000-000000000002',
  service: '10000000-0000-4000-8000-000000000003',
  staff: '10000000-0000-4000-8000-000000000004',
  location: '10000000-0000-4000-8000-000000000005',
  page: '10000000-0000-4000-8000-000000000006',
  targetPage: '10000000-0000-4000-8000-000000000007',
  change: '10000000-0000-4000-8000-000000000008',
  unpublishedStaff: '10000000-0000-4000-8000-000000000009',
  unpublishedLocation: '10000000-0000-4000-8000-000000000010',
} as const;

function liveData(overrides: Partial<PublicLiveSiteData> = {}) {
  return PublicLiveSiteDataSchema.parse({
    schemaVersion: 1,
    dataClass: 'LIVE',
    siteReference: refs.site,
    resolvedAt: '2026-08-11T12:00:00.000Z',
    services: [{
      publicReference: refs.service,
      exists: true,
      active: true,
      bookingEligible: true,
      durationMinutes: 60,
      publicPrice: { amountMinor: 9500, currency: 'GBP', formatted: '£95.00' },
      staffReferences: [refs.staff],
      locationReferences: [refs.location],
      waitlistEligible: false,
    }],
    staff: [{
      publicReference: refs.staff,
      active: true,
      bookingEligible: true,
      serviceReferences: [refs.service],
      locationReferences: [refs.location],
    }],
    locations: [{
      publicReference: refs.location,
      active: true,
      bookingEligible: true,
      serviceReferences: [refs.service],
      staffReferences: [refs.staff],
      opening: { state: 'OPEN', label: 'Open now · closes at 19:00', source: 'CANONICAL_HOURS' },
    }],
    availability: [{
      serviceReference: refs.service,
      state: 'AVAILABLE_THIS_WEEK',
      message: 'Appointments available this week',
      computedAt: '2026-08-11T12:00:00.000Z',
      expiresAt: '2026-08-11T12:05:00.000Z',
    }],
    campaigns: [],
    warnings: [],
    telemetry: { cacheClass: 'LIVE_FAST', cacheHit: false, fallbackActivated: false, queryCount: 8, resolutionMs: 12 },
    ...overrides,
  });
}

const input: LiveSiteResolutionInput = {
  siteReference: refs.site,
  tenantReference: refs.tenant,
  serviceReferences: [refs.service],
  staffReferences: [refs.staff],
  locationReferences: [refs.location],
};

test('closed V1 rule schema rejects arbitrary and duplicate expressions', () => {
  assert.equal(LiveConditionRuleV1Schema.safeParse({
    version: 1,
    all: [{ key: 'eval(window.alert())' }],
  }).success, false);
  assert.equal(LiveConditionRuleV1Schema.safeParse({
    version: 1,
    all: [{ key: 'SERVICE_BOOKABLE', subjectReference: refs.service }],
    any: [{ key: 'SERVICE_BOOKABLE', subjectReference: refs.service }],
  }).success, false);
});

test('compound rules are deterministic and distinguish false from unknown', () => {
  const result = evaluateLiveRule({
    version: 1,
    all: [
      { key: 'SERVICE_EXISTS', subjectReference: refs.service },
      { key: 'SERVICE_BOOKABLE', subjectReference: refs.service },
    ],
    any: [{ key: 'LOCATION_OPEN', subjectReference: refs.location }],
    none: [{ key: 'WAITLIST_AVAILABLE', subjectReference: refs.service }],
  }, liveData());
  assert.equal(result.matches, true);
  assert.equal(result.indeterminate, false);
  const unavailable = evaluateLiveRule({
    version: 1,
    all: [{ key: 'SERVICE_BOOKABLE', subjectReference: refs.service }],
    any: [], none: [],
  }, liveData({ services: [{ ...liveData().services[0]!, bookingEligible: false }] }));
  assert.equal(unavailable.definitiveFalse, true);
});

test('resolver batches once, caches public state and fails safe', async () => {
  let calls = 0;
  const source: LiveSiteDataSource = {
    async resolveBatch() { calls += 1; return liveData(); },
  };
  const resolver = new LiveSiteDataResolver(source, new BoundedLiveSiteCache(4), 100);
  assert.equal((await resolver.resolve(input)).telemetry.cacheHit, false);
  assert.equal((await resolver.resolve(input)).telemetry.cacheHit, true);
  assert.equal(calls, 1);

  const failed = await new LiveSiteDataResolver({
    async resolveBatch() { throw new Error('database unavailable'); },
  }, new BoundedLiveSiteCache(4), 100).resolve(input);
  assert.equal(failed.telemetry.fallbackActivated, true);
  assert.equal(failed.services.length, 0);
  assert.equal(failed.warnings[0]?.code, 'LIVE_SOURCE_UNAVAILABLE');
  assert.equal(liveSiteCacheControl('PERSONAL'), 'private, no-store, max-age=0');
});

test('resolver removes availability references outside the published snapshot', async () => {
  const availabilityBase = {
    serviceReference: refs.service,
    state: 'AVAILABLE_THIS_WEEK' as const,
    message: 'Appointments available this week',
    computedAt: '2026-08-11T12:00:00.000Z',
    expiresAt: '2026-08-11T12:05:00.000Z',
  };
  const resolver = new LiveSiteDataResolver({
    async resolveBatch() {
      return liveData({
        availability: [
          availabilityBase,
          { ...availabilityBase, staffReference: refs.unpublishedStaff },
          { ...availabilityBase, locationReference: refs.unpublishedLocation },
        ],
      });
    },
  }, new BoundedLiveSiteCache(4), 100);

  const resolved = await resolver.resolve(input);
  assert.deepEqual(resolved.availability, [availabilityBase]);
  assert.equal(resolved.availability.some(item => item.staffReference === refs.unpublishedStaff), false);
  assert.equal(resolved.availability.some(item => item.locationReference === refs.unpublishedLocation), false);
});

test('impact engine separates immediate live effects from published review', () => {
  const base = {
    publicReference: refs.change,
    tenantReference: refs.tenant,
    siteReference: refs.site,
    entityType: 'SERVICE' as const,
    entityReference: refs.service,
    changedFields: ['price'],
    occurredAt: '2026-08-11T12:00:00.000Z',
  };
  const pages = [{
    pageReference: refs.page,
    path: '/services/example',
    pageType: 'SERVICE_DETAIL' as const,
    entityReferences: [refs.service],
    structuredDataTypes: ['SERVICE'],
    internalLinkTargets: [],
  }];
  assert.equal(assessSiteImpact({ change: { ...base, kind: 'PRICE_CHANGED' }, pages }).classification, 'AUTO_APPLY_LIVE');
  const removal = assessSiteImpact({ change: { ...base, kind: 'SERVICE_DISABLED' }, pages });
  assert.equal(removal.classification, 'REQUIRE_SITE_REVIEW');
  assert.equal(removal.affectedPages[0]?.path, '/services/example');
  assert.match(removal.recommendedPublishedChanges[0]!, /Disable booking immediately/);
});

test('recommendations require both approved semantic relevance and live eligibility', () => {
  const approved = [{
    sourcePageReference: refs.page,
    targetPageReference: refs.targetPage,
    targetServiceReference: refs.service,
    relationship: 'RELATED_SERVICE' as const,
    semanticScore: 0.9,
    approved: true as const,
  }];
  assert.equal(eligibleLiveRecommendations(approved, liveData()).length, 1);
  assert.equal(eligibleLiveRecommendations(approved, liveData({
    services: [{ ...liveData().services[0]!, bookingEligible: false }],
  })).length, 0);
});
