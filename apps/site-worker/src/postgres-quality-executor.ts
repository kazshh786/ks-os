import { createHash, randomUUID } from 'node:crypto';
import {
  and,
  desc,
  eq,
  getDatabase,
  gt,
  inArray,
  isNotNull,
  isNull,
  knowledgePacks,
  or,
  platformAuditEvents,
  siteApprovalDecisions,
  siteGenerationClaims,
  sitePages,
  siteQualityAuditSessions,
  siteQualityChecks,
  siteQualityEvidence,
  siteQualityFindings,
  siteQualityPageRuns,
  siteQualityRuns,
  siteGenerationRuns,
  siteRenderSnapshots,
  siteReviewCycles,
  sites,
  siteVersions,
  sql,
  templateLicenses,
  templateSources,
  templateVersions,
  tenants,
  agencyUsers,
} from '@ks-os/database';
import {
  SiteJobExecutionError,
  type SiteJobLeaseContext,
  type SiteJobResult,
} from '@ks-os/site-jobs';
import { isQualityAuditableGenerationStatus } from '@ks-os/site-generation';
import {
  SITE_QUALITY_ENGINE_VERSION,
  SITE_QUALITY_VIEWPORTS,
  SiteQualityAuditTypeSchema,
  checksForAuditType,
  digestQualityToken,
  findingsFromBrowserResult,
  isNonWaivableFinding,
  qualityCheckById,
  runDeterministicQualityChecks,
  type SecureQualityPreview,
  type SiteQualityAuditType,
  type SiteQualityBrowserAdapter,
  type SiteQualityCheckDefinition,
  type SiteQualityCheckResult,
  type SiteQualityFindingInput,
} from '@ks-os/site-quality';
import {
  PublishedSiteSnapshotSchema,
} from '@ks-os/site-schema';
import { signSitePreviewToken } from '@ks-os/site-review';
import type { SiteWorkerConfig } from './config.js';
import type {
  SiteQualityJobExecutor,
  SiteQualityJobType,
} from './handlers.js';
import { finalizeProvisionedWorkspace } from './provisioning-finalization.js';

type Database = ReturnType<typeof getDatabase>;
type QualityConfig = SiteWorkerConfig['quality'];

interface QualityPayload {
  jobType: SiteQualityJobType;
  siteReference: string;
  siteVersionReference: string;
  qualityRunReference: string;
  requestedByAgencyUserReference: string;
  reason: string;
}

interface QualityRunContext {
  id: string;
  reference: string;
  tenantId: string;
  tenantReference: string;
  siteId: string;
  siteReference: string;
  siteVersionId: string;
  versionReference: string;
  versionStatus: string;
  versionGenerationStatus: string | null;
  currentVersionDigest: string | null;
  generationRunId: string | null;
  reviewCycleId: string | null;
  knowledgePackId: string;
  knowledgePackReference: string;
  knowledgePackDigest: string;
  knowledgePackVersion: string;
  auditType: SiteQualityAuditType;
  auditReason: string;
  policyVersion: string;
  rendererVersion: string;
  engineVersion: string;
  requestedByAgencyUserId: string;
  requestedByAgencyUserReference: string;
}

interface PageTarget {
  id: string;
  reference: string;
  path: string;
  contentDigest: string;
}

const sha256 = (value: unknown) => createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value))
  .digest('hex');

const qualityAuditTypesByJob: Record<
  SiteQualityJobType,
  readonly SiteQualityAuditType[]
> = {
  RUN_FULL_SITE_QUALITY_AUDIT: ['FULL_SITE_QUALITY'],
  RUN_TECHNICAL_SEO_AUDIT: [
    'TECHNICAL_SEO',
    'ON_PAGE_SEO',
    'LOCAL_SEO',
    'STRUCTURED_DATA',
    'INTERNAL_LINKING',
  ],
  RUN_ACCESSIBILITY_AUDIT: ['ACCESSIBILITY'],
  RUN_RESPONSIVE_UX_AUDIT: ['RESPONSIVE_UX'],
  RUN_CONVERSION_AUDIT: ['CONVERSION'],
  RUN_BOOKING_INTEGRITY_AUDIT: ['BOOKING_INTEGRITY'],
  RUN_PERFORMANCE_AUDIT: ['PERFORMANCE'],
  RUN_CONTENT_INTEGRITY_AUDIT: ['CONTENT_INTEGRITY'],
  RUN_ASSET_READINESS_AUDIT: ['ASSET_READINESS'],
  EVALUATE_PUBLICATION_READINESS: ['PUBLICATION_READINESS'],
};

const alwaysRequiredCheckIds = [
  'KSQ_PLATFORM_SNAPSHOT_VALID',
  'KSQ_PLATFORM_VERSION_COMPLETE',
  'KSQ_PLATFORM_TENANT_ISOLATION',
] as const;

const currentFindingStatuses = [
  'OPEN',
  'ACKNOWLEDGED',
  'IN_REMEDIATION',
] as const;

function safeFailureMessage(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : 'The quality audit failed unexpectedly.';
  return message
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(?:token|secret|authorization|cookie)=\S+/gi, '$1=[REDACTED]')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED_DATABASE_URL]')
    .slice(0, 500);
}

function definitionsForRun(auditType: SiteQualityAuditType) {
  const selected = new Map<string, SiteQualityCheckDefinition>();
  for (const definition of checksForAuditType(auditType)) {
    selected.set(definition.checkId, definition);
  }
  for (const checkId of alwaysRequiredCheckIds) {
    const definition = qualityCheckById(checkId);
    if (definition) selected.set(checkId, definition);
  }
  return [...selected.values()];
}

export class PostgresSiteQualityExecutor implements SiteQualityJobExecutor {
  constructor(
    private readonly database: Database,
    private readonly config: QualityConfig,
    private readonly browserAdapter: SiteQualityBrowserAdapter,
    private readonly environment: SiteWorkerConfig['nodeEnvironment'],
  ) {}

