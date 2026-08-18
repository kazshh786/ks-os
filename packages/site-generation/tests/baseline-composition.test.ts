import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSiteComponent,
  listSiteComponents,
} from '@ks-os/site-components';
import type { SiteConversionRole, SitePageType, SiteSectionType } from '@ks-os/site-schema';
import {
  createBaselineComposition,
  createBaselinePageCompositionPlan,
} from '../src/baseline-composition.js';
import { parseSiteGenerationConfig } from '../src/config.js';
import { validatePageCompositionPlan } from '../src/composition.js';
import { executeStructuredSiteGeneration } from '../src/orchestrator.js';
import { PAGE_COMPLETENESS_RECIPES } from '../src/recipes.js';
import type {
  GeneratedPage,
  GenerationPlan,
  PageCompositionPlan,
  TemplateGenerationConstraint,
  VerifiedBusinessFacts,
} from '../src/contracts.js';
import type { PageSeoBrief } from '../src/search-intelligence.js';
import type { SiteGenerationProvider } from '../src/provider.js';

const id = (value: number) =>
  `${String(value).padStart(8, '0')}-3333-4333-8333-${String(value).padStart(12, '0')}`;

const roles: Partial<Record<SitePageType, SiteConversionRole>> = {
  SERVICE_HUB: 'SERVICE_CONVERSION',
  SERVICE_DETAIL: 'SERVICE_CONVERSION',
  LOCATION_HUB: 'LOCAL_DISCOVERY',
  LOCATION_DETAIL: 'LOCAL_DISCOVERY',
  BOOKING: 'BOOKING',
};

const completeFacts = (approvedAssets: VerifiedBusinessFacts['approvedAssets'] = []): VerifiedBusinessFacts => ({
  businessReference: id(1),
  business: [
    { key: 'business_name', value: 'Governed Studio', status: 'VERIFIED' },
    { key: 'booking_enabled', value: true, status: 'VERIFIED' },
    { key: 'phone_number', value: '020 7000 0000', status: 'TENANT_CONFIRMED' },
    { key: 'public_email', value: 'hello@example.test', status: 'TENANT_CONFIRMED' },
  ],
  services: [{
    publicReference: id(2),
    facts: [
      { key: 'service_name', value: 'Consultation', status: 'VERIFIED' },
      { key: 'service_description', value: 'A verified consultation.', status: 'VERIFIED' },
      { key: 'service_price', value: '65.00', status: 'VERIFIED' },
    ],
  }],
  locations: [{
    publicReference: id(3),
    facts: [
      { key: 'location_name', value: 'Central Studio', status: 'VERIFIED' },
      { key: 'physical_address', value: '1 High Street', status: 'VERIFIED' },
      { key: 'opening_hours', value: 'MONDAY 09:00-17:00', status: 'VERIFIED' },
    ],
  }],
  staff: [{
    publicReference: id(4),
    facts: [
      { key: 'staff_name', value: 'Alex Example', status: 'VERIFIED' },
      { key: 'staff_biography', value: 'A verified team biography.', status: 'VERIFIED' },
    ],
  }],
  policies: [{ key: 'cancellation_policy', value: 'The verified cancellation policy.', status: 'VERIFIED' }],
  brand: [],
  assetReferences: approvedAssets.map(asset => asset.publicReference),
  approvedAssets,
});

const extraSections: Partial<Record<SitePageType, readonly SiteSectionType[]>> = {
  SERVICE_DETAIL: ['TRUST_INDICATORS'],
  TEAM_DETAIL: ['FAQ'],
  NEW_CLIENT_GUIDE: ['OPENING_HOURS'],
};

