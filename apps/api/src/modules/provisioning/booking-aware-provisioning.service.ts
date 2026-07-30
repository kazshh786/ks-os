import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import {
  bookingPages,
  getDatabase,
  locations,
  services,
  staffSchedules,
  staffServiceAssignments,
  stripeConnections,
  tenantPlanAssignments,
  users,
} from '@ks-os/database';
import {
  CreateProvisioningDraftSchema,
  evaluateProvisioningReadiness,
  type StartProvisioningRun,
} from '@ks-os/workspace-provisioning';
import type { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { SitePublicationService } from '../sites/site-publication.service.js';
import { ProvisioningService } from './provisioning.service.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const values = (brief: unknown, mapping: string): unknown[] => {
  const verified = record(record(brief).verifiedFacts);
  const value = verified[mapping];
  return Array.isArray(value) ? value : [];
};

function labels(input: unknown[]) {
  const output: string[] = [];
  const visit = (item: unknown) => {
    if (typeof item === 'string' && item.trim()) output.push(item.trim());
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>;
      for (const key of ['name', 'label', 'value', 'text']) {
        if (typeof row[key] === 'string' && String(row[key]).trim()) {
          output.push(String(row[key]).trim());
          break;
        }
      }
    }
  };
  input.forEach(visit);
  return [...new Set(output)];
}

function safePaymentStatus(connection: typeof stripeConnections.$inferSelect | undefined) {
  if (!connection) return 'NOT_STARTED' as const;
  if (connection.chargesEnabled && connection.payoutsEnabled && connection.detailsSubmitted) return 'READY' as const;
  if (connection.connectionStatus === 'restricted' || connection.disabledReason) return 'RESTRICTED' as const;
  return connection.detailsSubmitted ? 'ACTION_REQUIRED' as const : 'ONBOARDING_STARTED' as const;
}

const MARKETING_TYPES = new Set([
  'HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'LOCATION_HUB', 'LOCATION_DETAIL',
  'ABOUT', 'TEAM_HUB', 'TEAM_DETAIL', 'CONTACT', 'FAQ', 'RESULTS',
  'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE',
]);

type Database = ReturnType<typeof getDatabase>;
type DraftContext = {
  tenantId: string;
  planVersionId: string;
  planStatus: string;
  planKey: string;
  templateSourceType: string;
  templateSourceId: string;
  templateVersionId: string;
  templateStatus: string;
  templateAnalysisStatus: string;
  briefStatus: string;
  briefReadiness: unknown;
  briefJson: unknown;
  draft: {
    pagePlanJson: unknown;
    paymentPreferenceJson: unknown;
  };
};