  async execute(
    jobType: SiteQualityJobType,
    rawPayload: unknown,
    context: SiteJobLeaseContext,
  ): Promise<SiteJobResult> {
    if (!this.config.enabled) {
      throw new SiteJobExecutionError(
        'TERMINAL_DATA_MISSING',
        'Site-quality execution is disabled for this worker.',
      );
    }
    const payload = rawPayload as QualityPayload;
    let run: QualityRunContext | null = null;
    try {
      run = await this.loadRun(payload);
      if (!qualityAuditTypesByJob[jobType].includes(run.auditType)) {
        throw new SiteJobExecutionError(
          'TERMINAL_VALIDATION_FAILURE',
          'The quality job type does not match the pinned run audit type.',
        );
      }
      await this.writeAudit(run, 'SITE_QUALITY_RUN_STARTED', 'SUCCESS', {
        auditType: run.auditType,
        policyVersion: run.policyVersion,
        engineVersion: run.engineVersion,
      });
      return await this.runAudit(run, context);
    } catch (error) {
      if (run) {
        if (context.signal.aborted) {
          await this.cancelRun(run);
          throw new SiteJobExecutionError(
            'CANCELLED_BY_USER',
            'The site-quality run was cancelled.',
          );
        }
        await this.failRun(run, error);
      }
      if (error instanceof SiteJobExecutionError) throw error;
      throw new SiteJobExecutionError(
        'TERMINAL_VALIDATION_FAILURE',
        safeFailureMessage(error),
      );
    }
  }

  private async runAudit(
    run: QualityRunContext,
    context: SiteJobLeaseContext,
  ): Promise<SiteJobResult> {
    const { snapshot, snapshotReference, templateVersionId } =
      await this.assertPreconditions(run);
    const definitions = definitionsForRun(run.auditType);
    const checkIds = await this.ensureChecks(run, definitions);
    const pageTargets = await this.pageTargets(run, snapshot);
    const review = await this.reviewStatus(run);
    const [
      unresolvedProhibitedClaimCount,
      templateLicenceValid,
      activePacks,
    ] = await Promise.all([
      this.unresolvedProhibitedClaims(run),
      this.templateLicenceValid(run, templateVersionId),
      this.activePublicPacks(),
    ]);

    await this.database.update(siteQualityRuns).set({
      status: 'RUNNING_DETERMINISTIC_CHECKS',
      pageCountPlanned: pageTargets.length,
      checkCount: definitions.length,
      startedAt: new Date(),
      failureCode: null,
      failureMessage: null,
      updatedAt: new Date(),
    }).where(eq(siteQualityRuns.id, run.id));
    await context.updateProgress({
      current: 1,
      total: Math.max(3, pageTargets.length + 3),
      message: 'Running deterministic site-quality checks.',
    });

    const deterministic = runDeterministicQualityChecks({
      snapshot,
      expectedTenantReference: run.tenantReference,
      expectedSiteReference: run.siteReference,
      expectedVersionReference: run.versionReference,
      siteVersionStatus: run.versionStatus,
      siteVersionDigestSha256: run.currentVersionDigest!,
      activeKnowledgePackCount: activePacks.length,
      activeKnowledgePackReference: activePacks[0]?.reference,
      activeKnowledgePackDigestSha256: activePacks[0]?.digest,
      unresolvedProhibitedClaimCount,
      staleApprovalCount: review.staleApprovalCount,
      agencyApprovalCurrent: review.agencyApprovalCurrent,
      clientApprovalRequired: review.clientApprovalRequired,
      clientApprovalCurrent: review.clientApprovalCurrent,
      templateLicenceValid,
    });
    const allFindings: SiteQualityFindingInput[] = [
      ...deterministic.findings.filter(finding => checkIds.has(finding.checkId)),
    ];
    await this.applyDeterministicResults(
      run,
      definitions,
      deterministic.checkResults,
      checkIds,
    );
    for (const finding of allFindings) {
      await this.persistFinding(run, checkIds, finding);
    }
    await this.persistEvidence(run, {
      checkId: 'KSQ_PLATFORM_SNAPSHOT_VALID',
      qualityCheckId: checkIds.get('KSQ_PLATFORM_SNAPSHOT_VALID'),
      evidenceType: 'STRUCTURED_RESULT',
      contentDigest: run.currentVersionDigest!,
      evidenceDigest: deterministic.snapshotDigestSha256,
      safeSummary: deterministic.validSnapshot
        ? 'The exact PREVIEW snapshot passed bounded structural validation.'
        : 'The exact PREVIEW snapshot failed bounded structural validation.',
      safeMetadata: {
        snapshotReference,
        validSnapshot: deterministic.validSnapshot,
        findingCount: deterministic.findings.length,
      },
      toolVersion: SITE_QUALITY_ENGINE_VERSION,
    });

    const browserDefinitions = definitions.filter(definition =>
      ['RENDERED_BROWSER', 'MIXED'].includes(definition.validationMethod));
    if (browserDefinitions.length > 0) {
      if (
        !this.config.browserEnabled
        || !this.config.previewOrigin
        || !this.config.previewTokenSecret
      ) {
        throw Object.assign(
          new Error('Required rendered browser auditing is unavailable.'),
          { code: 'QUALITY_BROWSER_UNAVAILABLE' },
        );
      }
      await this.runBrowserChecks(
        run,
        pageTargets,
        checkIds,
        allFindings,
        context,
      );
    }

    const humanDefinitions = definitions.filter(
      definition => definition.validationMethod === 'HUMAN_REVIEW',
    );
    for (const definition of humanDefinitions) {
      const finding: SiteQualityFindingInput = {
        checkId: definition.checkId,
        category: definition.category,
        severity: 'BLOCKING',
        publicationEffect: 'BLOCK',
        waivable: false,
        ruleIds: definition.ruleIds,
        code: 'HUMAN_REVIEW_REQUIRED',
        message: 'An authorised agency human-review decision is required.',
        evidenceSummary: 'No current human decision exists for this exact run and digest.',
        remediationGuidance: definition.remediationGuidance,
        status: 'OPEN',
        contentDigestSha256: run.currentVersionDigest!,
      };
      allFindings.push(finding);
      await this.persistFinding(run, checkIds, finding);
      await this.updateCheck(
        checkIds.get(definition.checkId)!,
        'DATA_REQUIRED',
        'An authorised agency human-review decision is required.',
      );
    }

    for (const definition of definitions.filter(
      item => item.validationMethod === 'AI_REVIEW',
    )) {
      await this.updateCheck(
        checkIds.get(definition.checkId)!,
        'NOT_APPLICABLE',
        'Optional AI-assisted review is disabled; no live AI call was made.',
      );
    }

    await this.database.update(siteQualityRuns).set({
      status: 'EVALUATING',
      updatedAt: new Date(),
    }).where(eq(siteQualityRuns.id, run.id));
    const summary = await this.finaliseRun(run);
    await context.updateProgress({
      current: Math.max(3, pageTargets.length + 3),
      total: Math.max(3, pageTargets.length + 3),
      message: 'Site-quality evaluation completed.',
    });
    await this.writeAudit(run, 'SITE_QUALITY_RUN_COMPLETED', 'SUCCESS', {
      auditType: run.auditType,
      publicationGateStatus: summary.gateStatus,
      blockingCount: summary.blockingCount,
      warningCount: summary.warningCount,
      pageCount: pageTargets.length,
      promotedGenerationToReview: summary.promotedToReview,
      publicationPerformed: false,
    });
    return {
      summary: `Site quality completed with gate status ${summary.gateStatus}.`,
      outputReferences: [run.reference],
      metrics: {
        checks: definitions.length,
        pages: pageTargets.length,
        blockingFindings: summary.blockingCount,
        warnings: summary.warningCount,
      },
    };
  }

