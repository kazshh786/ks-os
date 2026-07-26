import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  agencyUsers,
  bookingPages,
  factFindingQuestionnaires,
  getDatabase,
  locations,
  platformPlanEntitlements,
  platformPlans,
  platformPlanVersions,
  productionBriefs,
  provisioningActivity,
  provisioningDrafts,
  provisioningRecordLinks,
  provisioningRuns,
  provisioningRunSteps,
  services,
  siteBlueprintPages,
  siteBlueprints,
  siteGenerationRuns,
  siteJobs,
  sitePages,
  siteReviewCycles,
  siteReviewSessions,
  siteSections,
  sites,
  siteVersions,
  staffSchedules,
  staffServiceAssignments,
  stripeConnections,
  templateLicenses,
  templateSources,
  templateVersions,
  tenantOnboarding,
  tenantPlanAssignments,
  tenants,
  users,
} from '@ks-os/database';
import {
  CreateProvisioningDraftSchema,
  PROVISIONING_STEPS,
  ProvisioningActionReasonSchema,
  StartProvisioningRunSchema,
  UpdateProvisioningDraftSchema,
  canonicalStepIdempotencyKey,
  combinedReadiness,
  evaluateProvisioningReadiness,
  provisioningIdentity,
  toSafeProvisioningDto,
} from '@ks-os/workspace-provisioning';
import { ProvisionWorkspacePayloadSchema } from '@ks-os/site-jobs';
import type { z } from 'zod';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';
import { SiteService } from '../sites/site.service.js';
import { SiteJobEnqueueService } from '../sites/site-job-enqueue.service.js';
import { AgencySiteJobService } from '../sites/site-job.service.js';

type Database = ReturnType<typeof getDatabase>;
type CreateDraft = z.infer<typeof CreateProvisioningDraftSchema>;
type UpdateDraft = z.infer<typeof UpdateProvisioningDraftSchema>;
type StartRun = z.infer<typeof StartProvisioningRunSchema>;

