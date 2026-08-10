import {
  CampaignReferenceSchema,
  EmailActionSchema,
  InternalPageActionSchema,
  KsOsBookingActionSchema,
  PhoneActionSchema,
  PublicReferenceSchema,
  SiteConversionRoleSchema,
  SitePageTypeSchema,
  SiteStatusSchema,
  SiteVersionStatusSchema,
  TenantSubdomainSchema,
} from '@ks-os/contracts';
import { z } from 'zod';

export type {
  SiteConversionRole,
  SitePageType,
} from '@ks-os/contracts';

/**
 * The controlled discriminator list for structured site sections.
 *
 * Knowledge imports and other framework-neutral packages consume this enum
 * instead of maintaining a second copy of the renderer's section vocabulary.
 */
export const SiteSectionTypeSchema = z.enum([
  'HEADER',
  'ANNOUNCEMENT_BAR',
  'HERO',
  'INTRODUCTION',
  'FEATURED_SERVICES',
  'SERVICE_GRID',
  'SERVICE_DETAILS',
  'BENEFITS',
  'PROCESS',
  'PRICING',
  'TEAM',
  'STAFF_PROFILE',
  'GALLERY',
  'RESULTS',
  'TESTIMONIALS',
  'TRUST_INDICATORS',
  'FAQ',
  'LOCATION',
  'OPENING_HOURS',
  'CONTACT',
  'BOOKING_CTA',
  'FINAL_CTA',
  'FOOTER',
  'RICH_TEXT',
]);
export type SiteSectionType = z.infer<typeof SiteSectionTypeSchema>;

const ShortTextSchema = z.string().trim().min(1).max(240);
const BodyTextSchema = z.string().trim().min(1).max(4_000);
const HexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const SafePathSchema = z.string().min(1).max(500).superRefine((path, ctx) => {
  if (!path.startsWith('/') || path.startsWith('//')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Paths must be site-relative.' });
  }
  if (/[?#\\\u0000-\u001f\u007f]/.test(path) || path.includes('..') || path.includes('//')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The path contains unsafe syntax.' });
  }
  if (path !== '/' && !/^\/[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(path)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The path is not canonical.' });
  }
});

export const RESERVED_PUBLIC_SITE_PATHS = new Set([
  '/api',
  '/assets',
  '/book',
  '/health',
  '/robots.txt',
  '/sitemap.xml',
  '/site-preview',
  '/_astro',
]);

export const SiteRendererStatusSchema = z.enum([
  'UNMAPPED',
  'MAPPED',
  'READY',
  'DISABLED',
  'REQUIRES_REVIEW',
]);
export type SiteRendererStatus = z.infer<typeof SiteRendererStatusSchema>;

export const SiteDesignTokensV2Schema = z.object({
  designVersion: z.literal(2),
  typography: z.object({
    displayFont: z.enum(['SYSTEM_SANS', 'SYSTEM_SERIF', 'EDITORIAL_SERIF']),
    headingFont: z.enum(['SYSTEM_SANS', 'SYSTEM_SERIF', 'EDITORIAL_SERIF']),
    bodyFont: z.enum(['SYSTEM_SANS', 'SYSTEM_SERIF']),
    displayScale: z.enum(['RESTRAINED', 'BALANCED', 'DRAMATIC']),
    headingScale: z.enum(['COMPACT', 'BALANCED', 'EXPRESSIVE']),
    bodyScale: z.enum(['COMPACT', 'STANDARD', 'GENEROUS']),
    headingWeight: z.enum(['REGULAR', 'MEDIUM', 'SEMIBOLD', 'BOLD']),
    bodyWeight: z.enum(['REGULAR', 'MEDIUM']),
    displayTracking: z.enum(['TIGHT', 'NORMAL', 'WIDE']),
    headingTracking: z.enum(['TIGHT', 'NORMAL', 'WIDE']),
    headingLineHeight: z.enum(['TIGHT', 'STANDARD', 'RELAXED']),
    bodyLineHeight: z.enum(['STANDARD', 'RELAXED', 'SPACIOUS']),
  }).strict(),
  layout: z.object({
    containerWidths: z.enum(['COMPACT_RANGE', 'BALANCED_RANGE', 'EXPANSIVE_RANGE']),
    pageGutter: z.enum(['COMPACT', 'STANDARD', 'GENEROUS']),
    sectionSpacing: z.enum(['COMPACT', 'STANDARD', 'EXPANSIVE']),
    contentSpacing: z.enum(['TIGHT', 'STANDARD', 'RELAXED']),
    gridColumns: z.enum(['TEN', 'TWELVE', 'SIXTEEN']),
    gridGap: z.enum(['TIGHT', 'STANDARD', 'GENEROUS']),
    textMeasure: z.enum(['NARROW', 'READABLE', 'WIDE']),
  }).strict(),
  shape: z.object({
    radiusScale: z.enum(['NONE', 'SUBTLE', 'SOFT', 'ROUNDED']),
    cardRadius: z.enum(['NONE', 'SMALL', 'MEDIUM', 'LARGE']),
    buttonRadius: z.enum(['SQUARE', 'SOFT', 'PILL']),
    imageRadius: z.enum(['NONE', 'SMALL', 'MEDIUM', 'LARGE']),
  }).strict(),
  surface: z.object({
    background: HexColourSchema,
    surface: HexColourSchema,
    surfaceAlt: HexColourSchema,
    border: HexColourSchema,
    mutedSurface: HexColourSchema,
  }).strict(),
  elevation: z.enum(['NONE', 'SUBTLE', 'MEDIUM', 'STRONG']),
  buttons: z.object({
    height: z.enum(['COMPACT', 'STANDARD', 'LARGE']),
    padding: z.enum(['COMPACT', 'STANDARD', 'GENEROUS']),
    weight: z.enum(['MEDIUM', 'SEMIBOLD', 'BOLD']),
    primaryStyle: z.enum(['SOLID', 'OUTLINE', 'SOFT', 'HIGH_CONTRAST']),
    secondaryStyle: z.enum(['TEXT', 'OUTLINE', 'SOFT']),
  }).strict(),
  imagery: z.object({
    defaultAspectRatio: z.enum(['SQUARE', 'FOUR_THREE', 'THREE_TWO', 'SIXTEEN_NINE']),
    portraitAspectRatio: z.enum(['THREE_FOUR', 'FOUR_FIVE', 'TWO_THREE']),
    serviceAspectRatio: z.enum(['SQUARE', 'FOUR_THREE', 'THREE_TWO', 'SIXTEEN_NINE']),
    cropMode: z.enum(['COVER', 'CONTAIN']),
    focalBehaviour: z.enum(['ASSET_FOCAL_POINT', 'CENTRE', 'TOP']),
    imageTreatment: z.enum(['NATURAL', 'EDITORIAL', 'SOFTENED', 'HIGH_CONTRAST', 'MONOCHROME']),
  }).strict(),
  sectionRhythm: z.enum([
    'CONTINUOUS',
    'ALTERNATING_SURFACES',
    'EDITORIAL',
    'HIGH_CONTRAST',
    'SOFT_LUXURY',
  ]),
}).strict();
export type SiteDesignTokensV2 = z.infer<typeof SiteDesignTokensV2Schema>;

export const SiteThemeSchema = z.object({
  primaryColour: HexColourSchema,
  secondaryColour: HexColourSchema,
  accentColour: HexColourSchema,
  backgroundColour: HexColourSchema,
  surfaceColour: HexColourSchema,
  textColour: HexColourSchema,
  mutedTextColour: HexColourSchema,
  borderColour: HexColourSchema,
  headingFontKey: z.enum(['SYSTEM_SANS', 'SYSTEM_SERIF', 'EDITORIAL_SERIF']),
  bodyFontKey: z.enum(['SYSTEM_SANS', 'SYSTEM_SERIF']),
  radiusScale: z.enum(['NONE', 'SMALL', 'MEDIUM', 'LARGE']),
  spacingDensity: z.enum(['COMPACT', 'COMFORTABLE', 'AIRY']),
  containerWidth: z.enum(['NARROW', 'STANDARD', 'WIDE']),
  buttonStyle: z.enum(['SOLID', 'OUTLINE', 'SOFT']),
  imageStyle: z.enum(['SQUARE', 'ROUNDED', 'EDITORIAL']),
  motionPreference: z.enum(['NONE', 'REDUCED', 'STANDARD']),
  designTokens: SiteDesignTokensV2Schema.optional(),
}).strict();
export type SiteTheme = z.infer<typeof SiteThemeSchema>;

const ApprovedAssetUrlSchema = z.string().url().max(2_000).superRefine((value, ctx) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Published assets must use credential-free HTTPS URLs.',
    });
  }
});