  private async loadRun(payload: QualityPayload): Promise<QualityRunContext> {
    const [row] = await this.database.select({
      id: siteQualityRuns.id,
      reference: siteQualityRuns.publicReference,
      tenantId: siteQualityRuns.tenantId,
      tenantReference: tenants.businessReference,
      siteId: siteQualityRuns.siteId,
      siteReference: sites.publicReference,
      siteVersionId: siteQualityRuns.siteVersionId,
      versionReference: siteVersions.publicReference,
      versionStatus: siteVersions.status,
      versionGenerationStatus: siteVersions.generationStatus,
      currentVersionDigest: siteVersions.generationContentDigestSha256,
      generationRunId: siteQualityRuns.generationRunId,
      reviewCycleId: siteQualityRuns.reviewCycleId,
      knowledgePackId: siteQualityRuns.knowledgePackId,
      knowledgePackReference: knowledgePacks.publicReference,
      knowledgePackDigest: siteQualityRuns.knowledgePackDigestSha256,
      knowledgePackVersion: siteQualityRuns.knowledgePackSemanticVersion,
      auditType: siteQualityRuns.auditType,
      auditReason: siteQualityRuns.auditReason,
      policyVersion: siteQualityRuns.policyVersion,
      rendererVersion: siteQualityRuns.rendererVersion,
      engineVersion: siteQualityRuns.qualityEngineVersion,
      requestedByAgencyUserId: siteQualityRuns.requestedByAgencyUserId,
      requestedByAgencyUserReference: agencyUsers.publicReference,
    }).from(siteQualityRuns)
      .innerJoin(tenants, eq(siteQualityRuns.tenantId, tenants.id))
      .innerJoin(sites, and(
        eq(siteQualityRuns.siteId, sites.id),
        eq(sites.tenantId, tenants.id),
      ))
      .innerJoin(siteVersions, and(
        eq(siteQualityRuns.siteVersionId, siteVersions.id),
        eq(siteVersions.siteId, sites.id),
        eq(siteVersions.tenantId, tenants.id),
      ))
      .innerJoin(
        knowledgePacks,
        eq(siteQualityRuns.knowledgePackId, knowledgePacks.id),
      )
      .innerJoin(
        agencyUsers,
        eq(siteQualityRuns.requestedByAgencyUserId, agencyUsers.id),
      )
      .where(and(
        eq(siteQualityRuns.publicReference, payload.qualityRunReference),
        eq(sites.publicReference, payload.siteReference),
        eq(siteVersions.publicReference, payload.siteVersionReference),
        eq(agencyUsers.publicReference, payload.requestedByAgencyUserReference),
      ))
      .limit(1);
    const auditType = SiteQualityAuditTypeSchema.safeParse(row?.auditType);
    if (!row || !auditType.success) {
      throw new SiteJobExecutionError(
        'TERMINAL_DATA_MISSING',
        'The exact tenant-scoped quality run could not be resolved.',
      );
    }
    return { ...row, auditType: auditType.data };
  }

  private async assertPreconditions(run: QualityRunContext) {
    if (
      !isQualityAuditableGenerationStatus(run.versionGenerationStatus)
      || !run.currentVersionDigest
      || run.currentVersionDigest.length !== 64
      || run.versionStatus === 'SUPERSEDED'
    ) {
      throw Object.assign(
        new Error('The exact site version is incomplete, stale, or superseded.'),
        { code: 'QUALITY_VERSION_STALE' },
      );
    }
    const [snapshot, activePacks] = await Promise.all([
      this.database.select({
        reference: siteRenderSnapshots.publicReference,
        content: siteRenderSnapshots.contentJson,
        templateVersionId: siteRenderSnapshots.templateVersionId,
      }).from(siteRenderSnapshots).where(and(
        eq(siteRenderSnapshots.tenantId, run.tenantId),
        eq(siteRenderSnapshots.siteId, run.siteId),
        eq(siteRenderSnapshots.siteVersionId, run.siteVersionId),
        eq(siteRenderSnapshots.snapshotKind, 'PREVIEW'),
        eq(
          siteRenderSnapshots.sourceContentDigestSha256,
          run.currentVersionDigest,
        ),
      )).orderBy(desc(siteRenderSnapshots.revision)).limit(1)
        .then(rows => rows[0]),
      this.activePublicPacks(),
    ]);
    if (!snapshot) {
      throw Object.assign(
        new Error('The exact digest-bound PREVIEW snapshot is unavailable.'),
        { code: 'QUALITY_SECURE_PREVIEW_UNAVAILABLE' },
      );
    }
    if (
      activePacks.length !== 1
      || activePacks[0].id !== run.knowledgePackId
      || activePacks[0].digest !== run.knowledgePackDigest
    ) {
      throw Object.assign(
        new Error('The pinned ACTIVE PUBLIC_SITE knowledge pack is no longer valid.'),
        { code: 'QUALITY_PRECONDITION_FAILED' },
      );
    }
    return {
      snapshot: snapshot.content,
      snapshotReference: snapshot.reference,
      templateVersionId: snapshot.templateVersionId,
    };
  }

