import type {
  SiteConversionRole,
  SitePageType,
  SiteSection,
  SiteSectionType,
} from '@ks-os/site-schema';

export const SITE_COMPONENT_REGISTRY_VERSION = 2 as const;

export const SITE_COMPONENT_DATA_BINDINGS = [
  'BUSINESS',
  'SERVICES',
  'LOCATIONS',
  'STAFF',
  'BOOKING',
  'TESTIMONIALS',
  'GALLERY',
  'RESULTS',
  'OPENING_HOURS',
  'CONTACT',
  'POLICIES',
] as const;
export type SiteComponentDataBinding = typeof SITE_COMPONENT_DATA_BINDINGS[number];

export const SITE_COMPONENT_ASSET_SLOTS = [
  'LOGO',
  'PRIMARY_IMAGE',
  'SECONDARY_IMAGE',
  'PORTRAIT',
  'LOCATION_IMAGE',
  'GALLERY_SET',
  'RESULT_PAIR',
  'DECORATIVE_IMAGE',
] as const;
export type SiteComponentAssetSlot = typeof SITE_COMPONENT_ASSET_SLOTS[number];

export type SiteComponentStatus = 'ACTIVE' | 'DISABLED';
export type SiteComponentVisualWeight = 'LOW' | 'MEDIUM' | 'HIGH';
export type SiteComponentPosition = 'SITE_CHROME' | 'PAGE_START' | 'PAGE_BODY' | 'PAGE_END';
export type SiteComponentClassification =
  | 'CHROME'
  | 'PRIMARY'
  | 'SUBSTANTIVE'
  | 'SUPPORTING'
  | 'CONVERSION'
  | 'LEGAL';

export interface SiteComponentDefinition {
  componentKey: string;
  sectionType: SiteSectionType;
  compatibleSectionTypes: readonly SiteSectionType[];
  version: number;
  status: SiteComponentStatus;
  supportedPageTypes: readonly SitePageType[];
  supportedConversionRoles: readonly SiteConversionRole[];
  requiredDataBindings: readonly SiteComponentDataBinding[];
  optionalDataBindings: readonly SiteComponentDataBinding[];
  supportedAssetSlots: readonly SiteComponentAssetSlot[];
  requiredAssetSlots: readonly SiteComponentAssetSlot[];
  contentSlots: readonly string[];
  layoutIntent: string;
  visualWeight: SiteComponentVisualWeight;
  recommendedPosition: SiteComponentPosition;
  classification: SiteComponentClassification;
  mobileBehaviour: string;
  accessibilityContract: readonly string[];
  allowedThemeModes: readonly ('LIGHT' | 'DARK' | 'SURFACE' | 'OVERLAY')[];
  compatibilityRules: readonly string[];
}

const ALL_PAGE_TYPES: readonly SitePageType[] = [
  'HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'LOCATION_HUB', 'LOCATION_DETAIL',
  'ABOUT', 'TEAM_HUB', 'TEAM_DETAIL', 'CONTACT', 'FAQ', 'POLICIES', 'RESULTS',
  'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE', 'BOOKING',
];

const ALL_CONVERSION_ROLES: readonly SiteConversionRole[] = [
  'PRIMARY_LANDING', 'SERVICE_CONVERSION', 'LOCAL_DISCOVERY', 'TRUST_BUILDING',
  'OBJECTION_HANDLING', 'BOOKING',
];

const SECTION_TYPES: readonly SiteSectionType[] = [
  'HEADER', 'ANNOUNCEMENT_BAR', 'HERO', 'INTRODUCTION', 'FEATURED_SERVICES',
  'SERVICE_GRID', 'SERVICE_DETAILS', 'BENEFITS', 'PROCESS', 'PRICING', 'TEAM',
  'STAFF_PROFILE', 'GALLERY', 'RESULTS', 'TESTIMONIALS', 'TRUST_INDICATORS',
  'FAQ', 'LOCATION', 'OPENING_HOURS', 'CONTACT', 'BOOKING_CTA', 'FINAL_CTA',
  'FOOTER', 'RICH_TEXT',
];

