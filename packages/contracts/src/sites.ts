import { z } from 'zod';
import { PlanKeySchema } from './agency.js';

export const SiteStatusSchema = z.enum([
  'SETUP_REQUIRED',
  'DRAFT',
  'GENERATING',
  'INTERNAL_REVIEW',
  'CLIENT_REVIEW',
  'APPROVED',
  'PUBLISHING',
  'LIVE',
  'PUBLISH_FAILED',
  'SUSPENDED',
  'ARCHIVED',
]);
export type SiteStatus = z.infer<typeof SiteStatusSchema>;

export const SiteVersionStatusSchema = z.enum([
  'DRAFT',
  'INTERNAL_REVIEW',
  'CLIENT_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'SUPERSEDED',
  'REJECTED',
  'ARCHIVED',
]);
export type SiteVersionStatus = z.infer<typeof SiteVersionStatusSchema>;

export const SitePageTypeSchema = z.enum([
  'HOME',
  'SERVICE_HUB',
  'SERVICE_DETAIL',
  'LOCATION_HUB',
  'LOCATION_DETAIL',
  'ABOUT',
  'TEAM_HUB',
  'TEAM_DETAIL',
  'CONTACT',
  'FAQ',
  'POLICIES',
  'RESULTS',
  'NEW_CLIENT_GUIDE',
  'AFTERCARE_GUIDE',
  'CONSULTATION_GUIDE',
  'GUIDE',
  'HOW_TO',
  'ARTICLE',
  'BLOG_POST',
  'FAQ_RESOURCE',
  'TUTORIAL',
  'DEFINITION',
  'TROUBLESHOOTING',
  'COMPARISON',
  'CASE_STUDY',
  'BOOKING',
]);
export type SitePageType = z.infer<typeof SitePageTypeSchema>;

export const SiteConversionRoleSchema = z.enum([
  'PRIMARY_LANDING',
  'SERVICE_CONVERSION',
  'LOCAL_DISCOVERY',
  'TRUST_BUILDING',
  'OBJECTION_HANDLING',
  'BOOKING',
]);
export type SiteConversionRole = z.infer<typeof SiteConversionRoleSchema>;

export const SiteDomainStatusSchema = z.enum([
  'NOT_CONNECTED',
  'ADDING',
  'DNS_ACTION_REQUIRED',
  'VERIFYING',
  'SSL_PENDING',
  'ACTIVE',
  'MISCONFIGURED',
  'FAILED',
  'REMOVED',
]);
export type SiteDomainStatus = z.infer<typeof SiteDomainStatusSchema>;

export const SiteJobStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'DELAYED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type SiteJobStatus = z.infer<typeof SiteJobStatusSchema>;

export const SiteEntitlementKindSchema = z.enum([
  'MARKETING',
  'FUNCTIONAL',
  'REQUIRED_LEGAL',
]);
export type SiteEntitlementKind = z.infer<typeof SiteEntitlementKindSchema>;

export const SitePageAllocationSchema = z.enum(['INITIAL', 'MONTHLY']);
export type SitePageAllocation = z.infer<typeof SitePageAllocationSchema>;

export const SiteApprovalStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'WITHDRAWN',
]);
export type SiteApprovalStatus = z.infer<typeof SiteApprovalStatusSchema>;

export const SiteChangeRequestStatusSchema = z.enum([
  'SUBMITTED',
  'TRIAGED',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
]);
export type SiteChangeRequestStatus = z.infer<typeof SiteChangeRequestStatusSchema>;

export const TemplateSourceTypeSchema = z.enum([
  'ENVATO_HTML',
  'GOOGLE_STITCH',
  'INTERNAL',
]);
export type TemplateSourceType = z.infer<typeof TemplateSourceTypeSchema>;

export const PublicReferenceSchema = z.string().uuid();
export const SiteSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/);
export const SiteCanonicalPathSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)?$/);
export const TenantSubdomainSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
export const CampaignReferenceSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/);

export const KsOsBookingActionSchema = z.object({
  type: z.literal('KS_OS_BOOKING'),
  label: z.string().trim().min(1).max(80),
  serviceReference: PublicReferenceSchema.optional(),
  locationReference: PublicReferenceSchema.optional(),
  staffReference: PublicReferenceSchema.optional(),
  campaignReference: CampaignReferenceSchema.optional(),
}).strict();

export const InternalPageActionSchema = z.object({
  type: z.literal('INTERNAL_PAGE'),
  label: z.string().trim().min(1).max(80),
  pageReference: PublicReferenceSchema,
}).strict();

