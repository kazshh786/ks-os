import assert from 'node:assert/strict';
import test from 'node:test';
import type { SitePageType, SiteSection } from '@ks-os/site-schema';
import {
  PAGE_COMPLETENESS_RECIPES,
  createDeterministicAssetCoveragePlan,
  detectCompositionRepetition,
  listPageCompletenessRecipes,
  pageCompositionResponseJsonSchema,
  validateAssetCoveragePlan,
  validatePageCompositionPlan,
  validatePageCompleteness,
  type GeneratedPage,
  type PageCompositionPlan,
  type VerifiedBusinessFacts,
} from '../src/index.js';

const ids = Array.from({ length: 40 }, (_, index) =>
  `${String(index + 1).padStart(8, '0')}-1111-4111-8111-${String(index + 1).padStart(12, '0')}`);
const words = (label: string, count = 90) => Array.from({ length: count }, (_, index) => `${label}${index}`).join(' ');
const book = { type: 'KS_OS_BOOKING' as const, label: 'Book now' };

function section(type: SiteSection['type'], index: number, componentKey: string, extra: Record<string, unknown> = {}) {
  return { reference: ids[index]!, type, componentKey, ...extra } as SiteSection;
}

function generatedPage(
  pageType: SitePageType,
  sections: SiteSection[],
  reference = ids[30]!,
  uniqueCopy = '',
): GeneratedPage {
  return {
    pageReference: reference,
    title: `${pageType} ${uniqueCopy}`,
    navigationLabel: pageType,
    slug: pageType === 'HOME' ? 'home' : `${pageType.toLowerCase().replaceAll('_', '-')}-${reference.slice(0, 4)}`,
    pageType,
    conversionRole: pageType === 'BOOKING' ? 'BOOKING' : pageType.includes('SERVICE') ? 'SERVICE_CONVERSION' : 'PRIMARY_LANDING',
    layoutReference: ids[31]!,
    seo: {
      title: `${pageType} page`, description: words('description', 18), canonicalPath: pageType === 'HOME' ? '/' : `/${pageType.toLowerCase().replaceAll('_', '-')}`,
      index: true, follow: true, openGraphTitle: `${pageType} page`, openGraphDescription: words('open', 18), twitterCard: 'summary',
    },
    sections,
    internalLinks: [{ pageReference: ids[32]!, intent: 'Continue the verified visitor journey.' }],
    structuredDataInputs: [],
    assetRequirements: [],
    missingDataFindings: [],
    claims: [],
  } as GeneratedPage;
}

function shallowHome() {
  return generatedPage('HOME', [
    section('HEADER', 0, 'header-classic-v1', { primaryAction: book }),
    section('HERO', 1, 'hero-centered-v1', { heading: 'Welcome', body: words('hero', 20), primaryAction: book }),
    section('FINAL_CTA', 2, 'cta-banner-v1', { heading: 'Book', body: words('cta', 12), primaryAction: book }),
    section('FOOTER', 3, 'footer-compact-v1', { primaryAction: book }),
  ]);
}

function richHome() {
  return generatedPage('HOME', [
    section('HEADER', 0, 'header-classic-v1', { primaryAction: book }),
    section('HERO', 1, 'hero-centered-v1', { heading: 'A useful welcome', body: words('homehero'), primaryAction: book }),
    section('INTRODUCTION', 2, 'intro-centered-v1', { heading: 'Our approach', body: words('intro') }),
    section('FEATURED_SERVICES', 3, 'services-editorial-grid-v1', { heading: 'Services', serviceReferences: [ids[20]] }),
    section('BENEFITS', 4, 'benefits-numbered-v1', { heading: 'Benefits', items: [{ heading: 'Thoughtful', body: words('benefit') }] }),
    section('PROCESS', 5, 'process-timeline-v1', { heading: 'Process', steps: [{ heading: 'Plan', body: words('process') }] }),
    section('TEAM', 6, 'team-editorial-v1', { heading: 'Team', staffReferences: [ids[21]] }),
    section('FAQ', 7, 'faq-accordion-v1', { heading: 'Questions', items: [{ question: 'What happens?', answer: words('answer') }] }),
    section('LOCATION', 8, 'location-details-card-v1', { heading: 'Visit', locationReference: ids[22] }),
    section('TRUST_INDICATORS', 9, 'trust-cards-v1', { heading: 'Trust', items: [{ label: 'Verified', detail: words('trust') }] }),
    section('FINAL_CTA', 10, 'cta-editorial-v1', { heading: 'Plan a visit', body: words('final', 30), primaryAction: book }),
    section('FOOTER', 11, 'footer-multi-column-v1', { primaryAction: book }),
  ]);
}