const fail = (statusCode: number, code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const values = (brief: unknown, mapping: string): unknown[] => {
  const verified = record(record(brief).verifiedFacts);
  const value = verified[mapping];
  return Array.isArray(value) ? value : [];
};

function flattenedLabels(input: unknown[]) {
  const output: string[] = [];
  for (const item of input) {
    if (typeof item === 'string' && item.trim()) output.push(item.trim());
    else if (Array.isArray(item)) {
      for (const child of item) {
        if (typeof child === 'string' && child.trim()) output.push(child.trim());
        else if (child && typeof child === 'object' && typeof (child as { label?: unknown }).label === 'string') {
          output.push(String((child as { label: string }).label).trim());
        }
      }
    }
  }
  return [...new Set(output.filter(Boolean))];
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

export class ProvisioningService {
  private readonly audit: AgencyAuditService;
  private readonly sites: SiteService;
  private readonly jobs: SiteJobEnqueueService;
  private readonly jobOperations: AgencySiteJobService;

  constructor(
    private readonly db: Database = getDatabase(),
    audit = new AgencyAuditService(),
  ) {
    this.audit = audit;
    this.sites = new SiteService(db, audit);
    this.jobs = new SiteJobEnqueueService(db, new Set(['PROVISION_WORKSPACE']), audit);
    this.jobOperations = new AgencySiteJobService(db, audit);
  }

  async createDraft(actor: AgencyActor, input: CreateDraft) {
    const parsed = CreateProvisioningDraftSchema.parse(input);
    const context = await this.resolveDraftReferences(parsed);
    const [latest] = await this.db.select({ value: sql<number>`coalesce(max(${provisioningDrafts.draftVersion}), 0)::int` })
      .from(provisioningDrafts).where(eq(provisioningDrafts.tenantId, context.tenantId));
    const [draft] = await this.db.insert(provisioningDrafts).values({
      tenantId: context.tenantId,
      productionBriefId: context.briefId,
      planVersionId: context.planVersionId,
      templateVersionId: context.templateVersionId,
      draftVersion: Number(latest?.value || 0) + 1,
      workspaceJson: parsed.workspace,
      pagePlanJson: parsed.pagePlan,
      paymentPreferenceJson: parsed.paymentPreference,
      createdByAgencyUserId: actor.agencyUserId,
    }).returning();
    await this.audit.write(actor, 'PROVISIONING_DRAFT_CREATED', 'PROVISIONING_DRAFT', draft.publicReference, {
      tenantId: draft.tenantId,
      metadata: { draftVersion: draft.draftVersion, productionBriefReference: parsed.productionBriefReference },
    });
    return this.getDraft(draft.publicReference);
  }

  async getDraft(reference: string) {
    const context = await this.draftContext(reference);
    return toSafeProvisioningDto({
      reference: context.draft.publicReference,
      tenantReference: context.tenantReference,
      tenantName: context.tenantName,
      status: context.draft.status,
      version: context.draft.draftVersion,
      productionBriefReference: context.briefReference,
      productionBriefVersion: context.briefVersion,
      plan: {
        key: context.planKey,
        name: context.planName,
        version: context.planVersion,
        versionReference: context.planVersionId,
        monthlyPriceMinor: context.monthlyPriceMinor,
        setupFeeAmountMinor: context.setupFeeAmountMinor,
        currency: context.planCurrency,
      },
      templateVersionReference: context.templateReference,
      templateSourceType: context.templateSourceType,
      workspace: context.draft.workspaceJson,
      pagePlan: context.draft.pagePlanJson,
      paymentPreference: context.draft.paymentPreferenceJson,
      validation: context.draft.validationJson,
      validatedAt: context.draft.validatedAt,
      createdAt: context.draft.createdAt,
      updatedAt: context.draft.updatedAt,
    });
  }

  async updateDraft(actor: AgencyActor, reference: string, input: UpdateDraft) {
    const current = await this.draftContext(reference);
    if (!['DRAFT', 'VALIDATING', 'READY_TO_PROVISION'].includes(current.draft.status)) {
      throw fail(409, 'PROVISIONING_DRAFT_LOCKED', 'A provisioning draft cannot change after provisioning begins.');
    }
    const merged = CreateProvisioningDraftSchema.parse({
      productionBriefReference: input.productionBriefReference || current.briefReference,
      planVersionReference: input.planVersionReference || current.planVersionId,
      workspace: { ...record(current.draft.workspaceJson), ...input.workspace },
      templateVersionReference: input.templateVersionReference || current.templateReference,
      pagePlan: { ...record(current.draft.pagePlanJson), ...input.pagePlan },
      paymentPreference: { ...record(current.draft.paymentPreferenceJson), ...input.paymentPreference },
    });
    const resolved = await this.resolveDraftReferences(merged, current.tenantId);
    const [updated] = await this.db.update(provisioningDrafts).set({
      productionBriefId: resolved.briefId,
      planVersionId: resolved.planVersionId,
      templateVersionId: resolved.templateVersionId,
      workspaceJson: merged.workspace,
      pagePlanJson: merged.pagePlan,
      paymentPreferenceJson: merged.paymentPreference,
      status: 'DRAFT',
      validationJson: {},
      validatedAt: null,
      validatedByAgencyUserId: null,
      updatedAt: new Date(),
    }).where(eq(provisioningDrafts.id, current.draft.id)).returning();
    await this.audit.write(actor, 'PROVISIONING_DRAFT_UPDATED', 'PROVISIONING_DRAFT', reference, {
      tenantId: updated.tenantId,
      metadata: { fields: Object.keys(input) },
    });
    return this.getDraft(reference);
  }

  async validateDraft(actor: AgencyActor, reference: string) {
    const context = await this.draftContext(reference);
    if (!['DRAFT', 'VALIDATING', 'READY_TO_PROVISION'].includes(context.draft.status)) {
      throw fail(409, 'PROVISIONING_DRAFT_LOCKED', 'This draft is no longer available for validation.');
    }
    const assessment = await this.assess(context);
    const status = assessment.ready ? 'READY_TO_PROVISION' : 'DRAFT';
    await this.db.update(provisioningDrafts).set({
      status,
      validationJson: assessment,
      validatedByAgencyUserId: actor.agencyUserId,
      validatedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(provisioningDrafts.id, context.draft.id));
    await this.audit.write(actor, 'PROVISIONING_VALIDATED', 'PROVISIONING_DRAFT', reference, {
      tenantId: context.tenantId,
      metadata: { ready: assessment.ready, blockerCodes: assessment.blockingIssues.map(issue => issue.code) },
    });
    return { reference, status, ...assessment };
  }

  async start(actor: AgencyActor, input: StartRun) {
    const parsed = StartProvisioningRunSchema.parse(input);
    const context = await this.draftContext(parsed.provisioningDraftReference);
    const assessment = await this.assess(context);
    if (!assessment.ready || context.draft.status !== 'READY_TO_PROVISION') {
      throw fail(409, 'PROVISIONING_DRAFT_NOT_READY', 'Validate and resolve every blocking issue before provisioning.', assessment);
    }
    if (context.briefStatus !== 'LOCKED_FOR_PROVISIONING') {
      throw fail(409, 'PRODUCTION_BRIEF_NOT_LOCKED', 'Provisioning requires an approved locked production brief.');
    }
    const identity = provisioningIdentity({
      draftReference: context.draft.publicReference,
      productionBriefReference: context.briefReference,
      productionBriefDigestSha256: context.briefDigest,
      idempotencyKey: parsed.idempotencyKey,
    });
    const [existing] = await this.db.select({ reference: provisioningRuns.publicReference })
      .from(provisioningRuns).where(eq(provisioningRuns.identityDigestSha256, identity)).limit(1);
    if (existing) return { ...(await this.getRun(existing.reference)), idempotentReplay: true };

    const site = await this.sites.create(actor, {
      tenantReference: context.tenantBusinessReference,
      displayName: `${record(context.draft.workspaceJson).name || context.tenantName} website`,
      idempotencyKey: `provisioning:${context.draft.publicReference}`,
    });
    const [actorRow] = await this.db.select({ reference: agencyUsers.publicReference })
      .from(agencyUsers).where(and(eq(agencyUsers.id, actor.agencyUserId), eq(agencyUsers.status, 'ACTIVE'))).limit(1);
    if (!actorRow) throw fail(403, 'AGENCY_ACCESS_DENIED', 'The agency actor is not active.');

    const run = await this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`provisioning:${identity}`}::text, 0))`);
      const [replay] = await tx.select({ reference: provisioningRuns.publicReference })
        .from(provisioningRuns).where(eq(provisioningRuns.identityDigestSha256, identity)).limit(1);
      if (replay) return { reference: replay.reference, replay: true as const };
      const [siteRow] = await tx.select({ id: sites.id }).from(sites)
        .where(and(eq(sites.publicReference, site.reference), eq(sites.tenantId, context.tenantId))).limit(1);
      if (!siteRow) throw fail(409, 'PROVISIONING_SITE_MISSING', 'The managed site could not be resolved.');
      const [created] = await tx.insert(provisioningRuns).values({
        tenantId: context.tenantId,
        provisioningDraftId: context.draft.id,
        questionnaireId: context.questionnaireId,
        questionnaireVersion: context.questionnaireVersion,
        responseVersion: context.responseVersion,
        productionBriefId: context.briefId,
        productionBriefVersion: context.briefVersion,
        productionBriefDigestSha256: context.briefDigest,
        approvedFactSetDigestSha256: context.factDigest,
        approvedAssetSetDigestSha256: context.assetDigest,
        planVersionId: context.planVersionId,
        templateVersionId: context.templateVersionId,
        siteId: siteRow.id,
        status: 'QUEUED',
        idempotencyKey: parsed.idempotencyKey,
        identityDigestSha256: identity,
        currentStep: 'VALIDATE_DRAFT',
        requestedByAgencyUserId: actor.agencyUserId,
      }).returning();
      await tx.insert(provisioningRunSteps).values(PROVISIONING_STEPS.map((stepKey, sequence) => ({
        provisioningRunId: created.id,
        tenantId: context.tenantId,
        stepKey,
        sequence: sequence + 1,
        idempotencyKey: canonicalStepIdempotencyKey(created.publicReference, stepKey),
      })));
      await tx.insert(provisioningActivity).values({
        provisioningRunId: created.id,
        tenantId: context.tenantId,
        eventType: 'WORKSPACE_PROVISIONING_REQUESTED',
        statusTo: 'QUEUED',
        stepKey: 'VALIDATE_DRAFT',
        safeMessage: 'An authorised agency user requested workspace provisioning.',
        agencyUserId: actor.agencyUserId,
      });
      await tx.update(provisioningDrafts).set({ status: 'PROVISIONING', updatedAt: new Date() })
        .where(eq(provisioningDrafts.id, context.draft.id));
      return { reference: created.publicReference, replay: false as const };
    });
    if (run.replay) return { ...(await this.getRun(run.reference)), idempotentReplay: true };

    try {
      const job = await this.jobs.enqueue(actor, {
        tenantReference: context.tenantBusinessReference,
        siteReference: site.reference,
        jobType: 'PROVISION_WORKSPACE',
        payload: ProvisionWorkspacePayloadSchema.parse({
          jobType: 'PROVISION_WORKSPACE',
          siteReference: site.reference,
          provisioningRunReference: run.reference,
          provisioningDraftReference: context.draft.publicReference,
          productionBriefReference: context.briefReference,
          productionBriefDigestSha256: context.briefDigest,
          requestedByAgencyUserReference: actorRow.reference,
        }),
        sourceReference: context.briefReference,
        sourceDigestSha256: context.briefDigest,
        operationVersion: 1,
        maxAttempts: 5,
        priority: 20,
      });
      const [jobRow] = await this.db.select({ id: siteJobs.id }).from(siteJobs)
        .where(eq(siteJobs.publicReference, job.reference)).limit(1);
      if (!jobRow) throw fail(503, 'PROVISIONING_JOB_MISSING', 'The durable provisioning job could not be resolved.');
      await this.db.update(provisioningRuns).set({ siteJobId: jobRow.id, updatedAt: new Date() })
        .where(eq(provisioningRuns.publicReference, run.reference));
    } catch (error) {
      await this.db.update(provisioningRuns).set({
        status: 'FAILED', failureCode: 'PROVISIONING_JOB_ENQUEUE_FAILED',
        failureMessage: 'The durable provisioning job could not be queued.', retryable: true,
        failedAt: new Date(), updatedAt: new Date(),
      }).where(eq(provisioningRuns.publicReference, run.reference));
      throw error;
    }
    await this.audit.write(actor, 'WORKSPACE_PROVISIONING_REQUESTED', 'PROVISIONING_RUN', run.reference, {
      tenantId: context.tenantId,
      metadata: { draftReference: context.draft.publicReference, siteReference: site.reference },
    });
    return { ...(await this.getRun(run.reference)), idempotentReplay: false };
  }

  async getRun(reference: string) {
    const [run] = await this.db.select({
      id: provisioningRuns.id,
      reference: provisioningRuns.publicReference,
      tenantReference: tenants.agencyReference,
      tenantBusinessReference: tenants.businessReference,
      tenantName: tenants.name,
      draftReference: provisioningDrafts.publicReference,
      briefReference: productionBriefs.publicReference,
      siteReference: sites.publicReference,
      blueprintReference: siteBlueprints.publicReference,
      generationReference: siteGenerationRuns.publicReference,
      reviewReference: siteReviewCycles.publicReference,
      previewSessionReference: siteReviewSessions.publicReference,
      jobReference: siteJobs.publicReference,
      status: provisioningRuns.status,
      currentStep: provisioningRuns.currentStep,
      completionPercentage: provisioningRuns.completionPercentage,
      failureCode: provisioningRuns.failureCode,
      failureMessage: provisioningRuns.failureMessage,
      retryable: provisioningRuns.retryable,
      attemptCount: provisioningRuns.attemptCount,
      startedAt: provisioningRuns.startedAt,
      completedAt: provisioningRuns.completedAt,
      failedAt: provisioningRuns.failedAt,
      cancelledAt: provisioningRuns.cancelledAt,
      createdAt: provisioningRuns.createdAt,
      updatedAt: provisioningRuns.updatedAt,
    }).from(provisioningRuns)
      .innerJoin(tenants, eq(provisioningRuns.tenantId, tenants.id))
      .innerJoin(provisioningDrafts, eq(provisioningRuns.provisioningDraftId, provisioningDrafts.id))
      .innerJoin(productionBriefs, eq(provisioningRuns.productionBriefId, productionBriefs.id))
      .leftJoin(sites, eq(provisioningRuns.siteId, sites.id))
      .leftJoin(siteBlueprints, eq(provisioningRuns.blueprintId, siteBlueprints.id))
      .leftJoin(siteGenerationRuns, eq(provisioningRuns.generationRunId, siteGenerationRuns.id))
      .leftJoin(siteReviewCycles, eq(provisioningRuns.reviewCycleId, siteReviewCycles.id))
      .leftJoin(siteReviewSessions, eq(provisioningRuns.previewSessionId, siteReviewSessions.id))
      .leftJoin(siteJobs, eq(provisioningRuns.siteJobId, siteJobs.id))
      .where(eq(provisioningRuns.publicReference, reference)).limit(1);
    if (!run) throw fail(404, 'PROVISIONING_RUN_NOT_FOUND', 'Provisioning run was not found.');
    const steps = await this.db.select({
      reference: provisioningRunSteps.publicReference,
      key: provisioningRunSteps.stepKey,
      sequence: provisioningRunSteps.sequence,
      status: provisioningRunSteps.status,
      attemptCount: provisioningRunSteps.attemptCount,
      safeMessage: provisioningRunSteps.safeMessage,
      failureCode: provisioningRunSteps.failureCode,
      outputReferences: provisioningRunSteps.outputReferencesJson,
      startedAt: provisioningRunSteps.startedAt,
      completedAt: provisioningRunSteps.completedAt,
    }).from(provisioningRunSteps).where(eq(provisioningRunSteps.provisioningRunId, run.id))
      .orderBy(asc(provisioningRunSteps.sequence));
    return toSafeProvisioningDto({ ...run, steps, ready: run.status === 'READY' });
  }

  async retry(actor: AgencyActor, reference: string, input: z.infer<typeof ProvisioningActionReasonSchema>) {
    const run = await this.runOperationContext(reference);
    if (!['FAILED', 'PARTIALLY_FAILED', 'ACTION_REQUIRED'].includes(run.status) || !run.jobReference) {
      throw fail(409, 'PROVISIONING_NOT_RETRYABLE', 'Only a failed or action-required provisioning run can be retried.');
    }
    await this.jobOperations.retry(actor, run.jobReference, input.reason);
    await this.db.update(provisioningRuns).set({
      status: 'QUEUED', failureCode: null, failureMessage: null, retryable: null,
      failedAt: null, currentStep: run.failedStep || run.currentStep || 'VALIDATE_DRAFT',
      attemptCount: sql`${provisioningRuns.attemptCount} + 1`, updatedAt: new Date(),
    }).where(eq(provisioningRuns.id, run.id));
    await this.audit.write(actor, 'WORKSPACE_PROVISIONING_RETRIED', 'PROVISIONING_RUN', reference, {
      tenantId: run.tenantId, reason: input.reason, metadata: { failedStep: run.failedStep },
    });
    return this.getRun(reference);
  }

  async cancel(actor: AgencyActor, reference: string, input: z.infer<typeof ProvisioningActionReasonSchema>) {
    const run = await this.runOperationContext(reference);
    if (['READY', 'CANCELLED'].includes(run.status) || !run.jobReference) {
      throw fail(409, 'PROVISIONING_NOT_CANCELLABLE', 'This provisioning run cannot be cancelled.');
    }
    const cancelled = await this.jobOperations.cancel(actor, run.jobReference, input.reason);
    const status = cancelled.status === 'CANCELLED' ? 'CANCELLED' : 'CANCEL_REQUESTED';
    await this.db.update(provisioningRuns).set({
      status,
      cancelledByAgencyUserId: actor.agencyUserId,
      ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      updatedAt: new Date(),
    }).where(eq(provisioningRuns.id, run.id));
    await this.audit.write(actor, 'WORKSPACE_PROVISIONING_CANCELLED', 'PROVISIONING_RUN', reference, {
      tenantId: run.tenantId, reason: input.reason, metadata: { status },
    });
    return this.getRun(reference);
  }

  async readiness(tenantReference: string) {
    const [tenant] = await this.db.select({ id: tenants.id, reference: tenants.agencyReference })
      .from(tenants).where(or(eq(tenants.agencyReference, tenantReference), eq(tenants.businessReference, tenantReference))).limit(1);
    if (!tenant) throw fail(404, 'TENANT_NOT_FOUND', 'Tenant was not found.');
    const [serviceRows, locationRows, staffRows, schedules, booking, site, blueprint, generation, review, payment, run] = await Promise.all([
      this.db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, tenant.id), eq(services.isActive, true))),
      this.db.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenant.id), eq(locations.isActive, true))),
      this.db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenant.id), eq(users.accountStatus, 'ACTIVE'), eq(users.bookingEnabled, true))),
      this.db.select({ id: staffSchedules.id }).from(staffSchedules).where(eq(staffSchedules.tenantId, tenant.id)).limit(1),
      this.db.select({ id: bookingPages.id, enabled: bookingPages.enabled }).from(bookingPages).where(eq(bookingPages.tenantId, tenant.id)).limit(1),
      this.db.select({ id: sites.id, status: sites.status }).from(sites).where(eq(sites.tenantId, tenant.id)).limit(1),
      this.db.select({ id: siteBlueprints.id, status: siteBlueprints.status }).from(siteBlueprints).where(eq(siteBlueprints.tenantId, tenant.id)).orderBy(desc(siteBlueprints.revision)).limit(1),
      this.db.select({ id: siteGenerationRuns.id, status: siteGenerationRuns.status }).from(siteGenerationRuns).where(eq(siteGenerationRuns.tenantId, tenant.id)).orderBy(desc(siteGenerationRuns.createdAt)).limit(1),
      this.db.select({ id: siteReviewCycles.id, status: siteReviewCycles.status }).from(siteReviewCycles).where(eq(siteReviewCycles.tenantId, tenant.id)).orderBy(desc(siteReviewCycles.createdAt)).limit(1),
      this.db.select().from(stripeConnections).where(eq(stripeConnections.tenantId, tenant.id)).limit(1),
      this.db.select({ status: provisioningRuns.status }).from(provisioningRuns).where(eq(provisioningRuns.tenantId, tenant.id)).orderBy(desc(provisioningRuns.createdAt)).limit(1),
    ]);
    const paymentStatus = safePaymentStatus(payment[0]);
    const bookingReady = serviceRows.length > 0 && locationRows.length > 0 && staffRows.length > 0 && schedules.length > 0 && Boolean(booking[0]?.enabled);
    const websiteReady = Boolean(site[0] && blueprint[0]?.status === 'APPROVED' && ['READY_FOR_REVIEW', 'COMPLETED'].includes(generation[0]?.status || ''));
    const reviewReady = Boolean(review[0] && !['CANCELLED', 'SUPERSEDED', 'REJECTED'].includes(review[0].status));
    const workspaceReady = run[0]?.status === 'READY';
    const blockingIssues: Array<{ code: string; area: 'WORKSPACE' | 'BOOKING' | 'WEBSITE' | 'REVIEW' | 'PAYMENTS'; message: string }> = [];
    if (!bookingReady) blockingIssues.push({ code: 'BOOKING_NOT_READY', area: 'BOOKING', message: 'Canonical service, location, staff, availability, and booking records are incomplete.' });
    if (!websiteReady) blockingIssues.push({ code: 'WEBSITE_DRAFT_NOT_READY', area: 'WEBSITE', message: 'The generated structured website draft is not ready.' });
    if (!reviewReady) blockingIssues.push({ code: 'INTERNAL_REVIEW_NOT_READY', area: 'REVIEW', message: 'The internal agency review cycle is not ready.' });
    const warnings = paymentStatus === 'READY' ? [] : [{ code: 'PAYMENT_ACTION_REQUIRED', area: 'PAYMENTS' as const, message: 'Merchant payment onboarding remains outstanding; pay-later may remain available.' }];
    return combinedReadiness({ workspaceReady, bookingReady, websiteReady, reviewReady, paymentStatus, blockingIssues, warnings });
  }

  private async resolveDraftReferences(input: CreateDraft, expectedTenantId?: string) {
    const [brief] = await this.db.select({
      id: productionBriefs.id,
      tenantId: productionBriefs.tenantId,
    }).from(productionBriefs).where(eq(productionBriefs.publicReference, input.productionBriefReference)).limit(1);
    if (!brief || (expectedTenantId && brief.tenantId !== expectedTenantId)) {
      throw fail(404, 'PRODUCTION_BRIEF_NOT_FOUND', 'The production brief was not found for this tenant.');
    }
    const [plan] = await this.db.select({ id: platformPlanVersions.id }).from(platformPlanVersions)
      .innerJoin(platformPlans, eq(platformPlanVersions.planId, platformPlans.id))
      .where(and(eq(platformPlanVersions.id, input.planVersionReference), eq(platformPlanVersions.status, 'ACTIVE'), inArray(platformPlans.key, ['CORE', 'GROWTH', 'SCALE']))).limit(1);
    if (!plan) throw fail(400, 'PLAN_VERSION_INVALID', 'An active Core, Growth, or Scale plan version is required.');
    const [template] = await this.db.select({ id: templateVersions.id }).from(templateVersions)
      .where(eq(templateVersions.publicReference, input.templateVersionReference)).limit(1);
    if (!template) throw fail(404, 'TEMPLATE_VERSION_NOT_FOUND', 'Template version was not found.');
    return { tenantId: brief.tenantId, briefId: brief.id, planVersionId: plan.id, templateVersionId: template.id };
  }

  private async draftContext(reference: string) {
    const [row] = await this.db.select({
      draft: provisioningDrafts,
      tenantId: tenants.id,
      tenantReference: tenants.agencyReference,
      tenantBusinessReference: tenants.businessReference,
      tenantName: tenants.name,
      tenantLifecycleStatus: tenants.lifecycleStatus,
      questionnaireId: factFindingQuestionnaires.id,
      questionnaireVersion: productionBriefs.questionnaireVersion,
      responseVersion: productionBriefs.responseVersion,
      briefId: productionBriefs.id,
      briefReference: productionBriefs.publicReference,
      briefVersion: productionBriefs.briefVersion,
      briefStatus: productionBriefs.status,
      briefJson: productionBriefs.briefJson,
      briefReadiness: productionBriefs.readinessJson,
      briefDigest: productionBriefs.contentDigestSha256,
      factDigest: productionBriefs.approvedFactSetDigestSha256,
      assetDigest: productionBriefs.approvedAssetSetDigestSha256,
      planVersionId: platformPlanVersions.id,
      planVersion: platformPlanVersions.version,
      planStatus: platformPlanVersions.status,
      planKey: platformPlans.key,
      planName: platformPlanVersions.name,
      monthlyPriceMinor: platformPlanVersions.monthlyPriceMinor,
      setupFeeAmountMinor: platformPlanVersions.setupFeeAmountMinor,
      planCurrency: platformPlanVersions.currency,
      templateVersionId: templateVersions.id,
      templateReference: templateVersions.publicReference,
      templateStatus: templateVersions.status,
      templateAnalysisStatus: templateVersions.analysisStatus,
      templateSourceId: templateSources.id,
      templateSourceType: templateSources.sourceType,
    }).from(provisioningDrafts)
      .innerJoin(tenants, eq(provisioningDrafts.tenantId, tenants.id))
      .innerJoin(productionBriefs, eq(provisioningDrafts.productionBriefId, productionBriefs.id))
      .innerJoin(factFindingQuestionnaires, eq(productionBriefs.questionnaireId, factFindingQuestionnaires.id))
      .innerJoin(platformPlanVersions, eq(provisioningDrafts.planVersionId, platformPlanVersions.id))
      .innerJoin(platformPlans, eq(platformPlanVersions.planId, platformPlans.id))
      .innerJoin(templateVersions, eq(provisioningDrafts.templateVersionId, templateVersions.id))
      .innerJoin(templateSources, eq(templateVersions.templateSourceId, templateSources.id))
      .where(eq(provisioningDrafts.publicReference, reference)).limit(1);
    if (!row) throw fail(404, 'PROVISIONING_DRAFT_NOT_FOUND', 'Provisioning draft was not found.');
    return row;
  }

  private async assess(context: Awaited<ReturnType<ProvisioningService['draftContext']>>) {
    const pagePlan = record(context.draft.pagePlanJson);
    const requested = Array.isArray(pagePlan.requestedPageTypes) ? pagePlan.requestedPageTypes.filter(item => typeof item === 'string') : [];
    const marketingPageCount = requested.filter(item => MARKETING_TYPES.has(item)).length;
    const [entitlement, assignment, licence, payment] = await Promise.all([
      this.db.select({ value: platformPlanEntitlements.valueJson }).from(platformPlanEntitlements)
        .where(and(eq(platformPlanEntitlements.planVersionId, context.planVersionId), eq(platformPlanEntitlements.entitlementKey, 'sites.initial_marketing_pages'))).limit(1),
      this.db.select({ id: tenantPlanAssignments.id }).from(tenantPlanAssignments)
        .where(and(eq(tenantPlanAssignments.tenantId, context.tenantId), eq(tenantPlanAssignments.planVersionId, context.planVersionId), eq(tenantPlanAssignments.status, 'ACTIVE'))).limit(1),
      context.templateSourceType === 'ENVATO_HTML'
        ? this.db.select({ id: templateLicenses.id }).from(templateLicenses).where(and(
          eq(templateLicenses.templateSourceId, context.templateSourceId),
          or(eq(templateLicenses.templateVersionId, context.templateVersionId), isNull(templateLicenses.templateVersionId)),
          or(eq(templateLicenses.tenantId, context.tenantId), isNull(templateLicenses.tenantId)),
          eq(templateLicenses.status, 'ACTIVE'),
        )).limit(1)
        : Promise.resolve([{ id: 'not-required' }]),
      this.db.select().from(stripeConnections).where(eq(stripeConnections.tenantId, context.tenantId)).limit(1),
    ]);
    const limit = Number((record(entitlement[0]?.value).limit));
    const briefReadiness = record(context.briefReadiness);
    const services = flattenedLabels(values(context.briefJson, 'SERVICE.NAME'));
    const locations = flattenedLabels(values(context.briefJson, 'LOCATION.NAME'));
    const staff = flattenedLabels(values(context.briefJson, 'STAFF.NAME'));
    const durations = values(context.briefJson, 'SERVICE.DURATION');
    const prices = values(context.briefJson, 'SERVICE.PRICE');
    const hours = values(context.briefJson, 'LOCATION.OPENING_HOURS').concat(values(context.briefJson, 'STAFF.AVAILABILITY'));
    const bookingFacts = Object.keys(record(record(context.briefJson).verifiedFacts)).filter(key => key.startsWith('BOOKING.'));
    const paymentPreference = record(context.draft.paymentPreferenceJson);
    const paymentStatus = safePaymentStatus(payment[0]);
    const assessment = evaluateProvisioningReadiness({
      productionBriefLocked: context.briefStatus === 'LOCKED_FOR_PROVISIONING',
      productionBriefReady: briefReadiness.readyForProvisioning === true,
      planResolved: context.planStatus === 'ACTIVE' && ['CORE', 'GROWTH', 'SCALE'].includes(context.planKey) && Boolean(assignment[0]),
      entitlementPageLimit: Number.isInteger(limit) ? limit : -1,
      requestedMarketingPageCount: marketingPageCount,
      approvedTemplate: context.templateStatus === 'APPROVED' && context.templateAnalysisStatus === 'APPROVED',
      templateLicensed: licence.length > 0,
      locationCount: locations.length,
      approvedRemoteServiceConfiguration: Boolean(values(context.briefJson, 'LOCATION.SERVICE_AREA').length && !locations.length),
      bookableServiceCount: services.length && durations.length && prices.length ? services.length : 0,
      eligibleStaffCount: staff.length,
      staffRequired: staff.length > 0,
      validAvailability: hours.length > 0,
      bookingConfigurationPresent: bookingFacts.length > 0,
      nativeBookingOnly: true,
      validBookingPath: services.length > 0 && (locations.length > 0 || staff.length > 0),
      requiredFormsPresent: values(context.briefJson, 'SERVICE.INTAKE_REQUIREMENTS').length === 0 || values(context.briefJson, 'SERVICE.INTAKE_REQUIREMENTS').some(Boolean),
      paymentStatus,
      payLaterAllowed: paymentPreference.allowPayLater === true,
    });
    if (!Number.isInteger(limit)) assessment.blockingIssues.push({ code: 'PAGE_ENTITLEMENT_UNAVAILABLE', area: 'WEBSITE', message: 'The selected plan has no valid marketing-page entitlement.' });
    if (durations.some(value => typeof value !== 'number' || !Number.isInteger(value) || value < 5)) assessment.blockingIssues.push({ code: 'INVALID_SERVICE_DURATION', area: 'BOOKING', message: 'Every service duration must be a valid number of minutes.' });
    if (prices.some(value => !value || typeof value !== 'object' || !Number.isInteger(Number((value as { amountMinor?: unknown }).amountMinor)))) assessment.blockingIssues.push({ code: 'INVALID_SERVICE_PRICE', area: 'BOOKING', message: 'Every service price must use validated minor currency units.' });
    assessment.ready = assessment.blockingIssues.length === 0;
    return { ...assessment, signals: { marketingPageCount, entitlementPageLimit: limit, serviceCount: services.length, locationCount: locations.length, staffCount: staff.length, paymentStatus } };
  }

  private async runOperationContext(reference: string) {
    const [row] = await this.db.select({
      id: provisioningRuns.id,
      tenantId: provisioningRuns.tenantId,
      status: provisioningRuns.status,
      currentStep: provisioningRuns.currentStep,
      jobReference: siteJobs.publicReference,
      failedStep: provisioningRunSteps.stepKey,
    }).from(provisioningRuns)
      .leftJoin(siteJobs, eq(provisioningRuns.siteJobId, siteJobs.id))
      .leftJoin(provisioningRunSteps, and(eq(provisioningRunSteps.provisioningRunId, provisioningRuns.id), eq(provisioningRunSteps.status, 'FAILED')))
      .where(eq(provisioningRuns.publicReference, reference)).limit(1);
    if (!row) throw fail(404, 'PROVISIONING_RUN_NOT_FOUND', 'Provisioning run was not found.');
    return row;
  }
}
