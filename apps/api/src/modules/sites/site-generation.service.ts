import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  or,
} from 'drizzle-orm';
import {
  agencyUsers,
  factFindingUploads,
  getDatabase,
  knowledgePacks,
  locations,
  provisioningActivity,
  provisioningRuns,
  provisioningRunSteps,
  services,
  siteBlueprintPages,
  siteBlueprints,
  siteAssets,
  siteGenerationFindings,
  siteGenerationPageRuns,
  siteGenerationRuns,
  sitePageSeoBriefs,
  siteSearchResearchEvidence,
  siteSearchStrategies,
  siteJobEvents,
  siteJobs,
  sitePages,
  siteSections,
  sites,
  siteVersions,
  templateLayoutPageTypes,
  templateLayoutRenderers,
  templateLayoutSections,
  templateLayouts,
  templateLicenses,
  templateSources,
  templateVersions,
  tenants,
  users,
} from '@ks-os/database';
import {
  SITE_GENERATION_PROMPT_TEMPLATE_VERSION,
  GOVERNED_SITE_ASSET_CATEGORIES,
  GOVERNED_SITE_ASSET_CONSENT_STATUSES,
  GOVERNED_SITE_ASSET_MIME_TYPES,
  GOVERNED_SITE_ASSET_SCAN_STATUSES,
  ApprovedGenerationAssetSchema,
  buildVerifiedBusinessFacts,
  generationDigest,
  generationIdempotencyKey,
  generationRetryProjection,
  searchStrategyDigest,
  validateSearchIntelligencePlan,
  PageSeoBriefSchema,
  parseSearchResearchEvidenceDatabaseRow,
  SearchIntelligenceStrategyV2Schema,
  SiteGenerationRunStatusSchema,
  isSiteGenerationProviderReady,
  terminalGenerationRunFailure,
  parseSiteGenerationConfig,
  type ApprovedGenerationAsset,
  type GenerationRunRequestSchema,
} from '@ks-os/site-generation';
import {
  GenerateMetadataPayloadSchema,
  GeneratePagePayloadSchema,
  GenerateSitePayloadSchema,
  GenerateStructuredDataPayloadSchema,
  RegenerateSectionPayloadSchema,
} from '@ks-os/site-jobs';
import { getSiteLayoutRenderer, listNativeLayoutManifests } from '@ks-os/site-templates';
import type { z } from 'zod';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';
import { AgencySiteJobService } from './site-job.service.js';
import { SiteJobEnqueueService } from './site-job-enqueue.service.js';
import {
  GovernedSiteAssetService,
  type GovernedSiteAssetCandidate,
} from './governed-site-asset.service.js';
import { auditV2TemplateReadiness, isV2TemplateManifest } from './v2-template-readiness.js';

type Database = ReturnType<typeof getDatabase>;
type GenerationRunRequest = z.infer<typeof GenerationRunRequestSchema>;