const SECTION_DEFAULTS: Record<SiteSectionType, {
  classification: SiteComponentClassification;
  position: SiteComponentPosition;
  weight: SiteComponentVisualWeight;
  required: readonly SiteComponentDataBinding[];
  optional: readonly SiteComponentDataBinding[];
  assets: readonly SiteComponentAssetSlot[];
  requiredAssets?: readonly SiteComponentAssetSlot[];
  slots: readonly string[];
}> = {
  HEADER: { classification: 'CHROME', position: 'SITE_CHROME', weight: 'MEDIUM', required: ['BUSINESS', 'BOOKING'], optional: [], assets: ['LOGO'], slots: ['brand', 'navigation', 'bookingAction'] },
  ANNOUNCEMENT_BAR: { classification: 'SUPPORTING', position: 'PAGE_START', weight: 'LOW', required: ['BUSINESS'], optional: ['BOOKING'], assets: [], slots: ['message', 'optionalAction'] },
  HERO: { classification: 'PRIMARY', position: 'PAGE_START', weight: 'HIGH', required: ['BUSINESS', 'BOOKING'], optional: ['SERVICES', 'LOCATIONS', 'STAFF'], assets: ['PRIMARY_IMAGE', 'SECONDARY_IMAGE', 'PORTRAIT', 'LOCATION_IMAGE', 'DECORATIVE_IMAGE'], slots: ['eyebrow', 'heading', 'body', 'primaryAction', 'secondaryAction', 'media'] },
  INTRODUCTION: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'MEDIUM', required: ['BUSINESS'], optional: ['SERVICES', 'STAFF', 'LOCATIONS'], assets: ['PRIMARY_IMAGE'], slots: ['heading', 'body', 'supportingPoints', 'media'] },
  FEATURED_SERVICES: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'HIGH', required: ['SERVICES'], optional: ['BOOKING'], assets: ['PRIMARY_IMAGE', 'GALLERY_SET'], slots: ['heading', 'serviceCards', 'serviceActions'] },
  SERVICE_GRID: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'HIGH', required: ['SERVICES'], optional: ['BOOKING'], assets: ['GALLERY_SET'], slots: ['heading', 'serviceCards', 'categories'] },
  SERVICE_DETAILS: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'HIGH', required: ['SERVICES', 'BOOKING'], optional: ['STAFF', 'LOCATIONS'], assets: ['PRIMARY_IMAGE'], slots: ['heading', 'body', 'serviceFacts', 'bookingAction', 'media'] },
  BENEFITS: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'MEDIUM', required: ['BUSINESS'], optional: ['SERVICES'], assets: ['PRIMARY_IMAGE', 'DECORATIVE_IMAGE'], slots: ['heading', 'benefitItems', 'optionalMedia'] },
  PROCESS: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'MEDIUM', required: ['BUSINESS'], optional: ['SERVICES', 'BOOKING'], assets: ['PRIMARY_IMAGE'], slots: ['heading', 'steps', 'optionalMedia'] },
  PRICING: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'MEDIUM', required: ['SERVICES'], optional: ['BOOKING'], assets: [], slots: ['heading', 'pricingItems', 'pricingNotes'] },
  TEAM: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'HIGH', required: ['STAFF'], optional: ['SERVICES', 'BOOKING'], assets: ['PORTRAIT', 'GALLERY_SET'], slots: ['heading', 'staffCards', 'profileLinks'] },
  STAFF_PROFILE: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'HIGH', required: ['STAFF'], optional: ['SERVICES', 'BOOKING'], assets: ['PORTRAIT'], requiredAssets: ['PORTRAIT'], slots: ['name', 'role', 'biography', 'services', 'bookingAction', 'portrait'] },
  GALLERY: { classification: 'SUPPORTING', position: 'PAGE_BODY', weight: 'HIGH', required: ['GALLERY'], optional: [], assets: ['GALLERY_SET'], requiredAssets: ['GALLERY_SET'], slots: ['heading', 'galleryAssets'] },
  RESULTS: { classification: 'SUPPORTING', position: 'PAGE_BODY', weight: 'HIGH', required: ['RESULTS'], optional: [], assets: ['RESULT_PAIR', 'GALLERY_SET'], requiredAssets: ['RESULT_PAIR'], slots: ['heading', 'approvedResults', 'captions'] },
  TESTIMONIALS: { classification: 'SUPPORTING', position: 'PAGE_BODY', weight: 'MEDIUM', required: ['TESTIMONIALS'], optional: [], assets: ['PORTRAIT'], slots: ['heading', 'verifiedQuotes', 'attributions'] },
  TRUST_INDICATORS: { classification: 'SUPPORTING', position: 'PAGE_BODY', weight: 'MEDIUM', required: ['BUSINESS'], optional: ['STAFF', 'SERVICES'], assets: ['LOGO', 'DECORATIVE_IMAGE'], slots: ['heading', 'verifiedTrustItems'] },
  FAQ: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'MEDIUM', required: ['BUSINESS'], optional: ['SERVICES', 'BOOKING'], assets: [], slots: ['heading', 'questions', 'answers'] },
  LOCATION: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'HIGH', required: ['LOCATIONS'], optional: ['CONTACT', 'BOOKING'], assets: ['LOCATION_IMAGE', 'GALLERY_SET'], slots: ['heading', 'address', 'contact', 'media'] },
  OPENING_HOURS: { classification: 'SUPPORTING', position: 'PAGE_BODY', weight: 'LOW', required: ['LOCATIONS', 'OPENING_HOURS'], optional: ['BOOKING'], assets: ['LOCATION_IMAGE'], slots: ['heading', 'openingHours', 'optionalMedia'] },
  CONTACT: { classification: 'SUBSTANTIVE', position: 'PAGE_BODY', weight: 'MEDIUM', required: ['CONTACT'], optional: ['LOCATIONS', 'OPENING_HOURS', 'BOOKING'], assets: ['LOCATION_IMAGE'], slots: ['heading', 'body', 'contactActions', 'location'] },
  BOOKING_CTA: { classification: 'CONVERSION', position: 'PAGE_END', weight: 'HIGH', required: ['BOOKING'], optional: ['SERVICES', 'LOCATIONS', 'STAFF'], assets: ['PRIMARY_IMAGE', 'DECORATIVE_IMAGE'], slots: ['heading', 'body', 'bookingAction', 'optionalMedia'] },
  FINAL_CTA: { classification: 'CONVERSION', position: 'PAGE_END', weight: 'HIGH', required: ['BOOKING'], optional: ['SERVICES', 'LOCATIONS', 'STAFF'], assets: ['PRIMARY_IMAGE', 'DECORATIVE_IMAGE'], slots: ['heading', 'body', 'bookingAction', 'optionalMedia'] },
  FOOTER: { classification: 'CHROME', position: 'SITE_CHROME', weight: 'MEDIUM', required: ['BUSINESS', 'BOOKING'], optional: ['CONTACT', 'LOCATIONS'], assets: ['LOGO'], slots: ['brand', 'navigation', 'contact', 'legal', 'bookingAction'] },
  RICH_TEXT: { classification: 'LEGAL', position: 'PAGE_BODY', weight: 'LOW', required: ['BUSINESS'], optional: ['POLICIES', 'BOOKING'], assets: [], slots: ['heading', 'structuredDocument'] },
};