const SiteAssetBaseShape = {
  publicReference: PublicReferenceSchema,
  type: z.enum(['IMAGE', 'LOGO', 'ICON', 'VIDEO_POSTER']),
  publicationStatus: z.literal('PUBLISHED'),
  mimeType: z.enum(['image/avif', 'image/webp', 'image/jpeg', 'image/png', 'image/gif']),
  url: ApprovedAssetUrlSchema,
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
  focalPoint: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }).strict().optional(),
  variants: z.array(z.object({
    url: ApprovedAssetUrlSchema,
    width: z.number().int().positive().max(20_000),
    mimeType: z.enum(['image/avif', 'image/webp', 'image/jpeg', 'image/png']),
  }).strict()).max(10).default([]),
  caption: z.string().trim().min(1).max(500).optional(),
  creditText: z.string().trim().min(1).max(240).optional(),
  licenseUrl: ApprovedAssetUrlSchema.optional(),
  contentContext: z.string().trim().min(1).max(500).optional(),
} as const;

export const SiteAssetReferenceSchema = z.discriminatedUnion('purpose', [
  z.object({
    ...SiteAssetBaseShape,
    purpose: z.literal('DECORATIVE'),
    alt: z.literal(''),
  }).strict(),
  z.object({
    ...SiteAssetBaseShape,
    purpose: z.literal('INFORMATIVE'),
    alt: z.string().trim().min(1).max(500),
  }).strict(),
]);
export type SiteAssetReference = z.infer<typeof SiteAssetReferenceSchema>;