  private activePublicPacks() {
    return this.database.select({
      id: knowledgePacks.id,
      reference: knowledgePacks.publicReference,
      digest: knowledgePacks.contentDigestSha256,
    }).from(knowledgePacks).where(and(
      eq(knowledgePacks.intendedScope, 'PUBLIC_SITE'),
      eq(knowledgePacks.status, 'ACTIVE'),
      isNotNull(knowledgePacks.contentDigestSha256),
    )).limit(2).then(rows => rows.map(row => ({
      ...row,
      digest: row.digest!,
    })));
  }

  private async ensureChecks(
    run: QualityRunContext,
    definitions: readonly SiteQualityCheckDefinition[],
  ) {
    const ids = new Map<string, string>();
    for (const definition of definitions) {
      const existing = await this.database.select({
        id: siteQualityChecks.id,
      }).from(siteQualityChecks).where(and(
        eq(siteQualityChecks.qualityRunId, run.id),
        isNull(siteQualityChecks.pageRunId),
        eq(siteQualityChecks.checkId, definition.checkId),
      )).limit(1).then(rows => rows[0]);
      const row = existing ?? await this.database.insert(siteQualityChecks)
        .values({
          qualityRunId: run.id,
          tenantId: run.tenantId,
          checkId: definition.checkId,
          category: definition.category,
          validationMethod: definition.validationMethod,
          severity: definition.severity,
          publicationEffect: definition.publicationEffect,
          waivable: definition.waivable,
          result: 'DATA_REQUIRED',
          ruleIdsJson: definition.ruleIds,
          safeSummary: 'The check is awaiting execution.',
          engineVersion: definition.engineVersion,
          startedAt: new Date(),
        }).returning({ id: siteQualityChecks.id }).then(rows => rows[0]);
      ids.set(definition.checkId, row.id);
    }
    return ids;
  }

  private async applyDeterministicResults(
    run: QualityRunContext,
    definitions: readonly SiteQualityCheckDefinition[],
    results: ReadonlyMap<string, 'PASS' | 'FAIL' | 'DATA_REQUIRED'>,
    checkIds: ReadonlyMap<string, string>,
  ) {
    for (const definition of definitions) {
      if (!['DETERMINISTIC', 'MIXED'].includes(definition.validationMethod)) {
        continue;
      }
      const result = results.get(definition.checkId) ?? 'DATA_REQUIRED';
      await this.updateCheck(
        checkIds.get(definition.checkId)!,
        result,
        result === 'PASS'
          ? 'The deterministic check passed for the exact version.'
          : result === 'FAIL'
            ? 'The deterministic check produced one or more findings.'
            : 'Additional rendered or governed evidence is required.',
      );
    }
    await this.database.update(siteQualityRuns).set({
      status: 'EVALUATING',
      updatedAt: new Date(),
    }).where(eq(siteQualityRuns.id, run.id));
  }

  private updateCheck(
    checkId: string,
    result: SiteQualityCheckResult,
    safeSummary: string,
    evidenceDigest?: string,
  ) {
    return this.database.update(siteQualityChecks).set({
      result,
      safeSummary: safeSummary.slice(0, 1_000),
      evidenceDigestSha256: evidenceDigest ?? null,
      completedAt: new Date(),
    }).where(eq(siteQualityChecks.id, checkId));
  }

  private async pageTargets(
    run: QualityRunContext,
    rawSnapshot: unknown,
  ): Promise<PageTarget[]> {
    const snapshot = PublishedSiteSnapshotSchema.parse(rawSnapshot);
    const pages = await this.database.select({
      id: sitePages.id,
      reference: sitePages.publicReference,
    }).from(sitePages).where(and(
      eq(sitePages.tenantId, run.tenantId),
      eq(sitePages.siteId, run.siteId),
      eq(sitePages.versionId, run.siteVersionId),
      isNull(sitePages.archivedAt),
    ));
    const ids = new Map(pages.map(page => [page.reference, page.id]));
    return snapshot.pages
      .filter(page => page.active && page.pageType !== 'BOOKING')
      .map(page => {
        const id = ids.get(page.publicReference);
        if (!id) {
          throw Object.assign(
            new Error('A snapshot page does not belong to the exact site version.'),
            { code: 'QUALITY_PRECONDITION_FAILED' },
          );
        }
        return {
          id,
          reference: page.publicReference,
          path: page.path,
          contentDigest: sha256(page),
        };
      });
  }

  private unresolvedProhibitedClaims(run: QualityRunContext) {
    if (!run.generationRunId) return Promise.resolve(0);
    return this.database.select({
      count: sql<number>`count(*)::int`,
    }).from(siteGenerationClaims).where(and(
      eq(siteGenerationClaims.tenantId, run.tenantId),
      eq(siteGenerationClaims.generationRunId, run.generationRunId),
      inArray(siteGenerationClaims.claimStatus, ['UNSUPPORTED', 'PROHIBITED']),
    )).then(rows => Number(rows[0]?.count ?? 0));
  }

  private async templateLicenceValid(
    run: QualityRunContext,
    templateVersionId: string,
  ) {
    const [template] = await this.database.select({
      sourceId: templateSources.id,
      sourceType: templateSources.sourceType,
    }).from(templateVersions)
      .innerJoin(
        templateSources,
        eq(templateVersions.templateSourceId, templateSources.id),
      )
      .where(eq(templateVersions.id, templateVersionId))
      .limit(1);
    if (!template) return false;
    if (template.sourceType !== 'ENVATO_HTML') return true;
    const now = new Date();
    const [licence] = await this.database.select({
      id: templateLicenses.id,
    }).from(templateLicenses).where(and(
      eq(templateLicenses.templateSourceId, template.sourceId),
      or(
        eq(templateLicenses.templateVersionId, templateVersionId),
        isNull(templateLicenses.templateVersionId),
      ),
      or(
        eq(templateLicenses.tenantId, run.tenantId),
        isNull(templateLicenses.tenantId),
      ),
      or(
        eq(templateLicenses.siteId, run.siteId),
        isNull(templateLicenses.siteId),
      ),
      eq(templateLicenses.status, 'ACTIVE'),
      or(isNull(templateLicenses.expiresAt), gt(templateLicenses.expiresAt, now)),
    )).limit(1);
    return Boolean(licence);
  }

