import {
  getSiteComponent,
  listSiteComponents,
  type SiteComponentAssetSlot,
  type SiteComponentDataBinding,
  type SiteComponentDefinition,
} from '@ks-os/site-components';
import type { SiteSectionType } from '@ks-os/site-schema';
import type { z } from 'zod';
import { buildApprovedAssetInventory } from './assets.js';
import {
  PageCompositionPlanSchema,
  SiteCompositionStrategySchema,
  type ApprovedGenerationAsset,
  type BlueprintGenerationPageSchema,
  type GenerationPlan,
  type PageCompositionPlan,
  type SiteCompositionStrategy,
  type TemplateGenerationConstraint,
  type VerifiedBusinessFacts,
} from './contracts.js';
import { pageCompletenessRecipe } from './recipes.js';
import type { PageSeoBrief } from './search-intelligence.js';

type BlueprintPage = z.infer<typeof BlueprintGenerationPageSchema>;

const SLOT_CLASSES: Record<SiteComponentAssetSlot, readonly ApprovedGenerationAsset['assetClass'][]> = {
  LOGO: ['LOGO'],
  PRIMARY_IMAGE: ['BRAND', 'SERVICE', 'STAFF', 'LOCATION', 'GALLERY'],
  SECONDARY_IMAGE: ['BRAND', 'SERVICE', 'STAFF', 'LOCATION', 'GALLERY', 'DECORATIVE'],
  PORTRAIT: ['STAFF'],
  LOCATION_IMAGE: ['LOCATION'],
  GALLERY_SET: ['GALLERY', 'BRAND', 'SERVICE', 'LOCATION'],
  RESULT_PAIR: ['RESULT'],
  DECORATIVE_IMAGE: ['DECORATIVE', 'BRAND'],
};

const SLOT_PLACEHOLDERS = {
  LOGO: 'BRAND_IMAGE_REQUIRED',
  PRIMARY_IMAGE: 'SERVICE_IMAGE_REQUIRED',
  SECONDARY_IMAGE: 'BRAND_IMAGE_REQUIRED',
  PORTRAIT: 'STAFF_PORTRAIT_REQUIRED',
  LOCATION_IMAGE: 'LOCATION_IMAGE_REQUIRED',
  GALLERY_SET: 'GALLERY_ASSET_REQUIRED',
  RESULT_PAIR: 'RESULT_ASSET_REQUIRED',
  DECORATIVE_IMAGE: 'BRAND_IMAGE_REQUIRED',
} as const satisfies Record<SiteComponentAssetSlot, string>;

const PAGE_VARIANT_HINTS: Partial<Record<BlueprintPage['pageType'], Partial<Record<SiteSectionType, readonly string[]>>>> = {
  HOME: {
    HERO: ['layered', 'collage', 'editorial', 'centered'],
    FEATURED_SERVICES: ['editorial-grid', 'featured-primary', 'card-grid'],
    TEAM: ['portrait-grid', 'editorial', 'compact'],
  },
  SERVICE_HUB: {
    HERO: ['editorial', 'centered'],
    SERVICE_GRID: ['featured', 'editorial', 'image-cards'],
  },
  SERVICE_DETAIL: {
    HERO: ['service', 'editorial'],
    SERVICE_DETAILS: ['information-rich', 'split', 'editorial'],
  },
  TEAM_HUB: { HERO: ['profile', 'editorial'], TEAM: ['portrait-grid', 'editorial', 'compact'] },
  TEAM_DETAIL: { HERO: ['profile', 'editorial'], STAFF_PROFILE: ['image-led', 'split', 'editorial'] },
  LOCATION_HUB: { HERO: ['location', 'editorial'], LOCATION: ['media-split', 'details-card', 'editorial'] },
  LOCATION_DETAIL: { HERO: ['location', 'editorial'], LOCATION: ['media-split', 'details-card', 'editorial'] },
  CONTACT: { HERO: ['centered', 'editorial'], CONTACT: ['location-led', 'split', 'editorial'] },
  FAQ: { HERO: ['minimal-luxury', 'centered'], FAQ: ['grouped', 'accordion', 'editorial'] },
  NEW_CLIENT_GUIDE: { HERO: ['editorial', 'centered'], RICH_TEXT: ['guide', 'editorial'] },
  POLICIES: { RICH_TEXT: ['policy', 'narrow', 'standard'] },
  BOOKING: { INTRODUCTION: ['centered', 'with-points'], BOOKING_CTA: ['minimal', 'card'] },
};