export const SiteBusinessProfileSchema = z.object({
  name: z.string().trim().min(1).max(160),
  legalName: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(1_000),
  publicTelephone: z.string().trim().min(7).max(30).regex(/^\+?[0-9 ()-]+$/).optional(),
  publicEmail: z.string().email().max(255).optional(),
  logoAssetReference: PublicReferenceSchema.optional(),
  socialLinks: z.array(z.object({
    network: z.enum(['INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'LINKEDIN', 'YOUTUBE']),
    url: z.string().url().max(1_000).refine((value) => new URL(value).protocol === 'https:'),
  }).strict()).max(10).default([]),
}).strict();
export type SiteBusinessProfile = z.infer<typeof SiteBusinessProfileSchema>;

export const SiteLocationProfileSchema = z.object({
  publicReference: PublicReferenceSchema,
  name: ShortTextSchema,
  addressLines: z.array(ShortTextSchema).min(1).max(5),
  locality: ShortTextSchema,
  region: ShortTextSchema.optional(),
  postalCode: z.string().trim().min(2).max(20),
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/),
  publicTelephone: z.string().trim().min(7).max(30).regex(/^\+?[0-9 ()-]+$/).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  openingHours: z.array(z.object({
    day: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
    opens: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
    closes: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
  }).strict()).max(7).default([]),
}).strict();
export type SiteLocationProfile = z.infer<typeof SiteLocationProfileSchema>;

export const SiteServiceProfileSchema = z.object({
  publicReference: PublicReferenceSchema,
  name: ShortTextSchema,
  shortDescription: z.string().trim().min(1).max(500),
  durationMinutes: z.number().int().positive().max(1_440).optional(),
  priceText: z.string().trim().min(1).max(80).optional(),
  imageAssetReference: PublicReferenceSchema.optional(),
  bookingEnabled: z.boolean(),
}).strict();
export type SiteServiceProfile = z.infer<typeof SiteServiceProfileSchema>;

export const SiteStaffProfileSchema = z.object({
  publicReference: PublicReferenceSchema,
  displayName: ShortTextSchema,
  role: ShortTextSchema,
  biography: z.string().trim().min(1).max(2_000).optional(),
  imageAssetReference: PublicReferenceSchema.optional(),
  bookingEnabled: z.boolean(),
  serviceReferences: z.array(PublicReferenceSchema).max(100).default([]),
}).strict();
export type SiteStaffProfile = z.infer<typeof SiteStaffProfileSchema>;

export const SiteNavigationItemSchema = z.object({
  label: z.string().trim().min(1).max(80),
  pageReference: PublicReferenceSchema,
  children: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    pageReference: PublicReferenceSchema,
  }).strict()).max(20).default([]),
}).strict();
export type SiteNavigationItem = z.infer<typeof SiteNavigationItemSchema>;

export const SiteNavigationSchema = z.object({
  primary: z.array(SiteNavigationItemSchema).max(12),
  footer: z.array(SiteNavigationItemSchema).max(20),
  utility: z.array(SiteNavigationItemSchema).max(8).default([]),
  legal: z.array(SiteNavigationItemSchema).max(8).default([]),
}).strict();
export type SiteNavigation = z.infer<typeof SiteNavigationSchema>;

export const RichTextInlineSchema: z.ZodType<RichTextInline> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('TEXT'), text: z.string().max(4_000) }).strict(),
    z.object({ type: z.literal('STRONG'), children: z.array(RichTextInlineSchema).min(1).max(100) }).strict(),
    z.object({ type: z.literal('EMPHASIS'), children: z.array(RichTextInlineSchema).min(1).max(100) }).strict(),
    z.object({
      type: z.literal('INTERNAL_LINK'),
      pageReference: PublicReferenceSchema,
      children: z.array(RichTextInlineSchema).min(1).max(100),
    }).strict(),
    z.object({ type: z.literal('LINE_BREAK') }).strict(),
  ]),
);
export type RichTextInline =
  | { type: 'TEXT'; text: string }
  | { type: 'STRONG'; children: RichTextInline[] }
  | { type: 'EMPHASIS'; children: RichTextInline[] }
  | { type: 'INTERNAL_LINK'; pageReference: string; children: RichTextInline[] }
  | { type: 'LINE_BREAK' };

const RichTextListItemSchema = z.object({
  children: z.array(RichTextInlineSchema).min(1).max(100),
}).strict();

export const RichTextDocumentSchema = z.object({
  blocks: z.array(z.discriminatedUnion('type', [
    z.object({
      type: z.literal('PARAGRAPH'),
      children: z.array(RichTextInlineSchema).min(1).max(100),
    }).strict(),
    z.object({
      type: z.literal('HEADING'),
      level: z.enum(['H2', 'H3', 'H4']),
      children: z.array(RichTextInlineSchema).min(1).max(100),
    }).strict(),
    z.object({
      type: z.literal('ORDERED_LIST'),
      items: z.array(RichTextListItemSchema).min(1).max(100),
    }).strict(),
    z.object({
      type: z.literal('UNORDERED_LIST'),
      items: z.array(RichTextListItemSchema).min(1).max(100),
    }).strict(),
  ])).max(300),
}).strict();
export type RichTextDocument = z.infer<typeof RichTextDocumentSchema>;

export const PrimarySiteActionSchema = z.union([
  KsOsBookingActionSchema,
  InternalPageActionSchema,
]);
export const SecondarySiteActionSchema = z.union([
  KsOsBookingActionSchema,
  InternalPageActionSchema,
  PhoneActionSchema,
  EmailActionSchema,
]);
export const SiteActionSchema = SecondarySiteActionSchema;
export type SiteAction = z.infer<typeof SiteActionSchema>;