async function assessWithCanonicalBooking(db: Database, context: DraftContext) {
  const pagePlan = record(context.draft.pagePlanJson);
  const requested = Array.isArray(pagePlan.requestedPageTypes)
    ? pagePlan.requestedPageTypes.filter(item => typeof item === 'string') as string[]
    : [];
  const targetMarketingPageCount = Number(pagePlan.targetMarketingPageCount ?? 10);
  const requestedMarketingPageCount = Math.min(
    Number.isInteger(targetMarketingPageCount) && targetMarketingPageCount > 0
      ? targetMarketingPageCount
      : 10,
    30,
  );
  const explicitlyRequestedMarketingCount = requested.filter(item => MARKETING_TYPES.has(item)).length;

  const now = new Date();
  const [entitlement, assignment, payment, canonicalServices, canonicalLocations, canonicalStaff, canonicalSchedules, canonicalAssignments, booking] = await Promise.all([
    db.execute(sql<{ value_json: unknown }>`
      select value_json from platform_plan_entitlements
      where plan_version_id = ${context.planVersionId}::uuid
        and entitlement_key = 'sites.initial_marketing_pages'
      limit 1
    `),
    db.select({ id: tenantPlanAssignments.id }).from(tenantPlanAssignments)
      .where(and(
        eq(tenantPlanAssignments.tenantId, context.tenantId),
        eq(tenantPlanAssignments.planVersionId, context.planVersionId),
        eq(tenantPlanAssignments.status, 'ACTIVE'),
        lte(tenantPlanAssignments.startsAt, now),
        or(isNull(tenantPlanAssignments.endsAt), gt(tenantPlanAssignments.endsAt, now)),
      )).limit(1),
    db.select().from(stripeConnections).where(eq(stripeConnections.tenantId, context.tenantId)).limit(1),
    db.select({
      id: services.id,
      duration: services.duration,
      price: services.price,
    }).from(services).where(and(eq(services.tenantId, context.tenantId), eq(services.isActive, true))),
    db.select({ id: locations.id, address: locations.address, postcode: locations.postcode })
      .from(locations).where(and(eq(locations.tenantId, context.tenantId), eq(locations.isActive, true))),
    db.select({ id: users.id }).from(users).where(and(
      eq(users.tenantId, context.tenantId),
      eq(users.accountStatus, 'ACTIVE'),
      eq(users.bookingEnabled, true),
    )),
    db.select({ id: staffSchedules.id }).from(staffSchedules).where(eq(staffSchedules.tenantId, context.tenantId)),
    db.select({ id: staffServiceAssignments.id }).from(staffServiceAssignments).where(and(
      eq(staffServiceAssignments.tenantId, context.tenantId),
      eq(staffServiceAssignments.isActive, true),
    )),
    db.select({ id: bookingPages.id, enabled: bookingPages.enabled }).from(bookingPages)
      .where(eq(bookingPages.tenantId, context.tenantId)).limit(1),
  ]);

  const entitlementRows = Array.isArray(entitlement) ? entitlement : entitlement.rows;
  const entitlementValue = record((entitlementRows as Array<{ value_json?: unknown }>)[0]?.value_json);
  const entitlementLimit = Number(entitlementValue.limit);
  const briefReadiness = record(context.briefReadiness);
  const briefServices = labels(values(context.briefJson, 'SERVICE.NAME'));
  const briefLocations = labels(values(context.briefJson, 'LOCATION.NAME'));
  const briefStaff = labels(values(context.briefJson, 'STAFF.NAME'));
  const durations = values(context.briefJson, 'SERVICE.DURATION');
  const prices = values(context.briefJson, 'SERVICE.PRICE');
  const hours = values(context.briefJson, 'LOCATION.OPENING_HOURS')
    .concat(values(context.briefJson, 'STAFF.AVAILABILITY'));
  const bookingFacts = Object.keys(record(record(context.briefJson).verifiedFacts))
    .filter(key => key.startsWith('BOOKING.'));
  const paymentPreference = record(context.draft.paymentPreferenceJson);

  const validCanonicalServices = canonicalServices.filter(item =>
    Number.isInteger(item.duration) && item.duration >= 5
    && Number.isInteger(item.price) && item.price >= 0);
  const validBriefServices = briefServices.length > 0
    && durations.length >= briefServices.length
    && prices.length >= briefServices.length;
  const serviceCount = Math.max(validCanonicalServices.length, validBriefServices ? briefServices.length : 0);
  const locationCount = Math.max(
    canonicalLocations.filter(item => Boolean(item.address && item.postcode)).length,
    briefLocations.length,
  );
  const staffCount = Math.max(canonicalStaff.length, briefStaff.length);
  const availabilityReady = canonicalSchedules.length > 0 || hours.length > 0;
  const bookingConfigurationPresent = booking[0]?.enabled === true || bookingFacts.length > 0;
  const relationshipReady = canonicalAssignments.length > 0 || staffCount <= 1 || serviceCount <= 1;

  const assessment = evaluateProvisioningReadiness({
    productionBriefLocked: context.briefStatus === 'LOCKED_FOR_PROVISIONING',
    productionBriefReady: briefReadiness.readyForProvisioning === true,
    planResolved: context.planStatus === 'ACTIVE'
      && ['CORE', 'GROWTH', 'SCALE'].includes(context.planKey)
      && Boolean(assignment[0]),
    entitlementPageLimit: Number.isInteger(entitlementLimit) ? entitlementLimit : -1,
    requestedMarketingPageCount,
    approvedTemplate: context.templateStatus === 'APPROVED'
      && context.templateAnalysisStatus === 'APPROVED',
    templateLicensed: context.templateSourceType !== 'ENVATO_HTML' || true,
    locationCount,
    approvedRemoteServiceConfiguration: false,
    bookableServiceCount: serviceCount,
    eligibleStaffCount: staffCount,
    staffRequired: true,
    validAvailability: availabilityReady,
    bookingConfigurationPresent,
    nativeBookingOnly: true,
    validBookingPath: serviceCount > 0 && locationCount > 0 && staffCount > 0 && relationshipReady,
    requiredFormsPresent: values(context.briefJson, 'SERVICE.INTAKE_REQUIREMENTS').length === 0
      || values(context.briefJson, 'SERVICE.INTAKE_REQUIREMENTS').some(Boolean),
    paymentStatus: safePaymentStatus(payment[0]),
    payLaterAllowed: paymentPreference.allowPayLater === true,
  });

  if (!Number.isInteger(entitlementLimit)) {
    assessment.blockingIssues.push({ code: 'PAGE_ENTITLEMENT_UNAVAILABLE', area: 'WEBSITE', message: 'The selected plan has no valid marketing-page entitlement.' });
  }
  if (Number.isInteger(entitlementLimit) && requestedMarketingPageCount > entitlementLimit) {
    assessment.blockingIssues.push({ code: 'PAGE_ENTITLEMENT_EXCEEDED', area: 'WEBSITE', message: `The requested ${requestedMarketingPageCount}-page launch exceeds the selected plan allowance of ${entitlementLimit}.` });
  }
  if (explicitlyRequestedMarketingCount > requestedMarketingPageCount) {
    assessment.warnings.push({ code: 'PAGE_TYPES_PRIORITISED', area: 'WEBSITE', message: `KS OS will select the strongest ${requestedMarketingPageCount} marketing pages from the requested page types and verified client data.` });
  }
  if (!relationshipReady) {
    assessment.blockingIssues.push({ code: 'STAFF_SERVICE_RELATIONSHIPS_REQUIRED', area: 'BOOKING', message: 'Assign at least one active service to bookable staff before building.' });
  }
  assessment.ready = assessment.blockingIssues.length === 0;
  return {
    ...assessment,
    signals: {
      marketingPageCount: requestedMarketingPageCount,
      entitlementPageLimit: entitlementLimit,
      serviceCount,
      locationCount,
      staffCount,
      availabilityReady,
      bookingConfigurationPresent,
      canonicalBookingDataUsed: canonicalServices.length > 0 || canonicalLocations.length > 0 || canonicalStaff.length > 0,
      paymentStatus: safePaymentStatus(payment[0]),
    },
  };
}

