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
  actionHref,
  componentRegistrySummary,
  listSiteComponents,
  renderGovernedRecommendations,
  renderLiveCampaignPlacement,
  renderSection,
  resolveSiteComponent,
  validateSiteSectionComponent,
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

test('registry exposes governed live capability and never enables PERSONAL output', () => {
  const serviceComponent = resolveSiteComponent({ sectionType: 'SERVICE_DETAILS' });
  assert.ok(serviceComponent.liveDataCapabilities.includes('SERVICE_STATE'));
  assert.ok(serviceComponent.supportedConditions.includes('SERVICE_BOOKABLE'));
  assert.equal(serviceComponent.conditionalVisibility, 'NEVER');
  assert.equal(resolveSiteComponent({ sectionType: 'ANNOUNCEMENT_BAR' }).conditionalVisibility, 'OPTIONAL_LIVE_SECTION');
  assert.equal(listSiteComponents().some(component => component.sectionType !== 'ANNOUNCEMENT_BAR'
    && component.conditionalVisibility !== 'NEVER'), false);
  assert.equal(serviceComponent.fallbackBehaviour, 'RENDER_PUBLISHED');
  assert.equal(serviceComponent.personalisationMode, 'PUBLIC_ONLY');
  assert.equal(listSiteComponents().some(component => component.cacheClass === 'PERSONAL'), false);
});

test('server rendering uses safe live price and bookability with a published fallback', () => {
  const serviceSection = SiteSectionSchema.parse({
    ...sectionFor('SERVICE_DETAILS'),
    showIf: {
      version: 1,
      all: [{ key: 'SERVICE_BOOKABLE', subjectReference: serviceReference }],
    },
  });
  const servicePage = { ...page, pageType: 'SERVICE_DETAIL', sections: [serviceSection] } as PublishedPageSnapshot;
  const live = {
    schemaVersion: 1,
    dataClass: 'LIVE',
    siteReference: '77777777-7777-4777-8777-777777777777',
    resolvedAt: '2026-08-11T12:00:00.000Z',
    services: [{
      publicReference: serviceReference,
      exists: true,
      active: true,
      bookingEligible: false,
      durationMinutes: 75,
      publicPrice: { amountMinor: 9500, currency: 'GBP', formatted: '£95.00' },
      staffReferences: [staffReference],
      locationReferences: [locationReference],
      waitlistEligible: true,
    }],
    staff: [], locations: [], availability: [], campaigns: [], warnings: [],
    telemetry: { cacheClass: 'LIVE_FAST', cacheHit: false, fallbackActivated: false, queryCount: 5, resolutionMs: 10 },
  } as const;
  const liveMarkup = renderSection(serviceSection, { ...context, page: servicePage, live });
  assert.match(liveMarkup, /£95\.00/);
  assert.match(liveMarkup, /75 minutes/);
  assert.match(liveMarkup, /<h1>Service detail<\/h1>/);
  assert.match(liveMarkup, /Join waitlist/);
  assert.ok(liveMarkup.includes(`/waitlist?service=${serviceReference}`));

  const fallbackMarkup = renderSection(serviceSection, {
    ...context,
    page: servicePage,
    live: { ...live, services: [], telemetry: { ...live.telemetry, fallbackActivated: true } },
  });
  assert.doesNotMatch(fallbackMarkup, /£95\.00/);
  assert.match(fallbackMarkup, new RegExp(snapshot.services[0]!.name));
});