const SectionBaseShape = {
  reference: PublicReferenceSchema,
  componentKey: z.string().trim().min(1).max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/)
    .optional(),
  variant: z.enum([
    'editorial',
    'grid',
    'split',
    'compact',
    'standard',
    'featured',
    'quiet',
  ]).optional(),
} as const;
const HeadingBodyShape = {
  ...SectionBaseShape,
  heading: ShortTextSchema,
  body: BodyTextSchema,
} as const;

const HeaderSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('HEADER'),
  primaryAction: KsOsBookingActionSchema,
}).strict();
const AnnouncementBarSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('ANNOUNCEMENT_BAR'),
  message: ShortTextSchema,
}).strict();
const HeroSectionSchema = z.object({
  ...HeadingBodyShape,
  type: z.literal('HERO'),
  eyebrow: ShortTextSchema.optional(),
  imageAssetReference: PublicReferenceSchema.optional(),
  primaryAction: KsOsBookingActionSchema,
  secondaryAction: InternalPageActionSchema.optional(),
}).strict();
const IntroductionSectionSchema = z.object({
  ...HeadingBodyShape,
  type: z.literal('INTRODUCTION'),
  supportingPoints: z.array(ShortTextSchema).min(2).max(8).optional(),
  imageAssetReference: PublicReferenceSchema.optional(),
}).strict();
const FeaturedServicesSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('FEATURED_SERVICES'),
  heading: ShortTextSchema,
  serviceReferences: z.array(PublicReferenceSchema).min(1).max(12),
}).strict();
const ServiceGridSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('SERVICE_GRID'),
  heading: ShortTextSchema,
  serviceReferences: z.array(PublicReferenceSchema).min(1).max(100),
}).strict();
const ServiceDetailsSectionSchema = z.object({
  ...HeadingBodyShape,
  type: z.literal('SERVICE_DETAILS'),
  serviceReference: PublicReferenceSchema,
  imageAssetReference: PublicReferenceSchema.optional(),
  primaryAction: KsOsBookingActionSchema,
}).strict();
const BenefitsSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('BENEFITS'),
  heading: ShortTextSchema,
  items: z.array(z.object({ heading: ShortTextSchema, body: BodyTextSchema }).strict()).min(1).max(20),
  imageAssetReference: PublicReferenceSchema.optional(),
}).strict();
const ProcessSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('PROCESS'),
  heading: ShortTextSchema,
  steps: z.array(z.object({ heading: ShortTextSchema, body: BodyTextSchema }).strict()).min(1).max(20),
  imageAssetReference: PublicReferenceSchema.optional(),
}).strict();
const PricingSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('PRICING'),
  heading: ShortTextSchema,
  items: z.array(z.object({
    label: ShortTextSchema,
    priceText: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500).optional(),
  }).strict()).min(1).max(100),
}).strict();
const TeamSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('TEAM'),
  heading: ShortTextSchema,
  staffReferences: z.array(PublicReferenceSchema).min(1).max(100),
}).strict();
const StaffProfileSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('STAFF_PROFILE'),
  staffReference: PublicReferenceSchema,
  primaryAction: KsOsBookingActionSchema.optional(),
}).strict();
const GallerySectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('GALLERY'),
  heading: ShortTextSchema,
  assetReferences: z.array(PublicReferenceSchema).min(1).max(50),
}).strict();
const ResultsSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('RESULTS'),
  heading: ShortTextSchema,
  items: z.array(z.object({
    beforeAssetReference: PublicReferenceSchema.optional(),
    afterAssetReference: PublicReferenceSchema,
    caption: ShortTextSchema.optional(),
  }).strict()).min(1).max(30),
}).strict();
const TestimonialsSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('TESTIMONIALS'),
  heading: ShortTextSchema,
  items: z.array(z.object({
    quote: z.string().trim().min(1).max(1_000),
    attribution: ShortTextSchema,
  }).strict()).min(1).max(30),
}).strict();
const TrustIndicatorsSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('TRUST_INDICATORS'),
  heading: ShortTextSchema.optional(),
  items: z.array(z.object({
    label: ShortTextSchema,
    detail: z.string().trim().min(1).max(500).optional(),
  }).strict()).min(1).max(30),
}).strict();
const FaqSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('FAQ'),
  heading: ShortTextSchema,
  items: z.array(z.object({
    question: ShortTextSchema,
    answer: z.string().trim().min(1).max(2_000),
  }).strict()).min(1).max(50),
}).strict();
const LocationSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('LOCATION'),
  heading: ShortTextSchema,
  locationReference: PublicReferenceSchema,
  imageAssetReference: PublicReferenceSchema.optional(),
}).strict();
const OpeningHoursSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('OPENING_HOURS'),
  heading: ShortTextSchema,
  locationReference: PublicReferenceSchema,
  imageAssetReference: PublicReferenceSchema.optional(),
}).strict();
const ContactSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('CONTACT'),
  heading: ShortTextSchema,
  body: BodyTextSchema.optional(),
  locationReference: PublicReferenceSchema.optional(),
  secondaryActions: z.array(z.union([PhoneActionSchema, EmailActionSchema])).max(4).default([]),
  imageAssetReference: PublicReferenceSchema.optional(),
}).strict();
const BookingCtaSectionSchema = z.object({
  ...HeadingBodyShape,
  type: z.literal('BOOKING_CTA'),
  primaryAction: KsOsBookingActionSchema,
  imageAssetReference: PublicReferenceSchema.optional(),
}).strict();
const FinalCtaSectionSchema = z.object({
  ...HeadingBodyShape,
  type: z.literal('FINAL_CTA'),
  primaryAction: KsOsBookingActionSchema,
  imageAssetReference: PublicReferenceSchema.optional(),
}).strict();
const FooterSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('FOOTER'),
  primaryAction: KsOsBookingActionSchema,
  legalText: z.string().trim().min(1).max(500).optional(),
}).strict();
const RichTextSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal('RICH_TEXT'),
  heading: ShortTextSchema.optional(),
  document: RichTextDocumentSchema,
}).strict();