const BASELINE_DEPTH_ENRICHMENTS: Partial<Record<BlueprintPage['pageType'], readonly SiteSectionType[]>> = {
  SERVICE_DETAIL: ['TRUST_INDICATORS'],
  TEAM_DETAIL: ['FAQ'],
  NEW_CLIENT_GUIDE: ['OPENING_HOURS'],
};

function verifiedFactsExist(facts: VerifiedBusinessFacts['business']) {
  return facts.some(fact => ['VERIFIED', 'AGENCY_CONFIRMED', 'TENANT_CONFIRMED'].includes(fact.status));
}

function availableBindings(facts: VerifiedBusinessFacts) {
  const businessKeys = new Set(facts.business
    .filter(fact => ['VERIFIED', 'AGENCY_CONFIRMED', 'TENANT_CONFIRMED'].includes(fact.status))
    .map(fact => fact.key));
  const assets = buildApprovedAssetInventory(facts);
  const hasOpeningHours = facts.locations.some(location => location.facts.some(fact =>
    ['VERIFIED', 'AGENCY_CONFIRMED', 'TENANT_CONFIRMED'].includes(fact.status)
    && fact.key === 'opening_hours'));
  const hasLocationContact = facts.locations.some(location => location.facts.some(fact =>
    ['VERIFIED', 'AGENCY_CONFIRMED', 'TENANT_CONFIRMED'].includes(fact.status)
    && ['physical_address', 'postcode', 'phone_number'].includes(fact.key)));
  return new Set<SiteComponentDataBinding>([
    ...(verifiedFactsExist(facts.business) ? ['BUSINESS' as const] : []),
    ...(facts.services.length ? ['SERVICES' as const] : []),
    ...(facts.locations.length ? ['LOCATIONS' as const] : []),
    ...(hasOpeningHours ? ['OPENING_HOURS' as const] : []),
    ...(facts.staff.length ? ['STAFF' as const] : []),
    ...(businessKeys.has('booking_enabled') || businessKeys.has('business.booking_enabled')
      ? ['BOOKING' as const]
      : []),
    ...(facts.policies.length ? ['POLICIES' as const] : []),
    ...(assets.some(asset => ['GALLERY', 'BRAND', 'SERVICE', 'LOCATION'].includes(asset.assetClass))
      ? ['GALLERY' as const]
      : []),
    ...(assets.some(asset => asset.assetClass === 'RESULT') ? ['RESULTS' as const] : []),
    ...(businessKeys.has('phone_number')
      || businessKeys.has('public_email')
      || hasLocationContact
      ? ['CONTACT' as const]
      : []),
  ]);
}

function sectionFactsAvailable(
  sectionType: SiteSectionType,
  facts: VerifiedBusinessFacts,
) {
  if (sectionType !== 'PRICING') return true;
  return facts.services.some(service => service.facts.some(fact =>
    ['VERIFIED', 'AGENCY_CONFIRMED', 'TENANT_CONFIRMED'].includes(fact.status)
    && ['service_price', 'service.price'].includes(fact.key)));
}