test('defines a page-purpose completeness recipe for every supported page type', () => {
  const recipes = listPageCompletenessRecipes();
  assert.equal(recipes.length, 16);
  assert.deepEqual(new Set(recipes.map(recipe => recipe.pageType)), new Set(Object.keys(PAGE_COMPLETENESS_RECIPES)));
  for (const recipe of recipes) {
    assert.ok(recipe.pagePurpose.length > 20);
    assert.ok(recipe.recommendedSectionTypes.length > 0);
  }
});

test('shallow Home fails while a substantial Home reaches design complete before browser evidence', () => {
  const shallow = validatePageCompleteness({ page: shallowHome() });
  assert.equal(shallow.state, 'SCHEMA_VALID');
  assert.ok(shallow.findings.some(finding => finding.code === 'PAGE_TOO_SHALLOW' && finding.severity === 'ERROR'));

  const rich = validatePageCompleteness({ page: richHome() });
  assert.equal(rich.state, 'DESIGN_COMPLETE');
  assert.equal(rich.findings.some(finding => finding.severity === 'ERROR'), false);
  assert.ok(rich.metrics.substantiveSections >= 6);
});

test('V2 page planning enriches a legacy seed but rejects a shallow composition', () => {
  const page = {
    blueprintPageReference: ids[28]!, pageReference: ids[30]!, title: 'Home', slug: 'home',
    pageType: 'HOME' as const, conversionRole: 'PRIMARY_LANDING' as const,
    layoutReference: ids[29]!, plannedSectionTypes: ['HEADER', 'HERO', 'FINAL_CTA', 'FOOTER'] as const,
  };
  const order = ['HEADER', 'HERO', 'INTRODUCTION', 'FEATURED_SERVICES', 'BENEFITS', 'PROCESS', 'TEAM', 'TRUST_INDICATORS', 'FAQ', 'LOCATION', 'FINAL_CTA', 'FOOTER'] as const;
  const template = {
    templateVersionReference: ids[27]!, templateSourceType: 'INTERNAL' as const,
    templateVersionStatus: 'APPROVED' as const, licenceStatus: 'NOT_REQUIRED' as const,
    layoutReference: ids[29]!, layoutStatus: 'APPROVED' as const,
    compatiblePageTypes: ['HOME'] as const, rendererKey: 'home-editorial-v1', rendererVersion: 1,
    rendererStatus: 'READY' as const, requiredSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'FEATURED_SERVICES', 'BENEFITS', 'TRUST_INDICATORS', 'FINAL_CTA', 'FOOTER'] as const,
    prohibitedSectionTypes: [], sectionOrder: order, componentRegistryVersion: 2,
    availableComponentKeys: ['header-classic-v1', 'hero-centered-v1', 'intro-centered-v1', 'services-editorial-grid-v1', 'benefits-numbered-v1', 'process-timeline-v1', 'team-editorial-v1', 'trust-cards-v1', 'faq-accordion-v1', 'location-details-card-v1', 'cta-editorial-v1', 'footer-multi-column-v1'],
  };
  const responseSchema = pageCompositionResponseJsonSchema({
    page: page as any,
    template: template as any,
    approvedPageReferences: [ids[30]!, ids[31]!],
  }) as any;
  assert.deepEqual(responseSchema.properties.pageReference.enum, [ids[30]!]);
  assert.deepEqual(responseSchema.properties.internalLinkIntent.items.properties.targetPageReference.enum, [ids[30]!, ids[31]!]);
  assert.ok(responseSchema.properties.selectedComponents.items.properties.componentKey.enum.includes('hero-centered-v1'));
  assert.equal(responseSchema.properties.selectedComponents.items.additionalProperties, false);
  const selection = (sectionType: typeof order[number], componentKey: string) => ({
    sectionType, componentKey, purpose: `Provide a complete ${sectionType.toLowerCase()} part of the page.`,
    dataBindings: sectionType === 'FEATURED_SERVICES' ? ['SERVICES'] : sectionType === 'TEAM' ? ['STAFF'] : sectionType === 'LOCATION' ? ['LOCATIONS'] : sectionType === 'FINAL_CTA' || sectionType === 'HEADER' || sectionType === 'FOOTER' || sectionType === 'HERO' ? ['BUSINESS', 'BOOKING'] : ['BUSINESS'],
    assetAssignments: [],
  });
  const shallowPlan = {
    pageReference: ids[30]!, pagePurpose: 'Introduce the business and convert visitors.', conversionGoal: 'Guide visitors to native booking.',
    contentNarrative: 'A concise introduction followed by a booking action.',
    selectedComponents: [selection('HEADER', 'header-classic-v1'), selection('HERO', 'hero-centered-v1'), selection('FINAL_CTA', 'cta-editorial-v1'), selection('FOOTER', 'footer-multi-column-v1')],
    internalLinkIntent: [], ctaIntent: 'Use native booking as the primary conversion.',
  } as PageCompositionPlan;
  assert.ok(validatePageCompositionPlan({ output: shallowPlan, page: page as any, template: template as any, approvedPageReferences: [ids[30]!] }).some(finding => finding.code === 'PAGE_TOO_SHALLOW'));

  const richPlan = {
    ...shallowPlan,
    selectedComponents: order.map((type, index) => selection(type, template.availableComponentKeys[index]!)),
  } as PageCompositionPlan;
  assert.equal(validatePageCompositionPlan({ output: richPlan, page: page as any, template: template as any, approvedPageReferences: [ids[30]!] }).some(finding => finding.severity === 'ERROR'), false);
});

