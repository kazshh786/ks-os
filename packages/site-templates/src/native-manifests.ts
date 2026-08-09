import {
  listSiteComponents,
  SITE_COMPONENT_REGISTRY_VERSION,
  type SiteComponentClassification,
} from '@ks-os/site-components';
import type { SitePageType, SiteSectionType } from '@ks-os/site-schema';

export interface NativeLayoutSectionCapability {
  sectionType: SiteSectionType;
  componentKeys: readonly string[];
  classifications: readonly SiteComponentClassification[];
  required: boolean;
}

export interface NativeLayoutCapabilityManifest {
  schemaVersion: 2;
  componentRegistryVersion: number;
  semanticKey: string;
  pageTypes: readonly SitePageType[];
  sections: readonly NativeLayoutSectionCapability[];
}

const LAYOUTS: Readonly<Record<string, {
  pageTypes: readonly SitePageType[];
  required: readonly SiteSectionType[];
  supported: readonly SiteSectionType[];
}>> = {
  'native-home': {
    pageTypes: ['HOME'],
    required: ['HEADER', 'HERO', 'INTRODUCTION', 'FEATURED_SERVICES', 'BENEFITS', 'TRUST_INDICATORS', 'FINAL_CTA', 'FOOTER'],
    supported: ['HEADER', 'ANNOUNCEMENT_BAR', 'HERO', 'INTRODUCTION', 'FEATURED_SERVICES', 'SERVICE_GRID', 'BENEFITS', 'PROCESS', 'TEAM', 'GALLERY', 'RESULTS', 'TESTIMONIALS', 'TRUST_INDICATORS', 'FAQ', 'LOCATION', 'OPENING_HOURS', 'CONTACT', 'BOOKING_CTA', 'FINAL_CTA', 'FOOTER'],
  },
  'native-service-hub': {
    pageTypes: ['SERVICE_HUB'], required: ['HEADER', 'HERO', 'SERVICE_GRID', 'FINAL_CTA', 'FOOTER'],
    supported: ['HEADER', 'HERO', 'INTRODUCTION', 'FEATURED_SERVICES', 'SERVICE_GRID', 'BENEFITS', 'PROCESS', 'PRICING', 'TRUST_INDICATORS', 'FAQ', 'RICH_TEXT', 'FINAL_CTA', 'FOOTER'],
  },
  'native-service-detail': {
    pageTypes: ['SERVICE_DETAIL'], required: ['HEADER', 'HERO', 'SERVICE_DETAILS', 'BENEFITS', 'BOOKING_CTA', 'FOOTER'],
    supported: ['HEADER', 'HERO', 'INTRODUCTION', 'SERVICE_DETAILS', 'BENEFITS', 'PROCESS', 'PRICING', 'TEAM', 'STAFF_PROFILE', 'GALLERY', 'RESULTS', 'TESTIMONIALS', 'TRUST_INDICATORS', 'FAQ', 'FEATURED_SERVICES', 'RICH_TEXT', 'BOOKING_CTA', 'FINAL_CTA', 'FOOTER'],
  },
  'native-about': {
    pageTypes: ['ABOUT'], required: ['HEADER', 'HERO', 'INTRODUCTION', 'TEAM', 'FINAL_CTA', 'FOOTER'],
    supported: ['HEADER', 'HERO', 'INTRODUCTION', 'BENEFITS', 'PROCESS', 'TEAM', 'GALLERY', 'TESTIMONIALS', 'TRUST_INDICATORS', 'RICH_TEXT', 'FINAL_CTA', 'FOOTER'],
  },
  'native-contact': {
    pageTypes: ['CONTACT'], required: ['HEADER', 'HERO', 'CONTACT', 'LOCATION', 'OPENING_HOURS', 'BOOKING_CTA', 'FOOTER'],
    supported: ['HEADER', 'HERO', 'INTRODUCTION', 'CONTACT', 'LOCATION', 'OPENING_HOURS', 'FAQ', 'RICH_TEXT', 'BOOKING_CTA', 'FINAL_CTA', 'FOOTER'],
  },
  'native-faq': {
    pageTypes: ['FAQ'], required: ['HEADER', 'HERO', 'FAQ', 'FINAL_CTA', 'FOOTER'],
    supported: ['HEADER', 'HERO', 'INTRODUCTION', 'FAQ', 'CONTACT', 'RICH_TEXT', 'FINAL_CTA', 'FOOTER'],
  },
  'native-location-detail': {
    pageTypes: ['LOCATION_HUB', 'LOCATION_DETAIL'], required: ['HEADER', 'HERO', 'LOCATION', 'OPENING_HOURS', 'CONTACT', 'BOOKING_CTA', 'FOOTER'],
    supported: ['HEADER', 'HERO', 'INTRODUCTION', 'LOCATION', 'OPENING_HOURS', 'CONTACT', 'GALLERY', 'FEATURED_SERVICES', 'TEAM', 'FAQ', 'BOOKING_CTA', 'FINAL_CTA', 'FOOTER'],
  },
  'native-team-hub': {
    pageTypes: ['TEAM_HUB'], required: ['HEADER', 'HERO', 'TEAM', 'FINAL_CTA', 'FOOTER'],
    supported: ['HEADER', 'HERO', 'INTRODUCTION', 'TEAM', 'BENEFITS', 'GALLERY', 'TRUST_INDICATORS', 'RICH_TEXT', 'FINAL_CTA', 'FOOTER'],
  },
  'native-team-detail': {
    pageTypes: ['TEAM_DETAIL'], required: ['HEADER', 'HERO', 'STAFF_PROFILE', 'BOOKING_CTA', 'FOOTER'],
    supported: ['HEADER', 'HERO', 'STAFF_PROFILE', 'INTRODUCTION', 'FEATURED_SERVICES', 'SERVICE_GRID', 'BENEFITS', 'TRUST_INDICATORS', 'RICH_TEXT', 'BOOKING_CTA', 'FOOTER'],
  },
  'native-policies': {
    pageTypes: ['POLICIES'], required: ['HEADER', 'RICH_TEXT', 'FINAL_CTA', 'FOOTER'],
    supported: ['HEADER', 'INTRODUCTION', 'RICH_TEXT', 'CONTACT', 'FAQ', 'FINAL_CTA', 'FOOTER'],
  },
  'native-guide': {
    pageTypes: ['NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE'], required: ['HEADER', 'HERO', 'RICH_TEXT', 'FINAL_CTA', 'FOOTER'],
    supported: ['HEADER', 'HERO', 'INTRODUCTION', 'PROCESS', 'BENEFITS', 'RICH_TEXT', 'FAQ', 'LOCATION', 'OPENING_HOURS', 'CONTACT', 'BOOKING_CTA', 'FINAL_CTA', 'FOOTER'],
  },
  'native-booking': {
    pageTypes: ['BOOKING'], required: ['HEADER', 'INTRODUCTION', 'BOOKING_CTA', 'FOOTER'],
    supported: ['HEADER', 'INTRODUCTION', 'TRUST_INDICATORS', 'FAQ', 'CONTACT', 'BOOKING_CTA', 'FOOTER'],
  },
  'native-results': {
    pageTypes: ['RESULTS'], required: ['HEADER', 'HERO', 'RESULTS', 'FINAL_CTA', 'FOOTER'],
    supported: ['HEADER', 'HERO', 'INTRODUCTION', 'RESULTS', 'GALLERY', 'TESTIMONIALS', 'TRUST_INDICATORS', 'FAQ', 'RICH_TEXT', 'FINAL_CTA', 'FOOTER'],
  },
};

function capability(sectionType: SiteSectionType, required: ReadonlySet<SiteSectionType>) {
  const components = listSiteComponents({ sectionType });
  return {
    sectionType,
    componentKeys: components.map(component => component.componentKey),
    classifications: [...new Set(components.map(component => component.classification))],
    required: required.has(sectionType),
  } satisfies NativeLayoutSectionCapability;
}

export function getNativeLayoutManifest(semanticKey: string): NativeLayoutCapabilityManifest | null {
  const layout = LAYOUTS[semanticKey];
  if (!layout) return null;
  const required = new Set(layout.required);
  return {
    schemaVersion: 2,
    componentRegistryVersion: SITE_COMPONENT_REGISTRY_VERSION,
    semanticKey,
    pageTypes: layout.pageTypes,
    sections: layout.supported.map(sectionType => capability(sectionType, required)),
  };
}

export function listNativeLayoutManifests(): readonly NativeLayoutCapabilityManifest[] {
  return Object.keys(LAYOUTS).map(key => getNativeLayoutManifest(key)!);
}
