import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PublishedPageSnapshot,
  PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import { SiteSectionSchema } from '@ks-os/site-schema';
import {
  renderSection,
  type ComponentRenderContext,
} from '../src/index.js';

const pageReference = '11111111-1111-4111-8111-111111111111';
const sectionReference = '22222222-2222-4222-8222-222222222222';
const locationReference = '33333333-3333-4333-8333-333333333333';

const section = SiteSectionSchema.parse({
  reference: sectionReference,
  type: 'OPENING_HOURS',
  heading: 'Opening hours',
  locationReference,
});

const page = {
  publicReference: pageReference,
  pageType: 'CONTACT',
  conversionRole: 'PRIMARY_LANDING',
  sections: [section],
} as PublishedPageSnapshot;

const snapshot = {
  visibility: 'PREVIEW',
  locations: [{
    publicReference: locationReference,
    name: 'Studio',
    addressLines: ['1 Example Street'],
    locality: 'London',
    postalCode: 'SW1A 1AA',
    countryCode: 'GB',
    openingHours: [{ day: 'MONDAY', opens: '09:00', closes: '17:00' }],
  }],
} as unknown as PublishedSiteSnapshot;

const live = {
  schemaVersion: 1,
  dataClass: 'LIVE',
  siteReference: '44444444-4444-4444-8444-444444444444',
  resolvedAt: '2026-08-18T11:00:00.000Z',
  services: [],
  staff: [],
  locations: [{
    publicReference: locationReference,
    active: true,
    bookingEligible: true,
    serviceReferences: [],
    staffReferences: [],
    opening: {
      state: 'OPEN',
      label: 'Open now · closes at 18:00',
      source: 'BOOKING_SCHEDULE_FALLBACK',
    },
    openingHours: [{ day: 'MONDAY', opens: '10:00', closes: '18:00' }],
  }],
  availability: [],
  campaigns: [],
  warnings: [],
  telemetry: {
    cacheClass: 'LIVE_FAST',
    cacheHit: false,
    fallbackActivated: false,
    queryCount: 1,
    resolutionMs: 1,
  },
} as const;

const context = {
  snapshot,
  page,
  pagePathByReference: { [pageReference]: '/' },
  live,
} as unknown as ComponentRenderContext;

test('opening-hours table prefers the current booking-system schedule over the snapshot', () => {
  const markup = renderSection(section, context);
  assert.match(markup, /10:00–18:00/);
  assert.match(markup, /Open now · closes at 18:00/);
  assert.doesNotMatch(markup, /09:00–17:00/);
});
