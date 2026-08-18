import { PublicReferenceSchema } from '@ks-os/contracts';
import { z } from 'zod';

export const SiteDataClassSchema = z.enum(['PUBLISHED', 'LIVE', 'PERSONAL']);
export type SiteDataClass = z.infer<typeof SiteDataClassSchema>;

export const LiveSiteCacheClassSchema = z.enum([
  'PUBLISHED',
  'LIVE_SLOW',
  'LIVE_FAST',
  'PERSONAL',
]);
export type LiveSiteCacheClass = z.infer<typeof LiveSiteCacheClassSchema>;

export const LiveDataDependencySchema = z.enum([
  'SERVICE_STATE',
  'STAFF_STATE',
  'LOCATION_STATE',
  'OPENING_STATE',
  'AVAILABILITY_SUMMARY',
  'CAMPAIGN_STATE',
  'WAITLIST_STATE',
  'RECOMMENDATION_ELIGIBILITY',
]);
export type LiveDataDependency = z.infer<typeof LiveDataDependencySchema>;

export const LiveFallbackModeSchema = z.enum([
  'RENDER_PUBLISHED',
  'STANDARD_BOOKING_CTA',
  'STATIC_STATUS',
  'HIDE_COMPONENT',
  'FAIL_CLOSED',
]);
export type LiveFallbackMode = z.infer<typeof LiveFallbackModeSchema>;

export const LivePersonalisationPolicySchema = z.enum([
  'NONE',
  'PUBLIC_ONLY',
  'PRIVATE_REQUEST_ONLY',
]);
export type LivePersonalisationPolicy = z.infer<typeof LivePersonalisationPolicySchema>;

export const LiveSeoImpactSchema = z.enum([
  'NONE',
  'VISIBLE_NON_CRITICAL',
  'STRUCTURED_DATA_SYNC_REQUIRED',
]);
export type LiveSeoImpact = z.infer<typeof LiveSeoImpactSchema>;

export const LiveConditionalVisibilitySchema = z.enum([
  'NEVER',
  'OPTIONAL_LIVE_SECTION',
]);
export type LiveConditionalVisibility = z.infer<typeof LiveConditionalVisibilitySchema>;

export const LiveComponentPolicySchema = z.object({
  liveDataDependencies: z.array(LiveDataDependencySchema).max(12),
  conditionalVisibility: LiveConditionalVisibilitySchema,
  fallbackMode: LiveFallbackModeSchema,
  cacheClass: LiveSiteCacheClassSchema,
  personalisationPolicy: LivePersonalisationPolicySchema,
  seoImpact: LiveSeoImpactSchema,
  liveContentSlots: z.array(z.string().regex(/^[a-z][A-Za-z0-9]{0,79}$/)).max(20),
}).strict();
export type LiveComponentPolicy = z.infer<typeof LiveComponentPolicySchema>;

const PublicMoneySchema = z.object({
  amountMinor: z.number().int().nonnegative().max(100_000_000),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/),
  formatted: z.string().trim().min(1).max(80),
}).strict();

export const PublicLiveServiceStateSchema = z.object({
  publicReference: PublicReferenceSchema,
  exists: z.boolean(),
  active: z.boolean(),
  bookingEligible: z.boolean(),
  durationMinutes: z.number().int().positive().max(1_440).optional(),
  publicPrice: PublicMoneySchema.optional(),
  staffReferences: z.array(PublicReferenceSchema).max(500),
  locationReferences: z.array(PublicReferenceSchema).max(100),
  waitlistEligible: z.boolean(),
}).strict();
export type PublicLiveServiceState = z.infer<typeof PublicLiveServiceStateSchema>;

export const PublicLiveStaffStateSchema = z.object({
  publicReference: PublicReferenceSchema,
  active: z.boolean(),
  bookingEligible: z.boolean(),
  serviceReferences: z.array(PublicReferenceSchema).max(500),
  locationReferences: z.array(PublicReferenceSchema).max(100),
}).strict();
export type PublicLiveStaffState = z.infer<typeof PublicLiveStaffStateSchema>;

export const PublicOpeningStateSchema = z.object({
  state: z.enum(['OPEN', 'CLOSED', 'TEMPORARILY_CLOSED', 'UNKNOWN']),
  label: z.string().trim().min(1).max(120),
  closesAt: z.string().datetime().optional(),
  opensAt: z.string().datetime().optional(),
  source: z.enum(['CANONICAL_HOURS', 'BOOKING_SCHEDULE_FALLBACK', 'SYSTEM_DEFAULT', 'UNAVAILABLE']),
}).strict();
export type PublicOpeningState = z.infer<typeof PublicOpeningStateSchema>;

