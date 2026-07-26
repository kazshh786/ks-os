import {
  and,
  asc,
  desc,
  eq,
  getDatabase,
  inArray,
  isNull,
} from '@ks-os/database';
import {
  bookingPages,
  locations,
  serviceLocations,
  services,
  siteBlueprints,
  siteChangeRequests,
  siteGenerationFindings,
  siteGenerationRuns,
  sitePages,
  siteReviewComments,
  siteReviewCycles,
  siteReviewItems,
  siteSections,
  sites,
  siteVersions,
  staffSchedules,
  staffServiceAssignments,
  tenants,
  users,
} from '@ks-os/database';
import { KsOsBookingActionSchema, type KsOsBookingAction } from '@ks-os/contracts';
import { NativeSiteBookingService } from './native-booking.service.js';

type Database = ReturnType<typeof getDatabase>;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function collectBookingActions(value: unknown, output: KsOsBookingAction[] = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectBookingActions(child, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  const candidate = KsOsBookingActionSchema.safeParse(value);
  if (candidate.success) output.push(candidate.data);
  for (const child of Object.values(value as Record<string, unknown>)) {
    collectBookingActions(child, output);
  }
  return output;
}

function actionKey(action: KsOsBookingAction) {
  return JSON.stringify({
    serviceReference: action.serviceReference || null,
    locationReference: action.locationReference || null,
    staffReference: action.staffReference || null,
    campaignReference: action.campaignReference || null,
  });
}

export class SiteStudioService {
  constructor(
    private readonly db: Database = getDatabase(),
    private readonly booking = new NativeSiteBookingService(),
  ) {}

  async get(siteReference: string) {
    const context = await this.siteContext(siteReference);
    const version = await this.latestVersion(context.id);
    const [blueprint, generation, review, bookingPage] = await Promise.all([
      this.latestBlueprint(context.id),
      this.latestGeneration(context.id),
      this.latestReview(context.id),
      this.db.select({
        title: bookingPages.title,
        enabled: bookingPages.enabled,
        published: bookingPages.published,
        publicSlug: bookingPages.publicSlug,
      }).from(bookingPages).where(eq(bookingPages.tenantId, context.tenantId)).limit(1)
        .then(rows => rows[0] || null),
    ]);
    const [pages, findings, items, comments, changes, links, canonical] = await Promise.all([
      version ? this.pages(version.id) : [],
      generation ? this.findings(generation.id) : [],
      review ? this.reviewItems(review.id) : [],
      review ? this.reviewComments(review.id) : [],
      review ? this.changeRequests(review.id) : [],
      this.bookingLinks(context, version?.id),
      this.canonicalRecords(context.tenantId),
    ]);
    return {
      site: {
        reference: context.reference,
        tenantReference: context.tenantReference,
        tenantName: context.tenantName,
        displayName: context.displayName,
        status: context.status,
      },
      version,
      blueprint,
      generation,
      review: review ? { ...review, items, comments, changeRequests: changes } : null,
      pages,
      findings,
      booking: { page: bookingPage, links },
      canonical,
      publication: {
        available: false,
        status: 'NOT_AVAILABLE_UNTIL_PHASE_15_9',
        message: 'Publishing, domains, deployment, and provider changes are outside this phase.',
      },
    };
  }

  async getBookingLinks(siteReference: string) {
    const context = await this.siteContext(siteReference);
    const version = await this.latestVersion(context.id);
    return this.bookingLinks(context, version?.id);
  }

  private async siteContext(reference: string) {
    const [row] = await this.db.select({
      id: sites.id,
      reference: sites.publicReference,
      tenantId: sites.tenantId,
      tenantReference: tenants.businessReference,
      tenantName: tenants.name,
      displayName: sites.displayName,
      status: sites.status,
    }).from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .where(eq(sites.publicReference, reference)).limit(1);
    if (!row) throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    return row;
  }

  private async latestVersion(siteId: string) {
    const [row] = await this.db.select({
      id: siteVersions.id,
      reference: siteVersions.publicReference,
      versionNumber: siteVersions.versionNumber,
      status: siteVersions.status,
      generationStatus: siteVersions.generationStatus,
      changeSummary: siteVersions.changeSummary,
      updatedAt: siteVersions.updatedAt,
    }).from(siteVersions).where(eq(siteVersions.siteId, siteId))
      .orderBy(desc(siteVersions.versionNumber)).limit(1);
    return row || null;
  }

  private async latestBlueprint(siteId: string) {
    const [row] = await this.db.select({
      reference: siteBlueprints.publicReference,
      revision: siteBlueprints.revision,
      status: siteBlueprints.status,
      marketingPageCount: siteBlueprints.proposedMarketingPageCount,
      marketingPageLimit: siteBlueprints.entitlementMarketingPageLimit,
      functionalPageCount: siteBlueprints.functionalPageCount,
      requiredLegalPageCount: siteBlueprints.requiredLegalPageCount,
      readiness: siteBlueprints.readinessJson,
      updatedAt: siteBlueprints.updatedAt,
    }).from(siteBlueprints).where(eq(siteBlueprints.siteId, siteId))
      .orderBy(desc(siteBlueprints.revision)).limit(1);
    return row || null;
  }

  private async latestGeneration(siteId: string) {
    const [row] = await this.db.select({
      id: siteGenerationRuns.id,
      reference: siteGenerationRuns.publicReference,
      status: siteGenerationRuns.status,
      generationReason: siteGenerationRuns.generationReason,
      pageCountPlanned: siteGenerationRuns.pageCountPlanned,
      pageCountCompleted: siteGenerationRuns.pageCountCompleted,
      sectionCountPlanned: siteGenerationRuns.sectionCountPlanned,
      sectionCountCompleted: siteGenerationRuns.sectionCountCompleted,
      startedAt: siteGenerationRuns.startedAt,
      completedAt: siteGenerationRuns.completedAt,
    }).from(siteGenerationRuns).where(eq(siteGenerationRuns.siteId, siteId))
      .orderBy(desc(siteGenerationRuns.createdAt)).limit(1);
    return row || null;
  }

  private async latestReview(siteId: string) {
    const [row] = await this.db.select({
      id: siteReviewCycles.id,
      reference: siteReviewCycles.publicReference,
      status: siteReviewCycles.status,
      scope: siteReviewCycles.reviewScope,
      revision: siteReviewCycles.reviewRevision,
      clientApprovalRequired: siteReviewCycles.clientApprovalRequired,
      agencyApprovalRequired: siteReviewCycles.agencyApprovalRequired,
      openedAt: siteReviewCycles.openedAt,
      updatedAt: siteReviewCycles.updatedAt,
    }).from(siteReviewCycles).where(eq(siteReviewCycles.siteId, siteId))
      .orderBy(desc(siteReviewCycles.createdAt)).limit(1);
    return row || null;
  }

  private async pages(versionId: string) {
    const pages = await this.db.select({
      id: sitePages.id,
      reference: sitePages.publicReference,
      pageType: sitePages.pageType,
      conversionRole: sitePages.conversionRole,
      title: sitePages.title,
      slug: sitePages.slug,
      sortOrder: sitePages.sortOrder,
      seoTitle: sitePages.seoTitle,
      seoDescription: sitePages.seoDescription,
    }).from(sitePages).where(eq(sitePages.versionId, versionId)).orderBy(asc(sitePages.sortOrder));
    const sections = await this.db.select({
      pageId: siteSections.pageId,
      reference: siteSections.publicReference,
      key: siteSections.sectionKey,
      type: siteSections.sectionType,
      sortOrder: siteSections.sortOrder,
      content: siteSections.contentJson,
      actions: siteSections.actionsJson,
    }).from(siteSections).where(eq(siteSections.versionId, versionId))
      .orderBy(asc(siteSections.sortOrder));
    return pages.map(({ id, ...page }) => ({
      ...page,
      sections: sections.filter(section => section.pageId === id)
        .map(({ pageId: _pageId, ...section }) => section),
    }));
  }

  private findings(generationRunId: string) {
    return this.db.select({
      reference: siteGenerationFindings.publicReference,
      severity: siteGenerationFindings.severity,
      category: siteGenerationFindings.category,
      code: siteGenerationFindings.code,
      message: siteGenerationFindings.message,
      current: siteGenerationFindings.current,
      createdAt: siteGenerationFindings.createdAt,
    }).from(siteGenerationFindings).where(and(
      eq(siteGenerationFindings.generationRunId, generationRunId),
      eq(siteGenerationFindings.current, true),
    )).orderBy(desc(siteGenerationFindings.createdAt));
  }

  private reviewItems(reviewCycleId: string) {
    return this.db.select({
      reference: siteReviewItems.publicReference,
      targetType: siteReviewItems.targetType,
      status: siteReviewItems.status,
      blocking: siteReviewItems.blocking,
      clientVisible: siteReviewItems.clientVisible,
      fieldPath: siteReviewItems.fieldPath,
    }).from(siteReviewItems).where(eq(siteReviewItems.reviewCycleId, reviewCycleId))
      .orderBy(asc(siteReviewItems.displayOrder));
  }

  private reviewComments(reviewCycleId: string) {
    return this.db.select({
      reference: siteReviewComments.publicReference,
      body: siteReviewComments.body,
      visibility: siteReviewComments.visibility,
      status: siteReviewComments.status,
      anchor: siteReviewComments.anchorJson,
      createdAt: siteReviewComments.createdAt,
    }).from(siteReviewComments).where(and(
      eq(siteReviewComments.reviewCycleId, reviewCycleId),
      isNull(siteReviewComments.deletedAt),
    )).orderBy(asc(siteReviewComments.createdAt));
  }

  private changeRequests(reviewCycleId: string) {
    return this.db.select({
      reference: siteChangeRequests.publicReference,
      status: siteChangeRequests.status,
      title: siteChangeRequests.title,
      description: siteChangeRequests.description,
      category: siteChangeRequests.category,
      priority: siteChangeRequests.priority,
      createdAt: siteChangeRequests.createdAt,
    }).from(siteChangeRequests).where(eq(siteChangeRequests.reviewCycleId, reviewCycleId))
      .orderBy(desc(siteChangeRequests.createdAt));
  }

  private async bookingLinks(
    context: Awaited<ReturnType<SiteStudioService['siteContext']>>,
    versionId?: string,
  ) {
    if (!versionId) return [];
    const sections = await this.db.select({
      pageReference: sitePages.publicReference,
      pageTitle: sitePages.title,
      sectionReference: siteSections.publicReference,
      actions: siteSections.actionsJson,
      content: siteSections.contentJson,
    }).from(siteSections)
      .innerJoin(sitePages, eq(siteSections.pageId, sitePages.id))
      .where(and(eq(siteSections.siteId, context.id), eq(siteSections.versionId, versionId)))
      .orderBy(asc(sitePages.sortOrder), asc(siteSections.sortOrder));
    const seen = new Set<string>();
    const output: Array<Record<string, unknown>> = [];
    for (const section of sections) {
      for (const action of [...collectBookingActions(section.actions), ...collectBookingActions(section.content)]) {
        const key = `${section.pageReference}:${section.sectionReference}:${actionKey(action)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
          pageReference: section.pageReference,
          pageTitle: section.pageTitle,
          sectionReference: section.sectionReference,
          action,
          url: await this.booking.resolveForTenant({
            tenantId: context.tenantId,
            tenantReference: context.tenantReference,
            action,
          }),
        });
      }
    }
    return output;
  }

  private async canonicalRecords(tenantId: string) {
    const [serviceRows, locationRows, staffRows, serviceLocationRows, staffServiceRows, scheduleRows] = await Promise.all([
      this.db.select({
        reference: services.publicReference,
        name: services.name,
        description: services.description,
        durationMinutes: services.duration,
        bufferMinutes: services.bufferTime,
        priceMinor: services.price,
        requiresDeposit: services.requiresDeposit,
        active: services.isActive,
      })
        .from(services).where(eq(services.tenantId, tenantId)).orderBy(asc(services.name)),
      this.db.select({
        reference: locations.publicReference,
        name: locations.name,
        address: locations.address,
        postcode: locations.postcode,
        timezone: locations.timezone,
        primary: locations.isPrimary,
        active: locations.isActive,
      })
        .from(locations).where(eq(locations.tenantId, tenantId)).orderBy(asc(locations.name)),
      this.db.select({
        reference: users.publicReference,
        name: users.name,
        role: users.jobTitle,
        active: users.accountStatus,
        bookingEnabled: users.bookingEnabled,
      })
        .from(users).where(and(eq(users.tenantId, tenantId), inArray(users.role, ['owner', 'staff'])))
        .orderBy(asc(users.name)),
      this.db.select({ serviceReference: services.publicReference, locationReference: locations.publicReference })
        .from(serviceLocations)
        .innerJoin(services, eq(serviceLocations.serviceId, services.id))
        .innerJoin(locations, eq(serviceLocations.locationId, locations.id))
        .where(eq(serviceLocations.tenantId, tenantId)),
      this.db.select({ staffReference: users.publicReference, serviceReference: services.publicReference })
        .from(staffServiceAssignments)
        .innerJoin(users, eq(staffServiceAssignments.staffUserId, users.id))
        .innerJoin(services, eq(staffServiceAssignments.serviceId, services.id))
        .where(and(eq(staffServiceAssignments.tenantId, tenantId), eq(staffServiceAssignments.isActive, true))),
      this.db.select({
        staffReference: users.publicReference,
        dayOfWeek: staffSchedules.dayOfWeek,
        startTime: staffSchedules.startTime,
        endTime: staffSchedules.endTime,
      }).from(staffSchedules)
        .innerJoin(users, eq(staffSchedules.userId, users.id))
        .where(eq(staffSchedules.tenantId, tenantId))
        .orderBy(asc(staffSchedules.dayOfWeek), asc(staffSchedules.startTime)),
    ]);
    return {
      services: serviceRows.map(service => ({
        ...service,
        eligibleLocationReferences: serviceLocationRows
          .filter(link => link.serviceReference === service.reference)
          .map(link => link.locationReference),
        eligibleStaffReferences: staffServiceRows
          .filter(link => link.serviceReference === service.reference)
          .map(link => link.staffReference),
      })),
      locations: locationRows.map(location => ({
        ...location,
        serviceReferences: serviceLocationRows
          .filter(link => link.locationReference === location.reference)
          .map(link => link.serviceReference),
      })),
      staff: staffRows.map(member => ({
        ...member,
        serviceReferences: staffServiceRows
          .filter(link => link.staffReference === member.reference)
          .map(link => link.serviceReference),
        availability: scheduleRows.filter(slot => slot.staffReference === member.reference)
          .map(({ staffReference: _staffReference, ...slot }) => slot),
      })),
    };
  }
}