function assetForSlot(
  assets: readonly ApprovedGenerationAsset[],
  slot: SiteComponentAssetSlot,
  page: BlueprintPage,
  sectionType: SiteSectionType,
) {
  const expectedByClass = {
    SERVICE: page.serviceReference,
    STAFF: page.staffReference,
    LOCATION: page.locationReference,
  } as const;
  const compatibleSections: Partial<Record<ApprovedGenerationAsset['assetClass'], readonly SiteSectionType[]>> = {
    SERVICE: ['HERO', 'FEATURED_SERVICES', 'SERVICE_GRID', 'SERVICE_DETAILS'],
    STAFF: ['HERO', 'TEAM', 'STAFF_PROFILE'],
    LOCATION: ['HERO', 'LOCATION', 'OPENING_HOURS', 'CONTACT'],
  };
  const candidates = assets.filter(asset => {
    if (!SLOT_CLASSES[slot].includes(asset.assetClass)) return false;
    if (slot === 'PORTRAIT' && !asset.entityReference) return false;
    const expected = expectedByClass[asset.assetClass as keyof typeof expectedByClass];
    if (expected) return asset.entityReference === expected;
    const sections = compatibleSections[asset.assetClass];
    return !sections || sections.includes(sectionType);
  });
  const exact = candidates.find(asset => {
    const expected = expectedByClass[asset.assetClass as keyof typeof expectedByClass];
    return expected && asset.entityReference === expected;
  });
  return exact ?? candidates[0];
}

function stableIndex(seed: string, length: number) {
  let value = 0;
  for (const character of seed) value = ((value * 31) + character.charCodeAt(0)) >>> 0;
  return length ? value % length : 0;
}

function variantHintScore(
  component: SiteComponentDefinition,
  page: BlueprintPage,
  sectionType: SiteSectionType,
) {
  const hints = PAGE_VARIANT_HINTS[page.pageType]?.[sectionType] ?? [];
  const hintIndex = hints.findIndex(hint => component.componentKey.includes(hint));
  return hintIndex < 0 ? 0 : (hints.length - hintIndex) * 10;
}

function selectComponent(input: {
  page: BlueprintPage;
  sectionType: SiteSectionType;
  template: TemplateGenerationConstraint;
  bindings: ReadonlySet<SiteComponentDataBinding>;
  assets: readonly ApprovedGenerationAsset[];
}) {
  const allowed = new Set(input.template.availableComponentKeys);
  const candidates = listSiteComponents({
    sectionType: input.sectionType,
    pageType: input.page.pageType,
    conversionRole: input.page.conversionRole,
  }).filter(component =>
    component.status === 'ACTIVE'
    && (allowed.size === 0 || allowed.has(component.componentKey))
    && component.requiredDataBindings.every(binding => input.bindings.has(binding)));
  if (!candidates.length) return null;

  const scored = candidates.map(component => {
    const missingRequiredAssets = component.requiredAssetSlots.filter(slot =>
      !assetForSlot(input.assets, slot, input.page, input.sectionType)).length;
    const availableRequiredAssets = component.requiredAssetSlots.length - missingRequiredAssets;
    return {
      component,
      score: variantHintScore(component, input.page, input.sectionType)
        + availableRequiredAssets * 30
        - missingRequiredAssets * 1_000,
    };
  });
  const bestScore = Math.max(...scored.map(item => item.score));
  const best = scored.filter(item => item.score === bestScore)
    .sort((left, right) => left.component.componentKey.localeCompare(right.component.componentKey));
  return best[stableIndex(`${input.page.pageReference}:${input.sectionType}`, best.length)]!.component;
}

function assetAssignments(
  component: SiteComponentDefinition,
  assets: readonly ApprovedGenerationAsset[],
  page: BlueprintPage,
  sectionType: SiteSectionType,
) {
  const assignments: PageCompositionPlan['selectedComponents'][number]['assetAssignments'] = [];
  for (const slot of component.requiredAssetSlots) {
    const asset = assetForSlot(assets, slot, page, sectionType);
    assignments.push(asset
      ? { slot, assetReference: asset.publicReference }
      : { slot, placeholderCode: SLOT_PLACEHOLDERS[slot] });
  }
  const optionalSlot = component.supportedAssetSlots.find(slot =>
    !component.requiredAssetSlots.includes(slot)
    && Boolean(assetForSlot(assets, slot, page, sectionType)));
  if (optionalSlot) {
    assignments.push({
      slot: optionalSlot,
      assetReference: assetForSlot(assets, optionalSlot, page, sectionType)!.publicReference,
    });
  }
  return assignments;
}