test('shallow Service Detail fails and a complete service composition passes deterministic depth', () => {
  const shallow = generatedPage('SERVICE_DETAIL', [
    section('HEADER', 0, 'header-classic-v1', { primaryAction: book }),
    section('SERVICE_DETAILS', 1, 'service-detail-editorial-v1', { heading: 'Service', body: words('short', 30), serviceReference: ids[20], primaryAction: { ...book, serviceReference: ids[20] } }),
    section('BOOKING_CTA', 2, 'cta-banner-v1', { heading: 'Book', body: words('cta', 10), primaryAction: book }),
    section('FOOTER', 3, 'footer-compact-v1', { primaryAction: book }),
  ]);
  assert.ok(validatePageCompleteness({ page: shallow }).findings.some(finding => finding.code === 'INCOMPLETE_SERVICE_CONTENT'));

  const complete = generatedPage('SERVICE_DETAIL', [
    section('HEADER', 0, 'header-classic-v1', { primaryAction: book }),
    section('HERO', 1, 'hero-service-v1', { heading: 'Specific service', body: words('servicehero'), primaryAction: book }),
    section('SERVICE_DETAILS', 2, 'service-detail-information-rich-v1', { heading: 'Overview', body: words('overview'), serviceReference: ids[20], primaryAction: { ...book, serviceReference: ids[20] } }),
    section('BENEFITS', 3, 'benefits-editorial-v1', { heading: 'Benefits', items: [{ heading: 'Benefit', body: words('benefit') }] }),
    section('PROCESS', 4, 'process-editorial-v1', { heading: 'Process', steps: [{ heading: 'Step', body: words('step') }] }),
    section('PRICING', 5, 'pricing-editorial-v1', { heading: 'Price', items: [{ label: 'Service', priceText: '£50', description: words('price', 50) }] }),
    section('FAQ', 6, 'faq-editorial-v1', { heading: 'Questions', items: [{ question: 'How?', answer: words('faq') }] }),
    section('TRUST_INDICATORS', 7, 'trust-editorial-v1', { items: [{ label: 'Verified', detail: words('verified', 50) }] }),
    section('BOOKING_CTA', 8, 'cta-editorial-v1', { heading: 'Book', body: words('booking', 25), primaryAction: book }),
    section('FOOTER', 9, 'footer-editorial-v1', { primaryAction: book }),
  ]);
  assert.equal(validatePageCompleteness({ page: complete }).findings.some(finding => finding.severity === 'ERROR'), false);
});

test('booking pages receive the deliberate marketing-depth exemption', () => {
  const booking = generatedPage('BOOKING', [
    section('HEADER', 0, 'header-booking-led-v1', { primaryAction: book }),
    section('INTRODUCTION', 1, 'intro-centered-v1', { heading: 'Book securely', body: words('flow', 20) }),
    section('BOOKING_CTA', 2, 'cta-minimal-v1', { heading: 'Choose an appointment', body: words('booking', 10), primaryAction: book }),
    section('FOOTER', 3, 'footer-booking-led-v1', { primaryAction: book }),
  ]);
  const result = validatePageCompleteness({ page: booking });
  assert.equal(result.findings.some(finding => finding.code === 'PAGE_TOO_SHALLOW'), false);
  assert.equal(result.findings.some(finding => finding.severity === 'ERROR'), false);
});

