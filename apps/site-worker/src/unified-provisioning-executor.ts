import { and, eq } from 'drizzle-orm';
import {
  getDatabase,
  locations,
  platformPlanEntitlements,
  platformAuditEvents,
  provisioningRuns,
  serviceLocations,
  services,
  siteBlueprintActionItems,
  siteBlueprintPages,
  siteBlueprints,
  staffServiceAssignments,
  templateLayoutPageTypes,
  templateLayouts,
  tenantPlanAssignments,
  tenants,
  users,
} from '@ks-os/database';
import {
  BlueprintGenerationRequestSchema,
  SitePageTypeSchema,
  type SitePageType,
} from '@ks-os/contracts';
import { generateBlueprintPlan } from '@ks-os/site-blueprints';
import { SiteJobExecutionError } from '@ks-os/site-jobs';
import type { SiteWorkerConfig } from './config.js';
import { PostgresWorkspaceProvisioningExecutor } from './postgres-provisioning-executor.js';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

function flatten(value: unknown): unknown[] {
  return Array.isArray(value) ? value.flatMap(flatten) : [value];
}

type ApprovedFact = {
  reference: string;
  mapping: string;
  value: unknown;
  digest: string;
};

type LinkedRecord = {
  type: string;
  reference: string;
  source?: ApprovedFact;
};

function mapped(facts: ApprovedFact[], mapping: string) {
  return facts.filter(fact => fact.mapping === mapping)
    .flatMap(fact => flatten(fact.value).map(value => ({ value, fact })));
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const row = object(value);
  for (const key of ['name', 'label', 'value', 'text']) {
    if (typeof row[key] === 'string' && String(row[key]).trim()) return String(row[key]).trim();
  }
  return null;
}

type Database = ReturnType<typeof getDatabase>;
type Run = {
  runId: string;
  runReference: string;
  tenantId: string;
  tenantReference: string;
  tenantName: string;
  siteId: string;
  siteReference: string;
  workspace: unknown;
  pagePlan: unknown;
  planVersionId: string;
  planKey: string;
  templateVersionId: string;
  templateVersionReference: string;
  templateSourceType: string;
  requestedByAgencyUserId: string;
};

/**
 * Extends the durable provisioning executor without changing its ledger or
 * idempotency model. Existing canonical booking records are reused, and the
 * initial architecture is capped at the requested ten marketing pages.
 */
export class UnifiedWorkspaceProvisioningExecutor extends PostgresWorkspaceProvisioningExecutor {
  constructor(
    private readonly database: Database,
    generation: SiteWorkerConfig['generation'],
  ) {
    super(database, generation);
    const methods = this as unknown as {
      businessProfile: (run: Run, facts: ApprovedFact[]) => Promise<LinkedRecord[]>;
      staffServices: (run: Run, facts: ApprovedFact[]) => Promise<LinkedRecord[]>;
      locationServices: (run: Run, facts: ApprovedFact[]) => Promise<LinkedRecord[]>;
      generateBlueprint: (run: Run) => Promise<LinkedRecord[]>;
    };
    methods.businessProfile = (run, facts) => this.preserveBusinessProfile(run, facts);
    methods.staffServices = (run, facts) => this.reuseStaffServices(run, facts);
    methods.locationServices = (run, facts) => this.reuseLocationServices(run, facts);
    methods.generateBlueprint = run => this.generateTenPageBlueprint(run);
  }

  private async preserveBusinessProfile(run: Run, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const trading = mapped(facts, 'BUSINESS.TRADING_NAME')[0];
    const legal = mapped(facts, 'BUSINESS.LEGAL_NAME')[0];
    const category = mapped(facts, 'BUSINESS.CATEGORY')[0];
    const phone = mapped(facts, 'BUSINESS.PUBLIC_PHONE')[0];
    const email = mapped(facts, 'BUSINESS.PUBLIC_EMAIL')[0];
    const workspace = object(run.workspace);
    const changes: Record<string, unknown> = {
      lifecycleStatus: 'ONBOARDING',
      updatedAt: new Date(),
    };
    const tradingName = stringValue(trading?.value);
    const legalName = stringValue(legal?.value);
    const businessType = stringValue(category?.value);
    const publicPhone = stringValue(phone?.value);
    const publicEmail = stringValue(email?.value);
    if (tradingName) changes.name = tradingName;
    if (legalName) changes.legalBusinessName = legalName;
    if (businessType) changes.businessType = businessType;
    if (publicPhone) changes.operationalPhone = publicPhone;
    if (publicEmail) changes.replyToEmail = publicEmail;
    if (typeof workspace.timezone === 'string' && workspace.timezone) changes.timezone = workspace.timezone;
    if (typeof workspace.currency === 'string' && workspace.currency) changes.currency = workspace.currency;
    await this.database.update(tenants).set(changes).where(eq(tenants.id, run.tenantId));
    return [{ type: 'BUSINESS_PROFILE', reference: run.tenantReference, source: trading?.fact || legal?.fact }];
  }

