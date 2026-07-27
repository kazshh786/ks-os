import { createHash } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  getDatabase,
  inArray,
  isNull,
  or,
  sql,
} from '@ks-os/database';
import {
  agencyUsers,
  knowledgePacks,
  knowledgePagePlaybooks,
  knowledgeRules,
  knowledgeSectionPlaybooks,
  siteFactVerifications,
  siteJobs,
  sitePages,
  siteQualityChecks,
  siteQualityEvidence,
  siteQualityFindings,
  siteQualityHumanReviews,
  siteQualityRemediationEvents,
  siteQualityRunComparisons,
  siteQualityRuns,
  siteQualityWaivers,
  siteRenderSnapshots,
  siteReviewCycles,
  siteReviewItems,
  siteSections,
  siteVersions,
  sites,
  templateLicenses,
  tenants,
} from '@ks-os/database';
import type { SiteJobPayload, SiteJobType } from '@ks-os/site-jobs';
import {
  CreateSiteQualityRunSchema,
  DEFAULT_PUBLICATION_POLICY_VERSION,
  SITE_QUALITY_ENGINE_VERSION,
  SITE_QUALITY_RENDERER_VERSION,
  SiteQualityAuditTypeSchema,
  SiteQualityHumanReviewDecisionSchema,
  SiteQualityWaiverDecisionSchema,
  assertFindingMayBeWaived,
  checksForAuditType,
  compareQualityRuns,
  evaluatePublicationReadiness,
  isNonWaivableFinding,
  qualityCheckById,
  summarizeCategoryFindings,
  type CreateSiteQualityRunInput,
  type PublicationReadinessFinding,
  type SiteQualityAuditType,
} from '@ks-os/site-quality';
import type { z } from 'zod';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';
import { SiteJobEnqueueService } from './site-job-enqueue.service.js';
import { AgencySiteJobService } from './site-job.service.js';
import { SiteReviewService } from './site-review.service.js';

type Database = ReturnType<typeof getDatabase>;
type WaiverInput = z.infer<typeof SiteQualityWaiverDecisionSchema>;
type HumanReviewInput = z.infer<typeof SiteQualityHumanReviewDecisionSchema>;

const QUALITY_JOB_TYPES = new Set<SiteJobType>([
  'RUN_FULL_SITE_QUALITY_AUDIT',
  'RUN_TECHNICAL_SEO_AUDIT',
  'RUN_ACCESSIBILITY_AUDIT',
  'RUN_RESPONSIVE_UX_AUDIT',
  'RUN_CONVERSION_AUDIT',
  'RUN_BOOKING_INTEGRITY_AUDIT',
  'RUN_PERFORMANCE_AUDIT',
  'RUN_CONTENT_INTEGRITY_AUDIT',
  'RUN_ASSET_READINESS_AUDIT',
  'EVALUATE_PUBLICATION_READINESS',
]);

const qualityJobByAudit: Record<SiteQualityAuditType, SiteJobType> = {
  FULL_SITE_QUALITY: 'RUN_FULL_SITE_QUALITY_AUDIT',
  TECHNICAL_SEO: 'RUN_TECHNICAL_SEO_AUDIT',
  ON_PAGE_SEO: 'RUN_TECHNICAL_SEO_AUDIT',
  LOCAL_SEO: 'RUN_TECHNICAL_SEO_AUDIT',
  STRUCTURED_DATA: 'RUN_TECHNICAL_SEO_AUDIT',
  ACCESSIBILITY: 'RUN_ACCESSIBILITY_AUDIT',
  RESPONSIVE_UX: 'RUN_RESPONSIVE_UX_AUDIT',
  CONVERSION: 'RUN_CONVERSION_AUDIT',
  BOOKING_INTEGRITY: 'RUN_BOOKING_INTEGRITY_AUDIT',
  CONTENT_INTEGRITY: 'RUN_CONTENT_INTEGRITY_AUDIT',
  PERFORMANCE: 'RUN_PERFORMANCE_AUDIT',
  INTERNAL_LINKING: 'RUN_TECHNICAL_SEO_AUDIT',
  ASSET_READINESS: 'RUN_ASSET_READINESS_AUDIT',
  PUBLICATION_READINESS: 'EVALUATE_PUBLICATION_READINESS',
};

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

const digest = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

const currentFindingStatuses = [
  'OPEN',
  'ACKNOWLEDGED',
  'IN_REMEDIATION',
] as const;