function fixture(pageType: SitePageType, index: number) {
  const recipe = PAGE_COMPLETENESS_RECIPES[pageType];
  const sectionOrder = [...new Set([
    ...recipe.recommendedSectionTypes,
    ...(extraSections[pageType] ?? []),
  ])];
  const page = {
    blueprintPageReference: id(100 + index),
    pageReference: id(200 + index),
    title: `${pageType} baseline`,
    slug: pageType === 'HOME' ? 'home' : pageType.toLowerCase().replaceAll('_', '-'),
    pageType,
    conversionRole: roles[pageType] ?? 'PRIMARY_LANDING' as SiteConversionRole,
    layoutReference: id(300 + index),
    plannedSectionTypes: sectionOrder,
    ...(pageType === 'SERVICE_DETAIL' ? { serviceReference: id(2) } : {}),
    ...(pageType === 'LOCATION_DETAIL' ? { locationReference: id(3) } : {}),
    ...(pageType === 'TEAM_DETAIL' ? { staffReference: id(4) } : {}),
  };
  const availableComponentKeys = sectionOrder.flatMap(sectionType =>
    listSiteComponents({ sectionType, pageType, conversionRole: page.conversionRole })
      .map(component => component.componentKey));
  const template: TemplateGenerationConstraint = {
    templateVersionReference: id(500),
    templateSourceType: 'INTERNAL',
    templateVersionStatus: 'APPROVED',
    licenceStatus: 'NOT_REQUIRED',
    layoutReference: page.layoutReference,
    layoutStatus: 'APPROVED',
    compatiblePageTypes: [pageType],
    rendererKey: `${pageType.toLowerCase().replaceAll('_', '-')}-baseline-v1`,
    rendererVersion: 1,
    rendererStatus: 'READY',
    requiredSectionTypes: recipe.bookingDepthExempt
      ? ['HEADER', 'INTRODUCTION', 'BOOKING_CTA', 'FOOTER']
      : sectionOrder.filter(type => ['HEADER', 'HERO', 'RICH_TEXT', 'FINAL_CTA', 'BOOKING_CTA', 'FOOTER'].includes(type)),
    prohibitedSectionTypes: [],
    sectionOrder,
    componentRegistryVersion: 2,
    availableComponentKeys,
  };
  return { page, template };
}

const words = (label: string, count = 110) =>
  Array.from({ length: count }, (_, index) => `${label}${index}`).join(' ');
const bookingAction = { type: 'KS_OS_BOOKING' as const, label: 'Book now' };

function generatedSection(
  selection: PageCompositionPlan['selectedComponents'][number],
  index: number,
  heading: string,
) {
  const base = { reference: id(2_000 + index), type: selection.sectionType, componentKey: selection.componentKey };
  switch (selection.sectionType) {
    case 'HEADER': return { ...base, primaryAction: bookingAction };
    case 'HERO': return { ...base, heading, body: words('hero'), primaryAction: bookingAction };
    case 'INTRODUCTION': return { ...base, heading, body: words('introduction') };
    case 'FEATURED_SERVICES': return { ...base, heading: 'Verified services', serviceReferences: [id(2)] };
    case 'SERVICE_GRID': return { ...base, heading: 'Explore services', serviceReferences: [id(2)] };
    case 'SERVICE_DETAILS': return { ...base, heading, body: words('service'), serviceReference: id(2), primaryAction: { ...bookingAction, serviceReference: id(2) } };
    case 'BENEFITS': return { ...base, heading: 'Why this helps', items: [{ heading: 'A considered benefit', body: words('benefit') }] };
    case 'PROCESS': return { ...base, heading: 'What to expect', steps: [{ heading: 'A clear first step', body: words('process') }] };
    case 'PRICING': return { ...base, heading: 'Verified pricing', items: [{ label: 'Consultation', priceText: '£65', description: words('pricing', 40) }] };
    case 'TEAM': return { ...base, heading: 'Meet the team', staffReferences: [id(4)] };
    case 'STAFF_PROFILE': return { ...base, staffReference: id(4), primaryAction: bookingAction };
    case 'GALLERY': return { ...base, heading: 'Approved gallery', assetReferences: [id(10)] };
    case 'RESULTS': return { ...base, heading: 'Approved results', items: [{ afterAssetReference: id(10) }] };
    case 'TESTIMONIALS': return { ...base, heading: 'Approved feedback', items: [{ quote: 'Approved feedback.', attribution: 'Verified client' }] };
    case 'TRUST_INDICATORS': return { ...base, heading: 'Verified details', items: [{ label: 'Governed information', detail: words('trust', 30) }] };
    case 'FAQ': return { ...base, heading: 'Common questions', items: [{ question: 'What should I expect?', answer: words('answer') }] };
    case 'LOCATION': return { ...base, heading: 'Visit the studio', locationReference: id(3) };
    case 'OPENING_HOURS': return { ...base, heading: 'Opening hours', locationReference: id(3) };
    case 'CONTACT': return { ...base, heading: 'Contact the studio', body: words('contact', 50), locationReference: id(3), secondaryActions: [] };
    case 'BOOKING_CTA': return { ...base, heading: 'Choose an appointment', body: words('booking', 40), primaryAction: bookingAction };
    case 'FINAL_CTA': return { ...base, heading: 'Plan your visit', body: words('conversion', 40), primaryAction: bookingAction };
    case 'FOOTER': return { ...base, primaryAction: bookingAction };
    case 'RICH_TEXT': return { ...base, heading: 'Governed guidance', document: { blocks: [{ type: 'PARAGRAPH', children: [{ type: 'TEXT', text: words('guidance') }] }] } };
    case 'ANNOUNCEMENT_BAR': return { ...base, message: 'Verified appointment information.' };
  }
  throw new Error(`Unsupported baseline test section: ${selection.sectionType}`);
}