export const SiteSectionSchema = z.discriminatedUnion('type', [
  HeaderSectionSchema,
  AnnouncementBarSectionSchema,
  HeroSectionSchema,
  IntroductionSectionSchema,
  FeaturedServicesSectionSchema,
  ServiceGridSectionSchema,
  ServiceDetailsSectionSchema,
  BenefitsSectionSchema,
  ProcessSectionSchema,
  PricingSectionSchema,
  TeamSectionSchema,
  StaffProfileSectionSchema,
  GallerySectionSchema,
  ResultsSectionSchema,
  TestimonialsSectionSchema,
  TrustIndicatorsSectionSchema,
  FaqSectionSchema,
  LocationSectionSchema,
  OpeningHoursSectionSchema,
  ContactSectionSchema,
  BookingCtaSectionSchema,
  FinalCtaSectionSchema,
  FooterSectionSchema,
  RichTextSectionSchema,
]);
export type SiteSection = z.infer<typeof SiteSectionSchema>;

export const SiteSeoMetadataSchema = z.object({
  title: z.string().trim().min(1).max(70),
  description: z.string().trim().min(1).max(170),
  canonicalPath: SafePathSchema,
  index: z.boolean(),
  follow: z.boolean(),
  openGraphTitle: z.string().trim().min(1).max(100),
  openGraphDescription: z.string().trim().min(1).max(200),
  openGraphImageAssetReference: PublicReferenceSchema.optional(),
  twitterCard: z.enum(['summary', 'summary_large_image']).default('summary_large_image'),
}).strict();
export type SiteSeoMetadata = z.infer<typeof SiteSeoMetadataSchema>;

export const PublishedPageSnapshotSchema = z.object({
  publicReference: PublicReferenceSchema,
  pageType: SitePageTypeSchema,
  conversionRole: SiteConversionRoleSchema,
  path: SafePathSchema,
  title: z.string().trim().min(1).max(160),
  active: z.boolean(),
  indexable: z.boolean(),
  canonical: z.boolean(),
  rendererKey: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/),
  rendererVersion: z.number().int().positive(),
  rendererStatus: SiteRendererStatusSchema,
  layoutReference: PublicReferenceSchema,
  layoutStatus: z.enum(['APPROVED', 'DISABLED']),
  templateVersionStatus: z.enum(['APPROVED', 'DISABLED']),
  compatiblePageTypes: z.array(SitePageTypeSchema).min(1).max(30),
  seo: SiteSeoMetadataSchema,
  sections: z.array(SiteSectionSchema).min(1).max(100),
  publishedAt: z.string().datetime().optional(),
  lastModifiedAt: z.string().datetime().optional(),
  reviewedAt: z.string().datetime().optional(),
  languageCode: z.string().regex(/^[a-z]{2,8}(?:-[A-Z0-9]{2,8})?$/).optional(),
  languageAlternates: z.array(z.object({
    languageCode: z.string().regex(/^[a-z]{2,8}(?:-[A-Z0-9]{2,8})?$/),
    path: SafePathSchema,
  }).strict()).max(50).optional(),
  authorship: z.object({
    author: z.object({
      name: ShortTextSchema,
      role: ShortTextSchema.optional(),
      bio: z.string().trim().min(1).max(2_000).optional(),
      credentials: z.array(ShortTextSchema).max(50).default([]),
      profilePath: SafePathSchema.optional(),
    }).strict(),
    reviewer: z.object({
      name: ShortTextSchema,
      role: ShortTextSchema.optional(),
      bio: z.string().trim().min(1).max(2_000).optional(),
      credentials: z.array(ShortTextSchema).max(50).default([]),
      profilePath: SafePathSchema.optional(),
    }).strict().optional(),
  }).strict().optional(),
  video: z.object({
    name: ShortTextSchema,
    description: z.string().trim().min(1).max(2_000),
    thumbnailAssetReference: PublicReferenceSchema,
    uploadDate: z.string().datetime(),
    contentUrl: ApprovedAssetUrlSchema.optional(),
    embedUrl: ApprovedAssetUrlSchema.optional(),
    transcript: z.string().trim().min(1).max(20_000).optional(),
  }).strict().optional(),
}).strict().superRefine((page, ctx) => {
  if (page.path === '/book' && page.pageType !== 'BOOKING') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['path'], message: '/book is reserved.' });
  }
  if (page.pageType === 'BOOKING' && page.path !== '/book') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['path'], message: 'Booking pages use /book.' });
  }
  const reserved = [...RESERVED_PUBLIC_SITE_PATHS].some((path) =>
    page.path === path || page.path.startsWith(`${path}/`),
  );
  if (reserved && page.pageType !== 'BOOKING') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['path'], message: 'The route is reserved.' });
  }
  if (page.seo.canonicalPath !== page.path) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['seo', 'canonicalPath'],
      message: 'Canonical path must match the page path.',
    });
  }
  if (page.pageType !== 'BOOKING') {
    const required = [
      ['HEADER', page.sections.some((section) => section.type === 'HEADER')],
      ['FOOTER', page.sections.some((section) => section.type === 'FOOTER')],
      [
        'PAGE_END_BOOKING',
        page.sections.some((section) =>
          section.type === 'FINAL_CTA' || section.type === 'BOOKING_CTA',
        ),
      ],
      [
        'PRIMARY_CONVERSION',
        page.sections.some((section) =>
          section.type === 'HERO'
          || section.type === 'SERVICE_DETAILS'
          || section.type === 'STAFF_PROFILE',
        ),
      ],
    ] as const;
    for (const [code, present] of required) {
      if (!present) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sections'],
          message: `${code} is required for public booking conversion.`,
        });
      }
    }
  }
  for (const [index, section] of page.sections.entries()) {
    if (
      section.type === 'SERVICE_DETAILS'
      && section.primaryAction.serviceReference !== section.serviceReference
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections', index, 'primaryAction', 'serviceReference'],
        message: 'Service details require a matching service-aware booking action.',
      });
    }
  }
  if (page.reviewedAt && !page.authorship?.reviewer) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reviewedAt'], message: 'A review date requires a governed reviewer profile.' });
  }
  const alternateLanguages = new Set<string>();
  for (const [index, alternate] of (page.languageAlternates ?? []).entries()) {
    if (alternateLanguages.has(alternate.languageCode)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['languageAlternates', index], message: 'Language alternates must be unique per language.' });
    }
    alternateLanguages.add(alternate.languageCode);
  }
});
export type PublishedPageSnapshot = z.infer<typeof PublishedPageSnapshotSchema>;

