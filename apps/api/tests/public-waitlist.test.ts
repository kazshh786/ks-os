import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreatePublicWaitlistRequest } from '@ks-os/contracts';
import {
  PublicWaitlistService,
  type PublicWaitlistStore,
  type ResolvedPublicWaitlistContext,
} from '../src/modules/sites/public-waitlist.service.js';

const refs = {
  tenant: '10000000-0000-4000-8000-000000000001',
  site: '10000000-0000-4000-8000-000000000002',
  service: '10000000-0000-4000-8000-000000000003',
  location: '10000000-0000-4000-8000-000000000004',
  staff: '10000000-0000-4000-8000-000000000005',
  idempotency: '10000000-0000-4000-8000-000000000006',
  request: '10000000-0000-4000-8000-000000000007',
  crossTenant: '20000000-0000-4000-8000-000000000001',
} as const;

const request: CreatePublicWaitlistRequest = {
  serviceReference: refs.service,
  locationReference: refs.location,
  staffReference: refs.staff,
  campaignReference: 'summer-2026',
  preferredDate: '2026-08-20',
  customer: {
    name: 'Private Person',
    email: 'person@example.com',
    phone: '+44 7700 900123',
  },
  idempotencyKey: refs.idempotency,
};

const context: ResolvedPublicWaitlistContext = {
  tenantId: refs.tenant,
  tenantTimezone: 'Europe/London',
  siteId: refs.site,
  serviceId: refs.service,
  serviceActive: true,
  waitlistEnabled: true,
  waitlistEligible: true,
  bookingEligible: false,
  locationId: refs.location,
  staffUserId: refs.staff,
};

function store(overrides: Partial<PublicWaitlistStore> = {}): PublicWaitlistStore {
  return {
    resolveContext: async () => context,
    persist: async () => ({ requestReference: refs.request, duplicate: false }),
    ...overrides,
  };
}

const clock = () => new Date('2026-08-11T12:00:00.000Z');

test('the public preflight exposes only the current waitlistEligible boolean', async () => {
  const eligible = await new PublicWaitlistService(store(), clock).eligibility('north-star', {
    serviceReference: refs.service,
    locationReference: refs.location,
    staffReference: refs.staff,
  });
  assert.deepEqual(eligible, { waitlistEligible: true });
  assert.doesNotMatch(JSON.stringify(eligible), /person|tenant|site|service/i);

  const unavailable = await new PublicWaitlistService(store({
    resolveContext: async () => null,
  }), clock).eligibility('north-star', { serviceReference: refs.crossTenant });
  assert.deepEqual(unavailable, { waitlistEligible: false });
});

test('a valid waitlist submission persists the server-resolved tenant and site context', async () => {
  let persisted: { context: ResolvedPublicWaitlistContext; request: CreatePublicWaitlistRequest } | undefined;
  const service = new PublicWaitlistService(store({
    persist: async (resolved, parsed) => {
      persisted = { context: resolved, request: parsed };
      return { requestReference: refs.request, duplicate: false };
    },
  }), clock);

  const response = await service.join('north-star', request, 'book.kasimshah.com');
  assert.equal(persisted?.context.tenantId, refs.tenant);
  assert.equal(persisted?.context.siteId, refs.site);
  assert.equal(persisted?.context.serviceId, refs.service);
  assert.equal(persisted?.request.customer.email, 'person@example.com');
  assert.deepEqual(response, {
    status: 'PENDING',
    message: "You're on the waitlist. We'll contact you if a suitable appointment becomes available.",
  });
});

test('cross-tenant location or staff references fail closed before persistence', async () => {
  let persistCalled = false;
  const service = new PublicWaitlistService(store({
    resolveContext: async ({ request: parsed }) => parsed.staffReference === refs.crossTenant ? null : context,
    persist: async () => {
      persistCalled = true;
      return { requestReference: refs.request, duplicate: false };
    },
  }), clock);
  await assert.rejects(
    service.join('north-star', { ...request, staffReference: refs.crossTenant }),
    (error: any) => error.code === 'WAITLIST_CONTEXT_NOT_FOUND' && error.statusCode === 404,
  );
  assert.equal(persistCalled, false);
});

test('inactive, non-waitlist and currently bookable services are rejected', async (t) => {
  const cases = [
    { context: { ...context, serviceActive: false }, code: 'WAITLIST_NOT_ENABLED' },
    { context: { ...context, waitlistEnabled: false }, code: 'WAITLIST_NOT_ENABLED' },
    { context: { ...context, waitlistEligible: false }, code: 'WAITLIST_NOT_ELIGIBLE' },
    { context: { ...context, bookingEligible: true }, code: 'WAITLIST_NOT_ELIGIBLE' },
  ] as const;
  for (const scenario of cases) {
    await t.test(scenario.code, async () => {
      const service = new PublicWaitlistService(store({
        resolveContext: async () => scenario.context,
      }), clock);
      await assert.rejects(
        service.join('north-star', request),
        (error: any) => error.code === scenario.code && error.statusCode === 409,
      );
    });
  }
});

test('repeated requests have deterministic behaviour without exposing membership state', async () => {
  let calls = 0;
  const service = new PublicWaitlistService(store({
    persist: async () => ({
      requestReference: refs.request,
      duplicate: calls++ > 0,
    }),
  }), clock);
  const first = await service.join('north-star', request);
  const repeated = await service.join('north-star', request);
  assert.deepEqual(first, repeated);
  assert.deepEqual(repeated, {
    status: 'PENDING',
    message: "You're on the waitlist. We'll contact you if a suitable appointment becomes available.",
  });
});

test('bounded waitlist input rejects malformed contact data before resolution', async () => {
  let resolveCalled = false;
  const service = new PublicWaitlistService(store({
    resolveContext: async () => {
      resolveCalled = true;
      return context;
    },
  }), clock);
  await assert.rejects(service.join('north-star', {
    ...request,
    customer: { ...request.customer, name: 'x'.repeat(121) },
  }));
  assert.equal(resolveCalled, false);
});