  private async reviewStatus(run: QualityRunContext) {
    const [review] = await this.database.select({
      id: siteReviewCycles.id,
      status: siteReviewCycles.status,
      digest: siteReviewCycles.pinnedContentDigestSha256,
      clientApprovalRequired: siteReviewCycles.clientApprovalRequired,
      clientApprovedAt: siteReviewCycles.clientApprovedAt,
      agencyApprovedAt: siteReviewCycles.agencyApprovedAt,
    }).from(siteReviewCycles).where(and(
      eq(siteReviewCycles.tenantId, run.tenantId),
      eq(siteReviewCycles.siteId, run.siteId),
      eq(siteReviewCycles.siteVersionId, run.siteVersionId),
    )).orderBy(desc(siteReviewCycles.reviewRevision)).limit(1);
    if (!review) {
      return {
        agencyApprovalCurrent: false,
        clientApprovalRequired: true,
        clientApprovalCurrent: false,
        staleApprovalCount: 0,
      };
    }
    const staleApprovalCount = await this.database.select({
      count: sql<number>`count(*)::int`,
    }).from(siteApprovalDecisions).where(and(
      eq(siteApprovalDecisions.reviewCycleId, review.id),
      or(
        isNotNull(siteApprovalDecisions.invalidatedAt),
        sql`${siteApprovalDecisions.contentDigestSha256} <> ${run.currentVersionDigest!}`,
      ),
    )).then(rows => Number(rows[0]?.count ?? 0));
    const digestCurrent = review.digest === run.currentVersionDigest;
    return {
      agencyApprovalCurrent: digestCurrent
        && review.status === 'AGENCY_APPROVED'
        && Boolean(review.agencyApprovedAt),
      clientApprovalRequired: review.clientApprovalRequired,
      clientApprovalCurrent: digestCurrent && (
        !review.clientApprovalRequired || Boolean(review.clientApprovedAt)
      ),
      staleApprovalCount,
    };
  }

  private async persistFinding(
    run: QualityRunContext,
    checkIds: ReadonlyMap<string, string>,
    finding: SiteQualityFindingInput,
  ) {
    const qualityCheckId = checkIds.get(finding.checkId);
    if (!qualityCheckId) return null;
    const pageId = finding.pageReference
      ? await this.database.select({ id: sitePages.id }).from(sitePages)
        .where(and(
          eq(sitePages.publicReference, finding.pageReference),
          eq(sitePages.versionId, run.siteVersionId),
          eq(sitePages.tenantId, run.tenantId),
        )).limit(1).then(rows => rows[0]?.id ?? null)
      : null;
    const conditions = [
      eq(siteQualityFindings.qualityRunId, run.id),
      eq(siteQualityFindings.qualityCheckId, qualityCheckId),
      eq(siteQualityFindings.code, finding.code),
      pageId
        ? eq(siteQualityFindings.pageId, pageId)
        : isNull(siteQualityFindings.pageId),
      finding.fieldPath
        ? eq(siteQualityFindings.fieldPath, finding.fieldPath)
        : isNull(siteQualityFindings.fieldPath),
    ];
    const existing = await this.database.select({
      id: siteQualityFindings.id,
      reference: siteQualityFindings.publicReference,
      status: siteQualityFindings.status,
    }).from(siteQualityFindings).where(and(...conditions)).limit(1)
      .then(rows => rows[0]);
    const evidenceDigest = sha256({
      checkId: finding.checkId,
      code: finding.code,
      pageReference: finding.pageReference ?? null,
      fieldPath: finding.fieldPath ?? null,
      evidenceSummary: finding.evidenceSummary,
      contentDigest: finding.contentDigestSha256,
    });
    if (existing) {
      const reopened = ['RESOLVED', 'NOT_APPLICABLE', 'SUPERSEDED'].includes(
        existing.status,
      );
      await this.database.update(siteQualityFindings).set({
        ...(reopened ? {
          status: 'OPEN',
          resolvedAt: null,
          resolvedByAgencyUserId: null,
          resolutionNote: null,
          supersededAt: null,
        } : {}),
        lastDetectedAt: new Date(),
        evidenceDigestSha256: evidenceDigest,
        updatedAt: new Date(),
      }).where(eq(siteQualityFindings.id, existing.id));
      if (reopened) {
        await this.writeAudit(
          run,
          'SITE_QUALITY_FINDING_REOPENED',
          'SUCCESS',
          {
            findingReference: existing.reference,
            checkId: finding.checkId,
            findingCode: finding.code,
            severity: finding.severity,
            publicationEffect: finding.publicationEffect,
          },
        );
      }
      return existing.id;
    }
    const created = await this.database.insert(siteQualityFindings).values({
      qualityRunId: run.id,
      qualityCheckId,
      tenantId: run.tenantId,
      siteId: run.siteId,
      siteVersionId: run.siteVersionId,
      pageId,
      fieldPath: finding.fieldPath ?? null,
      bookingActionReference: finding.bookingActionReference ?? null,
      checkId: finding.checkId,
      category: finding.category,
      severity: finding.severity,
      publicationEffect: finding.publicationEffect,
      waivable: finding.waivable,
      ruleIdsJson: finding.ruleIds,
      code: finding.code,
      safeMessage: finding.message,
      evidenceSummary: finding.evidenceSummary,
      remediationGuidance: finding.remediationGuidance,
      status: finding.status,
      contentDigestSha256: finding.contentDigestSha256,
      evidenceDigestSha256: evidenceDigest,
    }).returning({
      id: siteQualityFindings.id,
      reference: siteQualityFindings.publicReference,
    }).then(rows => rows[0]);
    await this.writeAudit(run, 'SITE_QUALITY_FINDING_CREATED', 'SUCCESS', {
      findingReference: created.reference,
      checkId: finding.checkId,
      findingCode: finding.code,
      severity: finding.severity,
      publicationEffect: finding.publicationEffect,
    });
    return created.id;
  }