export const SiteDomainSnapshotSchema = z.object({
  hostname: z.string().trim().toLowerCase().min(1).max(253),
  kind: z.enum(['FALLBACK', 'CUSTOM', 'LOCAL']),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  primary: z.boolean(),
}).strict();

export const PublishedSiteSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  publicReference: PublicReferenceSchema,
  siteReference: PublicReferenceSchema,
  versionReference: PublicReferenceSchema,
  templateVersionReference: PublicReferenceSchema,
  visibility: z.enum(['PUBLISHED', 'PREVIEW']),
  siteStatus: SiteStatusSchema,
  versionStatus: SiteVersionStatusSchema,
  createdAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  language: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
  theme: SiteThemeSchema,
  navigation: SiteNavigationSchema,
  business: SiteBusinessProfileSchema,
  locations: z.array(SiteLocationProfileSchema).max(100),
  services: z.array(SiteServiceProfileSchema).max(500),
  staff: z.array(SiteStaffProfileSchema).max(500),
  assets: z.array(SiteAssetReferenceSchema).max(2_000),
  domains: z.array(SiteDomainSnapshotSchema).min(1).max(20),
  canonicalHostname: z.string().trim().toLowerCase().min(1).max(253),
  booking: z.object({
    tenantReference: PublicReferenceSchema,
    tenantSubdomain: TenantSubdomainSchema,
    campaignReference: CampaignReferenceSchema.optional(),
  }).strict(),
  pages: z.array(PublishedPageSnapshotSchema).min(1).max(100),
}).strict().superRefine((snapshot, ctx) => {
  const pageReferences = new Set<string>();
  const paths = new Set<string>();
  const seoTitles = new Set<string>();
  for (const [index, page] of snapshot.pages.entries()) {
    if (pageReferences.has(page.publicReference)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pages', index, 'publicReference'],
        message: 'Page references must be unique.',
      });
    }
    if (paths.has(page.path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pages', index, 'path'],
        message: 'Page paths must be unique.',
      });
    }
    pageReferences.add(page.publicReference);
    paths.add(page.path);
    const normalizedSeoTitle = page.seo.title.toLowerCase();
    if (seoTitles.has(normalizedSeoTitle)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pages', index, 'seo', 'title'],
        message: 'Published page SEO titles must be unique.',
      });
    }
    seoTitles.add(normalizedSeoTitle);
    const pageLanguage = page.languageCode ?? snapshot.language;
    for (const [alternateIndex, alternate] of (page.languageAlternates ?? []).entries()) {
      const target = snapshot.pages.find(candidate => candidate.path === alternate.path && candidate.active && candidate.canonical);
      if (!target || (target.languageCode ?? snapshot.language) !== alternate.languageCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pages', index, 'languageAlternates', alternateIndex],
          message: 'A language alternate must resolve to an active canonical page with the declared language.',
        });
        continue;
      }
      const reciprocal = target.languageAlternates?.some(candidate =>
        candidate.path === page.path && candidate.languageCode === pageLanguage);
      if (!reciprocal) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pages', index, 'languageAlternates', alternateIndex],
          message: 'Language alternates must be reciprocal.',
        });
      }
    }
  }
  if (!snapshot.pages.some((page) => page.pageType === 'HOME' && page.path === '/')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pages'], message: 'A HOME page at / is required.' });
  }
  for (const group of ['primary', 'footer', 'utility', 'legal'] as const) {
    for (const [index, item] of snapshot.navigation[group].entries()) {
      if (!pageReferences.has(item.pageReference)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['navigation', group, index, 'pageReference'],
          message: 'Navigation may reference only pages in this snapshot.',
        });
      }
      for (const [childIndex, child] of item.children.entries()) {
        if (!pageReferences.has(child.pageReference)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['navigation', group, index, 'children', childIndex, 'pageReference'],
            message: 'Navigation may reference only pages in this snapshot.',
          });
        }
      }
    }
  }
  const canonicalDomain = snapshot.domains.find(
    (domain) => domain.hostname === snapshot.canonicalHostname
      && domain.primary
      && domain.status === 'ACTIVE',
  );
  if (!canonicalDomain) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['canonicalHostname'],
      message: 'Canonical hostname must be the active primary domain.',
    });
  }
  const assetReferences = new Set(snapshot.assets.map((asset) => asset.publicReference));
  const serviceReferences = new Set(snapshot.services.map((service) => service.publicReference));
  const locationReferences = new Set(snapshot.locations.map((location) => location.publicReference));
  const staffReferences = new Set(snapshot.staff.map((staff) => staff.publicReference));
  const assertReference = (
    reference: string | undefined,
    known: ReadonlySet<string>,
    path: Array<string | number>,
    kind: string,
  ) => {
    if (reference && !known.has(reference)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `${kind} must belong to this published snapshot.`,
      });
    }
  };
  assertReference(
    snapshot.business.logoAssetReference,
    assetReferences,
    ['business', 'logoAssetReference'],
    'Logo asset',
  );
  for (const [index, service] of snapshot.services.entries()) {
    assertReference(
      service.imageAssetReference,
      assetReferences,
      ['services', index, 'imageAssetReference'],
      'Service asset',
    );
  }
  for (const [index, staff] of snapshot.staff.entries()) {
    assertReference(
      staff.imageAssetReference,
      assetReferences,
      ['staff', index, 'imageAssetReference'],
      'Staff asset',
    );
    for (const [serviceIndex, reference] of staff.serviceReferences.entries()) {
      assertReference(
        reference,
        serviceReferences,
        ['staff', index, 'serviceReferences', serviceIndex],
        'Staff service',
      );
    }
  }
  const validateAction = (
    action: SiteAction | undefined,
    path: Array<string | number>,
  ) => {
    if (!action) return;
    if (action.type === 'KS_OS_BOOKING') {
      assertReference(action.serviceReference, serviceReferences, [...path, 'serviceReference'], 'Booking service');
      assertReference(action.locationReference, locationReferences, [...path, 'locationReference'], 'Booking location');
      assertReference(action.staffReference, staffReferences, [...path, 'staffReference'], 'Booking staff');
    } else if (action.type === 'INTERNAL_PAGE') {
      assertReference(action.pageReference, pageReferences, [...path, 'pageReference'], 'Internal page');
    }
  };
  for (const [pageIndex, page] of snapshot.pages.entries()) {
    assertReference(
      page.seo.openGraphImageAssetReference,
      assetReferences,
      ['pages', pageIndex, 'seo', 'openGraphImageAssetReference'],
      'Open Graph asset',
    );
    assertReference(
      page.video?.thumbnailAssetReference,
      assetReferences,
      ['pages', pageIndex, 'video', 'thumbnailAssetReference'],
      'Video thumbnail asset',
    );
    for (const [sectionIndex, section] of page.sections.entries()) {
      const path = ['pages', pageIndex, 'sections', sectionIndex];
      if ('imageAssetReference' in section) {
        assertReference(
          section.imageAssetReference,
          assetReferences,
          [...path, 'imageAssetReference'],
          'Section asset',
        );
      }
      switch (section.type) {
        case 'HEADER':
        case 'BOOKING_CTA':
        case 'FINAL_CTA':
        case 'FOOTER':
          validateAction(section.primaryAction, [...path, 'primaryAction']);
          break;
        case 'HERO':
          validateAction(section.primaryAction, [...path, 'primaryAction']);
          validateAction(section.secondaryAction, [...path, 'secondaryAction']);
          break;
        case 'FEATURED_SERVICES':
        case 'SERVICE_GRID':
          section.serviceReferences.forEach((reference, index) =>
            assertReference(reference, serviceReferences, [...path, 'serviceReferences', index], 'Service'),
          );
          break;
        case 'SERVICE_DETAILS':
          assertReference(section.serviceReference, serviceReferences, [...path, 'serviceReference'], 'Service');
          validateAction(section.primaryAction, [...path, 'primaryAction']);
          break;
        case 'TEAM':
          section.staffReferences.forEach((reference, index) =>
            assertReference(reference, staffReferences, [...path, 'staffReferences', index], 'Staff member'),
          );
          break;
        case 'STAFF_PROFILE':
          assertReference(section.staffReference, staffReferences, [...path, 'staffReference'], 'Staff member');
          validateAction(section.primaryAction, [...path, 'primaryAction']);
          break;
        case 'GALLERY':
          section.assetReferences.forEach((reference, index) =>
            assertReference(reference, assetReferences, [...path, 'assetReferences', index], 'Gallery asset'),
          );
          break;
        case 'RESULTS':
          section.items.forEach((item, index) => {
            assertReference(item.beforeAssetReference, assetReferences, [...path, 'items', index, 'beforeAssetReference'], 'Before asset');
            assertReference(item.afterAssetReference, assetReferences, [...path, 'items', index, 'afterAssetReference'], 'After asset');
          });
          break;
        case 'LOCATION':
        case 'OPENING_HOURS':
          assertReference(section.locationReference, locationReferences, [...path, 'locationReference'], 'Location');
          break;
        case 'CONTACT':
          assertReference(section.locationReference, locationReferences, [...path, 'locationReference'], 'Location');
          section.secondaryActions.forEach((action, index) =>
            validateAction(action, [...path, 'secondaryActions', index]),
          );
          break;
        case 'RICH_TEXT':
        case 'ANNOUNCEMENT_BAR':
        case 'INTRODUCTION':
        case 'BENEFITS':
        case 'PROCESS':
        case 'PRICING':
        case 'TESTIMONIALS':
        case 'TRUST_INDICATORS':
        case 'FAQ':
          break;
      }
    }
  }
  if (snapshot.visibility === 'PUBLISHED') {
    if (snapshot.versionStatus !== 'PUBLISHED' || !snapshot.publishedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['visibility'],
        message: 'Published snapshots require an immutable published version.',
      });
    }
  }
});
export type PublishedSiteSnapshot = z.infer<typeof PublishedSiteSnapshotSchema>;