const SECTION_PAGE_TYPES: Record<SiteSectionType, readonly SitePageType[]> = {
  HEADER: ALL_PAGE_TYPES,
  ANNOUNCEMENT_BAR: ALL_PAGE_TYPES,
  HERO: ALL_PAGE_TYPES.filter(page => page !== 'BOOKING' && page !== 'POLICIES'),
  INTRODUCTION: ALL_PAGE_TYPES,
  FEATURED_SERVICES: ['HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'LOCATION_DETAIL', 'ABOUT', 'TEAM_DETAIL', 'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE'],
  SERVICE_GRID: ['HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'LOCATION_DETAIL', 'TEAM_DETAIL'],
  SERVICE_DETAILS: ['SERVICE_DETAIL'],
  BENEFITS: ['HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'ABOUT', 'TEAM_HUB', 'TEAM_DETAIL', 'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE'],
  PROCESS: ['HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'ABOUT', 'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE'],
  PRICING: ['SERVICE_HUB', 'SERVICE_DETAIL'],
  TEAM: ['HOME', 'SERVICE_DETAIL', 'LOCATION_DETAIL', 'ABOUT', 'TEAM_HUB'],
  STAFF_PROFILE: ['SERVICE_DETAIL', 'TEAM_DETAIL'],
  GALLERY: ['HOME', 'SERVICE_DETAIL', 'LOCATION_DETAIL', 'ABOUT', 'TEAM_HUB', 'RESULTS'],
  RESULTS: ['HOME', 'SERVICE_DETAIL', 'RESULTS'],
  TESTIMONIALS: ['HOME', 'SERVICE_DETAIL', 'ABOUT', 'RESULTS'],
  TRUST_INDICATORS: ALL_PAGE_TYPES.filter(page => page !== 'POLICIES'),
  FAQ: ALL_PAGE_TYPES,
  LOCATION: ['HOME', 'LOCATION_HUB', 'LOCATION_DETAIL', 'CONTACT', 'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE'],
  OPENING_HOURS: ['HOME', 'LOCATION_HUB', 'LOCATION_DETAIL', 'CONTACT', 'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE', 'BOOKING'],
  CONTACT: ['HOME', 'LOCATION_HUB', 'LOCATION_DETAIL', 'CONTACT', 'FAQ', 'POLICIES', 'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE', 'BOOKING'],
  BOOKING_CTA: ALL_PAGE_TYPES,
  FINAL_CTA: ALL_PAGE_TYPES,
  FOOTER: ALL_PAGE_TYPES,
  RICH_TEXT: ['SERVICE_HUB', 'SERVICE_DETAIL', 'ABOUT', 'TEAM_HUB', 'TEAM_DETAIL', 'CONTACT', 'FAQ', 'POLICIES', 'RESULTS', 'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE'],
};

const COMPONENT_NAMES: Record<SiteSectionType, readonly string[]> = {
  HEADER: ['header-classic', 'header-centered', 'header-editorial', 'header-transparent-overlay', 'header-compact', 'header-booking-led'],
  ANNOUNCEMENT_BAR: ['announcement-simple', 'announcement-centered', 'announcement-action', 'announcement-soft'],
  HERO: ['hero-split-image', 'hero-full-bleed', 'hero-editorial', 'hero-centered', 'hero-image-collage', 'hero-service', 'hero-profile', 'hero-location', 'hero-minimal-luxury', 'hero-layered-media'],
  INTRODUCTION: ['intro-centered', 'intro-split', 'intro-editorial', 'intro-with-image', 'intro-with-points', 'intro-large-statement'],
  FEATURED_SERVICES: ['services-image-grid', 'services-editorial-grid', 'services-featured-primary', 'services-horizontal', 'services-card-grid', 'services-minimal-list', 'services-overlapping-media'],
  SERVICE_GRID: ['service-grid-image-cards', 'service-grid-editorial', 'service-grid-compact', 'service-grid-featured', 'service-grid-category-led'],
  SERVICE_DETAILS: ['service-detail-split', 'service-detail-editorial', 'service-detail-image-led', 'service-detail-summary-card', 'service-detail-luxury', 'service-detail-information-rich'],
  BENEFITS: ['benefits-icon-grid', 'benefits-numbered', 'benefits-editorial', 'benefits-cards', 'benefits-split', 'benefits-large-statements'],
  PROCESS: ['process-timeline', 'process-numbered-cards', 'process-horizontal', 'process-alternating', 'process-editorial'],
  PRICING: ['pricing-list', 'pricing-cards', 'pricing-editorial', 'pricing-service-menu', 'pricing-featured'],
  TEAM: ['team-portrait-grid', 'team-editorial', 'team-featured-lead', 'team-compact', 'team-image-led'],
  STAFF_PROFILE: ['profile-split', 'profile-editorial', 'profile-image-led', 'profile-card', 'profile-services-led'],
  GALLERY: ['gallery-grid', 'gallery-masonry', 'gallery-editorial', 'gallery-featured', 'gallery-collage'],
  RESULTS: ['results-grid', 'results-featured', 'results-before-after', 'results-editorial'],
  TESTIMONIALS: ['testimonials-grid', 'testimonials-featured', 'testimonials-editorial', 'testimonials-quote-led'],
  TRUST_INDICATORS: ['trust-strip', 'trust-cards', 'trust-icons', 'trust-editorial', 'trust-statements'],
  FAQ: ['faq-accordion', 'faq-split', 'faq-grouped', 'faq-editorial'],
  LOCATION: ['location-media-split', 'location-details-card', 'location-map-led', 'location-editorial', 'location-contact-led'],
  OPENING_HOURS: ['hours-simple', 'hours-card', 'hours-split', 'hours-editorial'],
  CONTACT: ['contact-split', 'contact-cards', 'contact-location-led', 'contact-minimal', 'contact-editorial'],
  BOOKING_CTA: [],
  FINAL_CTA: ['cta-banner', 'cta-split', 'cta-editorial', 'cta-image-backed', 'cta-card', 'cta-high-impact', 'cta-minimal'],
  FOOTER: ['footer-multi-column', 'footer-editorial', 'footer-compact', 'footer-booking-led', 'footer-large-brand'],
  RICH_TEXT: ['richtext-standard', 'richtext-editorial', 'richtext-policy', 'richtext-guide', 'richtext-narrow'],
};

function layoutIntent(name: string) {
  return name.replaceAll('-', ' ')
    .replace(/\b(grid|cards?)\b/g, 'structured $1')
    .replace(/\b(split|image|media)\b/g, 'balanced $1');
}

function componentDefinition(
  sectionType: SiteSectionType,
  name: string,
): SiteComponentDefinition {
  const defaults = SECTION_DEFAULTS[sectionType];
  const ctaTypes = name.startsWith('cta-')
    ? ['BOOKING_CTA', 'FINAL_CTA'] as const
    : [sectionType];
  const mediaLed = /image|media|gallery|portrait|collage|full-bleed|before-after/.test(name);
  const requiredAssetSlots = mediaLed
    ? defaults.requiredAssets ?? defaults.assets.slice(0, 1)
    : defaults.requiredAssets ?? [];
  return {
    componentKey: `${name}-v1`,
    sectionType,
    compatibleSectionTypes: ctaTypes,
    version: 1,
    status: 'ACTIVE',
    supportedPageTypes: SECTION_PAGE_TYPES[sectionType],
    supportedConversionRoles: ALL_CONVERSION_ROLES,
    requiredDataBindings: defaults.required,
    optionalDataBindings: defaults.optional,
    supportedAssetSlots: defaults.assets,
    requiredAssetSlots,
    contentSlots: defaults.slots,
    layoutIntent: layoutIntent(name),
    visualWeight: /minimal|compact|simple|quiet|narrow/.test(name)
      ? 'LOW'
      : /featured|full-bleed|high-impact|collage|layered|large|image-led/.test(name)
        ? 'HIGH'
        : defaults.weight,
    recommendedPosition: defaults.position,
    classification: defaults.classification,
    mobileBehaviour: /horizontal|split|alternating|multi-column|collage|layered/.test(name)
      ? 'Collapse to a single reading-order column at 768px; keep actions at least 44px high.'
      : 'Preserve semantic reading order, fluid measure and 44px touch targets at 390px.',
    accessibilityContract: [
      'Preserve semantic heading order and labelled landmark structure.',
      'Keep keyboard focus visible and interactive targets at least 44 by 44 CSS pixels.',
      'Use meaningful approved alt text; decorative media uses an empty alt attribute.',
    ],
    allowedThemeModes: name.includes('overlay') || name.includes('full-bleed') || name.includes('image-backed')
      ? ['LIGHT', 'DARK', 'OVERLAY']
      : ['LIGHT', 'DARK', 'SURFACE'],
    compatibilityRules: [
      'Use only content slots declared by the semantic section contract.',
      'Use only approved public references from the current tenant snapshot.',
      'Native booking actions remain server-resolved.',
    ],
  };
}

export function validateSiteComponentDefinition(
  definition: SiteComponentDefinition,
): readonly string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/.test(definition.componentKey)) {
    errors.push('componentKey must be a versioned kebab-case key.');
  }
  if (!SECTION_TYPES.includes(definition.sectionType)) errors.push('sectionType is not controlled.');
  if (!definition.compatibleSectionTypes.includes(definition.sectionType)) {
    errors.push('compatibleSectionTypes must include sectionType.');
  }
  if (!definition.supportedPageTypes.length
    || definition.supportedPageTypes.some(page => !ALL_PAGE_TYPES.includes(page))) {
    errors.push('supportedPageTypes contains no controlled page compatibility.');
  }
  if (!definition.supportedConversionRoles.length
    || definition.supportedConversionRoles.some(role => !ALL_CONVERSION_ROLES.includes(role))) {
    errors.push('supportedConversionRoles contains no controlled conversion compatibility.');
  }
  if (definition.requiredDataBindings.some(binding => !SITE_COMPONENT_DATA_BINDINGS.includes(binding))) {
    errors.push('requiredDataBindings contains an unknown binding.');
  }
  if (definition.optionalDataBindings.some(binding => !SITE_COMPONENT_DATA_BINDINGS.includes(binding))) {
    errors.push('optionalDataBindings contains an unknown binding.');
  }
  if (definition.requiredAssetSlots.some(slot => !definition.supportedAssetSlots.includes(slot))) {
    errors.push('requiredAssetSlots must be supported by the component.');
  }
  return errors;
}

function buildRegistry() {
  const definitions = Object.entries(COMPONENT_NAMES).flatMap(([type, names]) =>
    names.map(name => componentDefinition(type as SiteSectionType, name)));
  definitions.push({
    ...componentDefinition('HERO', 'hero-retired-placeholder'),
    status: 'DISABLED',
  });
  const byKey = new Map<string, SiteComponentDefinition>();
  for (const definition of definitions) {
    const errors = validateSiteComponentDefinition(definition);
    if (errors.length) throw new Error(`Invalid component ${definition.componentKey}: ${errors.join(' ')}`);
    if (byKey.has(definition.componentKey)) throw new Error(`Duplicate component key: ${definition.componentKey}`);
    byKey.set(definition.componentKey, Object.freeze(definition));
  }
  return byKey;
}

const REGISTRY = buildRegistry();

export function listSiteComponents(filters: {
  sectionType?: SiteSectionType;
  pageType?: SitePageType;
  conversionRole?: SiteConversionRole;
  includeDisabled?: boolean;
} = {}): readonly SiteComponentDefinition[] {
  return [...REGISTRY.values()].filter(component =>
    (filters.includeDisabled || component.status === 'ACTIVE')
    && (!filters.sectionType || component.compatibleSectionTypes.includes(filters.sectionType))
    && (!filters.pageType || component.supportedPageTypes.includes(filters.pageType))
    && (!filters.conversionRole || component.supportedConversionRoles.includes(filters.conversionRole)));
}

export function getSiteComponent(componentKey: string): SiteComponentDefinition | null {
  return REGISTRY.get(componentKey) ?? null;
}

const LEGACY_VARIANT_HINTS: Record<string, readonly string[]> = {
  editorial: ['editorial'],
  grid: ['grid', 'cards'],
  split: ['split'],
  compact: ['compact', 'minimal', 'simple', 'narrow'],
  featured: ['featured', 'high-impact'],
  quiet: ['minimal', 'editorial', 'simple'],
  standard: ['classic', 'standard', 'centered', 'list', 'accordion'],
};

export function resolveSiteComponent(input: {
  sectionType: SiteSectionType;
  componentKey?: string;
  legacyVariant?: string;
  pageType?: SitePageType;
  conversionRole?: SiteConversionRole;
}): SiteComponentDefinition {
  let component: SiteComponentDefinition | null = null;
  if (input.componentKey) {
    component = getSiteComponent(input.componentKey);
    if (!component) throw new Error(`Unknown site componentKey: ${input.componentKey}.`);
  } else {
    const available = listSiteComponents({
      sectionType: input.sectionType,
      pageType: input.pageType,
      conversionRole: input.conversionRole,
    });
    const hints = LEGACY_VARIANT_HINTS[input.legacyVariant ?? 'standard'] ?? [];
    component = available.find(candidate =>
      hints.some(hint => candidate.componentKey.includes(hint))) ?? available[0] ?? null;
  }
  if (!component) throw new Error(`No active site component is registered for ${input.sectionType}.`);
  if (component.status !== 'ACTIVE') throw new Error(`Site component ${component.componentKey} is disabled.`);
  if (!component.compatibleSectionTypes.includes(input.sectionType)) {
    throw new Error(`Site component ${component.componentKey} is incompatible with ${input.sectionType}.`);
  }
  if (input.pageType && !component.supportedPageTypes.includes(input.pageType)) {
    throw new Error(`Site component ${component.componentKey} is incompatible with ${input.pageType}.`);
  }
  if (input.conversionRole && !component.supportedConversionRoles.includes(input.conversionRole)) {
    throw new Error(`Site component ${component.componentKey} is incompatible with ${input.conversionRole}.`);
  }
  return component;
}

export function componentForSection(
  section: SiteSection,
  page?: { pageType: SitePageType; conversionRole: SiteConversionRole },
) {
  return resolveSiteComponent({
    sectionType: section.type,
    ...('componentKey' in section && section.componentKey
      ? { componentKey: section.componentKey }
      : {}),
    ...(section.variant ? { legacyVariant: section.variant } : {}),
    ...(page ? { pageType: page.pageType, conversionRole: page.conversionRole } : {}),
  });
}

export function componentRegistrySummary() {
  const activeComponents = listSiteComponents();
  return {
    version: SITE_COMPONENT_REGISTRY_VERSION,
    componentCount: activeComponents.length,
    registeredComponentCount: REGISTRY.size,
    semanticSectionTypeCount: SECTION_TYPES.length,
    bySectionType: Object.fromEntries(SECTION_TYPES.map(sectionType => [
      sectionType,
      listSiteComponents({ sectionType }).length,
    ])),
  } as const;
}