export const PublicLiveOpeningHoursEntrySchema = z.object({
  day: z.enum(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']),
  opens: z.string().regex(/^\d{2}:\d{2}$/),
  closes: z.string().regex(/^\d{2}:\d{2}$/),
}).strict();
export type PublicLiveOpeningHoursEntry = z.infer<typeof PublicLiveOpeningHoursEntrySchema>;

export const PublicLiveLocationStateSchema = z.object({
  publicReference: PublicReferenceSchema,
  active: z.boolean(),
  bookingEligible: z.boolean(),
  serviceReferences: z.array(PublicReferenceSchema).max(500),
  staffReferences: z.array(PublicReferenceSchema).max(500),
  opening: PublicOpeningStateSchema,
  openingHours: z.array(PublicLiveOpeningHoursEntrySchema).max(28).optional(),
}).strict();
export type PublicLiveLocationState = z.infer<typeof PublicLiveLocationStateSchema>;

export const PublicAvailabilitySummarySchema = z.object({
  serviceReference: PublicReferenceSchema,
  staffReference: PublicReferenceSchema.optional(),
  locationReference: PublicReferenceSchema.optional(),
  state: z.enum(['NEXT_AVAILABLE', 'AVAILABLE_THIS_WEEK', 'UNAVAILABLE', 'UNKNOWN']),
  message: z.string().trim().min(1).max(160),
  nextAvailableAt: z.string().datetime().optional(),
  computedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();
export type PublicAvailabilitySummary = z.infer<typeof PublicAvailabilitySummarySchema>;

export const PublicLiveCampaignStateSchema = z.object({
  publicReference: PublicReferenceSchema,
  active: z.boolean(),
  message: z.string().trim().min(1).max(240),
  placement: z.enum(['ANNOUNCEMENT', 'HERO', 'PAGE_BODY', 'PAGE_END']),
  action: z.object({
    type: z.literal('KS_OS_BOOKING'),
    label: z.string().trim().min(1).max(80),
    serviceReference: PublicReferenceSchema.optional(),
    locationReference: PublicReferenceSchema.optional(),
    staffReference: PublicReferenceSchema.optional(),
    campaignReference: PublicReferenceSchema,
  }).strict(),
  serviceReferences: z.array(PublicReferenceSchema).max(100),
  locationReferences: z.array(PublicReferenceSchema).max(100),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
}).strict();
export type PublicLiveCampaignState = z.infer<typeof PublicLiveCampaignStateSchema>;

export const LiveResolutionWarningSchema = z.object({
  code: z.enum([
    'LIVE_SOURCE_UNAVAILABLE',
    'LIVE_SOURCE_TIMEOUT',
    'AVAILABILITY_STALE',
    'PUBLIC_PRICE_DISABLED',
    'OPENING_STATE_UNKNOWN',
  ]),
  dependency: LiveDataDependencySchema.optional(),
}).strict();

export const PublicLiveSiteDataSchema = z.object({
  schemaVersion: z.literal(1),
  dataClass: z.literal('LIVE'),
  siteReference: PublicReferenceSchema,
  resolvedAt: z.string().datetime(),
  services: z.array(PublicLiveServiceStateSchema).max(500),
  staff: z.array(PublicLiveStaffStateSchema).max(500),
  locations: z.array(PublicLiveLocationStateSchema).max(100),
  availability: z.array(PublicAvailabilitySummarySchema).max(1_000),
  campaigns: z.array(PublicLiveCampaignStateSchema).max(100),
  warnings: z.array(LiveResolutionWarningSchema).max(100),
  telemetry: z.object({
    cacheClass: LiveSiteCacheClassSchema,
    cacheHit: z.boolean(),
    fallbackActivated: z.boolean(),
    queryCount: z.number().int().nonnegative().max(100),
    resolutionMs: z.number().int().nonnegative().max(120_000),
  }).strict(),
}).strict();
export type PublicLiveSiteData = z.infer<typeof PublicLiveSiteDataSchema>;

export const LiveSiteResolutionInputSchema = z.object({
  siteReference: PublicReferenceSchema,
  tenantReference: PublicReferenceSchema,
  serviceReferences: z.array(PublicReferenceSchema).max(500),
  staffReferences: z.array(PublicReferenceSchema).max(500),
  locationReferences: z.array(PublicReferenceSchema).max(100),
  now: z.string().datetime().optional(),
}).strict();
export type LiveSiteResolutionInput = z.infer<typeof LiveSiteResolutionInputSchema>;

export const PersonalSiteContextSchema = z.object({
  dataClass: z.literal('PERSONAL'),
  cacheClass: z.literal('PERSONAL'),
  authenticated: z.literal(true),
  subjectReference: PublicReferenceSchema,
}).strict();
export type PersonalSiteContext = z.infer<typeof PersonalSiteContextSchema>;