function safeRun(row: {
  publicReference: string;
  tenantReference: string;
  siteReference: string;
  versionReference: string;
  knowledgePackReference: string;
  knowledgePackSemanticVersion: string;
  siteVersionDigestSha256: string;
  knowledgePackDigestSha256: string;
  ruleSelectionDigestSha256: string;
  auditType: string;
  auditReason: string;
  status: string;
  policyVersion: string;
  rendererVersion: string;
  qualityEngineVersion: string;
  pageCountPlanned: number;
  pageCountCompleted: number;
  checkCount: number;
  passedCheckCount: number;
  warningCount: number;
  blockingCount: number;
  waivedCount: number;
  nonWaivableCount: number;
  publicationGateStatus: string;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  failedAt: Date | null;
  staleAt: Date | null;
  staleReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  jobReference: string | null;
  jobStatus: string | null;
}) {
  return {
    reference: row.publicReference,
    tenantReference: row.tenantReference,
    siteReference: row.siteReference,
    siteVersionReference: row.versionReference,
    siteVersionDigest: row.siteVersionDigestSha256,
    knowledgePack: {
      reference: row.knowledgePackReference,
      semanticVersion: row.knowledgePackSemanticVersion,
      digest: row.knowledgePackDigestSha256,
    },
    ruleSelectionDigest: row.ruleSelectionDigestSha256,
    auditType: row.auditType,
    reason: row.auditReason,
    status: row.status,
    policyVersion: row.policyVersion,
    rendererVersion: row.rendererVersion,
    qualityEngineVersion: row.qualityEngineVersion,
    pageCountPlanned: row.pageCountPlanned,
    pageCountCompleted: row.pageCountCompleted,
    checkCount: row.checkCount,
    passedCheckCount: row.passedCheckCount,
    warningCount: row.warningCount,
    blockingCount: row.blockingCount,
    waivedCount: row.waivedCount,
    nonWaivableCount: row.nonWaivableCount,
    publicationGateStatus: row.publicationGateStatus,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    job: row.jobReference
      ? { reference: row.jobReference, status: row.jobStatus }
      : null,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    failedAt: row.failedAt,
    staleAt: row.staleAt,
    staleReason: row.staleReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SiteQualityService {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
    private readonly enqueue = new SiteJobEnqueueService(
      database,
      QUALITY_JOB_TYPES,
    ),
    private readonly jobs = new AgencySiteJobService(database, audit),
    private readonly reviews = new SiteReviewService(database, audit),
  ) {}

  async create(
    actor: AgencyActor,
    siteReference: string,
    input: CreateSiteQualityRunInput,
  ) {
    const parsed = CreateSiteQualityRunSchema.parse(input);
    const context = await this.versionContext(
      siteReference,
      parsed.siteVersionReference,
    );
    if (
      !context.contentDigest
      || context.contentDigest.length !== 64
      || context.generationStatus !== 'COMPLETED'
    ) {
      throw fail(
        409,
        'SITE_QUALITY_VERSION_INCOMPLETE',
        'The target site version must be complete and have an immutable digest.',
      );
    }
    if (context.versionStatus === 'SUPERSEDED') {
      throw fail(
        409,
        'SITE_QUALITY_VERSION_SUPERSEDED',
        'A superseded site version cannot start a quality run.',
      );
    }
    const [snapshot, activePacks, agencyUser] = await Promise.all([
      this.previewSnapshot(context),
      this.database.select({
        id: knowledgePacks.id,
        reference: knowledgePacks.publicReference,
        semanticVersion: knowledgePacks.semanticVersion,
        contentDigest: knowledgePacks.contentDigestSha256,
      }).from(knowledgePacks).where(and(
        eq(knowledgePacks.intendedScope, 'PUBLIC_SITE'),
        eq(knowledgePacks.status, 'ACTIVE'),
      )).limit(2),
      this.database.select({
        reference: agencyUsers.publicReference,
      }).from(agencyUsers)
        .where(eq(agencyUsers.id, actor.agencyUserId))
        .limit(1)
        .then((rows) => rows[0]),
    ]);
    if (!snapshot) {
      throw fail(
        409,
        'SITE_QUALITY_SECURE_PREVIEW_UNAVAILABLE',
        'An exact-version PREVIEW snapshot is required before quality auditing.',
      );
    }
    if (
      activePacks.length !== 1
      || !activePacks[0].contentDigest
      || !agencyUser
    ) {
      throw fail(
        409,
        'SITE_QUALITY_OPERATIONAL_PRECONDITION_FAILED',
        'Exactly one digest-bound ACTIVE PUBLIC_SITE knowledge pack and an active agency actor are required.',
      );
    }
    const selection = await this.knowledgeSelection(
      activePacks[0].id,
      snapshot.content as Record<string, unknown>,
    );
    const idempotencyKey = digest({
      tenantReference: context.tenantReference,
      siteReference,
      versionReference: context.versionReference,
      siteVersionDigest: context.contentDigest,
      knowledgePackReference: activePacks[0].reference,
      knowledgePackDigest: activePacks[0].contentDigest,
      policyVersion: DEFAULT_PUBLICATION_POLICY_VERSION,
      qualityEngineVersion: SITE_QUALITY_ENGINE_VERSION,
      rendererVersion: SITE_QUALITY_RENDERER_VERSION,
      auditType: parsed.auditType,
      reason: parsed.reason,
    });
    const existing = await this.database.select({
      reference: siteQualityRuns.publicReference,
      status: siteQualityRuns.status,
      jobId: siteQualityRuns.siteJobId,
    }).from(siteQualityRuns).where(and(
      eq(siteQualityRuns.tenantId, context.tenantId),
      eq(siteQualityRuns.idempotencyKey, idempotencyKey),
    )).limit(1).then((rows) => rows[0]);
    if (existing?.jobId) {
      return {
        reference: existing.reference,
        status: existing.status,
        idempotentReplay: true,
      };
    }

    const run = existing ?? await this.database.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`site-quality:${idempotencyKey}`}::text, 0)
        )
      `);
      const replay = await tx.select({
        reference: siteQualityRuns.publicReference,
        status: siteQualityRuns.status,
        jobId: siteQualityRuns.siteJobId,
      }).from(siteQualityRuns).where(and(
        eq(siteQualityRuns.tenantId, context.tenantId),
        eq(siteQualityRuns.idempotencyKey, idempotencyKey),
      )).limit(1).then((rows) => rows[0]);
      if (replay) return replay;
      const [created] = await tx.insert(siteQualityRuns).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        siteVersionId: context.versionId,
        siteVersionDigestSha256: context.contentDigest!,
        generationRunId: context.generationRunId,
        reviewCycleId: context.reviewCycleId,
        knowledgePackId: activePacks[0].id,
        knowledgePackSemanticVersion: activePacks[0].semanticVersion,
        knowledgePackDigestSha256: activePacks[0].contentDigest!,
        applicableRuleIdsJson: selection.ruleIds,
        applicablePagePlaybooksJson: selection.pagePlaybooks,
        applicableSectionPlaybooksJson: selection.sectionPlaybooks,
        ruleSelectionDigestSha256: selection.digest,
        auditType: parsed.auditType,
        auditReason: parsed.reason,
        policyVersion: DEFAULT_PUBLICATION_POLICY_VERSION,
        rendererVersion: SITE_QUALITY_RENDERER_VERSION,
        qualityEngineVersion: SITE_QUALITY_ENGINE_VERSION,
        previewReference: snapshot.reference,
        idempotencyKey,
        pageCountPlanned: snapshot.pageCount,
        requestedByAgencyUserId: actor.agencyUserId,
      }).returning({
        reference: siteQualityRuns.publicReference,
        status: siteQualityRuns.status,
        jobId: siteQualityRuns.siteJobId,
      });
      await this.audit.write(
        actor,
        'SITE_QUALITY_RUN_REQUESTED',
        'SITE_QUALITY_RUN',
        created.reference,
        {
          tenantId: context.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            siteVersionReference: context.versionReference,
            auditType: parsed.auditType,
            reason: parsed.reason,
            policyVersion: DEFAULT_PUBLICATION_POLICY_VERSION,
            qualityEngineVersion: SITE_QUALITY_ENGINE_VERSION,
          },
          tx,
        },
      );
      return created;
    });

    const jobType = qualityJobByAudit[
      SiteQualityAuditTypeSchema.parse(parsed.auditType)
    ];
    const payload = {
      jobType,
      siteReference,
      siteVersionReference: context.versionReference,
      qualityRunReference: run.reference,
      requestedByAgencyUserReference: agencyUser.reference,
      reason: parsed.reason,
    } as SiteJobPayload;
    const enqueued = await this.enqueue.enqueue(actor, {
      tenantReference: context.tenantReference,
      siteReference,
      versionReference: context.versionReference,
      jobType,
      payload,
      sourceReference: run.reference,
      sourceDigestSha256: context.contentDigest,
      operationVersion: 1,
      maxAttempts: 3,
      priority: parsed.auditType === 'PUBLICATION_READINESS' ? 140 : 120,
    });
    const job = await this.database.select({
      id: siteJobs.id,
    }).from(siteJobs).where(eq(siteJobs.publicReference, enqueued.reference))
      .limit(1).then((rows) => rows[0]);
    if (!job) {
      throw fail(
        500,
        'SITE_QUALITY_JOB_LINK_FAILED',
        'The quality job could not be linked to its run.',
      );
    }
    await this.database.update(siteQualityRuns).set({
      siteJobId: job.id,
      updatedAt: new Date(),
    }).where(eq(siteQualityRuns.publicReference, run.reference));
    return {
      reference: run.reference,
      status: run.status,
      jobReference: enqueued.reference,
      idempotentReplay: false,
    };
  }

  async list(siteReference: string) {
    await this.siteContext(siteReference);
    const rows = await this.database.select(this.runSelection())
      .from(siteQualityRuns)
      .innerJoin(tenants, eq(siteQualityRuns.tenantId, tenants.id))
      .innerJoin(sites, and(
        eq(siteQualityRuns.siteId, sites.id),
        eq(siteQualityRuns.tenantId, sites.tenantId),
      ))
      .innerJoin(siteVersions, and(
        eq(siteQualityRuns.siteVersionId, siteVersions.id),
        eq(siteVersions.siteId, sites.id),
        eq(siteVersions.tenantId, sites.tenantId),
      ))
      .innerJoin(knowledgePacks, eq(siteQualityRuns.knowledgePackId, knowledgePacks.id))
      .leftJoin(siteJobs, eq(siteQualityRuns.siteJobId, siteJobs.id))
      .where(eq(sites.publicReference, siteReference))
      .orderBy(desc(siteQualityRuns.createdAt), desc(siteQualityRuns.id));
    return rows.map(safeRun);
  }

  async get(siteReference: string, runReference: string) {
    return safeRun(await this.runContext(siteReference, runReference));
  }

  async findings(siteReference: string, runReference: string) {
    const run = await this.runContext(siteReference, runReference);
    return this.database.select({
      reference: siteQualityFindings.publicReference,
      checkReference: siteQualityChecks.publicReference,
      checkId: siteQualityFindings.checkId,
      category: siteQualityFindings.category,
      severity: siteQualityFindings.severity,
      publicationEffect: siteQualityFindings.publicationEffect,
      waivable: siteQualityFindings.waivable,
      code: siteQualityFindings.code,
      message: siteQualityFindings.safeMessage,
      evidenceSummary: siteQualityFindings.evidenceSummary,
      remediationGuidance: siteQualityFindings.remediationGuidance,
      status: siteQualityFindings.status,
      pageReference: sitePages.publicReference,
      sectionReference: siteSections.publicReference,
      fieldPath: siteQualityFindings.fieldPath,
      bookingActionReference: siteQualityFindings.bookingActionReference,
      ruleIds: siteQualityFindings.ruleIdsJson,
      contentDigest: siteQualityFindings.contentDigestSha256,
      firstDetectedAt: siteQualityFindings.firstDetectedAt,
      lastDetectedAt: siteQualityFindings.lastDetectedAt,
      acknowledgedAt: siteQualityFindings.acknowledgedAt,
      resolvedAt: siteQualityFindings.resolvedAt,
      waivedAt: siteQualityFindings.waivedAt,
      supersededAt: siteQualityFindings.supersededAt,
    }).from(siteQualityFindings)
      .innerJoin(siteQualityChecks, eq(siteQualityFindings.qualityCheckId, siteQualityChecks.id))
      .leftJoin(sitePages, eq(siteQualityFindings.pageId, sitePages.id))
      .leftJoin(siteSections, eq(siteQualityFindings.sectionId, siteSections.id))
      .where(and(
        eq(siteQualityFindings.qualityRunId, run.id),
        eq(siteQualityFindings.tenantId, run.tenantId),
      ))
      .orderBy(
        asc(siteQualityFindings.publicationEffect),
        desc(siteQualityFindings.severity),
        asc(siteQualityFindings.createdAt),
      );
  }

  async evidence(siteReference: string, runReference: string) {
    const run = await this.runContext(siteReference, runReference);
    return this.database.select({
      reference: siteQualityEvidence.publicReference,
      checkReference: siteQualityChecks.publicReference,
      findingReference: siteQualityFindings.publicReference,
      pageReference: sitePages.publicReference,
      evidenceType: siteQualityEvidence.evidenceType,
      viewport: siteQualityEvidence.viewport,
      contentDigest: siteQualityEvidence.contentDigestSha256,
      evidenceDigest: siteQualityEvidence.evidenceDigestSha256,
      safeSummary: siteQualityEvidence.safeSummary,
      safeMetadata: siteQualityEvidence.safeMetadataJson,
      storageReference: siteQualityEvidence.storageReference,
      toolVersion: siteQualityEvidence.toolVersion,
      capturedAt: siteQualityEvidence.capturedAt,
    }).from(siteQualityEvidence)
      .leftJoin(siteQualityChecks, eq(siteQualityEvidence.qualityCheckId, siteQualityChecks.id))
      .leftJoin(siteQualityFindings, eq(siteQualityEvidence.findingId, siteQualityFindings.id))
      .leftJoin(sitePages, eq(siteQualityEvidence.pageId, sitePages.id))
      .where(and(
        eq(siteQualityEvidence.qualityRunId, run.id),
        eq(siteQualityEvidence.tenantId, run.tenantId),
      ))
      .orderBy(asc(siteQualityEvidence.capturedAt), asc(siteQualityEvidence.id));
  }

  async summary(siteReference: string, runReference: string) {
    const [run, findings, checks, humanReviews, waivers] = await Promise.all([
      this.get(siteReference, runReference),
      this.findings(siteReference, runReference),
      this.checks(siteReference, runReference),
      this.humanReviews(siteReference, runReference),
      this.waivers(siteReference, runReference),
    ]);
    return {
      run,
      categorySummary: summarizeCategoryFindings(findings.map((finding) => ({
        checkId: finding.checkId,
        category: finding.category as Parameters<typeof summarizeCategoryFindings>[0][number]['category'],
        severity: finding.severity as 'INFO' | 'WARNING' | 'BLOCKING',
        publicationEffect: finding.publicationEffect as 'BLOCK' | 'WARNING' | 'RECOMMENDATION',
        waivable: finding.waivable,
        ruleIds: Array.isArray(finding.ruleIds) ? finding.ruleIds as string[] : [],
        code: finding.code,
        message: finding.message,
        evidenceSummary: finding.evidenceSummary,
        remediationGuidance: finding.remediationGuidance,
        status: finding.status as 'OPEN',
        contentDigestSha256: finding.contentDigest,
      }))),
      findings,
      checks,
      humanReviews,
      waivers,
    };
  }

  async compare(
    actor: AgencyActor,
    siteReference: string,
    runReference: string,
    otherRunReference: string,
  ) {
    const [left, right, leftFindings, rightFindings] = await Promise.all([
      this.runContext(siteReference, runReference),
      this.runContext(siteReference, otherRunReference),
      this.findings(siteReference, runReference),
      this.findings(siteReference, otherRunReference),
    ]);
    const result = compareQualityRuns({
      left: {
        reference: left.publicReference,
        tenantReference: left.tenantReference,
        siteReference: left.siteReference,
        gateStatus: left.publicationGateStatus,
        findings: leftFindings.map((finding) => ({
          reference: finding.reference,
          checkId: finding.checkId,
          code: finding.code,
          severity: finding.severity as 'INFO' | 'WARNING' | 'BLOCKING',
          status: finding.status,
          pageReference: finding.pageReference,
          fieldPath: finding.fieldPath,
        })),
      },
      right: {
        reference: right.publicReference,
        tenantReference: right.tenantReference,
        siteReference: right.siteReference,
        gateStatus: right.publicationGateStatus,
        findings: rightFindings.map((finding) => ({
          reference: finding.reference,
          checkId: finding.checkId,
          code: finding.code,
          severity: finding.severity as 'INFO' | 'WARNING' | 'BLOCKING',
          status: finding.status,
          pageReference: finding.pageReference,
          fieldPath: finding.fieldPath,
        })),
      },
    });
    const comparisonDigest = digest(result);
    const [record] = await this.database.insert(siteQualityRunComparisons)
      .values({
        tenantId: left.tenantId,
        siteId: left.siteId,
        leftQualityRunId: left.id,
        rightQualityRunId: right.id,
        comparisonEngineVersion: SITE_QUALITY_ENGINE_VERSION,
        comparisonDigestSha256: comparisonDigest,
        summaryJson: result,
        requestedByAgencyUserId: actor.agencyUserId,
      }).onConflictDoNothing().returning({
        reference: siteQualityRunComparisons.publicReference,
      });
    return {
      reference: record?.reference ?? null,
      comparisonDigest,
      ...result,
    };
  }

  async cancel(
    actor: AgencyActor,
    siteReference: string,
    runReference: string,
    reason: string,
  ) {
    const run = await this.runContext(siteReference, runReference);
    if (!run.jobReference) {
      throw fail(409, 'SITE_QUALITY_RUN_NOT_CANCELLABLE', 'The run has no linked job.');
    }
    const job = await this.jobs.cancel(actor, run.jobReference, reason);
    const status = job.status === 'CANCELLED' ? 'CANCELLED' : 'CANCEL_REQUESTED';
    await this.database.update(siteQualityRuns).set({
      status,
      cancelledByAgencyUserId: actor.agencyUserId,
      ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      updatedAt: new Date(),
    }).where(eq(siteQualityRuns.id, run.id));
    await this.audit.write(
      actor,
      status === 'CANCELLED'
        ? 'SITE_QUALITY_RUN_CANCELLED'
        : 'SITE_QUALITY_RUN_CANCEL_REQUESTED',
      'SITE_QUALITY_RUN',
      runReference,
      {
        tenantId: run.tenantId,
        reason,
        category: 'WEBSITE',
        metadata: { siteReference, siteVersionReference: run.versionReference },
      },
    );
    return { reference: runReference, status };
  }

  async retry(
    actor: AgencyActor,
    siteReference: string,
    runReference: string,
    reason: string,
  ) {
    const run = await this.runContext(siteReference, runReference);
    if (!run.jobReference) {
      throw fail(409, 'SITE_QUALITY_RUN_NOT_RETRYABLE', 'The run has no linked job.');
    }
    const result = await this.jobs.retry(actor, run.jobReference, reason);
    await this.database.update(siteQualityRuns).set({
      status: 'PENDING',
      failureCode: null,
      failureMessage: null,
      failedAt: null,
      updatedAt: new Date(),
    }).where(eq(siteQualityRuns.id, run.id));
    return { reference: runReference, status: result.status };
  }

  async findingAction(
    actor: AgencyActor,
    siteReference: string,
    findingReference: string,
    action: 'ACKNOWLEDGE' | 'RESOLVE',
    note?: string,
  ) {
    const context = await this.findingContext(siteReference, findingReference);
    if (!currentFindingStatuses.includes(
      context.status as (typeof currentFindingStatuses)[number],
    )) {
      throw fail(409, 'SITE_QUALITY_FINDING_NOT_CURRENT', 'The finding is not current.');
    }
    const nextStatus = action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'RESOLVED';
    const now = new Date();
    await this.database.transaction(async (tx) => {
      await tx.update(siteQualityFindings).set({
        status: nextStatus,
        ...(action === 'ACKNOWLEDGE'
          ? {
            acknowledgedAt: now,
            acknowledgedByAgencyUserId: actor.agencyUserId,
          }
          : {
            resolvedAt: now,
            resolvedByAgencyUserId: actor.agencyUserId,
            resolutionNote: note,
          }),
        updatedAt: now,
      }).where(eq(siteQualityFindings.id, context.id));
      await tx.insert(siteQualityRemediationEvents).values({
        qualityRunId: context.qualityRunId,
        findingId: context.id,
        tenantId: context.tenantId,
        eventType: action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'RESOLVED',
        statusFrom: context.status,
        statusTo: nextStatus,
        safeMessage: action === 'ACKNOWLEDGE'
          ? 'An authorised agency user acknowledged the quality finding.'
          : 'An authorised agency user recorded remediation of the quality finding.',
        safeMetadataJson: { code: context.code, checkId: context.checkId },
        agencyUserId: actor.agencyUserId,
      });
      await this.audit.write(
        actor,
        action === 'ACKNOWLEDGE'
          ? 'SITE_QUALITY_FINDING_ACKNOWLEDGED'
          : 'SITE_QUALITY_FINDING_RESOLVED',
        'SITE_QUALITY_FINDING',
        findingReference,
        {
          tenantId: context.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            qualityRunReference: context.runReference,
            checkId: context.checkId,
            findingCode: context.code,
          },
          tx,
        },
      );
    });
    return { reference: findingReference, status: nextStatus };
  }

  async waive(
    actor: AgencyActor,
    siteReference: string,
    findingReference: string,
    input: WaiverInput,
  ) {
    if (!['PLATFORM_OWNER', 'AGENCY_ADMINISTRATOR'].includes(actor.role)) {
      throw fail(
        403,
        'SITE_QUALITY_WAIVER_APPROVER_REQUIRED',
        'Only a higher-authority agency approver may create a waiver.',
      );
    }
    const parsed = SiteQualityWaiverDecisionSchema.parse(input);
    const context = await this.findingContext(siteReference, findingReference);
    const definition = qualityCheckById(context.checkId);
    assertFindingMayBeWaived({
      code: context.code,
      definitionWaivable: Boolean(definition?.waivable),
      findingWaivable: context.waivable,
      status: context.status,
    });
    const ruleIds = Array.isArray(context.ruleIds)
      ? context.ruleIds.filter((value): value is string => typeof value === 'string')
      : [];
    const ruleId = ruleIds[0] ?? definition?.ruleIds[0] ?? 'PLATFORM_POLICY';
    const result = await this.database.transaction(async (tx) => {
      const [waiver] = await tx.insert(siteQualityWaivers).values({
        findingId: context.id,
        qualityRunId: context.qualityRunId,
        tenantId: context.tenantId,
        siteId: context.siteId,
        siteVersionId: context.siteVersionId,
        contentDigestSha256: context.contentDigest,
        evidenceDigestSha256: context.evidenceDigest,
        ruleId,
        policyVersion: context.policyVersion,
        knowledgePackDigestSha256: context.knowledgePackDigest,
        reason: parsed.reason,
        riskAcceptance: parsed.riskAcceptance,
        approvedByAgencyUserId: actor.agencyUserId,
        expiresAt: parsed.expiresAt,
      }).returning({
        reference: siteQualityWaivers.publicReference,
      });
      await tx.update(siteQualityFindings).set({
        status: 'WAIVED',
        waivedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(siteQualityFindings.id, context.id));
      await tx.insert(siteQualityRemediationEvents).values({
        qualityRunId: context.qualityRunId,
        findingId: context.id,
        tenantId: context.tenantId,
        eventType: 'WAIVER_CREATED',
        statusFrom: context.status,
        statusTo: 'WAIVED',
        relatedPublicReference: waiver.reference,
        safeMessage: 'An authorised agency approver accepted a policy-permitted risk.',
        safeMetadataJson: { ruleId, expires: Boolean(parsed.expiresAt) },
        agencyUserId: actor.agencyUserId,
      });
      await this.audit.write(
        actor,
        'SITE_QUALITY_WAIVER_CREATED',
        'SITE_QUALITY_WAIVER',
        waiver.reference,
        {
          tenantId: context.tenantId,
          reason: parsed.reason,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            qualityRunReference: context.runReference,
            findingReference,
            findingCode: context.code,
            ruleId,
            expiresAt: parsed.expiresAt?.toISOString(),
          },
          tx,
        },
      );
      return waiver;
    });
    return { reference: result.reference, findingStatus: 'WAIVED' as const };
  }

  async revokeWaiver(
    actor: AgencyActor,
    siteReference: string,
    findingReference: string,
    reason: string,
  ) {
    const context = await this.findingContext(siteReference, findingReference);
    const waiver = await this.database.select({
      id: siteQualityWaivers.id,
      reference: siteQualityWaivers.publicReference,
    }).from(siteQualityWaivers).where(and(
      eq(siteQualityWaivers.findingId, context.id),
      isNull(siteQualityWaivers.revokedAt),
      isNull(siteQualityWaivers.invalidatedAt),
    )).limit(1).then((rows) => rows[0]);
    if (!waiver) {
      throw fail(404, 'SITE_QUALITY_WAIVER_NOT_FOUND', 'No active waiver exists.');
    }
    await this.database.transaction(async (tx) => {
      await tx.update(siteQualityWaivers).set({
        revokedAt: new Date(),
        revokedByAgencyUserId: actor.agencyUserId,
        revokedReason: reason,
      }).where(eq(siteQualityWaivers.id, waiver.id));
      await tx.update(siteQualityFindings).set({
        status: 'OPEN',
        waivedAt: null,
        updatedAt: new Date(),
      }).where(eq(siteQualityFindings.id, context.id));
      await tx.insert(siteQualityRemediationEvents).values({
        qualityRunId: context.qualityRunId,
        findingId: context.id,
        tenantId: context.tenantId,
        eventType: 'WAIVER_REVOKED',
        statusFrom: 'WAIVED',
        statusTo: 'OPEN',
        relatedPublicReference: waiver.reference,
        safeMessage: 'An authorised agency user revoked the quality waiver.',
        safeMetadataJson: { findingCode: context.code },
        agencyUserId: actor.agencyUserId,
      });
      await this.audit.write(
        actor,
        'SITE_QUALITY_WAIVER_REVOKED',
        'SITE_QUALITY_WAIVER',
        waiver.reference,
        {
          tenantId: context.tenantId,
          reason,
          category: 'WEBSITE',
          metadata: { siteReference, findingReference },
          tx,
        },
      );
    });
    return { reference: waiver.reference, findingStatus: 'OPEN' as const };
  }

  async completeHumanReview(
    actor: AgencyActor,
    siteReference: string,
    runReference: string,
    checkReference: string,
    input: HumanReviewInput,
  ) {
    const parsed = SiteQualityHumanReviewDecisionSchema.parse(input);
    const run = await this.runContext(siteReference, runReference);
    const check = await this.database.select({
      id: siteQualityChecks.id,
      reference: siteQualityChecks.publicReference,
      checkId: siteQualityChecks.checkId,
      validationMethod: siteQualityChecks.validationMethod,
    }).from(siteQualityChecks).where(and(
      eq(siteQualityChecks.publicReference, checkReference),
      eq(siteQualityChecks.qualityRunId, run.id),
      eq(siteQualityChecks.tenantId, run.tenantId),
    )).limit(1).then((rows) => rows[0]);
    if (!check || check.validationMethod !== 'HUMAN_REVIEW') {
      throw fail(
        404,
        'SITE_QUALITY_HUMAN_REVIEW_CHECK_NOT_FOUND',
        'The human-review check was not found in this run.',
      );
    }
    const [decision] = await this.database.transaction(async (tx) => {
      const rows = await tx.insert(siteQualityHumanReviews).values({
        qualityRunId: run.id,
        qualityCheckId: check.id,
        tenantId: run.tenantId,
        siteVersionId: run.siteVersionId,
        contentDigestSha256: run.siteVersionDigestSha256,
        decision: parsed.decision,
        notes: parsed.notes,
        decidedByAgencyUserId: actor.agencyUserId,
      }).onConflictDoUpdate({
        target: [
          siteQualityHumanReviews.qualityRunId,
          siteQualityHumanReviews.qualityCheckId,
        ],
        set: {
          decision: parsed.decision,
          notes: parsed.notes,
          decidedByAgencyUserId: actor.agencyUserId,
          decidedAt: new Date(),
          invalidatedAt: null,
          invalidatedReason: null,
        },
      }).returning({
        reference: siteQualityHumanReviews.publicReference,
      });
      await tx.update(siteQualityChecks).set({
        result: parsed.decision === 'PASS'
          ? 'PASS'
          : parsed.decision === 'FAIL'
            ? 'FAIL'
            : 'DATA_REQUIRED',
        safeSummary: 'An authorised agency reviewer completed this qualitative check.',
        completedAt: new Date(),
      }).where(eq(siteQualityChecks.id, check.id));
      if (parsed.decision === 'PASS') {
        await tx.update(siteQualityFindings).set({
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedByAgencyUserId: actor.agencyUserId,
          resolutionNote: 'The required agency human review passed.',
          updatedAt: new Date(),
        }).where(and(
          eq(siteQualityFindings.qualityRunId, run.id),
          eq(siteQualityFindings.qualityCheckId, check.id),
          inArray(siteQualityFindings.status, [
            'OPEN',
            'ACKNOWLEDGED',
            'IN_REMEDIATION',
          ]),
        ));
      } else {
        await tx.update(siteQualityFindings).set({
          status: 'OPEN',
          resolvedAt: null,
          resolvedByAgencyUserId: null,
          resolutionNote: null,
          updatedAt: new Date(),
        }).where(and(
          eq(siteQualityFindings.qualityRunId, run.id),
          eq(siteQualityFindings.qualityCheckId, check.id),
          eq(siteQualityFindings.code, 'HUMAN_REVIEW_REQUIRED'),
        ));
      }
      await this.audit.write(
        actor,
        'SITE_QUALITY_HUMAN_REVIEW_COMPLETED',
        'SITE_QUALITY_HUMAN_REVIEW',
        rows[0].reference,
        {
          tenantId: run.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            qualityRunReference: runReference,
            checkId: check.checkId,
            decision: parsed.decision,
          },
          tx,
        },
      );
      return rows;
    });
    await this.refreshRunGate(run.id);
    return { reference: decision.reference, decision: parsed.decision };
  }

  async createChangeRequest(
    actor: AgencyActor,
    siteReference: string,
    findingReference: string,
  ) {
    const finding = await this.findingContext(siteReference, findingReference);
    if (!finding.reviewReference) {
      throw fail(
        409,
        'SITE_QUALITY_REVIEW_CYCLE_REQUIRED',
        'A current review cycle is required to create a change request.',
      );
    }
    const category = finding.category === 'ACCESSIBILITY'
      ? 'ACCESSIBILITY_CHANGE'
      : finding.category === 'BOOKING_INTEGRITY'
        ? 'BOOKING_CHANGE'
        : finding.category.includes('SEO') || finding.category === 'STRUCTURED_DATA'
          ? 'SEO_CHANGE'
          : finding.category === 'ASSET_READINESS'
            ? 'IMAGE_CHANGE'
            : 'OTHER';
    const request = await this.reviews.addAgencyChangeRequest(
      actor,
      siteReference,
      finding.reviewReference,
      {
        ...(finding.pageReference ? { pageReference: finding.pageReference } : {}),
        ...(finding.sectionReference ? { sectionReference: finding.sectionReference } : {}),
        ...(finding.fieldPath && /^[A-Za-z0-9_.\[\]-]+$/.test(finding.fieldPath)
          ? { fieldPath: finding.fieldPath }
          : {}),
        category,
        priority: finding.publicationEffect === 'BLOCK' ? 'HIGH' : 'NORMAL',
        title: `Quality remediation: ${finding.code}`.slice(0, 160),
        description: finding.safeMessage,
        requestedOutcome: finding.remediationGuidance,
      },
    );
    await this.database.insert(siteQualityRemediationEvents).values({
      qualityRunId: finding.qualityRunId,
      findingId: finding.id,
      tenantId: finding.tenantId,
      eventType: 'CHANGE_REQUEST_CREATED',
      statusFrom: finding.status,
      statusTo: 'IN_REMEDIATION',
      relatedPublicReference: request.reference,
      safeMessage: 'A controlled review change request was created from the quality finding.',
      safeMetadataJson: { code: finding.code, checkId: finding.checkId },
      agencyUserId: actor.agencyUserId,
    });
    await this.database.update(siteQualityFindings).set({
      status: 'IN_REMEDIATION',
      updatedAt: new Date(),
    }).where(eq(siteQualityFindings.id, finding.id));
    return request;
  }

  async publicationReadiness(
    siteReference: string,
    actor?: AgencyActor,
  ) {
    const context = await this.latestVersionContext(siteReference);
    const [run] = await this.database.select(this.runSelection())
      .from(siteQualityRuns)
      .innerJoin(tenants, eq(siteQualityRuns.tenantId, tenants.id))
      .innerJoin(sites, and(
        eq(siteQualityRuns.siteId, sites.id),
        eq(siteQualityRuns.tenantId, sites.tenantId),
      ))
      .innerJoin(siteVersions, and(
        eq(siteQualityRuns.siteVersionId, siteVersions.id),
        eq(siteVersions.siteId, sites.id),
        eq(siteVersions.tenantId, sites.tenantId),
      ))
      .innerJoin(knowledgePacks, eq(siteQualityRuns.knowledgePackId, knowledgePacks.id))
      .leftJoin(siteJobs, eq(siteQualityRuns.siteJobId, siteJobs.id))
      .where(and(
        eq(siteQualityRuns.siteId, context.siteId),
        eq(siteQualityRuns.siteVersionId, context.versionId),
        eq(siteQualityRuns.auditType, 'FULL_SITE_QUALITY'),
      ))
      .orderBy(desc(siteQualityRuns.createdAt))
      .limit(1);
    const runFindings = run
      ? await this.database.select({
        code: siteQualityFindings.code,
        category: siteQualityFindings.category,
        publicationEffect: siteQualityFindings.publicationEffect,
        waivable: siteQualityFindings.waivable,
        status: siteQualityFindings.status,
      }).from(siteQualityFindings).where(eq(siteQualityFindings.qualityRunId, run.id))
      : [];
    const review = await this.reviewStatus(context);
    const now = new Date();
    const staleWaivers = run
      ? await this.database.select({
        id: siteQualityWaivers.id,
        reference: siteQualityWaivers.publicReference,
        invalidatedAt: siteQualityWaivers.invalidatedAt,
      }).from(siteQualityWaivers).where(and(
        eq(siteQualityWaivers.qualityRunId, run.id),
        or(
          sql`${siteQualityWaivers.expiresAt} <= ${now}`,
          sql`${siteQualityWaivers.contentDigestSha256} <> ${context.contentDigest ?? ''}`,
          sql`${siteQualityWaivers.policyVersion} <> ${run.policyVersion}`,
          sql`${siteQualityWaivers.knowledgePackDigestSha256} <> ${run.knowledgePackDigestSha256}`,
          sql`${siteQualityWaivers.invalidatedAt} IS NOT NULL`,
        ),
      ))
      : [];
    const staleWaiverCount = staleWaivers.length;
    const humanReviewIncompleteCount = run
      ? await this.database.select({
        count: sql<number>`count(*)::int`,
      }).from(siteQualityChecks).where(and(
        eq(siteQualityChecks.qualityRunId, run.id),
        eq(siteQualityChecks.validationMethod, 'HUMAN_REVIEW'),
        inArray(siteQualityChecks.result, ['DATA_REQUIRED', 'FAIL', 'ERROR']),
      )).then((rows) => Number(rows[0]?.count ?? 0))
      : 0;
    const result = evaluatePublicationReadiness({
      qualityRunReference: run?.publicReference,
      qualityRunStatus: run?.status,
      qualityRunGateStatus: run?.publicationGateStatus as
        | 'NOT_EVALUATED'
        | 'BLOCKED'
        | 'READY_WITH_WARNINGS'
        | 'READY'
        | 'STALE'
        | undefined,
      runSiteVersionDigestSha256: run?.siteVersionDigestSha256,
      currentSiteVersionDigestSha256: context.contentDigest ?? '0'.repeat(64),
      siteVersionComplete: Boolean(
        context.contentDigest && context.generationStatus === 'COMPLETED',
      ),
      siteVersionSuperseded: context.versionStatus === 'SUPERSEDED',
      runStale: Boolean(
        run?.staleAt
        || (
          run?.siteVersionDigestSha256
          && run.siteVersionDigestSha256 !== context.contentDigest
        ),
      ),
      agencyApprovalCurrent: review.agencyApprovalCurrent,
      clientApprovalRequired: review.clientApprovalRequired,
      clientApprovalCurrent: review.clientApprovalCurrent,
      approvalFreshness: review.approvalFreshness,
      qualityPolicyVersion: run?.policyVersion ?? DEFAULT_PUBLICATION_POLICY_VERSION,
      knowledgePackVersion: run?.knowledgePackSemanticVersion ?? 'UNRESOLVED',
      findings: runFindings as PublicationReadinessFinding[],
      staleWaiverCount,
      unresolvedReviewCount: review.unresolvedReviewCount,
      unresolvedFactCount: review.unresolvedFactCount,
      humanReviewIncompleteCount,
    });
    if (actor) {
      for (const waiver of staleWaivers.filter(value => !value.invalidatedAt)) {
        await this.database.update(siteQualityWaivers).set({
          invalidatedAt: now,
          invalidatedReason: 'Pinned quality inputs no longer match publication readiness.',
        }).where(eq(siteQualityWaivers.id, waiver.id));
        await this.audit.write(
          actor,
          'SITE_QUALITY_WAIVER_INVALIDATED',
          'SITE_QUALITY_WAIVER',
          waiver.reference,
          {
            tenantId: context.tenantId,
            category: 'WEBSITE',
            metadata: {
              siteReference,
              qualityRunReference: run?.publicReference,
              siteVersionReference: context.versionReference,
            },
          },
        );
      }
      await this.audit.write(
        actor,
        result.ready
          ? 'SITE_PUBLICATION_READINESS_READY'
          : 'SITE_PUBLICATION_READINESS_BLOCKED',
        'SITE',
        siteReference,
        {
          tenantId: context.tenantId,
          category: 'WEBSITE',
          metadata: {
            qualityRunReference: result.qualityRunReference,
            siteVersionReference: context.versionReference,
            ready: result.ready,
            status: result.status,
            blockingCodes: result.blockingReasons.map((reason) => reason.code),
            policyVersion: result.qualityPolicyVersion,
          },
        },
      );
      await this.audit.write(
        actor,
        'SITE_PUBLICATION_READINESS_EVALUATED',
        'SITE',
        siteReference,
        {
          tenantId: context.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteVersionReference: context.versionReference,
            qualityRunReference: result.qualityRunReference,
            status: result.status,
          },
        },
      );
    }
    return {
      siteReference,
      siteVersionReference: context.versionReference,
      ...result,
      publicationPerformed: false,
    };
  }

  private async checks(siteReference: string, runReference: string) {
    const run = await this.runContext(siteReference, runReference);
    return this.database.select({
      reference: siteQualityChecks.publicReference,
      checkId: siteQualityChecks.checkId,
      category: siteQualityChecks.category,
      validationMethod: siteQualityChecks.validationMethod,
      severity: siteQualityChecks.severity,
      publicationEffect: siteQualityChecks.publicationEffect,
      waivable: siteQualityChecks.waivable,
      result: siteQualityChecks.result,
      ruleIds: siteQualityChecks.ruleIdsJson,
      safeSummary: siteQualityChecks.safeSummary,
      engineVersion: siteQualityChecks.engineVersion,
      startedAt: siteQualityChecks.startedAt,
      completedAt: siteQualityChecks.completedAt,
    }).from(siteQualityChecks)
      .where(eq(siteQualityChecks.qualityRunId, run.id))
      .orderBy(asc(siteQualityChecks.category), asc(siteQualityChecks.checkId));
  }

  private async humanReviews(siteReference: string, runReference: string) {
    const run = await this.runContext(siteReference, runReference);
    return this.database.select({
      reference: siteQualityHumanReviews.publicReference,
      checkReference: siteQualityChecks.publicReference,
      checkId: siteQualityChecks.checkId,
      decision: siteQualityHumanReviews.decision,
      notes: siteQualityHumanReviews.notes,
      decidedAt: siteQualityHumanReviews.decidedAt,
      invalidatedAt: siteQualityHumanReviews.invalidatedAt,
      invalidatedReason: siteQualityHumanReviews.invalidatedReason,
    }).from(siteQualityHumanReviews)
      .innerJoin(siteQualityChecks, eq(
        siteQualityHumanReviews.qualityCheckId,
        siteQualityChecks.id,
      ))
      .where(eq(siteQualityHumanReviews.qualityRunId, run.id))
      .orderBy(asc(siteQualityHumanReviews.decidedAt));
  }

  private async waivers(siteReference: string, runReference: string) {
    const run = await this.runContext(siteReference, runReference);
    return this.database.select({
      reference: siteQualityWaivers.publicReference,
      findingReference: siteQualityFindings.publicReference,
      ruleId: siteQualityWaivers.ruleId,
      reason: siteQualityWaivers.reason,
      riskAcceptance: siteQualityWaivers.riskAcceptance,
      expiresAt: siteQualityWaivers.expiresAt,
      createdAt: siteQualityWaivers.createdAt,
      revokedAt: siteQualityWaivers.revokedAt,
      revokedReason: siteQualityWaivers.revokedReason,
      invalidatedAt: siteQualityWaivers.invalidatedAt,
      invalidatedReason: siteQualityWaivers.invalidatedReason,
    }).from(siteQualityWaivers)
      .innerJoin(siteQualityFindings, eq(siteQualityWaivers.findingId, siteQualityFindings.id))
      .where(eq(siteQualityWaivers.qualityRunId, run.id))
      .orderBy(desc(siteQualityWaivers.createdAt));
  }

  private async siteContext(siteReference: string) {
    const [context] = await this.database.select({
      siteId: sites.id,
      tenantId: sites.tenantId,
      siteReference: sites.publicReference,
      tenantReference: tenants.businessReference,
    }).from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .where(eq(sites.publicReference, siteReference))
      .limit(1);
    if (!context) throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    return context;
  }

  private async versionContext(
    siteReference: string,
    versionReference: string,
  ) {
    const [context] = await this.database.select({
      tenantId: sites.tenantId,
      tenantReference: tenants.businessReference,
      siteId: sites.id,
      siteReference: sites.publicReference,
      versionId: siteVersions.id,
      versionReference: siteVersions.publicReference,
      versionStatus: siteVersions.status,
      generationStatus: siteVersions.generationStatus,
      contentDigest: siteVersions.generationContentDigestSha256,
      generationRunId: siteVersions.generationRunId,
      reviewCycleId: siteReviewCycles.id,
    }).from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .innerJoin(siteVersions, and(
        eq(siteVersions.siteId, sites.id),
        eq(siteVersions.tenantId, sites.tenantId),
      ))
      .leftJoin(siteReviewCycles, and(
        eq(siteReviewCycles.siteVersionId, siteVersions.id),
        eq(siteReviewCycles.tenantId, sites.tenantId),
      ))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteVersions.publicReference, versionReference),
      ))
      .orderBy(desc(siteReviewCycles.reviewRevision))
      .limit(1);
    if (!context) {
      throw fail(
        404,
        'SITE_QUALITY_VERSION_NOT_FOUND',
        'The site version was not found for this site.',
      );
    }
    return context;
  }

  private async latestVersionContext(siteReference: string) {
    const site = await this.siteContext(siteReference);
    const [version] = await this.database.select({
      versionReference: siteVersions.publicReference,
    }).from(siteVersions)
      .where(and(
        eq(siteVersions.siteId, site.siteId),
        eq(siteVersions.tenantId, site.tenantId),
      ))
      .orderBy(desc(siteVersions.versionNumber))
      .limit(1);
    if (!version) {
      throw fail(409, 'SITE_QUALITY_VERSION_REQUIRED', 'The site has no version.');
    }
    return this.versionContext(siteReference, version.versionReference);
  }

  private previewSnapshot(
    context: Awaited<ReturnType<SiteQualityService['versionContext']>>,
  ) {
    return this.database.select({
      id: siteRenderSnapshots.id,
      reference: siteRenderSnapshots.publicReference,
      content: siteRenderSnapshots.contentJson,
      pageCount: sql<number>`jsonb_array_length(${siteRenderSnapshots.contentJson}->'pages')::int`,
      templateVersionId: siteRenderSnapshots.templateVersionId,
    }).from(siteRenderSnapshots).where(and(
      eq(siteRenderSnapshots.tenantId, context.tenantId),
      eq(siteRenderSnapshots.siteId, context.siteId),
      eq(siteRenderSnapshots.siteVersionId, context.versionId),
      eq(siteRenderSnapshots.snapshotKind, 'PREVIEW'),
      eq(siteRenderSnapshots.sourceContentDigestSha256, context.contentDigest!),
    )).orderBy(desc(siteRenderSnapshots.revision)).limit(1)
      .then((rows) => rows[0] ?? null);
  }

  private async knowledgeSelection(
    knowledgePackId: string,
    snapshot: Record<string, unknown>,
  ) {
    const pages = Array.isArray(snapshot.pages)
      ? snapshot.pages.filter((value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value))
      : [];
    const pageTypes = new Set(pages.map((page) => String(page.pageType)));
    const conversionRoles = new Set(pages.map((page) => String(page.conversionRole)));
    const sectionTypes = new Set(pages.flatMap((page) =>
      Array.isArray(page.sections)
        ? page.sections.map((section) =>
          section && typeof section === 'object'
            ? String((section as Record<string, unknown>).type)
            : '')
        : []));
    const [rules, pageRows, sectionRows] = await Promise.all([
      this.database.select({
        ruleId: knowledgeRules.ruleId,
        contentDigest: knowledgeRules.contentDigestSha256,
        status: knowledgeRules.status,
      }).from(knowledgeRules).where(and(
        eq(knowledgeRules.knowledgePackId, knowledgePackId),
        eq(knowledgeRules.status, 'ACCEPTED'),
      )).orderBy(asc(knowledgeRules.ruleId)),
      this.database.select({
        id: knowledgePagePlaybooks.id,
        reference: knowledgePagePlaybooks.publicReference,
        pageType: knowledgePagePlaybooks.pageType,
        conversionRole: knowledgePagePlaybooks.conversionRole,
        contentDigest: knowledgePagePlaybooks.contentDigestSha256,
      }).from(knowledgePagePlaybooks)
        .where(eq(knowledgePagePlaybooks.knowledgePackId, knowledgePackId)),
      this.database.select({
        reference: knowledgeSectionPlaybooks.publicReference,
        pagePlaybookId: knowledgeSectionPlaybooks.pagePlaybookId,
        sectionType: knowledgeSectionPlaybooks.sectionType,
        contentDigest: knowledgeSectionPlaybooks.contentDigestSha256,
      }).from(knowledgeSectionPlaybooks)
        .where(eq(knowledgeSectionPlaybooks.knowledgePackId, knowledgePackId)),
    ]);
    const selectedPages = pageRows.filter((page) =>
      pageTypes.has(page.pageType) && conversionRoles.has(page.conversionRole));
    const selectedPageIds = new Set(selectedPages.map((page) => page.id));
    const selectedSections = sectionRows.filter((section) =>
      selectedPageIds.has(section.pagePlaybookId)
      && sectionTypes.has(section.sectionType));
    const selection = {
      ruleIds: rules.map((rule) => rule.ruleId),
      pagePlaybooks: selectedPages.map((page) => ({
        reference: page.reference,
        pageType: page.pageType,
        conversionRole: page.conversionRole,
        digest: page.contentDigest,
      })),
      sectionPlaybooks: selectedSections.map((section) => ({
        reference: section.reference,
        sectionType: section.sectionType,
        digest: section.contentDigest,
      })),
      ruleDigests: rules.map((rule) => rule.contentDigest),
    };
    return { ...selection, digest: digest(selection) };
  }

  private runSelection() {
    return {
      id: siteQualityRuns.id,
      tenantId: siteQualityRuns.tenantId,
      siteId: siteQualityRuns.siteId,
      siteVersionId: siteQualityRuns.siteVersionId,
      publicReference: siteQualityRuns.publicReference,
      tenantReference: tenants.businessReference,
      siteReference: sites.publicReference,
      versionReference: siteVersions.publicReference,
      knowledgePackReference: knowledgePacks.publicReference,
      knowledgePackSemanticVersion: siteQualityRuns.knowledgePackSemanticVersion,
      siteVersionDigestSha256: siteQualityRuns.siteVersionDigestSha256,
      knowledgePackDigestSha256: siteQualityRuns.knowledgePackDigestSha256,
      ruleSelectionDigestSha256: siteQualityRuns.ruleSelectionDigestSha256,
      auditType: siteQualityRuns.auditType,
      auditReason: siteQualityRuns.auditReason,
      status: siteQualityRuns.status,
      policyVersion: siteQualityRuns.policyVersion,
      rendererVersion: siteQualityRuns.rendererVersion,
      qualityEngineVersion: siteQualityRuns.qualityEngineVersion,
      pageCountPlanned: siteQualityRuns.pageCountPlanned,
      pageCountCompleted: siteQualityRuns.pageCountCompleted,
      checkCount: siteQualityRuns.checkCount,
      passedCheckCount: siteQualityRuns.passedCheckCount,
      warningCount: siteQualityRuns.warningCount,
      blockingCount: siteQualityRuns.blockingCount,
      waivedCount: siteQualityRuns.waivedCount,
      nonWaivableCount: siteQualityRuns.nonWaivableCount,
      publicationGateStatus: siteQualityRuns.publicationGateStatus,
      failureCode: siteQualityRuns.failureCode,
      failureMessage: siteQualityRuns.failureMessage,
      startedAt: siteQualityRuns.startedAt,
      completedAt: siteQualityRuns.completedAt,
      cancelledAt: siteQualityRuns.cancelledAt,
      failedAt: siteQualityRuns.failedAt,
      staleAt: siteQualityRuns.staleAt,
      staleReason: siteQualityRuns.staleReason,
      createdAt: siteQualityRuns.createdAt,
      updatedAt: siteQualityRuns.updatedAt,
      jobReference: siteJobs.publicReference,
      jobStatus: siteJobs.status,
    };
  }

  private async runContext(siteReference: string, runReference: string) {
    const [row] = await this.database.select(this.runSelection())
      .from(siteQualityRuns)
      .innerJoin(tenants, eq(siteQualityRuns.tenantId, tenants.id))
      .innerJoin(sites, and(
        eq(siteQualityRuns.siteId, sites.id),
        eq(siteQualityRuns.tenantId, sites.tenantId),
      ))
      .innerJoin(siteVersions, and(
        eq(siteQualityRuns.siteVersionId, siteVersions.id),
        eq(siteVersions.siteId, sites.id),
        eq(siteVersions.tenantId, sites.tenantId),
      ))
      .innerJoin(knowledgePacks, eq(siteQualityRuns.knowledgePackId, knowledgePacks.id))
      .leftJoin(siteJobs, eq(siteQualityRuns.siteJobId, siteJobs.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteQualityRuns.publicReference, runReference),
      ))
      .limit(1);
    if (!row) {
      throw fail(
        404,
        'SITE_QUALITY_RUN_NOT_FOUND',
        'Quality run not found for this site.',
      );
    }
    return row;
  }

  private async findingContext(
    siteReference: string,
    findingReference: string,
  ) {
    const [row] = await this.database.select({
      id: siteQualityFindings.id,
      qualityRunId: siteQualityFindings.qualityRunId,
      runReference: siteQualityRuns.publicReference,
      tenantId: siteQualityFindings.tenantId,
      siteId: siteQualityFindings.siteId,
      siteVersionId: siteQualityFindings.siteVersionId,
      checkId: siteQualityFindings.checkId,
      category: siteQualityFindings.category,
      code: siteQualityFindings.code,
      safeMessage: siteQualityFindings.safeMessage,
      remediationGuidance: siteQualityFindings.remediationGuidance,
      publicationEffect: siteQualityFindings.publicationEffect,
      waivable: siteQualityFindings.waivable,
      status: siteQualityFindings.status,
      fieldPath: siteQualityFindings.fieldPath,
      ruleIds: siteQualityFindings.ruleIdsJson,
      contentDigest: siteQualityFindings.contentDigestSha256,
      evidenceDigest: siteQualityFindings.evidenceDigestSha256,
      pageReference: sitePages.publicReference,
      sectionReference: siteSections.publicReference,
      policyVersion: siteQualityRuns.policyVersion,
      knowledgePackDigest: siteQualityRuns.knowledgePackDigestSha256,
      reviewReference: siteReviewCycles.publicReference,
    }).from(siteQualityFindings)
      .innerJoin(siteQualityRuns, eq(siteQualityFindings.qualityRunId, siteQualityRuns.id))
      .innerJoin(sites, and(
        eq(siteQualityFindings.siteId, sites.id),
        eq(siteQualityFindings.tenantId, sites.tenantId),
      ))
      .leftJoin(sitePages, eq(siteQualityFindings.pageId, sitePages.id))
      .leftJoin(siteSections, eq(siteQualityFindings.sectionId, siteSections.id))
      .leftJoin(siteReviewCycles, eq(siteQualityRuns.reviewCycleId, siteReviewCycles.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteQualityFindings.publicReference, findingReference),
      ))
      .limit(1);
    if (!row) {
      throw fail(
        404,
        'SITE_QUALITY_FINDING_NOT_FOUND',
        'Quality finding not found for this site.',
      );
    }
    return row;
  }

  private async reviewStatus(
    context: Awaited<ReturnType<SiteQualityService['versionContext']>>,
  ) {
    const [review] = await this.database.select({
      id: siteReviewCycles.id,
      status: siteReviewCycles.status,
      digest: siteReviewCycles.pinnedContentDigestSha256,
      clientApprovalRequired: siteReviewCycles.clientApprovalRequired,
      clientApprovedAt: siteReviewCycles.clientApprovedAt,
      agencyApprovedAt: siteReviewCycles.agencyApprovedAt,
    }).from(siteReviewCycles).where(and(
      eq(siteReviewCycles.tenantId, context.tenantId),
      eq(siteReviewCycles.siteId, context.siteId),
      eq(siteReviewCycles.siteVersionId, context.versionId),
    )).orderBy(desc(siteReviewCycles.reviewRevision)).limit(1);
    if (!review) {
      return {
        agencyApprovalCurrent: false,
        clientApprovalRequired: true,
        clientApprovalCurrent: false,
        approvalFreshness: 'MISSING' as const,
        unresolvedReviewCount: 1,
        unresolvedFactCount: 0,
      };
    }
    const [items, facts] = await Promise.all([
      this.database.select({
        count: sql<number>`count(*)::int`,
      }).from(siteReviewItems).where(and(
        eq(siteReviewItems.reviewCycleId, review.id),
        eq(siteReviewItems.blocking, true),
        inArray(siteReviewItems.status, ['PENDING', 'CHANGES_REQUIRED']),
      )).then((rows) => Number(rows[0]?.count ?? 0)),
      this.database.select({
        count: sql<number>`count(*)::int`,
      }).from(siteFactVerifications).where(and(
        eq(siteFactVerifications.reviewCycleId, review.id),
        inArray(siteFactVerifications.status, ['UNVERIFIED', 'DISPUTED']),
      )).then((rows) => Number(rows[0]?.count ?? 0)),
    ]);
    const digestCurrent = Boolean(
      context.contentDigest && review.digest === context.contentDigest,
    );
    return {
      agencyApprovalCurrent: digestCurrent && review.status === 'AGENCY_APPROVED'
        && Boolean(review.agencyApprovedAt),
      clientApprovalRequired: review.clientApprovalRequired,
      clientApprovalCurrent: digestCurrent && (
        !review.clientApprovalRequired || Boolean(review.clientApprovedAt)
      ),
      approvalFreshness: !digestCurrent
        ? 'STALE' as const
        : review.agencyApprovedAt
          ? 'CURRENT' as const
          : 'MISSING' as const,
      unresolvedReviewCount: items,
      unresolvedFactCount: facts,
    };
  }

  private async refreshRunGate(runId: string) {
    const [findings, checks] = await Promise.all([
      this.database.select({
        publicationEffect: siteQualityFindings.publicationEffect,
        status: siteQualityFindings.status,
        waivable: siteQualityFindings.waivable,
        code: siteQualityFindings.code,
      }).from(siteQualityFindings).where(
        eq(siteQualityFindings.qualityRunId, runId),
      ),
      this.database.select({
        result: siteQualityChecks.result,
      }).from(siteQualityChecks).where(eq(siteQualityChecks.qualityRunId, runId)),
    ]);
    const current = findings.filter((finding) =>
      ['OPEN', 'ACKNOWLEDGED', 'IN_REMEDIATION'].includes(finding.status));
    const blockingCount = current.filter(
      finding => finding.publicationEffect === 'BLOCK',
    ).length;
    const warningCount = current.filter(
      finding => finding.publicationEffect === 'WARNING',
    ).length;
    const waivedCount = findings.filter(
      finding => finding.status === 'WAIVED',
    ).length;
    const nonWaivableCount = current.filter(
      finding => !finding.waivable || isNonWaivableFinding(finding.code),
    ).length;
    await this.database.update(siteQualityRuns).set({
      publicationGateStatus: blockingCount > 0
        ? 'BLOCKED'
        : warningCount > 0 || waivedCount > 0
          ? 'READY_WITH_WARNINGS'
          : 'READY',
      checkCount: checks.length,
      passedCheckCount: checks.filter(check => check.result === 'PASS').length,
      blockingCount,
      warningCount,
      waivedCount,
      nonWaivableCount,
      updatedAt: new Date(),
    }).where(eq(siteQualityRuns.id, runId));
  }
}
