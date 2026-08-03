import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  max,
  or,
} from 'drizzle-orm';
import {
  agencyUsers,
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
  siteJobEvents,
  siteJobs,
  sitePages,
  siteSections,
  sites,
  siteVersions,
  templateLayoutPageTypes,
  templateLayoutRenderers,
  templateLayouts,
  templateLicenses,
  templateSources,
  templateVersions,
  tenants,
  users,
} from '@ks-os/database';
import {
  SITE_GENERATION_PROMPT_TEMPLATE_VERSION,
  buildVerifiedBusinessFacts,
  generationDigest,
  generationIdempotencyKey,
  parseSiteGenerationConfig,
  type GenerationRunRequestSchema,
} from '@ks-os/site-generation';
import {
  GenerateMetadataPayloadSchema,
  GeneratePagePayloadSchema,
  GenerateSitePayloadSchema,
  GenerateStructuredDataPayloadSchema,
  RegenerateSectionPayloadSchema,
} from '@ks-os/site-jobs';
import type { z } from 'zod';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';
import { AgencySiteJobService } from './site-job.service.js';
import { SiteJobEnqueueService } from './site-job-enqueue.service.js';

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

  constructor(
    private readonly database: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
    private readonly environment:
      NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  ) {
    this.jobs = new SiteJobEnqueueService(database, GENERATION_JOB_TYPES, audit);
    this.jobOperations = new AgencySiteJobService(database, audit);
  }

  async create(
    actor: AgencyActor,
    siteReference: string,
    input: GenerationRunRequest,
  ) {
    const provider = parseSiteGenerationConfig(this.environment);
    if (!provider.enabled || !provider.model) {
      throw fail(
        503,
        'SITE_GENERATION_DISABLED',
        'Structured generation is not enabled with a complete server-side provider configuration.',
      );
    }
    const modelKey = provider.model;
    const [context] = await this.database
      .select({
        tenantId: tenants.id,
        tenantReference: tenants.businessReference,
        tenantStatus: tenants.lifecycleStatus,
        siteId: sites.id,
        siteStatus: sites.status,
        blueprintId: siteBlueprints.id,
        blueprintRevision: siteBlueprints.revision,
        blueprintStatus: siteBlueprints.status,
        sourceDataDigest: siteBlueprints.sourceDataDigest,
        templateVersionId: templateVersions.id,
        templateVersionReference: templateVersions.publicReference,
        templateVersionStatus: templateVersions.status,
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
    const knowledge = await this.resolveKnowledgePack(input.knowledgePackReference);
    const blueprintPages = await this.resolveCompatiblePages(context);
    await this.assertTemplateLicence(context);
    const facts = await this.verifiedFactSnapshot(context.tenantId, context.siteId);
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
      const [run] = await transaction.insert(siteGenerationRuns).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        siteVersionId: version.id,
        blueprintId: context.blueprintId,
        blueprintRevision: context.blueprintRevision,
        templateVersionId: context.templateVersionId,
        knowledgePackId: knowledge.id,
        knowledgePackSemanticVersion: knowledge.semanticVersion,
        generationReason: input.generationReason,
        generatorVersion: provider.generatorVersion,
        providerKey: provider.provider,
        modelKey,
        idempotencyKey,
        sourceDataDigestSha256,
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
    const run = await this.runContext(siteReference, runReference);
    if (run.status !== 'FAILED' || !run.jobReference) {
      throw fail(409, 'SITE_GENERATION_NOT_RETRYABLE', 'Only failed generation runs can be retried.');
    }
    await this.jobOperations.retry(actor, run.jobReference, reason);
    await this.database.update(siteGenerationRuns).set({
      status: 'PENDING',
      failureCode: null,
      failureMessage: null,
    }).where(eq(siteGenerationRuns.id, run.id));
    await this.audit.write(actor, 'SITE_GENERATION_RETRIED', 'SITE_GENERATION_RUN', runReference, {
      tenantId: run.tenantId,
      reason,
      category: 'WEBSITE',
    });
    return { reference: runReference, status: 'PENDING' as const };
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
    return this.database.transaction(async transaction => {
      const [run] = await transaction.select({
        id: siteGenerationRuns.id,
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
        .where(and(
          eq(sites.publicReference, siteReference),
          eq(siteGenerationRuns.publicReference, runReference),
        )).limit(1).for('update');
      if (!run) throw fail(404, 'SITE_GENERATION_RUN_NOT_FOUND', 'Generation run not found.');
      if (['FAILED', 'CANCELLED', 'READY_FOR_REVIEW'].includes(run.status)) {
        return { reference: runReference, status: run.status, idempotentReplay: true as const };
      }
      if (!['FAILED', 'DEAD_LETTER'].includes(run.jobStatus)) {
        throw fail(
          409,
          'SITE_GENERATION_JOB_NOT_TERMINAL',
          'Only a generation run whose durable job failed terminally can be reconciled.',
        );
      }
      const failureCode = (run.jobFailureCode || 'TERMINAL_JOB_STATE_RECONCILED').slice(0, 100);
      const failureMessage = (
        run.jobFailureMessage
        || 'The durable generation job failed before its run lifecycle was persisted.'
      ).slice(0, 500);
      await transaction.update(siteGenerationRuns).set({
        status: 'FAILED',
        failureCode,
        failureMessage,
        updatedAt: new Date(),
      }).where(eq(siteGenerationRuns.id, run.id));
      if (run.versionId) {
        await transaction.update(siteVersions).set({
          generationStatus: 'FAILED',
          updatedAt: new Date(),
        }).where(eq(siteVersions.id, run.versionId));
      }
      if (run.provisioningRunId) {
        await transaction.update(provisioningRunSteps).set({
          status: 'FAILED',
          failureCode,
          safeMessage: failureMessage,
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(provisioningRunSteps.provisioningRunId, run.provisioningRunId),
          eq(provisioningRunSteps.stepKey, 'GENERATE_SITE'),
        ));
        await transaction.update(provisioningRuns).set({
          status: 'PARTIALLY_FAILED',
          currentStep: 'GENERATE_SITE',
          failureCode,
          failureMessage,
          retryable: false,
          failedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(provisioningRuns.id, run.provisioningRunId));
        await transaction.insert(provisioningActivity).values({
          provisioningRunId: run.provisioningRunId,
          tenantId: run.tenantId,
          eventType: 'SITE_GENERATION_STATE_RECONCILED',
          statusTo: 'PARTIALLY_FAILED',
          stepKey: 'GENERATE_SITE',
          safeMessage: 'A platform owner reconciled a terminal generation job with its stranded run state.',
          agencyUserId: actor.agencyUserId,
        });
      }
      await this.audit.write(actor, 'SITE_GENERATION_STATE_RECONCILED', 'SITE_GENERATION_RUN', runReference, {
        tenantId: run.tenantId,
        reason,
        category: 'WEBSITE',
        metadata: { siteReference, jobStatus: run.jobStatus, failureCode },
        tx: transaction,
      });
      return { reference: runReference, status: 'FAILED' as const, idempotentReplay: false as const };
    });
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

  private async resolveCompatiblePages(context: {
    tenantId: string;
    siteId: string;
    blueprintId: string;
    templateVersionId: string;
  }) {
    const rows = await this.database.select({
      id: siteBlueprintPages.id,
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

  private async verifiedFactSnapshot(tenantId: string, siteId: string) {
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
      this.database.select({ reference: siteAssets.publicReference })
        .from(siteAssets).where(and(
          eq(siteAssets.tenantId, tenantId),
          eq(siteAssets.siteId, siteId),
          eq(siteAssets.status, 'READY'),
        )),
    ]);
    if (!business[0]) throw fail(409, 'GENERATION_BUSINESS_DATA_MISSING', 'Verified business data is unavailable.');
    return buildVerifiedBusinessFacts({
      business: business[0],
      services: serviceRows,
      locations: locationRows,
      staff: staffRows,
      assetReferences: assetRows.map(asset => asset.reference),
    });
  }

  private async runContext(siteReference: string, runReference: string) {
    const [run] = await this.database.select({
      id: siteGenerationRuns.id,
      tenantId: siteGenerationRuns.tenantId,
      status: siteGenerationRuns.status,
      jobReference: siteJobs.publicReference,
    }).from(siteGenerationRuns)
      .innerJoin(sites, eq(siteGenerationRuns.siteId, sites.id))
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
