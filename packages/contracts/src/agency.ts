import { z } from 'zod';

export const AgencyRoleSchema = z.enum([
  'PLATFORM_OWNER', 'AGENCY_ADMINISTRATOR', 'SUPPORT_ADMINISTRATOR', 'FULFILMENT_ADMINISTRATOR',
]);
export type AgencyRole = z.infer<typeof AgencyRoleSchema>;

export const AgencyCapabilitySchema = z.enum([
  'agency.users.manage', 'tenants.read', 'tenants.manage', 'plans.read', 'plans.manage',
  'billing.read', 'billing.manage', 'support.read', 'support.session.start', 'support.retry',
  'fulfilment.read', 'fulfilment.manage', 'analytics.read', 'audit.read', 'audit.export',
  'privacy.read', 'privacy.manage', 'retention.manage',
  'sites.knowledge.read', 'sites.knowledge.manage',
  'sites.knowledge.import', 'sites.knowledge.approve',
  'sites.knowledge.activate',
  'sites.generation.read', 'sites.generation.create',
  'sites.generation.cancel', 'sites.generation.retry',
  'sites.generation.regenerate',
]);
export type AgencyCapability = z.infer<typeof AgencyCapabilitySchema>;

const roleCapabilities: Record<AgencyRole, readonly AgencyCapability[]> = {
  PLATFORM_OWNER: AgencyCapabilitySchema.options,
  AGENCY_ADMINISTRATOR: ['tenants.read','tenants.manage','plans.read','plans.manage','billing.read','billing.manage','support.read','support.session.start','support.retry','fulfilment.read','fulfilment.manage','analytics.read','audit.read','audit.export','privacy.read','privacy.manage','retention.manage','sites.knowledge.read','sites.knowledge.manage','sites.knowledge.import','sites.knowledge.approve','sites.knowledge.activate','sites.generation.read','sites.generation.create','sites.generation.cancel','sites.generation.retry','sites.generation.regenerate'],
  SUPPORT_ADMINISTRATOR: ['tenants.read','plans.read','billing.read','support.read','support.session.start','support.retry','audit.read','sites.knowledge.read','sites.generation.read'],
  FULFILMENT_ADMINISTRATOR: ['tenants.read','plans.read','support.read','fulfilment.read','fulfilment.manage','sites.knowledge.read','sites.knowledge.manage','sites.knowledge.import','sites.generation.read','sites.generation.create','sites.generation.cancel','sites.generation.retry','sites.generation.regenerate'],
};
export const capabilitiesForAgencyRole = (role: AgencyRole): readonly AgencyCapability[] => roleCapabilities[role];
export const agencyRoleNeedsMfa = (role: AgencyRole) => role !== 'FULFILMENT_ADMINISTRATOR';

export const PlanKeySchema = z.enum(['CORE', 'GROWTH', 'SCALE']);
export const EntitlementTypeSchema = z.enum(['BOOLEAN', 'QUANTITY', 'USAGE', 'SERVICE_LEVEL']);
export const EntitlementAvailabilitySchema = z.enum(['UNAVAILABLE', 'INTERNAL_PILOT', 'BETA', 'GENERALLY_AVAILABLE', 'RETIRED']);
export const PlanVersionStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'RETIRED']);
export const EntitlementValueSchema = z.object({
  enabled: z.boolean().optional(), limit: z.number().int().nonnegative().optional(), period: z.enum(['MONTH','LIFETIME']).optional(), level: z.string().trim().min(1).max(80).optional(),
}).strict();

export const CreatePlanVersionSchema = z.object({
  planKey: PlanKeySchema, version: z.number().int().positive(), name: z.string().trim().min(1).max(120),
  monthlyPriceMinor: z.number().int().nonnegative(), setupFeeAmountMinor: z.number().int().nonnegative(), currency: z.string().length(3).default('GBP'),
  effectiveFrom: z.coerce.date(), status: PlanVersionStatusSchema.default('DRAFT'),
  entitlements: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/), name: z.string().min(1).max(120), type: EntitlementTypeSchema, availability: EntitlementAvailabilitySchema, value: EntitlementValueSchema })).min(1),
}).strict();
export const CreateEntitlementOverrideSchema = z.object({
  entitlementKey: z.string().min(2).max(80), value: EntitlementValueSchema, reason: z.string().trim().min(8).max(500),
  startsAt: z.coerce.date().default(() => new Date()), expiresAt: z.coerce.date(),
}).strict().refine(v => v.expiresAt > v.startsAt, { message: 'Override expiry must follow its start.' });

