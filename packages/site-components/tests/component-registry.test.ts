import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PublishedPageSnapshot,
  PublishedSiteSnapshot,
  SiteSection,
  SiteSectionType,
} from '@ks-os/site-schema';
import { SiteSectionSchema } from '@ks-os/site-schema';
import {
  componentRegistrySummary,
  listSiteComponents,
  renderSection,
  resolveSiteComponent,
  validateSiteComponentDefinition,
  type ComponentRenderContext,
  type SiteComponentDefinition,
} from '../src/index.js';

const pageReference = '11111111-1111-4111-8111-111111111111';
const sectionReference = '22222222-2222-4222-8222-222222222222';
const serviceReference = '33333333-3333-4333-8333-333333333333';
const staffReference = '44444444-4444-4444-8444-444444444444';
const locationReference = '55555555-5555-4555-8555-555555555555';
const assetReference = '66666666-6666-4666-8666-666666666666';

const bookingAction = { type: 'KS_OS_BOOKING' as const, label: 'Book now' };
const body = 'Specific verified business information explains the service, the visit and the next practical step.';

function sectionFor(type: SiteSectionType): SiteSection {
  const base = { reference: sectionReference, type };
  const value: Record<SiteSectionType, unknown> = {
    HEADER: { ...base, primaryAction: bookingAction },
    ANNOUNCEMENT_BAR: { ...base, message: 'Appointments are available this week.' },
    HERO: { ...base, heading: 'A considered approach', body, primaryAction: bookingAction },
    INTRODUCTION: { ...base, heading: 'Welcome', body },
    FEATURED_SERVICES: { ...base, heading: 'Featured services', serviceReferences: [serviceReference] },
    SERVICE_GRID: { ...base, heading: 'Services', serviceReferences: [serviceReference] },
    SERVICE_DETAILS: { ...base, heading: 'Service detail', body, serviceReference, primaryAction: { ...bookingAction, serviceReference } },
    BENEFITS: { ...base, heading: 'Why clients choose us', items: [{ heading: 'Careful planning', body }] },
    PROCESS: { ...base, heading: 'What to expect', steps: [{ heading: 'Consult', body }] },
    PRICING: { ...base, heading: 'Pricing', items: [{ label: 'Consultation', priceText: 'From £40', description: body }] },
    TEAM: { ...base, heading: 'Meet the team', staffReferences: [staffReference] },
    STAFF_PROFILE: { ...base, staffReference, primaryAction: bookingAction },
    GALLERY: { ...base, heading: 'Gallery', assetReferences: [assetReference] },
    RESULTS: { ...base, heading: 'Approved results', items: [{ afterAssetReference: assetReference, caption: 'Approved result' }] },
    TESTIMONIALS: { ...base, heading: 'Client feedback', items: [{ quote: body, attribution: 'Verified client' }] },
    TRUST_INDICATORS: { ...base, heading: 'What matters', items: [{ label: 'Verified information', detail: body }] },
    FAQ: { ...base, heading: 'Questions', items: [{ question: 'What should I expect?', answer: body }] },
    LOCATION: { ...base, heading: 'Visit us', locationReference },
    OPENING_HOURS: { ...base, heading: 'Opening hours', locationReference },
    CONTACT: { ...base, heading: 'Contact us', body, locationReference, secondaryActions: [] },
    BOOKING_CTA: { ...base, heading: 'Ready to book?', body, primaryAction: bookingAction },
    FINAL_CTA: { ...base, heading: 'Plan your visit', body, primaryAction: bookingAction },
    FOOTER: { ...base, primaryAction: bookingAction, legalText: 'Business information is provided for review.' },
    RICH_TEXT: {
      ...base,
      heading: 'Guidance',
      document: { blocks: [{ type: 'PARAGRAPH', children: [{ type: 'TEXT', text: body }] }] },
    },
  };
  return SiteSectionSchema.parse(value[type]);
}

const page = {
  publicReference: pageReference,
  pageType: 'HOME',
  conversionRole: 'PRIMARY_LANDING',
  sections: [sectionFor('HERO')],
} as PublishedPageSnapshot;