/** Deterministic, provider-free site design strategy for baseline composition runs. */
export function createBaselineSiteCompositionStrategy(): SiteCompositionStrategy {
  return SiteCompositionStrategySchema.parse({
    brandMood: 'Clear, assured and welcoming, with verified business detail leading the experience.',
    visualDirection: 'A restrained editorial system with deliberate hierarchy and controlled component variation.',
    typographicIntent: 'Readable system typography with expressive headings and comfortable long-form body copy.',
    spacingIntent: 'Generous section rhythm with compact related content groups and consistent mobile gutters.',
    imageStrategy: 'Use approved tenant assets where they add meaning; otherwise retain strong text-led compositions.',
    surfaceStrategy: 'Use quiet neutral surfaces and alternating section treatments to make page structure legible.',
    heroStrategy: 'Select a page-purpose-specific hero with one governed native booking action and a clear H1.',
    cardStrategy: 'Use cards only for comparable services, people or facts, with predictable scanning order.',
    conversionStrategy: 'Build understanding before a governed native KS OS booking action closes each journey.',
    trustStrategy: 'Present only verified business, service, staff and location evidence without invented claims.',
    pageRhythm: 'Move from orientation to substantive answers, supporting evidence and a final conversion action.',
    sectionDiversityStrategy: 'Vary components deterministically by page purpose while preserving semantic consistency.',
    mobileStrategy: 'Keep semantic reading order, single-column collapse and accessible touch targets at 390 pixels.',
    recommendedDesignTokens: {
      designVersion: 2,
      typography: {
        displayFont: 'SYSTEM_SERIF', headingFont: 'SYSTEM_SERIF', bodyFont: 'SYSTEM_SANS',
        displayScale: 'DRAMATIC', headingScale: 'BALANCED', bodyScale: 'STANDARD',
        headingWeight: 'SEMIBOLD', bodyWeight: 'REGULAR', displayTracking: 'TIGHT',
        headingTracking: 'NORMAL', headingLineHeight: 'TIGHT', bodyLineHeight: 'RELAXED',
      },
      layout: {
        containerWidths: 'BALANCED_RANGE', pageGutter: 'STANDARD', sectionSpacing: 'EXPANSIVE',
        contentSpacing: 'STANDARD', gridColumns: 'TWELVE', gridGap: 'STANDARD', textMeasure: 'READABLE',
      },
      shape: { radiusScale: 'SOFT', cardRadius: 'MEDIUM', buttonRadius: 'SOFT', imageRadius: 'MEDIUM' },
      surface: { background: '#FFFFFF', surface: '#FFFFFF', surfaceAlt: '#F6F7F8', border: '#D9DDE1', mutedSurface: '#EEF1F3' },
      elevation: 'SUBTLE',
      buttons: { height: 'STANDARD', padding: 'STANDARD', weight: 'SEMIBOLD', primaryStyle: 'SOLID', secondaryStyle: 'OUTLINE' },
      imagery: {
        defaultAspectRatio: 'THREE_TWO', portraitAspectRatio: 'FOUR_FIVE', serviceAspectRatio: 'FOUR_THREE',
        cropMode: 'COVER', focalBehaviour: 'ASSET_FOCAL_POINT', imageTreatment: 'NATURAL',
      },
      sectionRhythm: 'ALTERNATING_SURFACES',
    },
  });
}