export const TenantLifecycleSchema = z.enum(['PROSPECT','ONBOARDING','ACTIVE','SUSPENDED','OFFBOARDING','OFFBOARDED']);
export const CreateAgencyTenantSchema = z.object({
  name: z.string().trim().min(2).max(255), legalBusinessName: z.string().trim().min(2).max(255),
  subdomain: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  businessType: z.string().trim().min(2).max(80), timezone: z.string().min(3).max(100).default('Europe/London'),
  currency: z.string().length(3).default('GBP'), planVersionId: z.string().uuid(),
  primaryContactName: z.string().trim().min(2).max(255), primaryContactEmail: z.string().email(),
  contractStartAt: z.coerce.date().optional(), minimumTermEndsAt: z.coerce.date().optional(),
  foundingClient: z.boolean().default(false), commercialNotes: z.string().trim().max(4000).nullable().optional(),
}).strict();
export const UpdateAgencyTenantSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(), legalBusinessName: z.string().trim().min(2).max(255).optional(),
  lifecycleStatus: TenantLifecycleSchema.optional(), businessType: z.string().trim().min(2).max(80).optional(),
  primaryContactName: z.string().trim().min(2).max(255).optional(), primaryContactEmail: z.string().email().optional(),
}).strict().refine(v => Object.keys(v).length > 0, 'At least one change is required.');