  private async persistEvidence(run: QualityRunContext, input: {
    checkId: string;
    qualityCheckId?: string;
    pageId?: string;
    viewport?: string;
    evidenceType: string;
    contentDigest: string;
    evidenceDigest: string;
    safeSummary: string;
    safeMetadata: Record<string, string | number | boolean | null>;
    toolVersion?: string;
  }) {
    const existing = await this.database.select({
      id: siteQualityEvidence.id,
    }).from(siteQualityEvidence).where(and(
      eq(siteQualityEvidence.qualityRunId, run.id),
      eq(siteQualityEvidence.evidenceDigestSha256, input.evidenceDigest),
      input.pageId
        ? eq(siteQualityEvidence.pageId, input.pageId)
        : isNull(siteQualityEvidence.pageId),
      input.viewport
        ? eq(siteQualityEvidence.viewport, input.viewport)
        : isNull(siteQualityEvidence.viewport),
    )).limit(1).then(rows => rows[0]);
    if (existing) return;
    await this.database.insert(siteQualityEvidence).values({
      qualityRunId: run.id,
      qualityCheckId: input.qualityCheckId ?? null,
      tenantId: run.tenantId,
      pageId: input.pageId ?? null,
      evidenceType: input.evidenceType,
      viewport: input.viewport ?? null,
      contentDigestSha256: input.contentDigest,
      evidenceDigestSha256: input.evidenceDigest,
      safeSummary: input.safeSummary,
      safeMetadataJson: input.safeMetadata,
      toolVersion: input.toolVersion,
      capturedAt: new Date(),
    });
  }