const GENERATION_JOB_TYPES = new Set([
  'GENERATE_SITE',
  'GENERATE_PAGE',
  'REGENERATE_SECTION',
  'GENERATE_METADATA',
  'GENERATE_STRUCTURED_DATA',
] as const);

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export class AgencySiteGenerationService {
  private readonly jobs: SiteJobEnqueueService;
  private readonly jobOperations: AgencySiteJobService;
  private readonly governedAssets: GovernedSiteAssetService;

  constructor(
    private readonly database: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
    private readonly environment:
      NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  ) {
    this.jobs = new SiteJobEnqueueService(database, GENERATION_JOB_TYPES, audit);
    this.jobOperations = new AgencySiteJobService(database, audit);
    this.governedAssets = new GovernedSiteAssetService(database, environment);
  }

  async create(
    actor: AgencyActor,
    siteReference: string,
    input: GenerationRunRequest,
  ) {
    const provider = parseSiteGenerationConfig(this.environment);
    if (!isSiteGenerationProviderReady(provider)) {
      throw fail(
        503,
        'SITE_GENERATION_DISABLED',
        'Structured generation is not enabled with a complete server-side provider configuration.',
      );
    }
    const modelKey = provider.model!;
    const [context] = await this.database
      .select({
        tenantId: tenants.id,
        tenantReference: tenants.businessReference,
        businessName: tenants.name,
        tenantStatus: tenants.lifecycleStatus,
        siteId: sites.id,
        siteStatus: sites.status,
        blueprintId: siteBlueprints.id,
        blueprintRevision: siteBlueprints.revision,
        blueprintStatus: siteBlueprints.status,
        sourceDataDigest: siteBlueprints.sourceDataDigest,
        templateVersionId: templateVersions.id,
        templateVersionReference: templateVersions.publicReference,
        templateVersionNumber: templateVersions.versionNumber,
        templateVersionStatus: templateVersions.status,
        templateVersionAnalysisStatus: templateVersions.analysisStatus,
        templateManifest: templateVersions.manifestJson,
        templateSourceId: templateSources.id,
        templateSourceType: templateSources.sourceType,
      })
      .from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .innerJoin(siteBlueprints, and(
        eq(siteBlueprints.siteId, sites.id),
        eq(siteBlueprints.tenantId, tenants.id),
      ))
      .innerJoin(templateVersions, eq(siteBlueprints.templateVersionId, templateVersions.id))
      .innerJoin(templateSources, eq(templateVersions.templateSourceId, templateSources.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteBlueprints.publicReference, input.blueprintReference),
      ))
      .limit(1);
    if (!context) {
      throw fail(404, 'GENERATION_BLUEPRINT_NOT_FOUND', 'The blueprint does not belong to the requested site.');
    }
    if (['SUSPENDED', 'ARCHIVED'].includes(context.siteStatus)
      || ['SUSPENDED', 'OFFBOARDING', 'OFFBOARDED'].includes(context.tenantStatus)) {
      throw fail(409, 'GENERATION_SITE_UNAVAILABLE', 'Suspended or archived sites cannot be generated.');
    }
    if (context.blueprintStatus !== 'APPROVED') {
      throw fail(409, 'GENERATION_BLUEPRINT_NOT_APPROVED', 'An approved blueprint is required.');
    }
    if (context.templateVersionStatus !== 'APPROVED') {
      throw fail(409, 'GENERATION_TEMPLATE_NOT_APPROVED', 'The pinned template version must be approved.');
    }
    await this.assertV2TemplateReady(context);
    const knowledge = await this.resolveKnowledgePack(input.knowledgePackReference);
    const blueprintPages = await this.resolveCompatiblePages(context);
    const searchIntelligence = isV2TemplateManifest(context.templateManifest)
      ? await this.resolveApprovedSearchIntelligence(context, blueprintPages)
      : null;
    await this.assertTemplateLicence(context);
    const assetCandidates = await this.governedAssets.prepare({
      tenantId: context.tenantId,
      siteId: context.siteId,
      siteReference,
      businessName: context.businessName,
    });
    const facts = await this.verifiedFactSnapshot(
      context.tenantId,
      context.siteId,
      { assetCandidates },
    );
    const sourceDataDigestSha256 = generationDigest(facts);
    const idempotencyKey = generationIdempotencyKey({
      tenantReference: context.tenantReference,
      siteReference,
      blueprintReference: input.blueprintReference,
      blueprintRevision: context.blueprintRevision,
      templateVersionReference: context.templateVersionReference,
      knowledgePackReference: knowledge.reference,
      knowledgePackSemanticVersion: knowledge.semanticVersion,
      verifiedBusinessDataDigestSha256: sourceDataDigestSha256,
      generatorVersion: provider.generatorVersion,
      generationReason: input.generationReason,
      ...(searchIntelligence
        ? { searchStrategyDigestSha256: searchIntelligence.digestSha256 }
        : {}),
    });
    const [agencyUser] = await this.database
      .select({ reference: agencyUsers.publicReference })
      .from(agencyUsers)
      .where(and(eq(agencyUsers.id, actor.agencyUserId), eq(agencyUsers.status, 'ACTIVE')))
      .limit(1);
    if (!agencyUser) throw fail(403, 'AGENCY_ACCESS_DENIED', 'The agency actor is not active.');

    return this.database.transaction(async transaction => {
      const [existing] = await transaction
        .select({
          reference: siteGenerationRuns.publicReference,
          versionReference: siteVersions.publicReference,
          status: siteGenerationRuns.status,
        })
        .from(siteGenerationRuns)
        .leftJoin(siteVersions, eq(siteGenerationRuns.siteVersionId, siteVersions.id))
        .where(and(
          eq(siteGenerationRuns.tenantId, context.tenantId),
          eq(siteGenerationRuns.idempotencyKey, idempotencyKey),
        ))
        .limit(1);
      if (existing) return { ...existing, idempotentReplay: true };

      const [latest] = await transaction
        .select({ value: max(siteVersions.versionNumber) })
        .from(siteVersions)
        .where(eq(siteVersions.siteId, context.siteId));
      const [version] = await transaction.insert(siteVersions).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        versionNumber: Number(latest?.value ?? 0) + 1,
        status: 'DRAFT',
        changeSummary: `Structured generation from approved blueprint revision ${context.blueprintRevision}.`,
        generationStatus: 'INCOMPLETE',
        createdByAgencyUserId: actor.agencyUserId,
      }).returning({ id: siteVersions.id, reference: siteVersions.publicReference });
      await this.governedAssets.materialize(transaction, {
        tenantId: context.tenantId,
        siteId: context.siteId,
        versionId: version.id,
      }, assetCandidates);
      const [run] = await transaction.insert(siteGenerationRuns).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        siteVersionId: version.id,
        blueprintId: context.blueprintId,
        blueprintRevision: context.blueprintRevision,
        templateVersionId: context.templateVersionId,
        knowledgePackId: knowledge.id,
        knowledgePackSemanticVersion: knowledge.semanticVersion,
        searchStrategyId: searchIntelligence?.id,
        searchStrategyVersion: searchIntelligence?.version,
        searchStrategyDigestSha256: searchIntelligence?.digestSha256,
        generationReason: input.generationReason,
        generatorVersion: provider.generatorVersion,
        providerKey: provider.provider,
        modelKey,
        idempotencyKey,
        sourceDataDigestSha256,
        assetInputJson: facts.approvedAssets,
        promptTemplateVersion: SITE_GENERATION_PROMPT_TEMPLATE_VERSION,
        pageCountPlanned: blueprintPages.length,
        requestedByAgencyUserId: actor.agencyUserId,
      }).returning({ id: siteGenerationRuns.id, reference: siteGenerationRuns.publicReference });
      await transaction.update(siteVersions).set({
        generationRunId: run.id,
        generationStatus: 'INCOMPLETE',
      }).where(eq(siteVersions.id, version.id));
      const payload = GenerateSitePayloadSchema.parse({
        jobType: 'GENERATE_SITE',
        siteReference,
        blueprintReference: input.blueprintReference,
        knowledgePackReference: knowledge.reference,
        requestedByAgencyUserReference: agencyUser.reference,
        generationReason: input.generationReason,
      });
      const [job] = await transaction.insert(siteJobs).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        versionId: version.id,
        blueprintId: context.blueprintId,
        jobType: 'GENERATE_SITE',
        status: 'PENDING',
        idempotencyKey: `generation:${idempotencyKey}`,
        sourceReference: run.reference,
        sourceDigestSha256: sourceDataDigestSha256,
        payloadJson: payload,
        payloadSchemaVersion: 1,
        priority: 100,
        maxAttempts: 5,
        createdByAgencyUserId: actor.agencyUserId,
      }).returning({ id: siteJobs.id, reference: siteJobs.publicReference });
      await transaction.update(siteGenerationRuns)
        .set({ siteJobId: job.id })
        .where(eq(siteGenerationRuns.id, run.id));
      await transaction.insert(siteJobEvents).values({
        jobId: job.id,
        tenantId: context.tenantId,
        eventType: 'JOB_CREATED',
        statusTo: 'PENDING',
        createdByAgencyUserId: actor.agencyUserId,
        safeMessage: 'A validated structured site-generation job was created.',
      });
      await this.audit.write(actor, 'SITE_GENERATION_REQUESTED', 'SITE_GENERATION_RUN', run.reference, {
        tenantId: context.tenantId,
        category: 'WEBSITE',
        metadata: {
          siteReference,
          blueprintReference: input.blueprintReference,
          blueprintRevision: context.blueprintRevision,
          templateVersionReference: context.templateVersionReference,
          knowledgePackReference: knowledge.reference,
          providerKey: provider.provider,
          modelKey,
          searchStrategyReference: searchIntelligence?.reference ?? null,
          searchStrategyVersion: searchIntelligence?.version ?? null,
          searchStrategyDigestSha256: searchIntelligence?.digestSha256 ?? null,
          pageCount: blueprintPages.length,
        },
        tx: transaction,
      });
      return {
        reference: run.reference,
        versionReference: version.reference,
        status: 'PENDING' as const,
        idempotentReplay: false,
      };
    });
  }

  async list(siteReference: string) {
    await this.reconcileTerminalGenerationRuns(siteReference, {
      reason: 'Automatic reconciliation while reading generation status.',
    });
    return this.database.select({
      reference: siteGenerationRuns.publicReference,
      siteReference: sites.publicReference,
      versionReference: siteVersions.publicReference,
      blueprintReference: siteBlueprints.publicReference,
      knowledgePackReference: knowledgePacks.publicReference,
      knowledgePackSemanticVersion: siteGenerationRuns.knowledgePackSemanticVersion,
      generatorVersion: siteGenerationRuns.generatorVersion,
      providerKey: siteGenerationRuns.providerKey,
      modelKey: siteGenerationRuns.modelKey,
      searchStrategyReference: siteSearchStrategies.publicReference,
      searchStrategyVersion: siteGenerationRuns.searchStrategyVersion,
      searchStrategyDigestSha256: siteGenerationRuns.searchStrategyDigestSha256,
      status: siteGenerationRuns.status,
      pageCountPlanned: siteGenerationRuns.pageCountPlanned,
      pageCountCompleted: siteGenerationRuns.pageCountCompleted,
      sectionCountPlanned: siteGenerationRuns.sectionCountPlanned,
      sectionCountCompleted: siteGenerationRuns.sectionCountCompleted,
      failureCode: siteGenerationRuns.failureCode,
      failureMessage: siteGenerationRuns.failureMessage,
      createdAt: siteGenerationRuns.createdAt,
      completedAt: siteGenerationRuns.completedAt,
    }).from(siteGenerationRuns)
      .innerJoin(sites, eq(siteGenerationRuns.siteId, sites.id))
      .leftJoin(siteVersions, eq(siteGenerationRuns.siteVersionId, siteVersions.id))
      .innerJoin(siteBlueprints, eq(siteGenerationRuns.blueprintId, siteBlueprints.id))
      .innerJoin(knowledgePacks, eq(siteGenerationRuns.knowledgePackId, knowledgePacks.id))
      .leftJoin(siteSearchStrategies, eq(siteGenerationRuns.searchStrategyId, siteSearchStrategies.id))
      .where(eq(sites.publicReference, siteReference))
      .orderBy(desc(siteGenerationRuns.createdAt));
  }

  async get(siteReference: string, runReference: string) {
    const rows = await this.list(siteReference);
    const run = rows.find(item => item.reference === runReference);
    if (!run) throw fail(404, 'SITE_GENERATION_RUN_NOT_FOUND', 'Generation run not found.');
    return run;
  }

  async findings(siteReference: string, runReference: string) {
    const run = await this.runContext(siteReference, runReference);
    return this.database.select({
      reference: siteGenerationFindings.publicReference,
      severity: siteGenerationFindings.severity,
      category: siteGenerationFindings.category,
      code: siteGenerationFindings.code,
      message: siteGenerationFindings.message,
      safeMetadata: siteGenerationFindings.safeMetadataJson,
      current: siteGenerationFindings.current,
      resolvedAt: siteGenerationFindings.resolvedAt,
      createdAt: siteGenerationFindings.createdAt,
    }).from(siteGenerationFindings)
      .where(and(
        eq(siteGenerationFindings.generationRunId, run.id),
        eq(siteGenerationFindings.tenantId, run.tenantId),
      ))
      .orderBy(desc(siteGenerationFindings.createdAt));
  }

  async resolveFinding(
    actor: AgencyActor,
    siteReference: string,
    runReference: string,
    findingReference: string,
    resolutionNote: string,
  ) {
    const run = await this.runContext(siteReference, runReference);
    const [resolved] = await this.database.update(siteGenerationFindings).set({
      current: false,
      resolvedAt: new Date(),
      resolvedByAgencyUserId: actor.agencyUserId,
      resolutionNote,
    }).where(and(
      eq(siteGenerationFindings.publicReference, findingReference),
      eq(siteGenerationFindings.generationRunId, run.id),
      eq(siteGenerationFindings.tenantId, run.tenantId),
      eq(siteGenerationFindings.current, true),
    )).returning({ reference: siteGenerationFindings.publicReference });
    if (!resolved) throw fail(404, 'SITE_GENERATION_FINDING_NOT_FOUND', 'Current generation finding not found.');
    await this.audit.write(
      actor,
      'SITE_GENERATION_FINDING_RESOLVED',
      'SITE_GENERATION_FINDING',
      findingReference,
      {
        tenantId: run.tenantId,
        reason: resolutionNote,
        category: 'WEBSITE',
        metadata: { generationRunReference: runReference },
      },
    );
    return { reference: findingReference, resolved: true as const };
  }

  async cancel(actor: AgencyActor, siteReference: string, runReference: string, reason: string) {
    const run = await this.runContext(siteReference, runReference);
    if (!run.jobReference) throw fail(409, 'SITE_GENERATION_JOB_MISSING', 'The generation run has no job.');
    const job = await this.jobOperations.cancel(actor, run.jobReference, reason);
    const status = job.status === 'CANCELLED' ? 'CANCELLED' : 'CANCEL_REQUESTED';
    await this.database.update(siteGenerationRuns).set({
      status,
      ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
    }).where(eq(siteGenerationRuns.id, run.id));
    await this.audit.write(actor, 'SITE_GENERATION_CANCEL_REQUESTED', 'SITE_GENERATION_RUN', runReference, {
      tenantId: run.tenantId,
      reason,
      category: 'WEBSITE',
    });
    return { reference: runReference, status };
  }

  async retry(actor: AgencyActor, siteReference: string, runReference: string, reason: string) {
    await this.reconcileTerminalGenerationRuns(siteReference, {
      runReference,
      actor,
      reason: `Automatic reconciliation before retry: ${reason}`,
    });
    const run = await this.runContext(siteReference, runReference);
    if (!run.jobReference || !run.versionId || !run.versionReference) {
      throw fail(409, 'SITE_GENERATION_NOT_RETRYABLE', 'Only failed generation runs can be retried.');
    }
    const retry = generationRetryProjection({
      runReference,
      versionReference: run.versionReference,
      jobReference: run.jobReference,
      idempotencyKey: run.idempotencyKey,
      sourceDataDigestSha256: run.sourceDataDigestSha256,
      runStatus: SiteGenerationRunStatusSchema.parse(run.status),
      jobStatus: run.jobStatus || '',
    });
    if (!retry) {
      throw fail(409, 'SITE_GENERATION_NOT_RETRYABLE', 'Only failed generation runs can be retried.');
    }
    const jobReference = retry.jobReference;
    const versionId = run.versionId;
    const pinnedAssets = run.assetInputJson === null
      ? null
      : ApprovedGenerationAssetSchema.array().parse(run.assetInputJson);
    const currentFacts = await this.verifiedFactSnapshot(run.tenantId, run.siteId, {
      pinnedAssets,
    });
    if (generationDigest(currentFacts) !== run.sourceDataDigestSha256) {
      throw fail(
        409,
        'GENERATION_SOURCE_DATA_STALE',
        'Verified business data changed after this generation run was pinned.',
      );
    }
    await this.jobOperations.retry(
      actor,
      jobReference,
      reason,
      async transaction => {
        await transaction.update(siteGenerationRuns).set({
          status: 'PENDING',
          failureCode: null,
          failureMessage: null,
          updatedAt: new Date(),
        }).where(and(
          eq(siteGenerationRuns.id, run.id),
          eq(siteGenerationRuns.tenantId, run.tenantId),
        ));
        await transaction.update(siteVersions).set({
          generationStatus: 'INCOMPLETE',
          updatedAt: new Date(),
        }).where(and(
          eq(siteVersions.id, versionId),
          eq(siteVersions.tenantId, run.tenantId),
          eq(siteVersions.siteId, run.siteId),
        ));
        await this.audit.write(actor, 'SITE_GENERATION_RETRIED', 'SITE_GENERATION_RUN', runReference, {
          tenantId: run.tenantId,
          reason,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            versionReference: retry.versionReference,
            idempotencyKey: retry.idempotencyKey,
            sourceDataDigestSha256: retry.sourceDataDigestSha256,
            assetInputCount: pinnedAssets?.length ?? 0,
            reusedDurableJob: true,
          },
          tx: transaction,
        });
      },
    );
    return { reference: runReference, status: 'PENDING' as const };
  }

  private async reconcileTerminalGenerationRuns(
    siteReference: string,
    options: {
      runReference?: string;
      actor?: AgencyActor;
      reason: string;
    },
  ) {
    return this.database.transaction(async transaction => {
      const conditions = [eq(sites.publicReference, siteReference)];
      if (options.runReference) {
        conditions.push(eq(siteGenerationRuns.publicReference, options.runReference));
      }
      const rows = await transaction.select({
        id: siteGenerationRuns.id,
        reference: siteGenerationRuns.publicReference,
        tenantId: siteGenerationRuns.tenantId,
        status: siteGenerationRuns.status,
        versionId: siteGenerationRuns.siteVersionId,
        provisioningRunId: siteGenerationRuns.provisioningRunId,
        jobStatus: siteJobs.status,
        jobFailureCode: siteJobs.failureCode,
        jobFailureMessage: siteJobs.failureMessage,
      }).from(siteGenerationRuns)
        .innerJoin(sites, eq(siteGenerationRuns.siteId, sites.id))
        .innerJoin(siteJobs, eq(siteGenerationRuns.siteJobId, siteJobs.id))
        .where(and(...conditions))
        .for('update');
      const reconciled = [];
      for (const run of rows) {
        const parsedStatus = SiteGenerationRunStatusSchema.safeParse(run.status);
        if (!parsedStatus.success) continue;
        const failure = terminalGenerationRunFailure(parsedStatus.data, {
          status: run.jobStatus,
          failureCode: run.jobFailureCode,
          failureMessage: run.jobFailureMessage,
        });
        if (!failure) continue;
        const now = new Date();
        await transaction.update(siteGenerationRuns).set({
          status: 'FAILED',
          failureCode: failure.failureCode,
          failureMessage: failure.failureMessage,
          updatedAt: now,
        }).where(eq(siteGenerationRuns.id, run.id));
        if (run.versionId) {
          await transaction.update(siteVersions).set({
            generationStatus: 'FAILED',
            updatedAt: now,
          }).where(eq(siteVersions.id, run.versionId));
        }
        if (run.provisioningRunId) {
          await transaction.update(provisioningRunSteps).set({
            status: 'FAILED',
            failureCode: failure.failureCode,
            safeMessage: failure.failureMessage,
            completedAt: now,
            updatedAt: now,
          }).where(and(
            eq(provisioningRunSteps.provisioningRunId, run.provisioningRunId),
            eq(provisioningRunSteps.stepKey, 'GENERATE_SITE'),
          ));
          await transaction.update(provisioningRuns).set({
            status: 'PARTIALLY_FAILED',
            currentStep: 'GENERATE_SITE',
            failureCode: failure.failureCode,
            failureMessage: failure.failureMessage,
            retryable: false,
            failedAt: now,
            updatedAt: now,
          }).where(eq(provisioningRuns.id, run.provisioningRunId));
          await transaction.insert(provisioningActivity).values({
            provisioningRunId: run.provisioningRunId,
            tenantId: run.tenantId,
            eventType: 'SITE_GENERATION_STATE_RECONCILED',
            statusTo: 'PARTIALLY_FAILED',
            stepKey: 'GENERATE_SITE',
            safeMessage: 'A terminal durable job was reconciled with its generation run.',
            agencyUserId: options.actor?.agencyUserId,
          });
        }
        await this.audit.write(
          options.actor ?? null,
          'SITE_GENERATION_STATE_RECONCILED',
          'SITE_GENERATION_RUN',
          run.reference,
          {
            tenantId: run.tenantId,
            reason: options.reason,
            category: 'WEBSITE',
            sourceComponent: options.actor ? 'agency-api' : 'generation-status-read',
            metadata: {
              siteReference,
              jobStatus: run.jobStatus,
              failureCode: failure.failureCode,
            },
            tx: transaction,
          },
        );
        reconciled.push(run.reference);
      }
      return { rows, reconciled };
    });
  }

  async reconcileTerminalJobState(
    actor: AgencyActor,
    siteReference: string,
    runReference: string,
    reason: string,
  ) {
    if (actor.role !== 'PLATFORM_OWNER') {
      throw fail(403, 'AGENCY_ACCESS_DENIED', 'Only a platform owner can reconcile terminal generation state.');
    }
    const result = await this.reconcileTerminalGenerationRuns(siteReference, {
      runReference,
      actor,
      reason,
    });
    const run = result.rows[0];
    if (!run) throw fail(404, 'SITE_GENERATION_RUN_NOT_FOUND', 'Generation run not found.');
    if (result.reconciled.includes(runReference)) {
      return { reference: runReference, status: 'FAILED' as const, idempotentReplay: false as const };
    }
    if (['FAILED', 'CANCELLED', 'DESIGN_COMPLETE', 'READY_FOR_REVIEW', 'SUPERSEDED'].includes(run.status)) {
      return { reference: runReference, status: run.status, idempotentReplay: true as const };
    }
    throw fail(
      409,
      'SITE_GENERATION_JOB_NOT_TERMINAL',
      'Only a generation run whose durable job failed terminally can be reconciled.',
    );
  }

  async regeneratePage(actor: AgencyActor, siteReference: string, versionReference: string, pageReference: string) {
    const target = await this.resolveDraftPage(siteReference, versionReference, pageReference);
    const actorReference = await this.actorReference(actor);
    return this.jobs.enqueue(actor, {
      tenantReference: target.tenantReference,
      siteReference,
      versionReference,
      jobType: 'GENERATE_PAGE',
      payload: GeneratePagePayloadSchema.parse({
        jobType: 'GENERATE_PAGE',
        siteReference,
        siteVersionReference: versionReference,
        blueprintPageReference: target.blueprintPageReference,
        requestedByAgencyUserReference: actorReference,
      }),
      sourceReference: pageReference,
      sourceDigestSha256: generationDigest({ versionReference, pageReference, updatedAt: target.updatedAt }),
      operationVersion: 1,
    });
  }

  async regenerateSection(
    actor: AgencyActor,
    siteReference: string,
    versionReference: string,
    pageReference: string,
    sectionReference: string,
    instruction: string,
  ) {
    const target = await this.resolveDraftPage(siteReference, versionReference, pageReference, sectionReference);
    const actorReference = await this.actorReference(actor);
    return this.jobs.enqueue(actor, {
      tenantReference: target.tenantReference,
      siteReference,
      versionReference,
      jobType: 'REGENERATE_SECTION',
      payload: RegenerateSectionPayloadSchema.parse({
        jobType: 'REGENERATE_SECTION',
        siteReference,
        siteVersionReference: versionReference,
        pageReference,
        sectionReference,
        regenerationInstruction: instruction,
        requestedByAgencyUserReference: actorReference,
      }),
      sourceReference: sectionReference,
      sourceDigestSha256: generationDigest({
        versionReference,
        pageReference,
        sectionReference,
        instructionDigest: generationDigest(instruction),
        updatedAt: target.updatedAt,
      }),
      operationVersion: 1,
    });
  }

  async generateMetadata(actor: AgencyActor, siteReference: string, versionReference: string) {
    const target = await this.resolveDraftPage(siteReference, versionReference);
    const actorReference = await this.actorReference(actor);
    return this.jobs.enqueue(actor, {
      tenantReference: target.tenantReference,
      siteReference,
      versionReference,
      jobType: 'GENERATE_METADATA',
      payload: GenerateMetadataPayloadSchema.parse({
        jobType: 'GENERATE_METADATA',
        siteReference,
        siteVersionReference: versionReference,
        requestedByAgencyUserReference: actorReference,
      }),
      sourceReference: versionReference,
      sourceDigestSha256: generationDigest({ versionReference, operation: 'metadata' }),
      operationVersion: 1,
    });
  }

  async generateStructuredData(actor: AgencyActor, siteReference: string, versionReference: string) {
    const target = await this.resolveDraftPage(siteReference, versionReference);
    const actorReference = await this.actorReference(actor);
    return this.jobs.enqueue(actor, {
      tenantReference: target.tenantReference,
      siteReference,
      versionReference,
      jobType: 'GENERATE_STRUCTURED_DATA',
      payload: GenerateStructuredDataPayloadSchema.parse({
        jobType: 'GENERATE_STRUCTURED_DATA',
        siteReference,
        siteVersionReference: versionReference,
        requestedByAgencyUserReference: actorReference,
      }),
      sourceReference: versionReference,
      sourceDigestSha256: generationDigest({ versionReference, operation: 'structured-data' }),
      operationVersion: 1,
    });
  }

  private async resolveKnowledgePack(reference?: string) {
    const conditions = [
      eq(knowledgePacks.status, 'ACTIVE'),
      eq(knowledgePacks.intendedScope, 'PUBLIC_SITE'),
    ];
    if (reference) conditions.push(eq(knowledgePacks.publicReference, reference));
    const packs = await this.database.select({
      id: knowledgePacks.id,
      reference: knowledgePacks.publicReference,
      semanticVersion: knowledgePacks.semanticVersion,
    }).from(knowledgePacks).where(and(...conditions)).limit(2);
    if (packs.length !== 1) {
      throw fail(409, 'ACTIVE_KNOWLEDGE_PACK_REQUIRED', 'Exactly one active PUBLIC_SITE knowledge pack is required.');
    }
    return packs[0]!;
  }

  private async assertV2TemplateReady(context: {
    templateVersionId: string;
    templateVersionNumber: number;
    templateVersionAnalysisStatus: string;
    templateManifest: unknown;
  }) {
    if (!isV2TemplateManifest(context.templateManifest)) return;
    const layouts = await this.database.select({
      id: templateLayouts.id,
      semanticKey: templateLayouts.semanticKey,
      status: templateLayouts.status,
      sectionManifest: templateLayouts.sectionManifestJson,
      rendererStatus: templateLayoutRenderers.rendererStatus,
      rendererKey: templateLayoutRenderers.rendererKey,
      rendererVersion: templateLayoutRenderers.rendererVersion,
    }).from(templateLayouts)
      .leftJoin(templateLayoutRenderers, eq(templateLayouts.id, templateLayoutRenderers.templateLayoutId))
      .where(eq(templateLayouts.templateVersionId, context.templateVersionId));
    const layoutIds = layouts.map(layout => layout.id);
    const [pageTypes, sections] = layoutIds.length ? await Promise.all([
      this.database.select({ layoutId: templateLayoutPageTypes.templateLayoutId, pageType: templateLayoutPageTypes.pageType })
        .from(templateLayoutPageTypes).where(inArray(templateLayoutPageTypes.templateLayoutId, layoutIds)),
      this.database.select({ layoutId: templateLayoutSections.layoutId })
        .from(templateLayoutSections).where(inArray(templateLayoutSections.layoutId, layoutIds)),
    ]) : [[], []];
    const pageTypesByLayoutId = new Map<string, Set<string>>();
    for (const item of pageTypes) {
      const values = pageTypesByLayoutId.get(item.layoutId) ?? new Set<string>();
      values.add(item.pageType);
      pageTypesByLayoutId.set(item.layoutId, values);
    }
    const readiness = auditV2TemplateReadiness({
      manifest: context.templateManifest,
      analysisStatus: context.templateVersionAnalysisStatus,
      expectedLayouts: listNativeLayoutManifests({ templateVersionNumber: context.templateVersionNumber }).map(manifest => ({
        semanticKey: manifest.semanticKey,
        pageTypes: manifest.pageTypes,
      })),
      layouts: layouts.map(layout => {
        const compiledRenderer = layout.rendererKey ? getSiteLayoutRenderer(layout.rendererKey) : null;
        return {
          ...layout,
          compiledRendererVersion: compiledRenderer?.version ?? null,
          compiledRendererPageTypes: compiledRenderer?.pageTypes ?? [],
        };
      }),
      pageTypesByLayoutId,
      sectionLayoutIds: new Set(sections.map(section => section.layoutId)),
    });
    if (!readiness.ready) {
      throw fail(409, 'GENERATION_V2_TEMPLATE_NOT_READY', 'The pinned V2+ template is incomplete for its immutable versioned layout, renderer, section, and page-type capability set.');
    }
  }

  private async resolveCompatiblePages(context: {
    tenantId: string;
    siteId: string;
    blueprintId: string;
    templateVersionId: string;
  }) {
    const rows = await this.database.select({
      id: siteBlueprintPages.id,
      publicReference: siteBlueprintPages.publicReference,
      pageType: siteBlueprintPages.pageType,
      layoutId: templateLayouts.id,
      layoutStatus: templateLayouts.status,
      layoutTemplateVersionId: templateLayouts.templateVersionId,
      rendererStatus: templateLayoutRenderers.rendererStatus,
      rendererKey: templateLayoutRenderers.rendererKey,
    }).from(siteBlueprintPages)
      .leftJoin(templateLayouts, eq(siteBlueprintPages.templateLayoutId, templateLayouts.id))
      .leftJoin(templateLayoutRenderers, eq(templateLayouts.id, templateLayoutRenderers.templateLayoutId))
      .where(and(
        eq(siteBlueprintPages.blueprintId, context.blueprintId),
        eq(siteBlueprintPages.tenantId, context.tenantId),
      ));
    if (!rows.length) throw fail(409, 'GENERATION_BLUEPRINT_EMPTY', 'The approved blueprint has no pages.');
    for (const row of rows) {
      if (!row.layoutId || row.layoutStatus !== 'APPROVED'
        || row.layoutTemplateVersionId !== context.templateVersionId) {
        throw fail(409, 'GENERATION_LAYOUT_NOT_APPROVED', 'Every blueprint page requires an approved pinned layout.');
      }
      if (row.rendererStatus !== 'READY' || !row.rendererKey) {
        throw fail(409, 'GENERATION_RENDERER_NOT_READY', 'Every approved layout requires a ready renderer mapping.');
      }
      const [compatible] = await this.database.select({ id: templateLayoutPageTypes.id })
        .from(templateLayoutPageTypes)
        .where(and(
          eq(templateLayoutPageTypes.templateLayoutId, row.layoutId),
          eq(templateLayoutPageTypes.pageType, row.pageType),
        )).limit(1);
      if (!compatible) throw fail(409, 'GENERATION_LAYOUT_INCOMPATIBLE', 'A blueprint layout is incompatible with its page type.');
    }
    return rows;
  }

  private async resolveApprovedSearchIntelligence(
    context: {
      tenantId: string;
      siteId: string;
      blueprintId: string;
      blueprintRevision: number;
    },
    blueprintPages: ReadonlyArray<{ id: string; publicReference: string; pageType: string }>,
  ) {
    const strategies = await this.database.select({
      id: siteSearchStrategies.id,
      reference: siteSearchStrategies.publicReference,
      version: siteSearchStrategies.strategyVersion,
      digestSha256: siteSearchStrategies.outputDigestSha256,
      value: siteSearchStrategies.strategyJson,
    }).from(siteSearchStrategies).where(and(
      eq(siteSearchStrategies.tenantId, context.tenantId),
      eq(siteSearchStrategies.siteId, context.siteId),
      eq(siteSearchStrategies.blueprintId, context.blueprintId),
      eq(siteSearchStrategies.blueprintRevision, context.blueprintRevision),
      eq(siteSearchStrategies.status, 'APPROVED'),
    )).limit(2);
    if (strategies.length !== 1) {
      throw fail(409, 'APPROVED_SEARCH_INTELLIGENCE_REQUIRED', 'V2 generation requires exactly one approved Search Intelligence strategy for the pinned blueprint revision.');
    }
    const pinned = strategies[0]!;
    const strategy = SearchIntelligenceStrategyV2Schema.parse(pinned.value);
    if (searchStrategyDigest(strategy) !== pinned.digestSha256) {
      throw fail(409, 'SEARCH_INTELLIGENCE_DIGEST_MISMATCH', 'The approved search strategy digest does not match its governed content.');
    }
    const [briefRows, evidenceRows] = await Promise.all([
      this.database.select({ value: sitePageSeoBriefs.briefJson })
        .from(sitePageSeoBriefs)
        .where(and(
          eq(sitePageSeoBriefs.strategyId, pinned.id),
          eq(sitePageSeoBriefs.status, 'APPROVED'),
        )),
      this.database.select({
        reference: siteSearchResearchEvidence.publicReference,
        providerKey: siteSearchResearchEvidence.providerKey,
        query: siteSearchResearchEvidence.query,
        market: siteSearchResearchEvidence.market,
        locale: siteSearchResearchEvidence.locale,
        location: siteSearchResearchEvidence.searchLocation,
        language: siteSearchResearchEvidence.language,
        device: siteSearchResearchEvidence.device,
        capturedAt: siteSearchResearchEvidence.capturedAt,
        expiresAt: siteSearchResearchEvidence.expiresAt,
        sourceUrl: siteSearchResearchEvidence.sourceUrl,
        sourceDigestSha256: siteSearchResearchEvidence.sourceDigestSha256,
        payloadDigestSha256: siteSearchResearchEvidence.payloadDigestSha256,
        notes: siteSearchResearchEvidence.notesJson,
      }).from(siteSearchResearchEvidence).where(and(
        eq(siteSearchResearchEvidence.tenantId, context.tenantId),
        eq(siteSearchResearchEvidence.siteId, context.siteId),
        eq(siteSearchResearchEvidence.strategyId, pinned.id),
      )),
    ]);
    const briefs = briefRows.map(row => PageSeoBriefSchema.parse(row.value));
    const evidence = evidenceRows.map(parseSearchResearchEvidenceDatabaseRow);
    const byBlueprintPage = new Map(briefs.map(brief => [brief.blueprintPageReference, brief]));
    const findings = validateSearchIntelligencePlan({
      strategy,
      briefs,
      evidence,
      plannedPages: blueprintPages.map(page => ({
        blueprintPageReference: page.publicReference,
        pageReference: byBlueprintPage.get(page.publicReference)?.pageReference ?? '',
        pageType: page.pageType,
      })),
    }).filter(finding => finding.blocking);
    if (findings.length) {
      throw fail(409, 'SEARCH_INTELLIGENCE_NOT_READY', `V2 generation is blocked by: ${findings.map(item => item.code).join(', ')}.`);
    }
    return { ...pinned, strategy, briefs, evidence };
  }

  private async assertTemplateLicence(context: {
    templateSourceType: string;
    templateSourceId: string;
    templateVersionId: string;
    tenantId: string;
    siteId: string;
  }) {
    if (context.templateSourceType !== 'ENVATO_HTML') return;
    const [licence] = await this.database.select({ id: templateLicenses.id })
      .from(templateLicenses)
      .where(and(
        eq(templateLicenses.templateSourceId, context.templateSourceId),
        or(eq(templateLicenses.templateVersionId, context.templateVersionId), isNull(templateLicenses.templateVersionId)),
        or(eq(templateLicenses.tenantId, context.tenantId), isNull(templateLicenses.tenantId)),
        or(eq(templateLicenses.siteId, context.siteId), isNull(templateLicenses.siteId)),
        eq(templateLicenses.status, 'ACTIVE'),
      )).limit(1);
    if (!licence) throw fail(409, 'GENERATION_TEMPLATE_LICENCE_REQUIRED', 'An applicable active Envato licence is required.');
  }

  private async verifiedFactSnapshot(
    tenantId: string,
    siteId: string,
    options: {
      assetCandidates?: readonly GovernedSiteAssetCandidate[];
      pinnedAssets?: readonly ApprovedGenerationAsset[] | null;
    } = {},
  ) {
    const assetConditions = [
      eq(siteAssets.tenantId, tenantId),
      eq(siteAssets.siteId, siteId),
      eq(siteAssets.status, 'READY'),
      or(
        isNull(siteAssets.sourceFactFindingUploadId),
        and(
          eq(factFindingUploads.uploadStatus, 'UPLOADED'),
          eq(factFindingUploads.agencyReviewStatus, 'APPROVED'),
          eq(factFindingUploads.publicUsePermission, true),
          eq(factFindingUploads.aiUsePermission, true),
          eq(factFindingUploads.copyrightConfirmed, true),
          inArray(factFindingUploads.consentStatus, GOVERNED_SITE_ASSET_CONSENT_STATUSES),
          inArray(factFindingUploads.malwareScanStatus, GOVERNED_SITE_ASSET_SCAN_STATUSES),
          inArray(factFindingUploads.assetCategory, GOVERNED_SITE_ASSET_CATEGORIES),
          inArray(factFindingUploads.mimeType, GOVERNED_SITE_ASSET_MIME_TYPES),
          or(isNull(factFindingUploads.boundStaffUserId), isNotNull(users.id)),
          or(isNull(factFindingUploads.boundServiceId), isNotNull(services.id)),
        ),
      ),
    ];
    if (Array.isArray(options.pinnedAssets) && options.pinnedAssets.length) {
      assetConditions.push(inArray(
        siteAssets.publicReference,
        options.pinnedAssets.map(asset => asset.publicReference),
      ));
    }
    const assetRowsPromise = Array.isArray(options.pinnedAssets)
      && options.pinnedAssets.length === 0
      ? Promise.resolve([])
      : this.database.select({
        reference: siteAssets.publicReference,
        kind: siteAssets.kind,
        alt: siteAssets.altText,
        width: siteAssets.width,
        height: siteAssets.height,
        boundStaffUserId: factFindingUploads.boundStaffUserId,
        boundStaffReference: users.publicReference,
        boundServiceId: factFindingUploads.boundServiceId,
        boundServiceReference: services.publicReference,
      })
        .from(siteAssets)
        .leftJoin(factFindingUploads, and(
          eq(siteAssets.sourceFactFindingUploadId, factFindingUploads.id),
          eq(siteAssets.tenantId, factFindingUploads.tenantId),
        ))
        .leftJoin(users, and(
          eq(factFindingUploads.boundStaffUserId, users.id),
          eq(factFindingUploads.tenantId, users.tenantId),
        ))
        .leftJoin(services, and(
          eq(factFindingUploads.boundServiceId, services.id),
          eq(factFindingUploads.tenantId, services.tenantId),
        ))
        .where(and(...assetConditions));
    const [business, serviceRows, locationRows, staffRows, assetRows] = await Promise.all([
      this.database.select({
        reference: tenants.businessReference,
        name: tenants.name,
        legalName: tenants.legalBusinessName,
        businessType: tenants.businessType,
        phone: tenants.operationalPhone,
        email: tenants.replyToEmail,
        primaryColour: tenants.primaryColor,
        secondaryColour: tenants.secondaryColor,
        accentColour: tenants.accentColor,
      }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
      this.database.select({
        reference: services.publicReference,
        name: services.name,
        description: services.description,
        duration: services.duration,
        price: services.price,
        active: services.isActive,
      }).from(services).where(and(eq(services.tenantId, tenantId), eq(services.isActive, true))),
      this.database.select({
        reference: locations.publicReference,
        name: locations.name,
        address: locations.address,
        postcode: locations.postcode,
        phone: locations.phone,
        active: locations.isActive,
      }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.isActive, true))),
      this.database.select({
        reference: users.publicReference,
        name: users.name,
        jobTitle: users.jobTitle,
        biography: users.bio,
        bookingEnabled: users.bookingEnabled,
      }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.accountStatus, 'ACTIVE'))),
      assetRowsPromise,
    ]);
    if (!business[0]) throw fail(409, 'GENERATION_BUSINESS_DATA_MISSING', 'Verified business data is unavailable.');
    const pinnedByReference = new Map(
      (options.pinnedAssets ?? []).map(asset => [asset.publicReference, asset]),
    );
    const governedAssets = new Map(assetRows.map(asset => {
      const pinned = pinnedByReference.get(asset.reference);
      const entityReference = pinned?.entityReference
        ?? (asset.boundStaffUserId ? asset.boundStaffReference : asset.boundServiceId
          ? asset.boundServiceReference : undefined);
      return [asset.reference, {
        reference: asset.reference,
        kind: asset.kind,
        ...(entityReference ? { entityReference } : {}),
        alt: asset.alt,
        width: asset.width,
        height: asset.height,
      }] as const;
    }));
    for (const candidate of options.assetCandidates ?? []) {
      governedAssets.set(candidate.publicReference, {
        reference: candidate.publicReference,
        kind: candidate.kind,
        ...(candidate.entityReference ? { entityReference: candidate.entityReference } : {}),
        alt: candidate.altText,
        width: candidate.width,
        height: candidate.height,
      });
    }
    const approvedAssets = [...governedAssets.values()];
    return buildVerifiedBusinessFacts({
      business: business[0],
      services: serviceRows,
      locations: locationRows,
      staff: staffRows,
      assetReferences: approvedAssets.map(asset => asset.reference),
      assets: approvedAssets,
    });
  }

  private async runContext(siteReference: string, runReference: string) {
    const [run] = await this.database.select({
      id: siteGenerationRuns.id,
      tenantId: siteGenerationRuns.tenantId,
      siteId: siteGenerationRuns.siteId,
      versionId: siteGenerationRuns.siteVersionId,
      versionReference: siteVersions.publicReference,
      status: siteGenerationRuns.status,
      idempotencyKey: siteGenerationRuns.idempotencyKey,
      sourceDataDigestSha256: siteGenerationRuns.sourceDataDigestSha256,
      assetInputJson: siteGenerationRuns.assetInputJson,
      jobReference: siteJobs.publicReference,
      jobStatus: siteJobs.status,
      businessName: tenants.name,
    }).from(siteGenerationRuns)
      .innerJoin(sites, eq(siteGenerationRuns.siteId, sites.id))
      .innerJoin(tenants, eq(siteGenerationRuns.tenantId, tenants.id))
      .leftJoin(siteVersions, eq(siteGenerationRuns.siteVersionId, siteVersions.id))
      .leftJoin(siteJobs, eq(siteGenerationRuns.siteJobId, siteJobs.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteGenerationRuns.publicReference, runReference),
      )).limit(1);
    if (!run) throw fail(404, 'SITE_GENERATION_RUN_NOT_FOUND', 'Generation run not found.');
    return run;
  }

  private async actorReference(actor: AgencyActor) {
    const [row] = await this.database.select({ reference: agencyUsers.publicReference })
      .from(agencyUsers).where(eq(agencyUsers.id, actor.agencyUserId)).limit(1);
    if (!row) throw fail(403, 'AGENCY_ACCESS_DENIED', 'Agency actor not found.');
    return row.reference;
  }

  private async resolveDraftPage(
    siteReference: string,
    versionReference: string,
    pageReference?: string,
    sectionReference?: string,
  ) {
    const conditions = [
      eq(sites.publicReference, siteReference),
      eq(siteVersions.publicReference, versionReference),
      eq(siteVersions.status, 'DRAFT'),
    ];
    if (pageReference) conditions.push(eq(sitePages.publicReference, pageReference));
    const [row] = await this.database.select({
      tenantReference: tenants.businessReference,
      pageId: sitePages.id,
      pageUpdatedAt: sitePages.updatedAt,
      sectionUpdatedAt: siteSections.updatedAt,
      blueprintPageReference: siteBlueprintPages.publicReference,
    }).from(siteVersions)
      .innerJoin(sites, and(eq(siteVersions.siteId, sites.id), eq(siteVersions.tenantId, sites.tenantId)))
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .leftJoin(sitePages, eq(sitePages.versionId, siteVersions.id))
      .leftJoin(siteSections, sectionReference
        ? and(
          eq(siteSections.pageId, sitePages.id),
          eq(siteSections.publicReference, sectionReference),
        )
        : eq(siteSections.pageId, sitePages.id))
      .leftJoin(siteGenerationPageRuns, eq(siteGenerationPageRuns.sitePageId, sitePages.id))
      .leftJoin(siteBlueprintPages, eq(siteGenerationPageRuns.blueprintPageId, siteBlueprintPages.id))
      .where(and(...conditions))
      .limit(1);
    if (!row || (pageReference && !row.pageId) || (pageReference && !row.blueprintPageReference)) {
      throw fail(409, 'DRAFT_GENERATION_TARGET_REQUIRED', 'Generation changes require an owned draft target.');
    }
    if (sectionReference && !row.sectionUpdatedAt) {
      throw fail(404, 'SITE_SECTION_NOT_FOUND', 'The section does not belong to the draft page.');
    }
    return {
      tenantReference: row.tenantReference,
      blueprintPageReference: row.blueprintPageReference!,
      updatedAt: row.sectionUpdatedAt ?? row.pageUpdatedAt ?? new Date(0),
    };
  }
}