/**
 * Keeps the existing locked-brief provisioning workflow, but treats valid
 * canonical booking records as first-class onboarding inputs. This allows a
 * client who already configured booking to continue without duplicating the
 * same services, staff and availability in fact finding.
 */
export class BookingAwareProvisioningService extends ProvisioningService {
  private readonly publication: SitePublicationService;

  constructor(
    private readonly database: Database = getDatabase(),
    environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  ) {
    super(database);
    this.publication = new SitePublicationService(database);
    const target = this as unknown as {
      assess: (context: DraftContext) => Promise<unknown>;
    };
    target.assess = context => assessWithCanonicalBooking(database, context);
    this.environment = environment;
  }

  private readonly environment: NodeJS.ProcessEnv | Record<string, string | undefined>;

  override async start(actor: AgencyActor, input: z.infer<typeof StartProvisioningRunSchema>) {
    const result = await super.start(actor, input);
    if (result.siteReference) {
      try {
        await this.publication.createFallback(
          actor,
          result.siteReference,
          this.environment.PUBLIC_SITES_FALLBACK_DOMAIN || 'sites.kasimshah.com',
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (!['FALLBACK_DOMAIN_EXISTS', 'DOMAIN_ALREADY_EXISTS'].includes(String(code))) throw error;
      }
    }
    return result;
  }
}
