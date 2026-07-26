import {
  SitePageTypeSchema,
  templateConfidenceBand,
  type SiteConversionRole,
  type SitePageType,
  type TemplateDetectedPageType,
  type TemplateSectionType,
} from '@ks-os/contracts';
import type {
  HtmlPageAnalysis,
  TemplateLayoutClassification,
} from './types.js';

const allPageTypes = [...SitePageTypeSchema.options];

const requiredSections: Partial<Record<SitePageType, TemplateSectionType[]>> = {
  HOME: ['HERO'],
  SERVICE_HUB: ['SERVICE_GRID'],
  SERVICE_DETAIL: ['SERVICE_DETAILS', 'BOOKING_CTA'],
  LOCATION_DETAIL: ['LOCATION'],
  CONTACT: ['CONTACT_FORM'],
  TEAM_HUB: ['TEAM'],
  TEAM_DETAIL: ['STAFF_PROFILE'],
  FAQ: ['FAQ'],
  RESULTS: ['RESULTS'],
  BOOKING: ['BOOKING_CTA'],
};

const additionalPageTypeSuggestions: Partial<
  Record<SitePageType, SitePageType[]>
> = {
  LOCATION_HUB: ['SERVICE_HUB'],
  LOCATION_DETAIL: ['CONTACT'],
  ABOUT: ['TEAM_HUB'],
  FAQ: ['NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE'],
  NEW_CLIENT_GUIDE: ['CONSULTATION_GUIDE'],
  AFTERCARE_GUIDE: ['NEW_CLIENT_GUIDE'],
  CONSULTATION_GUIDE: ['NEW_CLIENT_GUIDE'],
};

const conversionRoles: Record<SitePageType, SiteConversionRole> = {
  HOME: 'PRIMARY_LANDING',
  SERVICE_HUB: 'SERVICE_CONVERSION',
  SERVICE_DETAIL: 'SERVICE_CONVERSION',
  LOCATION_HUB: 'LOCAL_DISCOVERY',
  LOCATION_DETAIL: 'LOCAL_DISCOVERY',
  ABOUT: 'TRUST_BUILDING',
  TEAM_HUB: 'TRUST_BUILDING',
  TEAM_DETAIL: 'TRUST_BUILDING',
  CONTACT: 'LOCAL_DISCOVERY',
  FAQ: 'OBJECTION_HANDLING',
  POLICIES: 'OBJECTION_HANDLING',
  RESULTS: 'TRUST_BUILDING',
  NEW_CLIENT_GUIDE: 'OBJECTION_HANDLING',
  AFTERCARE_GUIDE: 'OBJECTION_HANDLING',
  CONSULTATION_GUIDE: 'OBJECTION_HANDLING',
  BOOKING: 'BOOKING',
};

interface Candidate {
  detected: TemplateDetectedPageType;
  recommended: SitePageType | null;
  score: number;
  evidence: string[];
}

function normalizedSignals(filePath: string, analysis: HtmlPageAnalysis) {
  return [
    filePath.replaceAll('\\', '/').toLowerCase(),
    analysis.title?.toLowerCase() || '',
    ...analysis.textSignals.map((signal) => signal.toLowerCase()),
    ...analysis.sections.map((section) => section.sectionType.toLowerCase()),
  ].join(' ');
}

function candidate(
  detected: TemplateDetectedPageType,
  recommended: SitePageType | null,
  score: number,
  evidence: string[],
): Candidate {
  return { detected, recommended, score, evidence };
}