  private async runBrowserChecks(
    run: QualityRunContext,
    pages: readonly PageTarget[],
    checkIds: ReadonlyMap<string, string>,
    allFindings: SiteQualityFindingInput[],
    context: SiteJobLeaseContext,
  ) {
    await this.database.update(siteQualityRuns).set({
      status: 'RUNNING_BROWSER_CHECKS',
      updatedAt: new Date(),
    }).where(eq(siteQualityRuns.id, run.id));
    const preview = await this.createPreviewSession(run);
    let completedBrowserAudits = 0;
    let failedBrowserAudits = 0;
    let progress = 1;
    const work = [...pages];
    const worker = async () => {
      while (work.length > 0) {
        context.signal.throwIfAborted();
        const page = work.shift();
        if (!page) return;
        const pageRunId = await this.ensurePageRun(run, page);
        const viewportResults: Record<string, unknown> = {};
        let pageFailureCount = 0;
        let pageFindingCount = 0;
        for (const viewport of SITE_QUALITY_VIEWPORTS) {
          context.signal.throwIfAborted();
          try {
            const result = await this.browserAdapter.auditPage({
              preview,
              page: {
                pageReference: page.reference,
                path: page.path,
              },
              viewport,
              signal: context.signal,
            });
            completedBrowserAudits += 1;
            const findings = findingsFromBrowserResult(
              result,
              run.currentVersionDigest!,
            ).filter(finding => checkIds.has(finding.checkId));
            pageFindingCount += findings.length;
            allFindings.push(...findings);
            for (const finding of findings) {
              await this.persistFinding(run, checkIds, finding);
            }
            await this.persistEvidence(run, {
              checkId: 'BROWSER_PAGE_SUMMARY',
              pageId: page.id,
              viewport: viewport.key,
              evidenceType: 'BROWSER_SUMMARY',
              contentDigest: run.currentVersionDigest!,
              evidenceDigest: result.evidenceDigestSha256,
              safeSummary: 'A bounded isolated browser audit completed.',
              safeMetadata: {
                httpStatus: result.httpStatus,
                findingCount: findings.length,
                accessibilityViolationCount:
                  result.accessibilityViolations.length,
                failedCriticalResourceCount:
                  result.failedCriticalResourceCount,
                consoleErrorCount: result.consoleErrorCount,
                imagesMissingDimensions: result.imagesMissingDimensions,
                oversizedImageCount: result.oversizedImageCount,
                horizontalOverflowPixels: result.horizontalOverflowPixels,
                primaryBookingVisible: result.primaryBookingVisible,
              },
              toolVersion: result.browserVersion,
            });
            viewportResults[viewport.key] = {
              status: 'READY',
              evidenceDigestSha256: result.evidenceDigestSha256,
              findingCount: findings.length,
            };
          } catch (error) {
            if (context.signal.aborted) throw error;
            pageFailureCount += 1;
            failedBrowserAudits += 1;
            viewportResults[viewport.key] = {
              status: 'FAILED',
              failureCode: 'QUALITY_RENDER_FAILED',
            };
            const renderCheck = checkIds.has('KSQ_TECH_SEO_RENDERABLE')
              ? 'KSQ_TECH_SEO_RENDERABLE'
              : [...checkIds.keys()].find(checkId =>
                qualityCheckById(checkId)?.validationMethod === 'RENDERED_BROWSER');
            if (renderCheck) {
              const definition = qualityCheckById(renderCheck)!;
              const finding: SiteQualityFindingInput = {
                checkId: renderCheck,
                category: definition.category,
                severity: 'BLOCKING',
                publicationEffect: 'BLOCK',
                waivable: false,
                pageReference: page.reference,
                ruleIds: definition.ruleIds,
                code: 'RENDER_FAILURE',
                message: 'The isolated browser audit could not render this page.',
                evidenceSummary: 'A safe renderer failure code was retained; raw diagnostics were excluded.',
                remediationGuidance: definition.remediationGuidance,
                status: 'OPEN',
                contentDigestSha256: run.currentVersionDigest!,
              };
              allFindings.push(finding);
              await this.persistFinding(run, checkIds, finding);
            }
          }
        }
        const pageFindings = allFindings.filter(
          finding => finding.pageReference === page.reference,
        );
        await this.database.update(siteQualityPageRuns).set({
          status: pageFailureCount === SITE_QUALITY_VIEWPORTS.length
            ? 'FAILED'
            : 'READY',
          viewportResultsJson: viewportResults,
          checkCount: SITE_QUALITY_VIEWPORTS.length,
          blockingCount: pageFindings.filter(
            finding => finding.publicationEffect === 'BLOCK',
          ).length,
          warningCount: pageFindings.filter(
            finding => finding.publicationEffect === 'WARNING',
          ).length,
          failureCode: pageFailureCount > 0
            ? 'QUALITY_CATEGORY_PARTIAL_FAILURE'
            : null,
          safeFailureMessage: pageFailureCount > 0
            ? `${pageFailureCount} viewport audit(s) failed safely.`
            : null,
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(siteQualityPageRuns.id, pageRunId));
        progress += 1;
        await this.database.update(siteQualityRuns).set({
          pageCountCompleted: progress - 1,
          updatedAt: new Date(),
        }).where(eq(siteQualityRuns.id, run.id));
        await context.updateProgress({
          current: progress,
          total: Math.max(3, pages.length + 3),
          message: `Completed browser checks for ${progress - 1} of ${pages.length} pages.`,
        });
        void pageFindingCount;
      }
    };
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(this.config.browserConcurrency, pages.length) },
          () => worker(),
        ),
      );
      await this.database.update(siteQualityRuns).set({
        pageCountCompleted: pages.length,
        updatedAt: new Date(),
      }).where(eq(siteQualityRuns.id, run.id));
      if (pages.length > 0 && completedBrowserAudits === 0) {
        throw Object.assign(
          new Error('No isolated browser audit completed successfully.'),
          { code: 'QUALITY_BROWSER_UNAVAILABLE' },
        );
      }
      await this.aggregateBrowserChecks(run, checkIds, allFindings);
      if (failedBrowserAudits > 0) {
        throw Object.assign(
          new Error(
            `${failedBrowserAudits} isolated browser audit(s) failed; completed evidence was preserved.`,
          ),
          { code: 'QUALITY_CATEGORY_PARTIAL_FAILURE' },
        );
      }
      await this.completePreviewSession(run, 'COMPLETED');
    } catch (error) {
      await this.completePreviewSession(run, 'REVOKED');
      throw error;
    }
  }

  private async createPreviewSession(
    run: QualityRunContext,
  ): Promise<SecureQualityPreview> {
    const jti = randomUUID();
    const ttlSeconds = Math.min(
      86_400,
      Math.max(60, Math.ceil(this.config.runTimeoutMs / 1_000)),
    );
    const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);
    const token = signSitePreviewToken({
      siteReference: run.siteReference,
      versionReference: run.versionReference,
      qualityRunReference: run.reference,
      purpose: 'QUALITY_AUDIT',
      secret: this.config.previewTokenSecret!,
      ttlSeconds,
      jti,
    });
    const tokenDigest = digestQualityToken(token);
    const existing = await this.database.select({
      id: siteQualityAuditSessions.id,
    }).from(siteQualityAuditSessions).where(
      eq(siteQualityAuditSessions.qualityRunId, run.id),
    ).limit(1).then(rows => rows[0]);
    if (existing) {
      await this.database.update(siteQualityAuditSessions).set({
        tokenJti: jti,
        tokenDigestSha256: tokenDigest,
        contentDigestSha256: run.currentVersionDigest!,
        status: 'ACTIVE',
        expiresAt,
        revokedAt: null,
        completedAt: null,
      }).where(eq(siteQualityAuditSessions.id, existing.id));
    } else {
      await this.database.insert(siteQualityAuditSessions).values({
        qualityRunId: run.id,
        tenantId: run.tenantId,
        siteId: run.siteId,
        siteVersionId: run.siteVersionId,
        tokenJti: jti,
        tokenDigestSha256: tokenDigest,
        contentDigestSha256: run.currentVersionDigest!,
        status: 'ACTIVE',
        expiresAt,
      });
    }
    return {
      qualityRunReference: run.reference,
      siteReference: run.siteReference,
      versionReference: run.versionReference,
      contentDigestSha256: run.currentVersionDigest!,
      previewBaseUrl: `${this.config.previewOrigin}/site-preview/`
        + `${run.siteReference}/${run.versionReference}`,
      bearerToken: token,
      expiresAt,
    };
  }

  private async ensurePageRun(run: QualityRunContext, page: PageTarget) {
    const existing = await this.database.select({
      id: siteQualityPageRuns.id,
    }).from(siteQualityPageRuns).where(and(
      eq(siteQualityPageRuns.qualityRunId, run.id),
      eq(siteQualityPageRuns.pageId, page.id),
    )).limit(1).then(rows => rows[0]);
    if (existing) {
      await this.database.update(siteQualityPageRuns).set({
        status: 'RENDERING',
        startedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(siteQualityPageRuns.id, existing.id));
      return existing.id;
    }
    return this.database.insert(siteQualityPageRuns).values({
      qualityRunId: run.id,
      tenantId: run.tenantId,
      siteId: run.siteId,
      siteVersionId: run.siteVersionId,
      pageId: page.id,
      pageContentDigestSha256: page.contentDigest,
      status: 'RENDERING',
      startedAt: new Date(),
    }).returning({ id: siteQualityPageRuns.id }).then(rows => rows[0].id);
  }

  private async aggregateBrowserChecks(
    run: QualityRunContext,
    checkIds: ReadonlyMap<string, string>,
    findings: readonly SiteQualityFindingInput[],
  ) {
    for (const [definitionId, databaseId] of checkIds.entries()) {
      const definition = qualityCheckById(definitionId);
      if (
        !definition
        || !['RENDERED_BROWSER', 'MIXED'].includes(definition.validationMethod)
      ) continue;
      const relevant = findings.filter(
        finding => finding.checkId === definitionId,
      );
      const result: SiteQualityCheckResult = relevant.some(
        finding => finding.publicationEffect === 'BLOCK',
      )
        ? 'FAIL'
        : relevant.some(finding => finding.publicationEffect === 'WARNING')
          ? 'WARNING'
          : 'PASS';
      await this.updateCheck(
        databaseId,
        result,
        relevant.length > 0
          ? `${relevant.length} bounded browser finding(s) were recorded.`
          : 'The rendered browser check passed at all required viewports.',
        sha256(relevant.map(finding => ({
          code: finding.code,
          pageReference: finding.pageReference ?? null,
        }))),
      );
    }
    await this.database.update(siteQualityRuns).set({
      status: 'EVALUATING',
      updatedAt: new Date(),
    }).where(eq(siteQualityRuns.id, run.id));
  }

  private completePreviewSession(
    run: QualityRunContext,
    status: 'COMPLETED' | 'REVOKED',
  ) {
    const now = new Date();
    return this.database.update(siteQualityAuditSessions).set({
      status,
      ...(status === 'COMPLETED'
        ? { completedAt: now }
        : { revokedAt: now }),
    }).where(eq(siteQualityAuditSessions.qualityRunId, run.id));
  }

  private async finaliseRun(run: QualityRunContext) {
    const [findings, checks, browserEvidence] = await Promise.all([
      this.database.select({
        publicationEffect: siteQualityFindings.publicationEffect,
        status: siteQualityFindings.status,
        waivable: siteQualityFindings.waivable,
        code: siteQualityFindings.code,
      }).from(siteQualityFindings).where(
        eq(siteQualityFindings.qualityRunId, run.id),
      ),
      this.database.select({
        result: siteQualityChecks.result,
      }).from(siteQualityChecks).where(
        eq(siteQualityChecks.qualityRunId, run.id),
      ),
      this.database.select({
        pageId: siteQualityEvidence.pageId,
        viewport: siteQualityEvidence.viewport,
      }).from(siteQualityEvidence).where(and(
        eq(siteQualityEvidence.qualityRunId, run.id),
        eq(siteQualityEvidence.evidenceType, 'BROWSER_SUMMARY'),
      )),
    ]);
    const current = findings.filter(finding =>
      currentFindingStatuses.includes(
        finding.status as typeof currentFindingStatuses[number],
      ));
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
    const preReviewBlockingCount = current.filter(
      finding => finding.publicationEffect === 'BLOCK'
        && finding.code !== 'HUMAN_REVIEW_REQUIRED',
    ).length;
    const gateStatus = blockingCount > 0
      ? 'BLOCKED'
      : warningCount > 0 || waivedCount > 0
        ? 'READY_WITH_WARNINGS'
        : 'READY';
    const completedAt = new Date();
    await this.database.update(siteQualityRuns).set({
      status: 'READY',
      publicationGateStatus: gateStatus,
      checkCount: checks.length,
      passedCheckCount: checks.filter(check => check.result === 'PASS').length,
      blockingCount,
      warningCount,
      waivedCount,
      nonWaivableCount,
      completedAt,
      updatedAt: completedAt,
    }).where(eq(siteQualityRuns.id, run.id));
    const promotionEligible = run.auditType === 'FULL_SITE_QUALITY'
      && Boolean(run.generationRunId)
      && browserEvidence.length > 0
      && preReviewBlockingCount === 0;
    let promotedToReview = false;
    if (promotionEligible) {
      promotedToReview = await this.database.transaction(async transaction => {
        const promotedRuns = await transaction.update(siteGenerationRuns).set({
          status: 'READY_FOR_REVIEW',
          updatedAt: completedAt,
        }).where(and(
          eq(siteGenerationRuns.id, run.generationRunId!),
          eq(siteGenerationRuns.status, 'DESIGN_COMPLETE'),
        )).returning({ id: siteGenerationRuns.id });
        if (!promotedRuns.length) return false;
        const promotedVersions = await transaction.update(siteVersions).set({
          generationStatus: 'READY_FOR_REVIEW',
          updatedAt: completedAt,
        }).where(and(
          eq(siteVersions.id, run.siteVersionId),
          eq(siteVersions.generationStatus, 'DESIGN_COMPLETE'),
        )).returning({ id: siteVersions.id });
        if (!promotedVersions.length) {
          throw new Error('The generation run and site version lifecycle states diverged during quality promotion.');
        }
        return true;
      });
      if (promotedToReview) {
        await finalizeProvisionedWorkspace(this.database, run.generationRunId!);
      }
    }
    return { gateStatus, blockingCount, warningCount, promotedToReview };
  }

  private async failRun(run: QualityRunContext, error: unknown) {
    const code = (
      error
      && typeof error === 'object'
      && 'code' in error
      && typeof error.code === 'string'
    ) ? error.code.slice(0, 100) : 'QUALITY_UNEXPECTED_FAILURE';
    const now = new Date();
    await this.database.update(siteQualityRuns).set({
      status: 'FAILED',
      publicationGateStatus: 'BLOCKED',
      failureCode: code,
      failureMessage: safeFailureMessage(error),
      failedAt: now,
      updatedAt: now,
    }).where(eq(siteQualityRuns.id, run.id));
    await this.completePreviewSession(run, 'REVOKED');
    await this.writeAudit(run, 'SITE_QUALITY_RUN_FAILED', 'FAILURE', {
      failureCode: code,
      publicationPerformed: false,
    });
  }

  private async cancelRun(run: QualityRunContext) {
    const now = new Date();
    await this.database.update(siteQualityRuns).set({
      status: 'CANCELLED',
      publicationGateStatus: 'BLOCKED',
      cancelledAt: now,
      updatedAt: now,
    }).where(eq(siteQualityRuns.id, run.id));
    await this.database.update(siteQualityPageRuns).set({
      status: 'CANCELLED',
      completedAt: now,
      updatedAt: now,
    }).where(and(
      eq(siteQualityPageRuns.qualityRunId, run.id),
      inArray(siteQualityPageRuns.status, ['PENDING', 'RENDERING', 'CHECKING']),
    ));
    await this.completePreviewSession(run, 'REVOKED');
    await this.writeAudit(run, 'SITE_QUALITY_RUN_CANCELLED', 'SUCCESS', {
      publicationPerformed: false,
    });
  }

  private writeAudit(
    run: QualityRunContext,
    action: string,
    outcome: 'SUCCESS' | 'FAILURE',
    metadata: Record<string, string | number | boolean | null>,
  ) {
    return this.database.insert(platformAuditEvents).values({
      agencyUserId: run.requestedByAgencyUserId,
      tenantId: run.tenantId,
      action,
      targetType: 'SITE_QUALITY_RUN',
      targetId: run.reference,
      outcome,
      metadata,
      eventCategory: 'WEBSITE',
      description: action.replaceAll('_', ' ').toLowerCase(),
      environment: this.environment,
      sourceComponent: 'site-worker',
      containsRedactions: false,
    });
  }

  async close() {
    await this.browserAdapter.close?.();
  }
}