export const SiteStructuredDataSchema = z.array(z.union([
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('WebSite'),
    name: ShortTextSchema,
    url: z.string().url(),
  }).strict(),
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('Person'),
    name: ShortTextSchema,
    url: z.string().url().optional(),
    jobTitle: ShortTextSchema.optional(),
    description: z.string().trim().min(1).max(2_000).optional(),
    hasCredential: z.array(z.object({
      '@type': z.literal('EducationalOccupationalCredential'),
      credentialCategory: ShortTextSchema,
    }).strict()).max(50).optional(),
  }).strict(),
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('Organization'),
    name: ShortTextSchema,
    url: z.string().url(),
    telephone: z.string().optional(),
    email: z.string().email().optional(),
  }).strict(),
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.union([z.literal('Article'), z.literal('BlogPosting')]),
    headline: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
    url: z.string().url(),
    datePublished: z.string().datetime().optional(),
    dateModified: z.string().datetime(),
    lastReviewed: z.string().datetime().optional(),
    author: z.object({
      '@type': z.literal('Person'),
      name: ShortTextSchema,
      url: z.string().url().optional(),
    }).strict(),
    reviewedBy: z.object({
      '@type': z.literal('Person'),
      name: ShortTextSchema,
      url: z.string().url().optional(),
    }).strict().optional(),
  }).strict(),
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('VideoObject'),
    name: ShortTextSchema,
    description: z.string().trim().min(1).max(2_000),
    thumbnailUrl: z.string().url(),
    uploadDate: z.string().datetime(),
    contentUrl: z.string().url().optional(),
    embedUrl: z.string().url().optional(),
    transcript: z.string().trim().min(1).max(20_000).optional(),
  }).strict(),
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('ImageObject'),
    contentUrl: z.string().url(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    caption: z.string().trim().min(1).max(500).optional(),
    creditText: z.string().trim().min(1).max(240).optional(),
    license: z.string().url().optional(),
  }).strict(),
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('LocalBusiness'),
    name: ShortTextSchema,
    url: z.string().url(),
    telephone: z.string().optional(),
    address: z.object({
      '@type': z.literal('PostalAddress'),
      streetAddress: z.string(),
      addressLocality: z.string(),
      addressRegion: z.string().optional(),
      postalCode: z.string(),
      addressCountry: z.string().length(2),
    }).strict(),
  }).strict(),
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('Service'),
    name: ShortTextSchema,
    description: z.string().max(500),
    url: z.string().url(),
  }).strict(),
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('BreadcrumbList'),
    itemListElement: z.array(z.object({
      '@type': z.literal('ListItem'),
      position: z.number().int().positive(),
      name: ShortTextSchema,
      item: z.string().url(),
    }).strict()).min(1),
  }).strict(),
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('WebPage'),
    name: ShortTextSchema,
    description: z.string().max(500),
    url: z.string().url(),
  }).strict(),
  z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('FAQPage'),
    mainEntity: z.array(z.object({
      '@type': z.literal('Question'),
      name: ShortTextSchema,
      acceptedAnswer: z.object({
        '@type': z.literal('Answer'),
        text: z.string().min(1).max(2_000),
      }).strict(),
    }).strict()).min(1),
  }).strict(),
])).max(500);
export type SiteStructuredData = z.infer<typeof SiteStructuredDataSchema>;

export const SiteRenderContextSchema = z.object({
  requestHostname: z.string().min(1).max(253),
  canonicalOrigin: z.string().url(),
  preview: z.boolean(),
  previewVersionReference: PublicReferenceSchema.optional(),
  pagePathByReference: z.record(PublicReferenceSchema, SafePathSchema),
}).strict();
export type SiteRenderContext = z.infer<typeof SiteRenderContextSchema>;

export type PublishedSnapshotInput = z.input<typeof PublishedSiteSnapshotSchema>;