export function classifyHtmlLayout(
  filePath: string,
  analysis: HtmlPageAnalysis,
): TemplateLayoutClassification {
  const signal = normalizedSignals(filePath, analysis);
  const sectionTypes = new Set(
    analysis.sections.map((section) => section.sectionType),
  );
  const candidates: Candidate[] = [
    candidate(
      'PORTFOLIO',
      'RESULTS',
      /\b(portfolio|lookbook|our[-_ ]?work)\b/.test(signal) ? 0.91 : 0,
      ['PORTFOLIO_TERMINOLOGY'],
    ),
    candidate(
      'PRODUCT_DETAIL',
      null,
      /\b(product[-_ ]?(detail|single)|add to cart|sku|shopping cart)\b/.test(signal)
        ? 0.94
        : 0,
      ['ECOMMERCE_PRODUCT_SIGNALS'],
    ),
    candidate(
      'SHOP',
      null,
      /\b(shop|store|product[-_ ]?grid|shopping)\b/.test(signal) ? 0.88 : 0,
      ['ECOMMERCE_CATALOGUE_SIGNALS'],
    ),
    candidate(
      'BLOG_ARTICLE',
      null,
      /\b(blog[-_ ]?(single|article)|article[-_ ]?detail|published by)\b/.test(signal)
        ? 0.88
        : 0,
      ['ARTICLE_METADATA_SIGNALS'],
    ),
    candidate(
      'BLOG_ARCHIVE',
      null,
      /\b(blog|news)[-_ ]?(archive|grid|list)\b/.test(signal) ? 0.84 : 0,
      ['ARTICLE_ARCHIVE_SIGNALS'],
    ),
    candidate(
      'CAREERS',
      null,
      /\b(careers?|vacancies|join[-_ ]?(our[-_ ]?)?team|job[-_ ]?openings?)\b/.test(
        signal,
      ) ? 0.9 : 0,
      ['CAREERS_TERMINOLOGY'],
    ),
    candidate(
      'CASE_STUDY',
      'RESULTS',
      /\bcase[-_ ]?stud(?:y|ies)|client[-_ ]?success\b/.test(signal) ? 0.88 : 0,
      ['CASE_STUDY_SIGNALS', 'RESULTS_RECOMMENDATION_REQUIRES_REVIEW'],
    ),
    candidate(
      'COMING_SOON',
      null,
      /\bcoming[-_ ]?soon|launching[-_ ]?soon\b/.test(signal) ? 0.94 : 0,
      ['COMING_SOON_SIGNALS'],
    ),
    candidate(
      'ERROR_PAGE',
      null,
      /(?:^|[/_-])(?:404|500|error)(?:[._/-]|$)|\bpage not found\b/.test(signal)
        ? 0.96
        : 0,
      ['ERROR_PAGE_SIGNALS'],
    ),
    candidate(
      'UTILITY_PAGE',
      null,
      /\b(search[-_ ]?results?|sitemap|maintenance)\b/.test(signal) ? 0.82 : 0,
      ['UTILITY_PAGE_SIGNALS'],
    ),
    candidate(
      'CONTACT',
      'CONTACT',
      (
        /\bcontact(?:[-_ ]?us)?\b/.test(signal)
        && (analysis.formCount > 0 || sectionTypes.has('CONTACT_FORM'))
      ) ? 0.92 : 0,
      ['CONTACT_TERMINOLOGY', 'CONTACT_FORM_PRESENT'],
    ),
    candidate(
      'TEAM_DETAIL',
      'TEAM_DETAIL',
      /\b(team|staff|practitioner)[-_ ]?(detail|single|profile)\b/.test(signal)
        || sectionTypes.has('STAFF_PROFILE')
        ? 0.9
        : 0,
      ['INDIVIDUAL_STAFF_PROFILE_SIGNALS'],
    ),
    candidate(
      'TEAM_HUB',
      'TEAM_HUB',
      /\b(team|staff|practitioners?)[-_ ]?(grid|list|members?)\b/.test(signal)
        || sectionTypes.has('TEAM')
        ? 0.86
        : 0,
      ['TEAM_COLLECTION_SIGNALS'],
    ),
    candidate(
      'SERVICE_DETAIL',
      'SERVICE_DETAIL',
      (
        /\b(service|treatment)[-_ ]?(detail|single)\b/.test(signal)
        || sectionTypes.has('SERVICE_DETAILS')
      ) && !/\bportfolio|product|shop|cart\b/.test(signal)
        ? 0.92
        : 0,
      ['SERVICE_DETAIL_TERMINOLOGY', 'SERVICE_CONVERSION_STRUCTURE'],
    ),
    candidate(
      'RESULTS',
      'RESULTS',
      /\b(results?|before[-_ ]?(and[-_ ]?)?after|transformations?)\b/.test(signal)
        || sectionTypes.has('RESULTS')
        ? 0.88
        : 0,
      ['RESULTS_STRUCTURE'],
    ),
    candidate(
      'SERVICE_HUB',
      'SERVICE_HUB',
      /\bservices?[-_ ]?(grid|hub|list|overview)\b/.test(signal)
        || sectionTypes.has('SERVICE_GRID')
        ? 0.86
        : 0,
      ['SERVICE_COLLECTION_SIGNALS'],
    ),
    candidate(
      'LOCATION_HUB',
      'LOCATION_HUB',
      /\b(locations?|salons?|clinics?)[-_ ]?(grid|hub|list|directory)\b/.test(
        signal,
      )
        ? 0.88
        : 0,
      ['LOCATION_COLLECTION_SIGNALS'],
    ),
    candidate(
      'LOCATION_DETAIL',
      'LOCATION_DETAIL',
      /\b(location|salon|clinic)[-_ ]?(detail|single)\b/.test(signal)
        ? 0.86
        : 0,
      ['LOCATION_DETAIL_SIGNALS'],
    ),
    candidate(
      'FAQ',
      'FAQ',
      /\bfaq|frequently asked\b/.test(signal) || sectionTypes.has('FAQ') ? 0.9 : 0,
      ['FAQ_SIGNALS'],
    ),
    candidate(
      'POLICIES',
      'POLICIES',
      /\bprivacy|terms|cancellation policy|policies\b/.test(signal) ? 0.92 : 0,
      ['POLICY_TERMINOLOGY'],
    ),
    candidate(
      'NEW_CLIENT_GUIDE',
      'NEW_CLIENT_GUIDE',
      /\bnew[-_ ]?(client|patient)[-_ ]?(guide|information)|first[-_ ]?visit\b/.test(
        signal,
      )
        ? 0.9
        : 0,
      ['NEW_CLIENT_GUIDE_SIGNALS'],
    ),
    candidate(
      'AFTERCARE_GUIDE',
      'AFTERCARE_GUIDE',
      /\baftercare|post[-_ ]?(treatment|appointment)[-_ ]?(care|guide)\b/.test(
        signal,
      )
        ? 0.92
        : 0,
      ['AFTERCARE_GUIDE_SIGNALS'],
    ),
    candidate(
      'CONSULTATION_GUIDE',
      'CONSULTATION_GUIDE',
      /\bconsultation[-_ ]?(guide|information|preparation)\b/.test(signal)
        ? 0.92
        : 0,
      ['CONSULTATION_GUIDE_SIGNALS'],
    ),
    candidate(
      'ABOUT',
      'ABOUT',
      /\babout[-_ ]?(us)?\b|our story|who we are/.test(signal) ? 0.82 : 0,
      ['ABOUT_TERMINOLOGY'],
    ),
    candidate(
      'BOOKING',
      'BOOKING',
      /\bbooking[-_ ]?(page|form)|book appointment\b/.test(signal)
        && analysis.bookingCtas.length > 0
        ? 0.9
        : 0,
      ['BOOKING_FLOW_SIGNALS'],
    ),
    candidate(
      'HOME',
      'HOME',
      /(?:^|\/)(?:index|home)(?:[-_.\/]|$)/.test(filePath.toLowerCase())
        && sectionTypes.has('HERO')
        ? 0.88
        : 0,
      ['HOME_FILENAME', 'HERO_PRESENT'],
    ),
  ];

  const selected = candidates.sort((left, right) => right.score - left.score)[0];
  const resolved = selected?.score > 0
    ? selected
    : candidate('UNKNOWN', null, 0.25, ['NO_DECISIVE_SEMANTIC_SIGNALS']);
  const confidence = Math.min(1, Math.max(0, resolved.score));
  const recommended = resolved.recommended;
  const missingExpectedSections = recommended
    ? requiredSectionsForPageType(recommended).filter(
      (section) =>
        section === 'BOOKING_CTA'
          ? analysis.bookingCtas.length === 0
          : !sectionTypes.has(section),
    )
    : [];
  const requiresAgencyReview =
    confidence < 0.8
    || resolved.detected === 'PORTFOLIO'
    || resolved.detected === 'PRODUCT_DETAIL'
    || resolved.detected === 'SHOP'
    || resolved.detected === 'CASE_STUDY'
    || resolved.detected === 'UNKNOWN'
    || missingExpectedSections.length > 0;
  const conversionRole = recommended
    ? conversionRoles[recommended]
    : 'TRUST_BUILDING';
  const suggestedAdditionalPageTypes = recommended
    ? additionalPageTypeSuggestions[recommended] || []
    : [];
  const incompatiblePageTypes = recommended
    ? allPageTypes.filter(
      (pageType) =>
        pageType !== recommended
        && !suggestedAdditionalPageTypes.includes(pageType),
    )
    : allPageTypes;

  return {
    detectedPageType: resolved.detected,
    recommendedPageType: recommended,
    suggestedAdditionalPageTypes,
    incompatiblePageTypes,
    conversionRole,
    confidence,
    confidenceBand: templateConfidenceBand(confidence),
    evidence: resolved.evidence,
    missingExpectedSections,
    requiresAgencyReview,
  };
}

export function requiredSectionsForPageType(
  pageType: SitePageType,
): readonly TemplateSectionType[] {
  return requiredSections[pageType] || [];
}

export function conversionRoleForPageType(
  pageType: SitePageType,
): SiteConversionRole {
  return conversionRoles[pageType];
}
