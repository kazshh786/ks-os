import assert from 'node:assert/strict';
import test from 'node:test';
import { renderAction } from '@ks-os/site-components';
import type { PublishedSiteSnapshot } from '@ks-os/site-schema';
import { createOriginalInternalSiteFixture } from '@ks-os/site-templates';
import { OperationalPublicSiteRepository } from '../src/lib/operational-repository.js';
import type { PublicSiteRepository } from '../src/lib/repository.js';

class MemoryRepository implements PublicSiteRepository {
  constructor(private readonly snapshot: PublishedSiteSnapshot) {}

  async resolveHostname() { return null; }
  async loadPublishedSnapshot() { return this.snapshot; }
  async loadPreviewSnapshot() { return this.snapshot; }
  async isPreviewTokenRevoked() { return false; }
}

function fakeDatabase(input: {
  tenantId: string;
  currency: string;
  services: Array<Record<string, unknown>>;
  eligible: Array<Record<string, unknown>>;
  locations: Array<Record<string, unknown>>;
  schedules: Array<Record<string, unknown>>;
  locationLinks?: Array<Record<string, unknown>>;
}) {
  return {
    select(selection: Record<string, unknown>) {
      const keys = new Set(Object.keys(selection));
      let rows: Array<Record<string, unknown>>;
      if (keys.has('currency')) rows = [{ id: input.tenantId, currency: input.currency }];
      else if (keys.has('name') && keys.has('discount')) rows = input.services;
      else if (keys.has('serviceReference')) rows = input.eligible;
      else if (keys.has('dayOfWeek')) rows = input.schedules;
      else if (keys.has('locationId')) rows = input.locationLinks ?? [];
      else rows = input.locations;

      const builder: any = {
        from() { return builder; },
        innerJoin() { return builder; },
        where() { return builder; },
        orderBy() { return builder; },
        limit(count: number) { return Promise.resolve(rows.slice(0, count)); },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('booking data refreshes existing services and hours without auto-adding new services', async () => {
  const snapshot = createOriginalInternalSiteFixture();
  const service = snapshot.services[0]!;
  const location = snapshot.locations[0]!;
  const unpublishedServiceReference = '90000000-0000-4000-8000-000000000099';
  const repository = new OperationalPublicSiteRepository(
    new MemoryRepository(snapshot),
    fakeDatabase({
      tenantId: 'tenant-1',
      currency: 'GBP',
      services: [
        {
          reference: service.publicReference,
          name: 'Live clarity treatment',
          description: 'Current booking-system description.',
          duration: 75,
          price: 5000,
          discount: 500,
          active: true,
        },
        {
          reference: unpublishedServiceReference,
          name: 'New unpublished treatment',
          description: 'Must remain an agency page opportunity.',
          duration: 30,
          price: 2500,
          discount: 0,
          active: true,
        },
      ],
      eligible: [{ serviceReference: service.publicReference }],
      locations: [{ id: 'location-1', reference: location.publicReference }],
      schedules: [
        { staffId: 'staff-1', dayOfWeek: 1, startTime: '09:00:00', endTime: '17:00:00' },
      ],
    }) as any,
  );

  const hydrated = await repository.loadPublishedSnapshot(snapshot.siteReference);
  assert.ok(hydrated);
  assert.equal(hydrated.services.length, snapshot.services.length);
  assert.equal(hydrated.services[0]!.name, 'Live clarity treatment');
  assert.equal(hydrated.services[0]!.durationMinutes, 75);
  assert.equal(hydrated.services[0]!.priceText, '£45.00');
  assert.equal(hydrated.services[0]!.bookingEnabled, true);
  assert.equal(
    hydrated.services.some(item => item.publicReference === unpublishedServiceReference),
    false,
  );
  const monday = hydrated.locations[0]!.openingHours.find(item => item.day === 'MONDAY');
  assert.deepEqual(monday, { day: 'MONDAY', opens: '09:00', closes: '17:00' });
});

test('a stale service booking action is rendered unavailable instead of linking to booking', () => {
  const snapshot = structuredClone(createOriginalInternalSiteFixture());
  const service = snapshot.services[0]!;
  service.bookingEnabled = false;
  const page = snapshot.pages.find(candidate => candidate.pageType === 'SERVICE_DETAIL')!;
  const output = renderAction({
    type: 'KS_OS_BOOKING',
    label: 'Book now',
    serviceReference: service.publicReference,
  }, {
    snapshot,
    page,
    pagePathByReference: Object.fromEntries(snapshot.pages.map(item => [item.publicReference, item.path])),
  });

  assert.match(String(output), /aria-disabled="true"/);
  assert.doesNotMatch(String(output), /href=/);
});
