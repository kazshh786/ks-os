import type { SitePageType, SiteSectionType } from '@ks-os/site-schema';

export interface PageCompletenessRecipe {
  pageType: SitePageType;
  pagePurpose: string;
  minMeaningfulSections: number;
  maxRecommendedSections: number;
  minSubstantiveSections: number;
  minSupportingSections: number;
  minSubstantiveWords: number;
  requiredAnyOf: readonly (readonly SiteSectionType[])[];
  recommendedSectionTypes: readonly SiteSectionType[];
  bookingDepthExempt: boolean;
}

const chrome = ['HEADER', 'FINAL_CTA', 'FOOTER'] as const;

export const PAGE_COMPLETENESS_RECIPES: Readonly<Record<SitePageType, PageCompletenessRecipe>> = {
  HOME: {
    pageType: 'HOME', pagePurpose: 'Establish the business, guide discovery, build trust and convert to booking.',
    minMeaningfulSections: 8, maxRecommendedSections: 14, minSubstantiveSections: 6,
    minSupportingSections: 1, minSubstantiveWords: 420, bookingDepthExempt: false,
    requiredAnyOf: [['HERO'], ['INTRODUCTION'], ['FEATURED_SERVICES', 'SERVICE_GRID'], ['BENEFITS', 'PROCESS'], ['TRUST_INDICATORS', 'TESTIMONIALS', 'RESULTS'], ['LOCATION', 'CONTACT']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'TRUST_INDICATORS', 'INTRODUCTION', 'FEATURED_SERVICES', 'BENEFITS', 'GALLERY', 'PROCESS', 'TEAM', 'FAQ', 'LOCATION', ...chrome.slice(1)],
  },
  SERVICE_HUB: {
    pageType: 'SERVICE_HUB', pagePurpose: 'Make service discovery clear and connect visitors to relevant detail and booking.',
    minMeaningfulSections: 7, maxRecommendedSections: 12, minSubstantiveSections: 5,
    minSupportingSections: 1, minSubstantiveWords: 360, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'INTRODUCTION'], ['SERVICE_GRID'], ['FEATURED_SERVICES', 'BENEFITS'], ['PROCESS'], ['FAQ', 'TRUST_INDICATORS']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'SERVICE_GRID', 'FEATURED_SERVICES', 'BENEFITS', 'PROCESS', 'TRUST_INDICATORS', 'FAQ', 'FINAL_CTA', 'FOOTER'],
  },
  SERVICE_DETAIL: {
    pageType: 'SERVICE_DETAIL', pagePurpose: 'Explain one verified service, answer objections and enable service-aware booking.',
    minMeaningfulSections: 7, maxRecommendedSections: 12, minSubstantiveSections: 5,
    minSupportingSections: 1, minSubstantiveWords: 380, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'SERVICE_DETAILS'], ['SERVICE_DETAILS'], ['BENEFITS'], ['PROCESS'], ['PRICING', 'FAQ'], ['TEAM', 'STAFF_PROFILE', 'TRUST_INDICATORS']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'SERVICE_DETAILS', 'BENEFITS', 'PROCESS', 'PRICING', 'TEAM', 'FAQ', 'FEATURED_SERVICES', 'BOOKING_CTA', 'FOOTER'],
  },
  LOCATION_HUB: {
    pageType: 'LOCATION_HUB', pagePurpose: 'Support local discovery and route visitors to verified locations.',
    minMeaningfulSections: 5, maxRecommendedSections: 10, minSubstantiveSections: 3,
    minSupportingSections: 1, minSubstantiveWords: 260, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'INTRODUCTION'], ['LOCATION'], ['CONTACT', 'OPENING_HOURS']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'LOCATION', 'OPENING_HOURS', 'CONTACT', 'TRUST_INDICATORS', 'FINAL_CTA', 'FOOTER'],
  },
  LOCATION_DETAIL: {
    pageType: 'LOCATION_DETAIL', pagePurpose: 'Explain a verified place, access, contact, hours, services and booking.',
    minMeaningfulSections: 6, maxRecommendedSections: 11, minSubstantiveSections: 4,
    minSupportingSections: 1, minSubstantiveWords: 300, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'LOCATION'], ['LOCATION'], ['OPENING_HOURS'], ['CONTACT'], ['SERVICE_GRID', 'FEATURED_SERVICES']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'LOCATION', 'GALLERY', 'OPENING_HOURS', 'CONTACT', 'FEATURED_SERVICES', 'TEAM', 'BOOKING_CTA', 'FOOTER'],
  },
  ABOUT: {
    pageType: 'ABOUT', pagePurpose: 'Build trust through the verified business story, approach, team and environment.',
    minMeaningfulSections: 7, maxRecommendedSections: 12, minSubstantiveSections: 5,
    minSupportingSections: 1, minSubstantiveWords: 400, bookingDepthExempt: false,
    requiredAnyOf: [['HERO'], ['INTRODUCTION'], ['BENEFITS', 'PROCESS'], ['TEAM'], ['GALLERY', 'TRUST_INDICATORS']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'RICH_TEXT', 'BENEFITS', 'PROCESS', 'TEAM', 'GALLERY', 'TRUST_INDICATORS', 'FINAL_CTA', 'FOOTER'],
  },
  TEAM_HUB: {
    pageType: 'TEAM_HUB', pagePurpose: 'Introduce the verified team, roles and service relationships.',
    minMeaningfulSections: 5, maxRecommendedSections: 10, minSubstantiveSections: 3,
    minSupportingSections: 1, minSubstantiveWords: 280, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'INTRODUCTION'], ['TEAM'], ['BENEFITS', 'RICH_TEXT']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'TEAM', 'BENEFITS', 'TRUST_INDICATORS', 'FINAL_CTA', 'FOOTER'],
  },
  TEAM_DETAIL: {
    pageType: 'TEAM_DETAIL', pagePurpose: 'Present a verified staff profile, services, approach and booking route.',
    minMeaningfulSections: 5, maxRecommendedSections: 9, minSubstantiveSections: 3,
    minSupportingSections: 0, minSubstantiveWords: 260, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'STAFF_PROFILE'], ['STAFF_PROFILE'], ['FEATURED_SERVICES', 'SERVICE_GRID', 'BENEFITS']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'STAFF_PROFILE', 'FEATURED_SERVICES', 'BENEFITS', 'BOOKING_CTA', 'FOOTER'],
  },
  CONTACT: {
    pageType: 'CONTACT', pagePurpose: 'Make verified contact, location, opening-hour and booking routes immediately clear.',
    minMeaningfulSections: 5, maxRecommendedSections: 9, minSubstantiveSections: 3,
    minSupportingSections: 1, minSubstantiveWords: 220, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'INTRODUCTION'], ['CONTACT'], ['LOCATION'], ['OPENING_HOURS']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'CONTACT', 'LOCATION', 'OPENING_HOURS', 'FAQ', 'BOOKING_CTA', 'FOOTER'],
  },
  FAQ: {
    pageType: 'FAQ', pagePurpose: 'Resolve business- and service-aware questions without invented information.',
    minMeaningfulSections: 4, maxRecommendedSections: 8, minSubstantiveSections: 2,
    minSupportingSections: 0, minSubstantiveWords: 360, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'INTRODUCTION'], ['FAQ']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'FAQ', 'CONTACT', 'FINAL_CTA', 'FOOTER'],
  },
  POLICIES: {
    pageType: 'POLICIES', pagePurpose: 'Present complete, structured and verified policy information.',
    minMeaningfulSections: 2, maxRecommendedSections: 8, minSubstantiveSections: 1,
    minSupportingSections: 0, minSubstantiveWords: 500, bookingDepthExempt: false,
    requiredAnyOf: [['RICH_TEXT']],
    recommendedSectionTypes: ['HEADER', 'RICH_TEXT', 'CONTACT', 'FINAL_CTA', 'FOOTER'],
  },
  RESULTS: {
    pageType: 'RESULTS', pagePurpose: 'Show only approved result evidence with context and a safe booking path.',
    minMeaningfulSections: 4, maxRecommendedSections: 9, minSubstantiveSections: 2,
    minSupportingSections: 1, minSubstantiveWords: 220, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'INTRODUCTION'], ['RESULTS']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'RESULTS', 'TRUST_INDICATORS', 'FAQ', 'FINAL_CTA', 'FOOTER'],
  },
  NEW_CLIENT_GUIDE: {
    pageType: 'NEW_CLIENT_GUIDE', pagePurpose: 'Prepare new clients with verified visit, booking, arrival and policy guidance.',
    minMeaningfulSections: 5, maxRecommendedSections: 10, minSubstantiveSections: 3,
    minSupportingSections: 1, minSubstantiveWords: 500, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'INTRODUCTION'], ['RICH_TEXT'], ['FAQ'], ['LOCATION', 'CONTACT']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'RICH_TEXT', 'PROCESS', 'LOCATION', 'FAQ', 'BOOKING_CTA', 'FOOTER'],
  },
  AFTERCARE_GUIDE: {
    pageType: 'AFTERCARE_GUIDE', pagePurpose: 'Provide verified service-aware aftercare and contact guidance.',
    minMeaningfulSections: 4, maxRecommendedSections: 9, minSubstantiveSections: 3,
    minSupportingSections: 0, minSubstantiveWords: 450, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'INTRODUCTION'], ['RICH_TEXT'], ['CONTACT', 'FAQ']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'RICH_TEXT', 'FAQ', 'CONTACT', 'FINAL_CTA', 'FOOTER'],
  },
  CONSULTATION_GUIDE: {
    pageType: 'CONSULTATION_GUIDE', pagePurpose: 'Explain the verified consultation flow, preparation and booking route.',
    minMeaningfulSections: 5, maxRecommendedSections: 10, minSubstantiveSections: 3,
    minSupportingSections: 0, minSubstantiveWords: 450, bookingDepthExempt: false,
    requiredAnyOf: [['HERO', 'INTRODUCTION'], ['PROCESS'], ['RICH_TEXT', 'FAQ']],
    recommendedSectionTypes: ['HEADER', 'HERO', 'INTRODUCTION', 'PROCESS', 'RICH_TEXT', 'FAQ', 'BOOKING_CTA', 'FOOTER'],
  },
  BOOKING: {
    pageType: 'BOOKING', pagePurpose: 'Provide a branded, accessible and functional native booking experience.',
    minMeaningfulSections: 1, maxRecommendedSections: 5, minSubstantiveSections: 0,
    minSupportingSections: 0, minSubstantiveWords: 0, bookingDepthExempt: true,
    requiredAnyOf: [],
    recommendedSectionTypes: ['HEADER', 'INTRODUCTION', 'BOOKING_CTA', 'FOOTER'],
  },
};

export function pageCompletenessRecipe(pageType: SitePageType): PageCompletenessRecipe {
  return PAGE_COMPLETENESS_RECIPES[pageType];
}

export function listPageCompletenessRecipes(): readonly PageCompletenessRecipe[] {
  return Object.values(PAGE_COMPLETENESS_RECIPES);
}
