import { listSiteComponents } from '@ks-os/site-components';
import type { SitePageType, SiteSectionType } from '@ks-os/site-schema';
import {
  PAGE_COMPLETENESS_RECIPES,
  type PageCompositionPlan,
  type TemplateGenerationConstraint,
} from '../../src/index.js';

const pageTypes = Object.keys(PAGE_COMPLETENESS_RECIPES) as SitePageType[];
export const recipeFixturePageReferences = Object.fromEntries(pageTypes.map((pageType, index) => [
  pageType,
  `${String(index + 1).padStart(8, '0')}-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
])) as Record<SitePageType, string>;

const placeholderBySlot = {
  LOGO: 'BRAND_IMAGE_REQUIRED', PRIMARY_IMAGE: 'BRAND_IMAGE_REQUIRED', SECONDARY_IMAGE: 'BRAND_IMAGE_REQUIRED',
  PORTRAIT: 'STAFF_PORTRAIT_REQUIRED', LOCATION_IMAGE: 'LOCATION_IMAGE_REQUIRED',
  GALLERY_SET: 'GALLERY_ASSET_REQUIRED', RESULT_PAIR: 'RESULT_ASSET_REQUIRED', DECORATIVE_IMAGE: 'BRAND_IMAGE_REQUIRED',
} as const;

const fixtureTypes: Partial<Record<SitePageType, readonly SiteSectionType[]>> = {
  HOME: ['HEADER', 'HERO', 'INTRODUCTION', 'FEATURED_SERVICES', 'BENEFITS', 'PROCESS', 'TEAM', 'GALLERY', 'TESTIMONIALS', 'TRUST_INDICATORS', 'FAQ', 'LOCATION', 'FINAL_CTA', 'FOOTER'],
  SERVICE_DETAIL: ['HEADER', 'HERO', 'SERVICE_DETAILS', 'BENEFITS', 'PROCESS', 'PRICING', 'TEAM', 'TRUST_INDICATORS', 'FAQ', 'FEATURED_SERVICES', 'BOOKING_CTA', 'FOOTER'],
  TEAM_DETAIL: ['HEADER', 'HERO', 'STAFF_PROFILE', 'FEATURED_SERVICES', 'BENEFITS', 'FAQ', 'BOOKING_CTA', 'FOOTER'],
  NEW_CLIENT_GUIDE: ['HEADER', 'HERO', 'INTRODUCTION', 'RICH_TEXT', 'PROCESS', 'LOCATION', 'OPENING_HOURS', 'FAQ', 'BOOKING_CTA', 'FOOTER'],
};

export function createRecipeFixture(input: { pageType: SitePageType; pageIndex: number }) {
  const recipe = PAGE_COMPLETENESS_RECIPES[input.pageType];
  const sectionTypes = fixtureTypes[input.pageType] ?? recipe.recommendedSectionTypes;
  const selectedComponents = sectionTypes.map((sectionType, sectionIndex) => {
    const available = listSiteComponents({ sectionType, pageType: input.pageType });
    const component = available[(input.pageIndex * 7 + sectionIndex * 5) % available.length]!;
    return {
      sectionType,
      componentKey: component.componentKey,
      purpose: `Fulfil the governed ${sectionType.toLowerCase().replaceAll('_', ' ')} role for this ${input.pageType.toLowerCase().replaceAll('_', ' ')} page.`,
      dataBindings: [...component.requiredDataBindings],
      assetAssignments: component.requiredAssetSlots.map(slot => ({
        slot,
        placeholderCode: placeholderBySlot[slot],
      })),
    };
  });
  const pageReference = recipeFixturePageReferences[input.pageType];
  const linkTarget = recipeFixturePageReferences[input.pageType === 'HOME' ? 'SERVICE_HUB' : 'HOME'];
  const output: PageCompositionPlan = {
    pageReference,
    pagePurpose: recipe.pagePurpose,
    conversionGoal: input.pageType === 'BOOKING'
      ? 'Complete the native booking journey safely.'
      : 'Move an informed visitor to native KS OS booking.',
    contentNarrative: `A purposeful, evidence-led ${input.pageType.toLowerCase().replaceAll('_', ' ')} narrative with clear progression and controlled conversion.`,
    selectedComponents,
    internalLinkIntent: input.pageType === 'BOOKING' ? [] : [{
      targetPageReference: linkTarget,
      intent: 'Continue to a related approved page in the visitor journey.',
    }],
    ctaIntent: 'Use native KS OS booking only after the page has answered its visitor purpose.',
  };
  const page = {
    blueprintPageReference: `${String(input.pageIndex + 41).padStart(8, '0')}-2222-4222-8222-${String(input.pageIndex + 41).padStart(12, '0')}`,
    pageReference,
    title: `${input.pageType} fixture`,
    slug: input.pageType === 'HOME' ? 'home' : input.pageType.toLowerCase().replaceAll('_', '-'),
    pageType: input.pageType,
    conversionRole: input.pageType === 'BOOKING' ? 'BOOKING' as const
      : input.pageType === 'SERVICE_DETAIL' || input.pageType === 'SERVICE_HUB' ? 'SERVICE_CONVERSION' as const
        : input.pageType === 'LOCATION_DETAIL' || input.pageType === 'LOCATION_HUB' ? 'LOCAL_DISCOVERY' as const
          : 'PRIMARY_LANDING' as const,
    layoutReference: `${String(input.pageIndex + 61).padStart(8, '0')}-2222-4222-8222-${String(input.pageIndex + 61).padStart(12, '0')}`,
    plannedSectionTypes: [...sectionTypes],
  };
  const template: TemplateGenerationConstraint = {
    templateVersionReference: '99999999-2222-4222-8222-999999999999',
    templateSourceType: 'INTERNAL', templateVersionStatus: 'APPROVED', licenceStatus: 'NOT_REQUIRED',
    layoutReference: page.layoutReference, layoutStatus: 'APPROVED', compatiblePageTypes: [input.pageType],
    rendererKey: `${input.pageType.toLowerCase().replaceAll('_', '-')}-fixture-v1`, rendererVersion: 1, rendererStatus: 'READY',
    requiredSectionTypes: [], prohibitedSectionTypes: [], sectionOrder: [], componentRegistryVersion: 2,
    availableComponentKeys: selectedComponents.map(selection => selection.componentKey),
  };
  return { output, page, template };
}

export const recipeCompositionFixtures = pageTypes.map((pageType, pageIndex) =>
  createRecipeFixture({ pageType, pageIndex }));