const facts = {
  assetReferences: [ids[20]!],
  approvedAssets: [{ publicReference: ids[20]!, assetClass: 'STAFF', approved: true }],
} as VerifiedBusinessFacts;

const portraitPlan = {
  pageReference: ids[30]!, pagePurpose: 'Present this staff profile.', conversionGoal: 'Book with this member of staff.', contentNarrative: 'Introduce expertise and guide the visitor to native booking.',
  selectedComponents: [{ sectionType: 'STAFF_PROFILE', componentKey: 'profile-split-v1', purpose: 'Present the verified staff profile.', dataBindings: ['STAFF'], assetAssignments: [] }],
  internalLinkIntent: [], ctaIntent: 'Book with this member of staff.',
} as PageCompositionPlan;

test('asset planning binds approved tenant assets and emits preview-only missing findings', () => {
  const required = new Map([['profile-split-v1', ['PORTRAIT'] as const]]);
  const approved = createDeterministicAssetCoveragePlan({ facts, pages: [portraitPlan], requiredSlotsByComponentKey: required });
  assert.equal(approved.assignments[0]?.assetReference, ids[20]);
  assert.equal(validateAssetCoveragePlan({ plan: approved, facts, approvedPageReferences: [ids[30]!] }).length, 0);

  const missing = createDeterministicAssetCoveragePlan({ facts: { ...facts, approvedAssets: [], assetReferences: [] }, pages: [portraitPlan], requiredSlotsByComponentKey: required });
  assert.equal(missing.assignments[0]?.placeholderCode, 'STAFF_PORTRAIT_REQUIRED');
  assert.ok(validateAssetCoveragePlan({ plan: missing, facts: { ...facts, approvedAssets: [], assetReferences: [] }, approvedPageReferences: [ids[30]!] }).some(finding => finding.code === 'MISSING_REQUIRED_ASSET'));
});

test('cross-tenant asset references are rejected', () => {
  const findings = validateAssetCoveragePlan({
    facts,
    approvedPageReferences: [ids[30]!],
    plan: {
      inventory: facts.approvedAssets,
      assignments: [{ pageReference: ids[30]!, sectionType: 'STAFF_PROFILE', componentKey: 'profile-split-v1', slot: 'PORTRAIT', assetReference: ids[25]! }],
      uncoveredRequirements: [],
    },
  });
  assert.ok(findings.some(finding => finding.code === 'CROSS_TENANT_ASSET_REJECTED' && finding.severity === 'ERROR'));
});

test('repetition checks catch exact copy and overused heroes while allowing intentional service-family structure', () => {
  const repeated = [0, 1, 2, 3].map(index => generatedPage('ABOUT', [
    section('HERO', 1, 'hero-centered-v1', { heading: 'Same heading', body: words('identical'), primaryAction: book }),
    section('INTRODUCTION', 2, 'intro-centered-v1', { heading: 'Same introduction', body: words('same') }),
  ], ids[30 + index]!, `copy-${index}`));
  const repeatedFindings = detectCompositionRepetition(repeated);
  assert.ok(repeatedFindings.some(finding => finding.code === 'EXCESSIVE_COMPONENT_REPETITION'));
  assert.ok(repeatedFindings.some(finding => finding.code === 'EXCESSIVE_COPY_REPETITION' && finding.severity === 'ERROR'));

  const serviceA = generatedPage('SERVICE_DETAIL', [section('SERVICE_DETAILS', 1, 'service-detail-editorial-v1', { heading: 'Cut service', body: `${words('shared', 30)} ${words('cut', 50)}` })], ids[34]!, 'Cut');
  const serviceB = generatedPage('SERVICE_DETAIL', [section('SERVICE_DETAILS', 1, 'service-detail-editorial-v1', { heading: 'Colour service', body: `${words('shared', 30)} ${words('colour', 50)}` })], ids[35]!, 'Colour');
  assert.equal(detectCompositionRepetition([serviceA, serviceB]).some(finding => finding.code === 'EXCESSIVE_COPY_REPETITION' && finding.severity === 'ERROR'), false);
});