test('unavailable services expose a waitlist action only when explicitly eligible', () => {
  const serviceSection = sectionFor('SERVICE_DETAILS');
  const servicePage = { ...page, pageType: 'SERVICE_DETAIL', sections: [serviceSection] } as PublishedPageSnapshot;
  const live = {
    schemaVersion: 1,
    dataClass: 'LIVE',
    siteReference: snapshot.siteReference,
    resolvedAt: '2026-08-11T12:00:00.000Z',
    services: [{
      publicReference: serviceReference,
      exists: true,
      active: true,
      bookingEligible: false,
      staffReferences: [],
      locationReferences: [],
      waitlistEligible: false,
    }],
    staff: [], locations: [], availability: [], campaigns: [], warnings: [],
    telemetry: { cacheClass: 'LIVE_FAST', cacheHit: false, fallbackActivated: false, queryCount: 5, resolutionMs: 10 },
  } as const;
  const markup = renderSection(serviceSection, { ...context, page: servicePage, live });
  assert.doesNotMatch(markup, /Join waitlist/);
  assert.doesNotMatch(markup, /href="\/waitlist/);
});

test('generic booking actions inherit stable service page context server-side', () => {
  const serviceSection = sectionFor('SERVICE_DETAILS');
  const servicePage = { ...page, pageType: 'SERVICE_DETAIL', sections: [serviceSection] } as PublishedPageSnapshot;
  assert.equal(
    actionHref({ type: 'KS_OS_BOOKING', label: 'Book now' }, { ...context, page: servicePage }),
    `/book?service=${serviceReference}`,
  );
});

test('unsupported section/component conditions fail deterministic validation', () => {
  const conditional = SiteSectionSchema.parse({
    ...sectionFor('SERVICE_DETAILS'),
    showIf: {
      version: 1,
      all: [{ key: 'STAFF_ACTIVE', subjectReference: staffReference }],
    },
  });
  const component = resolveSiteComponent({ sectionType: 'SERVICE_DETAILS' });
  assert.deepEqual(validateSiteSectionComponent(conditional, component), [
    'Component does not support condition STAFF_ACTIVE.',
  ]);
  const servicePage = { ...page, pageType: 'SERVICE_DETAIL', sections: [conditional] } as PublishedPageSnapshot;
  assert.throws(
    () => renderSection(conditional, { ...context, page: servicePage }),
    /does not support condition STAFF_ACTIVE/,
  );
});

test('explicitly optional live sections hide on false and render published fallback on unknown', () => {
  const conditional = SiteSectionSchema.parse({
    ...sectionFor('ANNOUNCEMENT_BAR'),
    showIf: {
      version: 1,
      all: [{ key: 'CAMPAIGN_ACTIVE', subjectReference: serviceReference }],
    },
  });
  const noLive = renderSection(conditional, context);
  assert.match(noLive, /Appointments are available this week/);
  const disabledLive = {
    schemaVersion: 1,
    dataClass: 'LIVE',
    siteReference: '77777777-7777-4777-8777-777777777777',
    resolvedAt: '2026-08-11T12:00:00.000Z',
    services: [], staff: [], locations: [], availability: [], campaigns: [], warnings: [],
    telemetry: { cacheClass: 'LIVE_FAST', cacheHit: false, fallbackActivated: false, queryCount: 5, resolutionMs: 10 },
  } as const;
  assert.equal(String(renderSection(conditional, { ...context, live: disabledLive })), '');
});

test('all approved campaign placements render through controlled booking actions', () => {
  const placements = ['ANNOUNCEMENT', 'HERO', 'PAGE_BODY', 'PAGE_END'] as const;
  const live = {
    schemaVersion: 1,
    dataClass: 'LIVE',
    siteReference: '77777777-7777-4777-8777-777777777777',
    resolvedAt: '2026-08-11T12:00:00.000Z',
    services: [], staff: [], locations: [], availability: [], warnings: [],
    campaigns: placements.map((placement, index) => ({
      publicReference: `88888888-8888-4888-8888-88888888888${index}`,
      active: true,
      message: `${placement} approved campaign`,
      placement,
      action: {
        type: 'KS_OS_BOOKING' as const,
        label: 'View availability',
        campaignReference: `88888888-8888-4888-8888-88888888888${index}`,
      },
      serviceReferences: [],
      locationReferences: [],
      startsAt: '2026-08-11T11:00:00.000Z',
      endsAt: '2026-08-12T11:00:00.000Z',
    })),
    telemetry: { cacheClass: 'LIVE_FAST', cacheHit: false, fallbackActivated: false, queryCount: 5, resolutionMs: 10 },
  } as const;
  for (const placement of placements) {
    const markup = placement === 'HERO'
      ? renderSection(sectionFor('HERO'), { ...context, live })
      : renderLiveCampaignPlacement(placement, { ...context, live });
    assert.match(markup, new RegExp(`${placement} approved campaign`));
    assert.match(markup, /campaign=/);
  }
});

test('version-bound recommendations render visibly and keep approved fallback links', () => {
  const targetPageReference = '99999999-9999-4999-8999-999999999999';
  const targetPage = {
    ...page,
    publicReference: targetPageReference,
    path: '/guide',
    title: 'Preparation guide',
    active: true,
    pageType: 'GUIDE',
  } as PublishedPageSnapshot;
  const recommendationContext: ComponentRenderContext = {
    ...context,
    snapshot: { ...snapshot, pages: [page, targetPage] } as PublishedSiteSnapshot,
    pagePathByReference: { [pageReference]: '/', [targetPageReference]: '/guide' },
    recommendations: [{
      sourcePageReference: pageReference,
      targetPageReference,
      anchorText: 'Read the preparation guide',
      relationship: 'USEFUL_GUIDE',
      governedOrder: 0,
      approved: true,
    }],
  };
  const markup = renderGovernedRecommendations(recommendationContext);
  assert.match(markup, /Recommended next/);
  assert.match(markup, /href="\/guide"/);
  assert.match(markup, /Read the preparation guide/);
});