export const PhoneActionSchema = z.object({
  type: z.literal('PHONE'),
  label: z.string().trim().min(1).max(80),
  phoneNumber: z.string().trim().min(7).max(30).regex(/^\+?[0-9 ()-]+$/),
  secondary: z.literal(true),
}).strict();

export const EmailActionSchema = z.object({
  type: z.literal('EMAIL'),
  label: z.string().trim().min(1).max(80),
  emailAddress: z.string().email().max(255),
  secondary: z.literal(true),
}).strict();

export const SiteActionSchema = z.discriminatedUnion('type', [
  KsOsBookingActionSchema,
  InternalPageActionSchema,
  PhoneActionSchema,
  EmailActionSchema,
]);
export type SiteAction = z.infer<typeof SiteActionSchema>;
export type KsOsBookingAction = z.infer<typeof KsOsBookingActionSchema>;

export const CreateSiteSchema = z.object({
  tenantReference: PublicReferenceSchema,
  displayName: z.string().trim().min(2).max(160),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
}).strict();
export type CreateSite = z.infer<typeof CreateSiteSchema>;

export const UpdateSiteSchema = z.object({
  displayName: z.string().trim().min(2).max(160).optional(),
  status: SiteStatusSchema.exclude(['PUBLISHING', 'LIVE', 'PUBLISH_FAILED']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one site change is required.',
});
export type UpdateSite = z.infer<typeof UpdateSiteSchema>;

export const CreateSiteVersionSchema = z.object({
  basedOnVersionReference: PublicReferenceSchema.optional(),
  changeSummary: z.string().trim().max(500).optional(),
}).strict();
export type CreateSiteVersion = z.infer<typeof CreateSiteVersionSchema>;

export const CreateSitePageSchema = z.object({
  versionReference: PublicReferenceSchema,
  pageType: SitePageTypeSchema,
  conversionRole: SiteConversionRoleSchema,
  title: z.string().trim().min(1).max(160),
  slug: SiteSlugSchema,
  allocation: SitePageAllocationSchema.default('INITIAL'),
  layoutReference: PublicReferenceSchema.optional(),
  monthlyOpportunityReference: PublicReferenceSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000),
  seoTitle: z.string().trim().max(70).nullable().optional(),
  seoDescription: z.string().trim().max(170).nullable().optional(),
}).strict();
export type CreateSitePage = z.infer<typeof CreateSitePageSchema>;

export const UpdateDraftSitePageSchema = z.object({
  pageType: SitePageTypeSchema.optional(),
  conversionRole: SiteConversionRoleSchema.optional(),
  title: z.string().trim().min(1).max(160).optional(),
  slug: SiteSlugSchema.optional(),
  layoutReference: PublicReferenceSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  seoTitle: z.string().trim().max(70).nullable().optional(),
  seoDescription: z.string().trim().max(170).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one page change is required.',
});
export type UpdateDraftSitePage = z.infer<typeof UpdateDraftSitePageSchema>;

export const SiteBlueprintPageSchema = z.object({
  reference: PublicReferenceSchema.optional(),
  pageType: SitePageTypeSchema,
  conversionRole: SiteConversionRoleSchema,
  title: z.string().trim().min(1).max(160),
  proposedSlug: SiteCanonicalPathSchema,
  allocation: SitePageAllocationSchema.default('INITIAL'),
  layoutReference: PublicReferenceSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000),
  rationale: z.string().trim().max(1000).nullable().optional(),
}).strict();
export type SiteBlueprintPage = z.infer<typeof SiteBlueprintPageSchema>;

export const SiteBlueprintSchema = z.object({
  status: z.enum(['DRAFT', 'INTERNAL_REVIEW', 'APPROVED', 'ARCHIVED']).default('DRAFT'),
  name: z.string().trim().min(1).max(160),
  pages: z.array(SiteBlueprintPageSchema).min(1).max(100),
}).strict();
export type SiteBlueprint = z.infer<typeof SiteBlueprintSchema>;

export const SiteEntitlementSummarySchema = z.object({
  planKey: PlanKeySchema,
  initial: z.object({
    allowance: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  }).strict(),
  monthly: z.object({
    allowance: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  }).strict(),
}).strict();
export type SiteEntitlementSummary = z.infer<typeof SiteEntitlementSummarySchema>;