  private async reuseStaffServices(run: Run, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const [staff, serviceRows, existingRows] = await Promise.all([
      this.database.select({ id: users.id, reference: users.publicReference, name: users.name })
        .from(users).where(and(eq(users.tenantId, run.tenantId), eq(users.bookingEnabled, true))),
      this.database.select({ id: services.id, reference: services.publicReference, name: services.name })
        .from(services).where(and(eq(services.tenantId, run.tenantId), eq(services.isActive, true))),
      this.database.select({
        reference: users.publicReference,
      }).from(staffServiceAssignments)
        .innerJoin(users, eq(staffServiceAssignments.staffUserId, users.id))
        .where(and(
          eq(staffServiceAssignments.tenantId, run.tenantId),
          eq(staffServiceAssignments.isActive, true),
        )),
    ]);
    const eligible = mapped(facts, 'STAFF.ELIGIBLE_SERVICES');
    if (!eligible.length && existingRows.length) {
      return [...new Set(existingRows.map(row => row.reference))]
        .map(reference => ({ type: 'STAFF_SERVICE_ASSIGNMENT', reference }));
    }
    if (!eligible.length && staff.length * serviceRows.length > 1) {
      throw new SiteJobExecutionError(
        'TERMINAL_DATA_MISSING',
        'Assign services to staff in booking, or approve the staff-service mapping in fact finding.',
      );
    }
    for (const [index, member] of staff.entries()) {
      const names = flatten(eligible[index]?.value)
        .map(stringValue)
        .filter((value): value is string => Boolean(value));
      const selected = names.length
        ? serviceRows.filter(service => names.includes(service.name))
        : serviceRows.slice(0, 1);
      if (names.length && selected.length !== names.length) {
        throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', `One or more services for ${member.name} could not be resolved.`);
      }
      for (const service of selected) {
        await this.database.insert(staffServiceAssignments).values({
          tenantId: run.tenantId,
          staffUserId: member.id,
          serviceId: service.id,
        }).onConflictDoNothing();
      }
    }
    const rows = await this.database.select({ reference: users.publicReference })
      .from(staffServiceAssignments)
      .innerJoin(users, eq(staffServiceAssignments.staffUserId, users.id))
      .where(and(
        eq(staffServiceAssignments.tenantId, run.tenantId),
        eq(staffServiceAssignments.isActive, true),
      ));
    if (staff.length && !rows.length) {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'No active staff-service relationship is available.');
    }
    return [...new Set(rows.map(row => row.reference))]
      .map(reference => ({ type: 'STAFF_SERVICE_ASSIGNMENT', reference }));
  }

  private async reuseLocationServices(run: Run, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const [locationRows, serviceRows, existingRows] = await Promise.all([
      this.database.select({ id: locations.id, reference: locations.publicReference, name: locations.name })
        .from(locations).where(and(eq(locations.tenantId, run.tenantId), eq(locations.isActive, true))),
      this.database.select({ id: services.id, reference: services.publicReference, name: services.name })
        .from(services).where(and(eq(services.tenantId, run.tenantId), eq(services.isActive, true))),
      this.database.select({ reference: locations.publicReference })
        .from(serviceLocations)
        .innerJoin(locations, eq(serviceLocations.locationId, locations.id))
        .where(eq(serviceLocations.tenantId, run.tenantId)),
    ]);
    const mappings = mapped(facts, 'SERVICE.AVAILABLE_LOCATIONS');
    if (!mappings.length && existingRows.length) {
      return [...new Set(existingRows.map(row => row.reference))]
        .map(reference => ({ type: 'LOCATION_SERVICE_CONFIGURATION', reference }));
    }
    if (!mappings.length && serviceRows.length * locationRows.length > 1) {
      throw new SiteJobExecutionError(
        'TERMINAL_DATA_MISSING',
        'Assign services to locations in booking, or approve the service-location mapping in fact finding.',
      );
    }
    for (const [index, service] of serviceRows.entries()) {
      const names = flatten(mappings[index]?.value)
        .map(stringValue)
        .filter((value): value is string => Boolean(value));
      const selected = names.length
        ? locationRows.filter(location => names.includes(location.name))
        : locationRows.slice(0, 1);
      if (names.length && selected.length !== names.length) {
        throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', `One or more locations for ${service.name} could not be resolved.`);
      }
      for (const location of selected) {
        await this.database.insert(serviceLocations).values({
          tenantId: run.tenantId,
          serviceId: service.id,
          locationId: location.id,
        }).onConflictDoNothing();
      }
    }
    return locationRows.map(row => ({ type: 'LOCATION_SERVICE_CONFIGURATION', reference: row.reference }));
  }

  private async generateTenPageBlueprint(run: Run): Promise<LinkedRecord[]> {
    const [existing] = await this.database.select({ id: siteBlueprints.id, reference: siteBlueprints.publicReference })
      .from(siteBlueprints).where(eq(siteBlueprints.provisioningRunId, run.runId)).limit(1);
    if (existing) return [{ type: 'SITE_BLUEPRINT', reference: existing.reference }];

    const [assignment, entitlement, layouts, pageTypes, serviceRows, locationRows, staffRows, business] = await Promise.all([
      this.database.select({ id: tenantPlanAssignments.id }).from(tenantPlanAssignments)
        .where(and(
          eq(tenantPlanAssignments.tenantId, run.tenantId),
          eq(tenantPlanAssignments.planVersionId, run.planVersionId),
          eq(tenantPlanAssignments.status, 'ACTIVE'),
        )).limit(1).then(rows => rows[0]),
      this.database.select({ value: platformPlanEntitlements.valueJson }).from(platformPlanEntitlements)
        .where(and(
          eq(platformPlanEntitlements.planVersionId, run.planVersionId),
          eq(platformPlanEntitlements.entitlementKey, 'sites.initial_marketing_pages'),
        )).limit(1).then(rows => rows[0]),
      this.database.select({
        id: templateLayouts.id,
        reference: templateLayouts.publicReference,
        status: templateLayouts.status,
        disabledAt: templateLayouts.disabledAt,
      }).from(templateLayouts).where(eq(templateLayouts.templateVersionId, run.templateVersionId)),
      this.database.select({
        layoutId: templateLayoutPageTypes.templateLayoutId,
        pageType: templateLayoutPageTypes.pageType,
        approvedAt: templateLayoutPageTypes.approvedAt,
      }).from(templateLayoutPageTypes),
      this.database.select({
        id: services.id,
        reference: services.publicReference,
        name: services.name,
        description: services.description,
        duration: services.duration,
        price: services.price,
        active: services.isActive,
        updatedAt: services.updatedAt,
      }).from(services).where(eq(services.tenantId, run.tenantId)),
      this.database.select({
        id: locations.id,
        reference: locations.publicReference,
        name: locations.name,
        address: locations.address,
        postcode: locations.postcode,
        phone: locations.phone,
        primary: locations.isPrimary,
        active: locations.isActive,
        updatedAt: locations.updatedAt,
      }).from(locations).where(eq(locations.tenantId, run.tenantId)),
      this.database.select({
        id: users.id,
        reference: users.publicReference,
        name: users.name,
        active: users.accountStatus,
        bookingEnabled: users.bookingEnabled,
        bio: users.bio,
        role: users.jobTitle,
        image: users.profileImageUrl,
        updatedAt: users.updatedAt,
      }).from(users).where(eq(users.tenantId, run.tenantId)),
      this.database.select({
        name: tenants.name,
        businessType: tenants.businessType,
        phone: tenants.operationalPhone,
        email: tenants.replyToEmail,
        primary: tenants.primaryColor,
        secondary: tenants.secondaryColor,
        accent: tenants.accentColor,
      }).from(tenants).where(eq(tenants.id, run.tenantId)).limit(1).then(rows => rows[0]),
    ]);
    if (!assignment || !business) {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Blueprint plan inputs are incomplete.');
    }

    const assignmentRows = await this.database.select({
      staffId: staffServiceAssignments.staffUserId,
      serviceId: staffServiceAssignments.serviceId,
    }).from(staffServiceAssignments).where(and(
      eq(staffServiceAssignments.tenantId, run.tenantId),
      eq(staffServiceAssignments.isActive, true),
    ));
    const pagePlan = object(run.pagePlan);
    const requestedTypes = Array.isArray(pagePlan.requestedPageTypes)
      ? pagePlan.requestedPageTypes.flatMap(value =>
          SitePageTypeSchema.safeParse(value).success ? [value as SitePageType] : [])
      : [];
    const includePageTypes = [...new Set<SitePageType>([
      ...requestedTypes,
      'NEW_CLIENT_GUIDE',
      'AFTERCARE_GUIDE',
      'CONSULTATION_GUIDE',
    ])];
    const request = BlueprintGenerationRequestSchema.parse({
      templateVersionReference: run.templateVersionReference,
      name: `${business.name} ten-page launch architecture`,
      preferences: {
        prioritisedServiceReferences: serviceRows.map(row => row.reference),
        prioritisedLocationReferences: locationRows.map(row => row.reference),
        prioritisedStaffReferences: staffRows.map(row => row.reference),
        preferredLayoutReferences: object(pagePlan.preferredLayoutReferences),
        includePageTypes,
      },
    });
    const entitlementLimit = Number(object(entitlement?.value).limit);
    const requestedTarget = Number(pagePlan.targetMarketingPageCount ?? 10);
    const targetMarketingPageCount = Number.isInteger(requestedTarget)
      ? Math.min(Math.max(requestedTarget, 1), 30)
      : 10;
    const marketingPageLimit = Number.isInteger(entitlementLimit)
      ? Math.min(entitlementLimit, targetMarketingPageCount)
      : 0;
    const bookableServiceIds = new Set(assignmentRows.map(row => row.serviceId));
    const plan = generateBlueprintPlan({
      tenantReference: run.tenantReference,
      siteReference: run.siteReference,
      planKey: run.planKey as 'CORE' | 'GROWTH' | 'SCALE',
      planAssignmentReference: assignment.id,
      marketingPageLimit,
      entitlementOverrideApplied: false,
      template: {
        reference: run.templateVersionReference,
        status: 'APPROVED',
        sourceType: run.templateSourceType as 'ENVATO_HTML' | 'GOOGLE_STITCH' | 'INTERNAL',
        licensedForSite: true,
        layouts: layouts.map(layout => ({
          reference: layout.reference,
          templateVersionReference: run.templateVersionReference,
          approved: layout.status === 'APPROVED',
          enabled: !layout.disabledAt,
          approvedPageTypes: pageTypes
            .filter(item => item.layoutId === layout.id && item.approvedAt)
            .flatMap(item => SitePageTypeSchema.safeParse(item.pageType).success
              ? [item.pageType as SitePageType]
              : []),
        })),
      },
      services: serviceRows.map(service => ({
        reference: service.reference,
        tenantReference: run.tenantReference,
        name: service.name,
        description: service.description,
        durationMinutes: service.duration,
        priceMinor: service.price,
        active: service.active,
        bookingEligible: service.active && bookableServiceIds.has(service.id),
        updatedAt: service.updatedAt.toISOString(),
      })),
      locations: locationRows.map(location => ({
        reference: location.reference,
        tenantReference: run.tenantReference,
        name: location.name,
        active: location.active,
        primary: location.primary,
        addressComplete: Boolean(location.address && location.postcode),
        openingHoursComplete: true,
        telephonePresent: Boolean(location.phone),
        updatedAt: location.updatedAt.toISOString(),
      })),
      staff: staffRows.map(staff => ({
        reference: staff.reference,
        tenantReference: run.tenantReference,
        name: staff.name,
        active: staff.active === 'ACTIVE',
        bookingEnabled: staff.bookingEnabled,
        publicProfileAllowed: true,
        biographyPresent: Boolean(staff.bio),
        rolePresent: Boolean(staff.role),
        imagePresent: Boolean(staff.image),
        serviceAssignmentCount: assignmentRows.filter(item => item.staffId === staff.id).length,
        updatedAt: staff.updatedAt.toISOString(),
      })),
      business: {
        name: business.name,
        businessType: business.businessType,
        profileComplete: Boolean(business.name && business.businessType),
        contactComplete: Boolean(business.phone || business.email),
        brandComplete: Boolean(business.primary && business.secondary && business.accent),
        approvedResultsAssetCount: 0,
      },
      existingCanonicalPaths: [],
      request,
    });

    const layoutIds = new Map(layouts.map(layout => [layout.reference, layout.id]));
    const serviceIds = new Map(serviceRows.map(service => [service.reference, service.id]));
    const locationIds = new Map(locationRows.map(location => [location.reference, location.id]));
    const staffIds = new Map(staffRows.map(staff => [staff.reference, staff]));
    const [blueprint] = await this.database.insert(siteBlueprints).values({
      tenantId: run.tenantId,
      siteId: run.siteId,
      templateVersionId: run.templateVersionId,
      planAssignmentId: assignment.id,
      provisioningRunId: run.runId,
      name: request.name!,
      status: 'REVIEW_REQUIRED',
      revision: 1,
      sourceDataDigest: plan.sourceDataDigest,
      engineVersion: plan.engineVersion,
      proposedMarketingPageCount: plan.entitlementUsage.proposedMarketingPageCount,
      entitlementMarketingPageLimit: plan.entitlementUsage.marketingPageLimit,
      functionalPageCount: plan.entitlementUsage.functionalPageCount,
      requiredLegalPageCount: plan.entitlementUsage.requiredLegalPageCount,
      unusedMarketingPageAllowance: plan.entitlementUsage.unusedMarketingPageAllowance,
      entitlementOverrideApplied: plan.entitlementUsage.overrideApplied,
      readinessJson: plan.readiness,
      generatedAt: new Date(),
      generatedByAgencyUserId: run.requestedByAgencyUserId,
    }).returning({ id: siteBlueprints.id, reference: siteBlueprints.publicReference });
    const insertedPages = await this.database.insert(siteBlueprintPages).values(plan.pages.map((page, index) => ({
      tenantId: run.tenantId,
      blueprintId: blueprint.id,
      pageType: page.pageType,
      conversionRole: page.conversionRole,
      entitlementKind: page.entitlementKind,
      allocation: 'INITIAL',
      title: page.titleLabel,
      proposedSlug: page.plannedSlug,
      templateLayoutId: page.layoutReference ? layoutIds.get(page.layoutReference) || null : null,
      serviceId: page.serviceReference ? serviceIds.get(page.serviceReference) || null : null,
      locationId: page.locationReference ? locationIds.get(page.locationReference) || null : null,
      staffUserId: page.staffReference ? staffIds.get(page.staffReference)?.id || null : null,
      navigationGroup: page.navigationGroup,
      navigationOrder: page.navigationOrder,
      consumesMarketingEntitlement: page.consumesMarketingEntitlement,
      generationPriority: page.generationPriority,
      selectionScore: page.selectionScore,
      selectionReasonsJson: page.selectionReasons,
      bookingRequirementsJson: page.bookingRequirements,
      layoutSelectionReason: page.layoutSelectionReason,
      agencyNotes: page.agencyNotes || null,
      sortOrder: index,
      rationale: page.selectionReasons.join(', ').slice(0, 1000),
    }))).returning({ id: siteBlueprintPages.id });
    if (plan.actionItems.length) {
      await this.database.insert(siteBlueprintActionItems).values(plan.actionItems.map(item => ({
        tenantId: run.tenantId,
        blueprintId: blueprint.id,
        category: item.category,
        severity: item.severity,
        code: item.code,
        message: item.message,
        subjectPublicReference: item.subjectReference,
        safeMetadataJson: item.safeMetadata,
      })));
    }
    await this.database.update(provisioningRuns).set({
      blueprintId: blueprint.id,
      updatedAt: new Date(),
    }).where(eq(provisioningRuns.id, run.runId));
    if (!insertedPages.length) {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The generated blueprint contains no pages.');
    }
    await this.database.insert(platformAuditEvents).values({
      agencyUserId: run.requestedByAgencyUserId,
      tenantId: run.tenantId,
      action: 'TEN_PAGE_SITE_BLUEPRINT_GENERATED',
      targetType: 'SITE_BLUEPRINT',
      targetId: blueprint.reference,
      eventCategory: 'WEBSITE',
      sourceComponent: 'site-worker',
      description: 'The launch pipeline selected the strongest booking-led marketing pages within the ten-page target.',
      metadata: {
        provisioningRunReference: run.runReference,
        targetMarketingPageCount,
        selectedMarketingPageCount: plan.entitlementUsage.proposedMarketingPageCount,
      },
    });
    return [{ type: 'SITE_BLUEPRINT', reference: blueprint.reference }];
  }
}