export const OnboardingStageKeySchema = z.enum([
  'SALE_HANDOVER','CONTRACT','SETUP_FEE','DIRECT_DEBIT','BUSINESS_PROFILE','BRAND_ASSETS',
  'CATALOGUE','TEAM_AND_LOCATIONS','PAYMENTS','COMMUNICATIONS','TRAINING','LAUNCH',
]);
export const OnboardingStageStatusSchema = z.enum(['NOT_STARTED','IN_PROGRESS','BLOCKED','READY','COMPLETE','SKIPPED']);
export const UpdateOnboardingStageSchema = z.object({
  status: OnboardingStageStatusSchema, blockerCode: z.string().max(80).nullable().optional(),
  blockerNote: z.string().max(1000).nullable().optional(), dueAt: z.coerce.date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).strict().superRefine((v,ctx)=>{if(v.status==='BLOCKED'&&!v.blockerNote)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Blocked stages require a note.',path:['blockerNote']});});
const ShortList=z.array(z.string().trim().min(1).max(500)).max(50);
export const UpdateTenantOnboardingSchema=z.object({
  targetLaunchAt:z.coerce.date().nullable().optional(),responsibleTenantUserId:z.string().uuid().nullable().optional(),
  missingInformation:ShortList.optional(),nextAction:z.string().trim().max(1000).nullable().optional(),internalNotes:z.string().max(4000).nullable().optional(),clientVisibleNotes:z.string().max(4000).nullable().optional(),
  businessProfile:z.object({description:z.string().max(4000).optional(),address:z.string().max(1000).optional(),serviceAreas:ShortList.optional(),socialProfiles:ShortList.optional(),existingWebsite:z.string().url().optional(),targetCustomers:z.string().max(2000).optional(),competitors:ShortList.optional(),keySellingPoints:ShortList.optional()}).strict().optional(),
  brandingProfile:z.object({logoStoragePath:z.string().max(500).optional(),colors:ShortList.optional(),fonts:ShortList.optional(),photographyStoragePaths:ShortList.optional(),tone:z.string().max(1000).optional(),designPreferences:z.string().max(2000).optional(),referenceWebsites:ShortList.optional(),reviewStatus:z.enum(['NOT_STARTED','IN_REVIEW','APPROVED','REVISION_REQUESTED']).optional()}).strict().optional(),
  domainEmailProfile:z.object({domain:z.string().max(255).optional(),ownership:z.string().max(255).optional(),registrar:z.string().max(255).optional(),dnsAccessStatus:z.enum(['NOT_REQUESTED','REQUESTED','AVAILABLE','UNAVAILABLE']).optional(),domainConnectionStatus:z.string().max(80).optional(),requiredMailboxes:z.number().int().nonnegative().optional(),emailProviderStatus:z.string().max(80).optional(),spfStatus:z.string().max(80).optional(),dkimStatus:z.string().max(80).optional(),dmarcStatus:z.string().max(80).optional(),sslStatus:z.string().max(80).optional()}).strict().optional(),
  websiteProfile:z.object({pageAllowance:z.number().int().nonnegative().optional(),sitemap:ShortList.optional(),designSystem:z.string().max(255).optional(),contentStatus:z.string().max(80).optional(),imagesStatus:z.string().max(80).optional(),designStatus:z.string().max(80).optional(),internalReviewStatus:z.string().max(80).optional(),clientReviewStatus:z.string().max(80).optional(),revisions:z.number().int().nonnegative().optional(),domainConnectionStatus:z.string().max(80).optional(),launchApprovalStatus:z.string().max(80).optional()}).strict().optional(),
}).strict().refine(v=>Object.keys(v).length>0,'At least one onboarding change is required.');

export const SetupPaymentStatusSchema = z.enum(['PENDING','CONFIRMED','FAILED','REFUNDED','WAIVED']);
export const SubscriptionStatusSchema = z.enum(['DRAFT','AWAITING_MANDATE','PENDING','TRIALLING','ACTIVE','PAYMENT_OVERDUE','GRACE_PERIOD','RESTRICTED','PAUSED','CANCELLATION_SCHEDULED','CANCELLED','WRITTEN_OFF']);
export const CreateBillingRequestSchema = z.object({
  description: z.string().trim().min(3).max(255), successRedirectUrl: z.string().url(), exitRedirectUrl: z.string().url(),
}).strict();
export const BillingPlanChangeSchema = z.object({ planVersionId: z.string().uuid(), effective: z.enum(['IMMEDIATE','NEXT_BILLING_BOUNDARY']), reason: z.string().trim().min(8).max(500) }).strict();
export const BillingExceptionSchema = z.object({
  kind: z.enum(['DISCOUNT','FOUNDING_RATE','FREE_PERIOD','MANUAL_PRICE']), amountMinor: z.number().int().nonnegative().optional(),
  percentageBasisPoints: z.number().int().min(0).max(10000).optional(), reason: z.string().trim().min(8).max(500),
  startsAt: z.coerce.date(), expiresAt: z.coerce.date().nullable().optional(),
}).strict();

export const DeliverableTypeSchema = z.enum(['WEBSITE','SEO','ANALYTICS','CONTENT','PAID_MEDIA','DOMAIN','EMAIL','OTHER']);
export const DeliverableStatusSchema = z.enum(['NOT_STARTED','IN_PROGRESS','AWAITING_CLIENT','BLOCKED','READY_FOR_APPROVAL','APPROVED','DELIVERED','CANCELLED']);
export const CreateDeliverableSchema = z.object({ type: DeliverableTypeSchema, title: z.string().trim().min(2).max(180), description: z.string().max(4000).optional(), dueAt: z.coerce.date().nullable().optional(), estimatedMinutes: z.number().int().nonnegative().optional(), assignedAgencyUserId: z.string().uuid().nullable().optional() }).strict();
export const UpdateDeliverableSchema = z.object({ status: DeliverableStatusSchema.optional(), title: z.string().trim().min(2).max(180).optional(), description: z.string().max(4000).nullable().optional(), dueAt: z.coerce.date().nullable().optional(), actualMinutes: z.number().int().nonnegative().optional(), costMinor: z.number().int().nonnegative().optional() }).strict().refine(v=>Object.keys(v).length>0,'At least one change is required.');

export const StartSupportSessionSchema = z.object({ tenantId: z.string().uuid(), reason: z.string().trim().min(12).max(500), durationMinutes: z.number().int().min(5).max(120).default(30), scope: z.enum(['READ_ONLY','STANDARD_SUPPORT']).default('STANDARD_SUPPORT') }).strict();
export const SupportNoteSchema = z.object({ tenantId: z.string().uuid().nullable().optional(), category: z.enum(['SUPPORT','BILLING','ONBOARDING','FULFILMENT','INCIDENT']), note: z.string().trim().min(2).max(4000), visibility: z.literal('AGENCY_ONLY').default('AGENCY_ONLY') }).strict();
export const SafeRetrySchema = z.object({ reason: z.string().trim().min(8).max(500) }).strict();
export const AgencyListQuerySchema = z.object({ search: z.string().trim().max(120).optional(), status: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().uuid().optional() });

export const SUPPORT_HIGH_RISK_PATHS = [
  /\/api\/v1\/finance(?:\/|$)/, /\/api\/v1\/payments\/.+\/refund/, /\/api\/v1\/(?:settings\/)?team(?:\/|$)/,
  /\/api\/v1\/integrations\/stripe/, /\/api\/v1\/reputation\/connections/, /\/api\/v1\/agency(?:\/|$)/,
] as const;
export const isSupportPathBlocked = (path: string) => SUPPORT_HIGH_RISK_PATHS.some(pattern => pattern.test(path));

export function evaluateDowngrade(input:{currentStaff:number;currentLocations:number;targetStaffLimit:number|null;targetLocationLimit:number|null}) {
  const blockers:string[]=[];
  if(input.targetStaffLimit!==null&&input.currentStaff>input.targetStaffLimit)blockers.push(`Reduce active staff from ${input.currentStaff} to ${input.targetStaffLimit}.`);
  if(input.targetLocationLimit!==null&&input.currentLocations>input.targetLocationLimit)blockers.push(`Reduce active locations from ${input.currentLocations} to ${input.targetLocationLimit}.`);
  return { safe:blockers.length===0, blockers };
}