export const SiteApprovalSchema = z.object({
  reference: PublicReferenceSchema,
  siteReference: PublicReferenceSchema,
  versionReference: PublicReferenceSchema,
  status: SiteApprovalStatusSchema,
  requestedAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable(),
  responseNote: z.string().max(1000).nullable(),
}).strict();
export type SiteApproval = z.infer<typeof SiteApprovalSchema>;

export const SiteChangeRequestSchema = z.object({
  reference: PublicReferenceSchema,
  siteReference: PublicReferenceSchema,
  pageReference: PublicReferenceSchema.nullable(),
  status: SiteChangeRequestStatusSchema,
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(4000),
  createdAt: z.string().datetime(),
}).strict();
export type SiteChangeRequest = z.infer<typeof SiteChangeRequestSchema>;

export const SiteDomainSummarySchema = z.object({
  reference: PublicReferenceSchema,
  hostname: z.string().trim().toLowerCase().min(3).max(255),
  status: SiteDomainStatusSchema,
  isPrimary: z.boolean(),
  verifiedAt: z.string().datetime().nullable(),
}).strict();
export type SiteDomainSummary = z.infer<typeof SiteDomainSummarySchema>;

export const SITE_PLAN_ENTITLEMENTS = {
  CORE: { initialMarketingPages: 10, monthlyMarketingPages: 1 },
  GROWTH: { initialMarketingPages: 20, monthlyMarketingPages: 2 },
  SCALE: { initialMarketingPages: 30, monthlyMarketingPages: 3 },
} as const satisfies Record<z.infer<typeof PlanKeySchema>, {
  initialMarketingPages: number;
  monthlyMarketingPages: number;
}>;

export function sitePlanEntitlements(planKey: z.infer<typeof PlanKeySchema>) {
  return SITE_PLAN_ENTITLEMENTS[planKey];
}

export function sitePageEntitlementKind(pageType: SitePageType): SiteEntitlementKind {
  if (pageType === 'BOOKING') return 'FUNCTIONAL';
  if (pageType === 'POLICIES') return 'REQUIRED_LEGAL';
  return 'MARKETING';
}

export function sitePageConsumesMarketingEntitlement(pageType: SitePageType): boolean {
  return sitePageEntitlementKind(pageType) === 'MARKETING';
}

export function siteVersionIsEditable(status: SiteVersionStatus): boolean {
  return status === 'DRAFT';
}