const snapshot = {
  visibility: 'PREVIEW',
  business: { name: 'Test Business' },
  navigation: {
    primary: [{ label: 'Home', pageReference, children: [] }],
    footer: [{ label: 'Home', pageReference, children: [] }],
    utility: [],
    legal: [],
  },
  services: [{
    publicReference: serviceReference,
    name: 'Consultation',
    shortDescription: body,
    serviceType: 'CONSULTATION',
    active: true,
  }],
  staff: [{ publicReference: staffReference, displayName: 'Alex', role: 'Specialist', serviceReferences: [serviceReference] }],
  locations: [{
    publicReference: locationReference,
    name: 'Studio',
    addressLines: ['1 Example Street'],
    locality: 'London',
    postalCode: 'SW1A 1AA',
    countryCode: 'GB',
    openingHours: [{ day: 'MONDAY', opens: '09:00', closes: '17:00' }],
  }],
  assets: [{
    publicReference: assetReference,
    type: 'IMAGE',
    publicationStatus: 'PUBLISHED',
    mimeType: 'image/webp',
    url: 'https://assets.example.test/image.webp',
    width: 1200,
    height: 800,
    purpose: 'INFORMATIVE',
    alt: 'Approved studio image',
    variants: [],
  }],
} as unknown as PublishedSiteSnapshot;

const context: ComponentRenderContext = {
  snapshot,
  page,
  pagePathByReference: { [pageReference]: '/' },
};

test('registry contains the controlled 24-type component library', () => {
  const summary = componentRegistrySummary();
  assert.equal(summary.semanticSectionTypeCount, 24);
  // The user's named minimum set itself totals 123 active implementations,
  // slightly above the approximate 80-120 planning range.
  assert.ok(summary.componentCount >= 80 && summary.componentCount <= 125);
  assert.equal(listSiteComponents().length, summary.componentCount);
  assert.equal(summary.registeredComponentCount, summary.componentCount + 1);
  assert.equal(summary.bySectionType.BOOKING_CTA, 7);
  assert.equal(summary.bySectionType.FINAL_CTA, 7);
});

test('validates registration metadata and rejects invalid semantic, binding and page data', () => {
  const valid = listSiteComponents()[0]!;
  assert.deepEqual(validateSiteComponentDefinition(valid), []);
  assert.ok(validateSiteComponentDefinition({ ...valid, sectionType: 'UNKNOWN' } as unknown as SiteComponentDefinition).includes('sectionType is not controlled.'));
  assert.ok(validateSiteComponentDefinition({ ...valid, requiredDataBindings: ['UNKNOWN'] } as unknown as SiteComponentDefinition).some(error => error.includes('unknown binding')));
  assert.ok(validateSiteComponentDefinition({ ...valid, supportedPageTypes: ['UNKNOWN'] } as unknown as SiteComponentDefinition).some(error => error.includes('page compatibility')));
});

test('rejects unknown, disabled and semantically incompatible component keys', () => {
  assert.throws(() => resolveSiteComponent({ sectionType: 'HERO', componentKey: 'hero-not-registered-v1' }), /Unknown site componentKey/);
  assert.throws(() => resolveSiteComponent({ sectionType: 'HERO', componentKey: 'hero-retired-placeholder-v1' }), /disabled/);
  assert.throws(() => resolveSiteComponent({ sectionType: 'FAQ', componentKey: 'hero-centered-v1' }), /incompatible/);
  assert.throws(() => resolveSiteComponent({ sectionType: 'STAFF_PROFILE', componentKey: 'profile-split-v1', pageType: 'HOME' }), /incompatible with HOME/);
});

test('renders every active component through deterministic markup', () => {
  for (const component of listSiteComponents()) {
    const section = { ...sectionFor(component.sectionType), componentKey: component.componentKey } as SiteSection;
    const compatiblePage = {
      ...page,
      pageType: component.supportedPageTypes[0],
      conversionRole: component.supportedConversionRoles[0],
    } as PublishedPageSnapshot;
    const markup = renderSection(section, { ...context, page: compatiblePage });
    assert.match(markup, new RegExp(`component-${component.componentKey}`));
    assert.doesNotMatch(markup, /<script|javascript:/i);
  }
});

test('V1 sections without componentKey retain deterministic fallback rendering', () => {
  const markup = renderSection({ ...sectionFor('HERO'), variant: 'split' }, context);
  assert.match(markup, /component-hero-split-image-v1/);
});

test('grouped navigation renders accessible native disclosure controls', () => {
  const grouped = {
    ...snapshot,
    navigation: {
      ...snapshot.navigation,
      primary: [{
        label: 'Services',
        pageReference,
        children: [{ label: 'Consultation', pageReference }],
      }],
    },
  } as PublishedSiteSnapshot;
  const markup = renderSection(sectionFor('HEADER'), { ...context, snapshot: grouped });
  assert.match(markup, /<details><summary>Services<\/summary>/);
  assert.match(markup, /aria-label="Mobile navigation"/);
});