/** Creates a complete allow-listed component sequence without calling a model. */
export function createBaselinePageCompositionPlan(input: {
  page: BlueprintPage;
  template: TemplateGenerationConstraint;
  facts: VerifiedBusinessFacts;
  approvedPageReferences: readonly string[];
  pageSeoBrief?: PageSeoBrief;
}): PageCompositionPlan {
  const recipe = pageCompletenessRecipe(input.page.pageType);
  const bindings = availableBindings(input.facts);
  const assets = buildApprovedAssetInventory(input.facts);
  const desired = new Set<SiteSectionType>([
    ...input.page.plannedSectionTypes,
    ...input.template.requiredSectionTypes,
    ...recipe.recommendedSectionTypes,
    ...(BASELINE_DEPTH_ENRICHMENTS[input.page.pageType] ?? []),
  ]);
  const order = input.template.sectionOrder.length
    ? input.template.sectionOrder
    : [...desired];
  const selectedComponents = order
    .filter(sectionType => desired.has(sectionType)
      && !input.template.prohibitedSectionTypes.includes(sectionType)
      && sectionFactsAvailable(sectionType, input.facts))
    .flatMap(sectionType => {
      const component = selectComponent({
        page: input.page,
        sectionType,
        template: input.template,
        bindings,
        assets,
      });
      if (!component) return [];
      return [{
        sectionType,
        componentKey: component.componentKey,
        purpose: `Fulfil the governed ${sectionType.toLowerCase().replaceAll('_', ' ')} role for this ${input.page.pageType.toLowerCase().replaceAll('_', ' ')} page.`,
        dataBindings: [
          ...component.requiredDataBindings,
          ...component.optionalDataBindings.filter(binding => bindings.has(binding)),
        ],
        assetAssignments: assetAssignments(component, assets, input.page, sectionType),
      }];
    });

  const approvedPages = new Set(input.approvedPageReferences);
  const seoLinks = (input.pageSeoBrief?.internalLinks ?? [])
    .filter(link => approvedPages.has(link.targetPageReference)
      && link.targetPageReference !== input.page.pageReference)
    .map(link => ({ targetPageReference: link.targetPageReference, intent: link.purpose }));
  const fallbackTarget = input.approvedPageReferences.find(reference =>
    reference !== input.page.pageReference);
  const internalLinkIntent = seoLinks.length
    ? seoLinks
    : fallbackTarget && !recipe.bookingDepthExempt
      ? [{ targetPageReference: fallbackTarget, intent: 'Continue to a related approved page in the governed visitor journey.' }]
      : [];
  const topic = input.pageSeoBrief?.primaryTopic;
  const plan = PageCompositionPlanSchema.parse({
    pageReference: input.page.pageReference,
    pagePurpose: recipe.pagePurpose,
    conversionGoal: recipe.bookingDepthExempt
      ? 'Complete the native KS OS booking journey safely.'
      : 'Move an informed visitor to native KS OS booking.',
    contentNarrative: topic
      ? `Answer the approved search intent for ${topic}, then progress through verified evidence to controlled conversion.`
      : `Build a complete ${input.page.pageType.toLowerCase().replaceAll('_', ' ')} narrative from orientation through verified evidence to controlled conversion.`,
    selectedComponents,
    internalLinkIntent,
    ctaIntent: 'Use native KS OS booking only after the page has answered its governed visitor purpose.',
  });

  // Keep failure deterministic and close to composition rather than asking Gemini
  // to compensate for an incompatible template, fact snapshot or registry graph.
  for (const selection of plan.selectedComponents) {
    if (!getSiteComponent(selection.componentKey)) {
      throw new Error(`BASELINE_COMPONENT_UNKNOWN:${selection.componentKey}`);
    }
  }
  return plan;
}

export function createBaselineComposition(input: {
  plan: GenerationPlan;
  constraints: readonly TemplateGenerationConstraint[];
  facts: VerifiedBusinessFacts;
  briefs?: readonly PageSeoBrief[];
}) {
  const approvedPageReferences = input.plan.pages.map(page => page.pageReference);
  return {
    strategy: createBaselineSiteCompositionStrategy(),
    pagePlans: input.plan.pages.map(page => {
      const template = input.constraints.find(item => item.layoutReference === page.layoutReference);
      if (!template) throw new Error(`BASELINE_TEMPLATE_CONTEXT_MISSING:${page.layoutReference}`);
      return createBaselinePageCompositionPlan({
        page,
        template,
        facts: input.facts,
        approvedPageReferences,
        pageSeoBrief: input.briefs?.find(brief => brief.pageReference === page.pageReference),
      });
    }),
  };
}