function generatedPage(
  page: ReturnType<typeof fixture>['page'],
  plan: PageCompositionPlan,
  brief: PageSeoBrief,
): GeneratedPage {
  return {
    pageReference: page.pageReference,
    title: brief.recommendedH1,
    navigationLabel: page.title,
    slug: page.slug,
    pageType: page.pageType,
    conversionRole: page.conversionRole,
    layoutReference: page.layoutReference,
    seo: {
      title: brief.recommendedTitle,
      description: brief.recommendedMetaDescription,
      canonicalPath: brief.canonicalPath,
      index: brief.indexation === 'INDEX',
      follow: true,
      openGraphTitle: brief.recommendedTitle,
      openGraphDescription: brief.recommendedMetaDescription,
      twitterCard: 'summary_large_image',
    },
    sections: plan.selectedComponents.map((selection, index) =>
      generatedSection(selection, index + (page.pageType === 'HOME' ? 0 : 100), brief.recommendedH1)),
    internalLinks: brief.internalLinks.map(link => ({
      targetPageReference: link.targetPageReference,
      anchorText: link.anchorText,
    })),
    structuredDataInputs: [],
    assetRequirements: [],
    missingDataFindings: [],
    claims: [],
  } as GeneratedPage;
}

test('A: Home baseline is substantial, valid, allow-listed and deterministic', () => {
  const { page, template } = fixture('HOME', 1);
  const assets = [
    { publicReference: id(10), assetClass: 'BRAND' as const, approved: true as const },
    { publicReference: id(11), assetClass: 'STAFF' as const, entityReference: id(4), approved: true as const },
    { publicReference: id(12), assetClass: 'LOCATION' as const, entityReference: id(3), approved: true as const },
  ];
  const input = {
    page,
    template,
    facts: completeFacts(assets),
    approvedPageReferences: [page.pageReference, id(999)],
  };
  const first = createBaselinePageCompositionPlan(input);
  const second = createBaselinePageCompositionPlan(structuredClone(input));
  assert.deepEqual(first, second);
  assert.ok(first.selectedComponents.length >= 10 && first.selectedComponents.length <= 14);
  assert.ok(first.selectedComponents.some(section => section.sectionType === 'HERO'));
  assert.ok(first.selectedComponents.some(section => section.sectionType === 'FEATURED_SERVICES'));
  assert.ok(first.selectedComponents.some(section => section.sectionType === 'TEAM'));
  assert.ok(first.selectedComponents.some(section => section.sectionType === 'LOCATION'));
  assert.equal(validatePageCompositionPlan({
    output: first,
    page,
    template,
    approvedPageReferences: input.approvedPageReferences,
    approvedAssetReferences: assets.map(asset => asset.publicReference),
  }).some(finding => finding.severity === 'ERROR'), false);
  for (const selection of first.selectedComponents) {
    const component = getSiteComponent(selection.componentKey)!;
    assert.equal(component.status, 'ACTIVE');
    assert.ok(component.compatibleSectionTypes.includes(selection.sectionType));
    assert.ok(component.supportedPageTypes.includes(page.pageType));
  }
  assert.doesNotMatch(JSON.stringify(first), /<\/?[a-z]|javascript:|```/i);
});

test('B: service hub and service detail receive strong non-uniform compositions', () => {
  const hub = fixture('SERVICE_HUB', 2);
  const detail = fixture('SERVICE_DETAIL', 3);
  const hubPlan = createBaselinePageCompositionPlan({
    ...hub,
    facts: completeFacts(),
    approvedPageReferences: [hub.page.pageReference, detail.page.pageReference],
  });
  const detailPlan = createBaselinePageCompositionPlan({
    ...detail,
    facts: completeFacts(),
    approvedPageReferences: [hub.page.pageReference, detail.page.pageReference],
  });
  assert.ok(hubPlan.selectedComponents.some(section => section.sectionType === 'SERVICE_GRID'));
  assert.ok(detailPlan.selectedComponents.some(section => section.sectionType === 'SERVICE_DETAILS'));
  assert.ok(detailPlan.selectedComponents.some(section => section.sectionType === 'TRUST_INDICATORS'));
  assert.notDeepEqual(
    hubPlan.selectedComponents.map(section => section.componentKey),
    detailPlan.selectedComponents.map(section => section.componentKey),
  );
});

test('baseline recipes cover location, contact, FAQ, guide, policies and booking page purposes', () => {
  const expectations: Partial<Record<SitePageType, readonly SiteSectionType[]>> = {
    LOCATION_DETAIL: ['LOCATION', 'OPENING_HOURS', 'CONTACT', 'FEATURED_SERVICES'],
    CONTACT: ['CONTACT', 'LOCATION', 'OPENING_HOURS'],
    FAQ: ['FAQ'],
    NEW_CLIENT_GUIDE: ['RICH_TEXT', 'PROCESS', 'LOCATION', 'FAQ'],
    POLICIES: ['RICH_TEXT'],
    BOOKING: ['INTRODUCTION', 'BOOKING_CTA'],
  };
  for (const [index, pageType] of (Object.keys(expectations) as SitePageType[]).entries()) {
    const { page, template } = fixture(pageType, 20 + index);
    const approvedPageReferences = [page.pageReference, id(999)];
    const plan = createBaselinePageCompositionPlan({
      page,
      template,
      facts: completeFacts(),
      approvedPageReferences,
    });
    const selected = new Set(plan.selectedComponents.map(section => section.sectionType));
    for (const required of expectations[pageType] ?? []) assert.ok(selected.has(required), `${pageType} omitted ${required}`);
    const findings = validatePageCompositionPlan({
      output: plan,
      page,
      template,
      approvedPageReferences,
    });
    assert.equal(
      findings.some(finding => finding.severity === 'ERROR'),
      false,
      `${pageType}: ${findings.map(finding => finding.code).join(', ')}`,
    );
  }
});

test('C-D-E: approved staff media is used and missing optional media falls back to text-safe variants', () => {
  const { page, template } = fixture('TEAM_HUB', 4);
  const staffAsset = {
    publicReference: id(20),
    assetClass: 'STAFF' as const,
    entityReference: id(4),
    approved: true as const,
  };
  const withAsset = createBaselinePageCompositionPlan({
    page,
    template,
    facts: completeFacts([staffAsset]),
    approvedPageReferences: [page.pageReference, id(999)],
  });
  const mediaTeam = withAsset.selectedComponents.find(section => section.sectionType === 'TEAM')!;
  assert.match(mediaTeam.componentKey, /portrait|image/);
  assert.ok(mediaTeam.assetAssignments.some(assignment => assignment.assetReference === staffAsset.publicReference));

  const withoutAsset = createBaselinePageCompositionPlan({
    page,
    template,
    facts: completeFacts(),
    approvedPageReferences: [page.pageReference, id(999)],
  });
  const textTeam = withoutAsset.selectedComponents.find(section => section.sectionType === 'TEAM')!;
  assert.doesNotMatch(textTeam.componentKey, /portrait|image-led/);
  assert.equal(textTeam.assetAssignments.some(assignment => assignment.placeholderCode), false);

  const detail = fixture('TEAM_DETAIL', 40);
  const profileWithoutAsset = createBaselinePageCompositionPlan({
    ...detail,
    facts: completeFacts(),
    approvedPageReferences: [detail.page.pageReference, id(999)],
  }).selectedComponents.find(section => section.sectionType === 'STAFF_PROFILE')!;
  assert.match(profileWithoutAsset.componentKey, /editorial|card|services-led/);
  assert.equal(profileWithoutAsset.assetAssignments.some(assignment => assignment.placeholderCode), false);

  const otherStaffAsset = {
    publicReference: id(21),
    assetClass: 'STAFF' as const,
    entityReference: id(999),
    approved: true as const,
  };
  const profileWithAssets = createBaselinePageCompositionPlan({
    ...detail,
    facts: completeFacts([otherStaffAsset, staffAsset]),
    approvedPageReferences: [detail.page.pageReference, id(999)],
  }).selectedComponents.find(section => section.sectionType === 'STAFF_PROFILE')!;
  assert.ok(profileWithAssets.assetAssignments.some(assignment => assignment.assetReference === staffAsset.publicReference));
  assert.ok(profileWithAssets.assetAssignments.every(assignment => assignment.assetReference !== otherStaffAsset.publicReference));
});

test('baseline fills TEAM_DETAIL depth from the approved native layout when FAQ is unsupported', () => {
  const detail = fixture('TEAM_DETAIL', 41);
  const page = { ...detail.page, conversionRole: 'TRUST_BUILDING' as const };
  const sectionOrder: SiteSectionType[] = [
    'HEADER', 'HERO', 'STAFF_PROFILE', 'INTRODUCTION', 'FEATURED_SERVICES',
    'SERVICE_GRID', 'BENEFITS', 'TRUST_INDICATORS', 'RICH_TEXT', 'BOOKING_CTA', 'FOOTER',
  ];
  const template: TemplateGenerationConstraint = {
    ...detail.template,
    compatiblePageTypes: ['TEAM_DETAIL'],
    requiredSectionTypes: ['HEADER', 'HERO', 'STAFF_PROFILE', 'BOOKING_CTA', 'FOOTER'],
    sectionOrder,
    availableComponentKeys: sectionOrder.flatMap(sectionType =>
      listSiteComponents({ sectionType, pageType: page.pageType, conversionRole: page.conversionRole })
        .map(component => component.componentKey)),
  };
  const approvedPageReferences = [page.pageReference, id(999)];
  const plan = createBaselinePageCompositionPlan({
    page,
    template,
    facts: completeFacts(),
    approvedPageReferences,
  });
  const selected = new Set(plan.selectedComponents.map(section => section.sectionType));
  assert.equal(selected.has('FAQ'), false);
  assert.ok(selected.has('INTRODUCTION') || selected.has('TRUST_INDICATORS') || selected.has('RICH_TEXT'));
  assert.equal(validatePageCompositionPlan({
    output: plan,
    page,
    template,
    approvedPageReferences,
  }).some(finding => finding.severity === 'ERROR'), false);
});

test('baseline caps optional NEW_CLIENT_GUIDE sections at the governed recipe maximum', () => {
  const guide = fixture('NEW_CLIENT_GUIDE', 42);
  const sectionOrder = [
    'HEADER', 'HERO', 'INTRODUCTION', 'PROCESS', 'BENEFITS', 'RICH_TEXT',
    'FAQ', 'LOCATION', 'OPENING_HOURS', 'CONTACT', 'BOOKING_CTA',
    'FINAL_CTA', 'FOOTER',
  ] as SiteSectionType[];
  const page = {
    ...guide.page,
    conversionRole: 'OBJECTION_HANDLING' as const,
    plannedSectionTypes: sectionOrder,
  };
  const template: TemplateGenerationConstraint = {
    ...guide.template,
    conversionRole: page.conversionRole,
    requiredSectionTypes: ['HEADER', 'HERO', 'RICH_TEXT', 'FINAL_CTA', 'FOOTER'],
    sectionOrder,
    availableComponentKeys: sectionOrder.flatMap(sectionType =>
      listSiteComponents({ sectionType, pageType: page.pageType, conversionRole: page.conversionRole })
        .map(component => component.componentKey)),
  };
  const approvedPageReferences = [page.pageReference, id(999)];
  const factsWithoutOpeningHours = structuredClone(completeFacts());
  factsWithoutOpeningHours.locations[0]!.facts = factsWithoutOpeningHours.locations[0]!.facts
    .filter(fact => fact.key !== 'opening_hours');
  const plan = createBaselinePageCompositionPlan({
    page,
    template,
    facts: factsWithoutOpeningHours,
    approvedPageReferences,
  });
  assert.equal(plan.selectedComponents.length, PAGE_COMPLETENESS_RECIPES.NEW_CLIENT_GUIDE.maxRecommendedSections);
  assert.ok(plan.selectedComponents.some(selection =>
    getSiteComponent(selection.componentKey)?.classification === 'SUPPORTING'));
  assert.equal(validatePageCompositionPlan({
    output: plan,
    page,
    template,
    approvedPageReferences,
  }).some(finding => finding.severity === 'ERROR'), false);
});

test('F-G: approved Search Intelligence links and topic guide baseline content composition', () => {
  const { page, template } = fixture('FAQ', 5);
  const targetPageReference = id(999);
  const pageSeoBrief = {
    primaryTopic: 'verified appointment questions',
    internalLinks: [{
      targetPageReference,
      anchorText: 'View services',
      purpose: 'Connect questions to the approved service journey.',
    }],
  } as PageSeoBrief;
  const plan = createBaselinePageCompositionPlan({
    page,
    template,
    facts: completeFacts(),
    approvedPageReferences: [page.pageReference, targetPageReference],
    pageSeoBrief,
  });
  assert.match(plan.contentNarrative, /verified appointment questions/);
  assert.deepEqual(plan.internalLinkIntent, [{
    targetPageReference,
    intent: 'Connect questions to the approved service journey.',
  }]);
});

test('I: an unavailable preferred component falls back before a truly incapable template fails validation', () => {
  const { page, template } = fixture('HOME', 6);
  const assets = [{ publicReference: id(10), assetClass: 'BRAND' as const, approved: true as const }];
  const preferredUnavailable = {
    ...template,
    availableComponentKeys: template.availableComponentKeys.filter(key => key !== 'hero-layered-media-v1'),
  };
  const fallbackPlan = createBaselinePageCompositionPlan({
    page,
    template: preferredUnavailable,
    facts: completeFacts(assets),
    approvedPageReferences: [page.pageReference, id(999)],
  });
  const hero = fallbackPlan.selectedComponents.find(section => section.sectionType === 'HERO')!;
  assert.notEqual(hero.componentKey, 'hero-layered-media-v1');
  assert.equal(validatePageCompositionPlan({
    output: fallbackPlan,
    page,
    template: preferredUnavailable,
    approvedPageReferences: [page.pageReference, id(999)],
    approvedAssetReferences: assets.map(asset => asset.publicReference),
  }).some(finding => finding.severity === 'ERROR'), false);

  const incompatible = {
    ...template,
    availableComponentKeys: template.availableComponentKeys.filter(key => !key.startsWith('hero-')),
  };
  const plan = createBaselinePageCompositionPlan({
    page,
    template: incompatible,
    facts: completeFacts(),
    approvedPageReferences: [page.pageReference, id(999)],
  });
  const findings = validatePageCompositionPlan({
    output: plan,
    page,
    template: incompatible,
    approvedPageReferences: [page.pageReference, id(999)],
  });
  assert.ok(findings.some(finding => finding.code === 'MISSING_PAGE_PURPOSE_CONTENT'));
});

test('baseline composition resolves the complete plan without a provider dependency', () => {
  const home = fixture('HOME', 7);
  const booking = fixture('BOOKING', 8);
  const generationPlan: GenerationPlan = {
    siteReference: id(600),
    blueprintReference: id(601),
    blueprintRevision: 3,
    templateVersionReference: id(500),
    knowledgePackReference: id(602),
    knowledgePackSemanticVersion: '1.0.2',
    pages: [home.page, booking.page],
  };
  const result = createBaselineComposition({
    plan: generationPlan,
    constraints: [home.template, booking.template],
    facts: completeFacts(),
  });
  assert.equal(result.pagePlans.length, 2);
  assert.equal(result.strategy.recommendedDesignTokens.designVersion, 2);
  assert.deepEqual(result.pagePlans.map(plan => plan.pageReference), generationPlan.pages.map(page => page.pageReference));
});

test('D-E-F-G-H: multi-page baseline calls the provider only for locked content and completes every page', async () => {
  const home = fixture('HOME', 60);
  const booking = fixture('BOOKING', 61);
  const facts = completeFacts();
  const plan: GenerationPlan = {
    siteReference: id(700), blueprintReference: id(701), blueprintRevision: 3,
    templateVersionReference: id(500), knowledgePackReference: id(702), knowledgePackSemanticVersion: '1.0.2',
    pages: [home.page, booking.page],
  };
  const composition = createBaselineComposition({
    plan,
    constraints: [home.template, booking.template],
    facts,
  });
  const strategyReference = id(703);
  const evidenceReference = id(704);
  const digest = 'a'.repeat(64);
  const link = (targetPageReference: string, anchorText: string) => ({
    targetPageReference,
    anchorText,
    purpose: 'Continue through the approved website journey.',
  });
  const homeLink = link(booking.page.pageReference, 'Book an appointment');
  const bookingLink = link(home.page.pageReference, 'Return home');
  const brief = (
    page: typeof home.page,
    canonicalPath: string,
    primaryKeyword: string,
    recommendedH1: string,
    outgoing: ReturnType<typeof link>,
    incomingSource: string,
    incomingAnchor: string,
    minimumContentDepthWords: number,
  ) => ({
    strategyReference,
    strategyVersion: 1,
    blueprintPageReference: page.blueprintPageReference,
    pageReference: page.pageReference,
    pageType: page.pageType,
    status: 'APPROVED',
    indexation: 'INDEX',
    canonicalPath,
    primaryKeyword,
    primarySearchIntent: 'TRANSACTIONAL',
    primaryTopic: primaryKeyword,
    recommendedTitle: `${recommendedH1} | Governed Studio`.slice(0, 70),
    recommendedMetaDescription: `Useful verified information about ${primaryKeyword} and the next step with Governed Studio.`,
    recommendedH1,
    contentFormat: 'LANDING_PAGE',
    minimumContentDepthWords,
    internalLinks: [outgoing],
    internalLinksIn: [{
      sourcePageReference: incomingSource,
      anchorText: incomingAnchor,
      purpose: 'Continue through the approved website journey.',
    }],
    schemaTypes: [],
    richResultEligibility: [],
    authorship: { required: false },
    reviewer: { required: false },
    evidenceRequirements: [],
    requiredEvidence: [],
    provenance: {
      strategyReference,
      strategyVersion: 1,
      strategyDigestSha256: digest,
    },
  } as unknown as PageSeoBrief);
  const briefs = [
    brief(home.page, '/home', 'governed studio', 'A complete governed studio website', homeLink, booking.page.pageReference, bookingLink.anchorText, 420),
    brief(booking.page, '/booking', 'book governed studio', 'Book with Governed Studio', bookingLink, home.page.pageReference, homeLink.anchorText, 0),
  ];
  const strategy = {
    reference: strategyReference,
    strategyVersion: 1,
    status: 'APPROVED',
    structuredDataStrategy: {
      pageRules: plan.pages.map(page => ({ pageReference: page.pageReference, types: [] })),
    },
    provenance: {
      providerKey: 'governed-search-research',
      modelKey: 'research-v1',
      outputDigestSha256: digest,
      researchEvidenceReferences: [evidenceReference],
    },
    serpAnalyses: [{ evidenceReference, query: 'governed studio' }],
    brandSearchStrategy: { targetPageReferences: plan.pages.map(page => page.pageReference) },
    keywordUniverse: [],
    internalLinkStrategy: { maximumClicksFromHome: 2 },
  };
  const pagesByReference = new Map(composition.pagePlans.map(pagePlan => {
    const page = plan.pages.find(candidate => candidate.pageReference === pagePlan.pageReference)!;
    const seoBrief = briefs.find(candidate => candidate.pageReference === page.pageReference)!;
    return [page.pageReference, generatedPage(page, pagePlan, seoBrief)] as const;
  }));
  const contentRequests: string[] = [];
  const provider: SiteGenerationProvider = {
    providerKey: 'gemini',
    modelKey: 'gemini-test',
    async generateStructuredOutput(request) {
      const prompt = JSON.parse(request.prompt) as Record<string, any>;
      assert.equal(prompt.operation, undefined, 'baseline mode must not ask Gemini for composition');
      assert.ok(prompt.pageCompositionPlan?.selectedComponents?.length > 0);
      assert.ok(prompt.immutablePageSeoBrief?.recommendedH1);
      const pageReference = prompt.approvedBlueprintPage.pageReference as string;
      contentRequests.push(pageReference);
      const value = request.outputSchema.parse(pagesByReference.get(pageReference));
      return {
        value,
        providerKey: 'gemini',
        modelKey: 'gemini-test',
        outputCharacterCount: JSON.stringify(value).length,
      };
    },
  };
  const persistedPages: string[] = [];
  let compositionPersisted = false;
  let completed = false;
  const result = await executeStructuredSiteGeneration({
    plan,
    constraints: [home.template, booking.template],
    facts,
    knowledgeContexts: new Map(plan.pages.map(page => [page.pageReference, {
      packReference: id(702), semanticVersion: '1.0.2', schemaVersion: 1,
      applicableRuleIds: ['RUL_NATIVE_BOOKING'], requiredInstructions: ['Use native booking.'],
      prohibitedBehaviours: ['Do not invent facts.'], missingBusinessDataRequirements: [],
      deterministicRequirements: ['Preserve the approved page plan.'], aiReviewInstructions: [],
      humanReviewInstructions: [], pagePlaybook: null, sourceReferences: [], omittedRuleCount: 0,
      estimatedCharacterCount: 100, requiredRulesExceededLimit: false, contentDigest: digest,
    }])),
    provider,
    persistence: {
      async beginRun() {},
      async completedPages() { return []; },
      async persistPage(input) { persistedPages.push(input.page.pageReference); },
      async persistFindings() {},
      async persistCompositionArtifacts() { compositionPersisted = true; },
      async completeRun() { completed = true; },
      async failRun() {},
    },
    maxRepairAttempts: 0,
    maxOutputCharacters: 250_000,
    pipelineVersion: 2,
    generationMode: 'baseline',
    searchIntelligence: {
      strategy: strategy as any,
      briefs,
      evidence: [{ reference: evidenceReference } as any],
    },
  });
  assert.equal(result.status, 'DESIGN_COMPLETE');
  assert.deepEqual(contentRequests, plan.pages.map(page => page.pageReference));
  assert.deepEqual(persistedPages, plan.pages.map(page => page.pageReference));
  assert.equal(compositionPersisted, true);
  assert.equal(completed, true);
});

test('J: thin Home composition is rejected by the existing baseline completeness contract', () => {
  const { page, template } = fixture('HOME', 70);
  const full = createBaselinePageCompositionPlan({
    page,
    template,
    facts: completeFacts(),
    approvedPageReferences: [page.pageReference, id(999)],
  });
  const thin = {
    ...full,
    selectedComponents: full.selectedComponents.filter(section =>
      ['HEADER', 'HERO', 'FINAL_CTA', 'FOOTER'].includes(section.sectionType)),
  };
  assert.ok(validatePageCompositionPlan({
    output: thin,
    page,
    template,
    approvedPageReferences: [page.pageReference, id(999)],
  }).some(finding => finding.code === 'PAGE_TOO_SHALLOW'));
});

test('baseline mode is opt-in and pins materially distinct generation provenance', () => {
  const existing = parseSiteGenerationConfig({});
  assert.equal(existing.generationMode, 'ai-composition');
  assert.equal(existing.generatorVersion, '1.0.0');
  const baseline = parseSiteGenerationConfig({ SITE_AI_GENERATION_MODE: 'baseline' });
  assert.equal(baseline.generationMode, 'baseline');
  assert.equal(baseline.generatorVersion, 'baseline-1');
});