export function utcMonthPeriod(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

export function calculateSiteEntitlementSummary(input: {
  planKey: z.infer<typeof PlanKeySchema>;
  initialMarketingPagesUsed: number;
  monthlyMarketingPagesUsed: number;
  now?: Date;
}): SiteEntitlementSummary {
  const limits = sitePlanEntitlements(input.planKey);
  const { periodStart, periodEnd } = utcMonthPeriod(input.now);
  const initialUsed = Math.max(0, Math.trunc(input.initialMarketingPagesUsed));
  const monthlyUsed = Math.max(0, Math.trunc(input.monthlyMarketingPagesUsed));
  return {
    planKey: input.planKey,
    initial: {
      allowance: limits.initialMarketingPages,
      used: initialUsed,
      remaining: Math.max(0, limits.initialMarketingPages - initialUsed),
    },
    monthly: {
      allowance: limits.monthlyMarketingPages,
      used: monthlyUsed,
      remaining: Math.max(0, limits.monthlyMarketingPages - monthlyUsed),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    },
  };
}

export class SiteEntitlementLimitError extends Error {
  readonly code = 'SITE_PAGE_ENTITLEMENT_EXCEEDED';

  constructor(readonly allocation: SitePageAllocation, readonly limit: number) {
    super(`${allocation.toLowerCase()} marketing-page allowance of ${limit} has been reached.`);
    this.name = 'SiteEntitlementLimitError';
  }
}

export function assertSitePageCreationAllowed(input: {
  pageType: SitePageType;
  allocation: SitePageAllocation;
  summary: SiteEntitlementSummary;
}) {
  if (!sitePageConsumesMarketingEntitlement(input.pageType)) return;
  const usage = input.allocation === 'INITIAL' ? input.summary.initial : input.summary.monthly;
  if (usage.used >= usage.allowance) {
    throw new SiteEntitlementLimitError(input.allocation, usage.allowance);
  }
}

export class SiteLayoutCompatibilityError extends Error {
  readonly code = 'SITE_LAYOUT_PAGE_TYPE_INCOMPATIBLE';

  constructor(readonly layoutReference: string, readonly pageType: SitePageType) {
    super(`Layout ${layoutReference} is not approved for ${pageType}.`);
    this.name = 'SiteLayoutCompatibilityError';
  }
}

export function assertSiteBlueprintLayoutsCompatible(
  pages: ReadonlyArray<Pick<SiteBlueprintPage, 'layoutReference' | 'pageType'>>,
  compatibility: ReadonlyMap<string, ReadonlySet<string>>,
) {
  for (const page of pages) {
    if (!page.layoutReference) continue;
    if (!compatibility.get(page.layoutReference)?.has(page.pageType)) {
      throw new SiteLayoutCompatibilityError(
        page.layoutReference,
        page.pageType,
      );
    }
  }
}

export const ResolveKsOsBookingUrlSchema = z.object({
  publicOrigin: z.string().url(),
  tenantReference: PublicReferenceSchema,
  tenantSubdomain: TenantSubdomainSchema,
  routeMode: z.enum(['FALLBACK', 'CUSTOM_DOMAIN']).default('FALLBACK'),
  serviceReference: PublicReferenceSchema.optional(),
  locationReference: PublicReferenceSchema.optional(),
  staffReference: PublicReferenceSchema.optional(),
  campaignReference: CampaignReferenceSchema.optional(),
}).strict();
export type ResolveKsOsBookingUrlInput = z.input<typeof ResolveKsOsBookingUrlSchema>;

export function resolveKsOsBookingUrl(input: ResolveKsOsBookingUrlInput): string {
  const parsed = ResolveKsOsBookingUrlSchema.parse(input);
  const url = new URL(parsed.publicOrigin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('The configured public booking origin is invalid.');
  }

  url.pathname = parsed.routeMode === 'CUSTOM_DOMAIN'
    ? '/book'
    : `/book/${encodeURIComponent(parsed.tenantSubdomain)}`;
  url.search = '';
  url.hash = '';

  if (parsed.serviceReference) url.searchParams.set('service', parsed.serviceReference);
  if (parsed.locationReference) url.searchParams.set('location', parsed.locationReference);
  if (parsed.staffReference) url.searchParams.set('staff', parsed.staffReference);
  if (parsed.campaignReference) url.searchParams.set('campaign', parsed.campaignReference);
  return url.toString();
}

export const BookingConversionPlacementSchema = z.enum([
  'HEADER',
  'HERO',
  'MOBILE_NAVIGATION',
  'SERVICE_CARD',
  'PAGE_END',
  'FOOTER',
  'STICKY_MOBILE_BAR',
]);
export type BookingConversionPlacement = z.infer<typeof BookingConversionPlacementSchema>;

export const BookingConversionSurfaceSchema = z.object({
  pageType: SitePageTypeSchema,
  exemptFromPageEnd: z.boolean().default(false),
  actions: z.array(z.object({
    placement: BookingConversionPlacementSchema,
    action: SiteActionSchema,
  }).strict()).max(100),
}).strict();
export type BookingConversionSurface = z.infer<typeof BookingConversionSurfaceSchema>;

export interface BookingConversionFinding {
  category: 'BOOKING_CONVERSION';
  code: string;
  blocking: true;
  message: string;
}

export function validateBookingConversionSurface(
  surface: BookingConversionSurface,
): BookingConversionFinding[] {
  const parsed = BookingConversionSurfaceSchema.parse(surface);
  const findings: BookingConversionFinding[] = [];
  const bookingPlacements = new Set(
    parsed.actions
      .filter((entry) => entry.action.type === 'KS_OS_BOOKING')
      .map((entry) => entry.placement),
  );

  const required: BookingConversionPlacement[] = [
    'HEADER',
    'HERO',
    'MOBILE_NAVIGATION',
    'FOOTER',
  ];
  if (!parsed.exemptFromPageEnd) required.push('PAGE_END');

  for (const placement of required) {
    if (!bookingPlacements.has(placement)) {
      findings.push({
        category: 'BOOKING_CONVERSION',
        code: `BOOKING_ACTION_MISSING_${placement}`,
        blocking: true,
        message: `${placement.toLowerCase().replaceAll('_', ' ')} requires a native KS OS booking action.`,
      });
    }
  }

  if (parsed.pageType === 'SERVICE_DETAIL') {
    const serviceAware = parsed.actions.some(
      (entry) => entry.action.type === 'KS_OS_BOOKING' && entry.action.serviceReference,
    );
    if (!serviceAware) {
      findings.push({
        category: 'BOOKING_CONVERSION',
        code: 'SERVICE_BOOKING_ACTION_NOT_PRESELECTED',
        blocking: true,
        message: 'Service-detail pages require a service-aware booking action.',
      });
    }
  }

  return findings;
}
