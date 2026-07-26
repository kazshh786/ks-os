import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import {
  agencyUsers,
  getDatabase,
  locations,
  knowledgePacks,
  platformAuditEvents,
  services,
  siteAssets,
  siteBlueprintPages,
  siteBlueprints,
  siteGenerationClaims,
  siteGenerationContexts,
  siteGenerationFindings,
  siteGenerationPageRuns,
  siteGenerationRuns,
  siteGenerationSectionRuns,
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
  ConcurrencyLimitedSiteGenerationProvider,
  GeneratedPageSchema,
  GenerationPlanSchema,
  GeminiSiteGenerationProvider,
  SiteGenerationProviderError,
  TemplateGenerationConstraintSchema,
  availableBusinessDataKeys,
  buildVerifiedBusinessFacts,
  executeStructuredDataGeneration,
  executeStructuredMetadataGeneration,
  executeStructuredPageGeneration,
  executeStructuredSectionRegeneration,
  executeStructuredSiteGeneration,
  generationDigest,
  type GeneratedPage,
  type GeneratedSection,
  type GenerationFinding,
  type GenerationPlan,
  type SiteGenerationPersistence,
  type SiteGenerationProvider,
  type TemplateGenerationConstraint,
  type VerifiedBusinessFacts,
} from '@ks-os/site-generation';
import {
  GenerateMetadataPayloadSchema,
  GeneratePagePayloadSchema,
  GenerateSitePayloadSchema,
  GenerateStructuredDataPayloadSchema,
  RegenerateSectionPayloadSchema,
  SiteJobExecutionError,
  type SiteJobLeaseContext,
  type SiteJobResult,
  type SiteJobType,
} from '@ks-os/site-jobs';
import { SiteSectionTypeSchema, type SiteSection } from '@ks-os/site-schema';
import type { SiteGenerationKnowledgeContext } from '@ks-os/site-knowledge';
import type { SiteWorkerConfig } from './config.js';
import {
  loadActiveGenerationKnowledge,
  prepareDatabaseGenerationContext,
} from './generation-knowledge.js';
import type { SiteGenerationJobExecutor } from './handlers.js';

type Database = ReturnType<typeof getDatabase>;

interface RunContext {
  id: string;
  reference: string;
  status: string;
  tenantId: string;
  tenantReference: string;
  siteId: string;
  siteReference: string;
  versionId: string;
  versionReference: string;
  versionStatus: string;
  blueprintId: string;
  blueprintReference: string;
  blueprintRevision: number;
  blueprintStatus: string;
  templateVersionId: string;
  templateVersionReference: string;
  templateVersionStatus: string;
  templateSourceId: string;
  templateSourceType: string;
  knowledgePackId: string;
  knowledgePackReference: string;
  knowledgePackSemanticVersion: string;
  requestedByAgencyUserId: string;
  requestedByAgencyUserReference: string;
  generatorVersion: string;
  providerKey: string;
  modelKey: string;
  sourceDataDigestSha256: string;
  promptTemplateVersion: string;
}

interface PreparedRuntime {
  run: RunContext;
  plan: GenerationPlan;
  constraints: TemplateGenerationConstraint[];
  facts: VerifiedBusinessFacts;
  knowledgeContexts: Map<string, SiteGenerationKnowledgeContext>;
}

function safeActions(section: SiteSection) {
  const actions: unknown[] = [];
  for (const key of ['primaryAction', 'secondaryAction', 'secondaryActions'] as const) {
    if (!(key in section)) continue;
    const value = section[key as keyof typeof section];
    if (Array.isArray(value)) actions.push(...value);
    else if (value) actions.push(value);
  }
  return actions;
}

function safeExcerpt(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function mapProviderError(error: unknown): never {
  if (error instanceof SiteJobExecutionError) throw error;
  if (!(error instanceof SiteGenerationProviderError)) throw error;
  if (error.kind === 'CANCELLED') {
    throw new SiteJobExecutionError('CANCELLED_BY_USER', 'Structured generation was cancelled.');
  }
  if (error.kind === 'RETRYABLE_RATE_LIMIT') {
    throw new SiteJobExecutionError(
      'RETRYABLE_RATE_LIMIT',
      'The generation provider rate-limited the request.',
      error.retryAfterMs,
    );
  }
  if (error.kind === 'RETRYABLE_EXTERNAL_FAILURE' || error.kind === 'TIMEOUT') {
    throw new SiteJobExecutionError(
      'RETRYABLE_EXTERNAL_FAILURE',
      error.kind === 'TIMEOUT'
        ? 'The generation provider request timed out.'
        : 'The generation provider is temporarily unavailable.',
      error.retryAfterMs,
    );
  }
  throw new SiteJobExecutionError(
    'TERMINAL_VALIDATION_FAILURE',
    error.kind === 'TERMINAL_INVALID_OUTPUT'
      ? 'The provider could not produce valid structured output.'
      : 'The generation provider rejected the request terminally.',
  );
}

export function createConfiguredSiteGenerationExecutor(
  database: Database,
  config: SiteWorkerConfig['generation'],
): SiteGenerationJobExecutor {
  if (!config.enabled || !config.apiKey || !config.model) {
    throw new Error('A complete enabled generation configuration is required.');
  }
  const provider = new ConcurrencyLimitedSiteGenerationProvider(
    new GeminiSiteGenerationProvider({
      apiKey: config.apiKey,
      modelKey: config.model,
      requestTimeoutMs: config.requestTimeoutMs,
      temperature: config.temperature,
    }),
    config.maxConcurrentRequests,
  );
  return new PostgresSiteGenerationExecutor(database, provider, config);
}

export class PostgresSiteGenerationExecutor implements SiteGenerationJobExecutor {
  constructor(
    private readonly database: Database,
    private readonly provider: SiteGenerationProvider,
    private readonly config: Pick<SiteWorkerConfig['generation'],
      'maxRepairAttempts' | 'maxOutputCharacters' | 'generatorVersion'>,
  ) {}

  async execute(
    jobType: Extract<SiteJobType,
      | 'GENERATE_SITE'
      | 'GENERATE_PAGE'
      | 'REGENERATE_SECTION'
      | 'GENERATE_METADATA'
      | 'GENERATE_STRUCTURED_DATA'>,
    payload: unknown,
    lease: SiteJobLeaseContext,
  ): Promise<SiteJobResult> {
    try {
      switch (jobType) {
        case 'GENERATE_SITE':
          return await this.generateSite(GenerateSitePayloadSchema.parse(payload), lease);
        case 'GENERATE_PAGE':
          return await this.generatePage(GeneratePagePayloadSchema.parse(payload), lease);
        case 'REGENERATE_SECTION':
          return await this.regenerateSection(RegenerateSectionPayloadSchema.parse(payload), lease);
        case 'GENERATE_METADATA':
          return await this.generateMetadata(GenerateMetadataPayloadSchema.parse(payload), lease);
        case 'GENERATE_STRUCTURED_DATA':
          return await this.generateStructuredData(GenerateStructuredDataPayloadSchema.parse(payload), lease);
      }
    } catch (error) {
      if (lease.signal.aborted && lease.signal.reason instanceof SiteJobExecutionError) {
        throw lease.signal.reason;
      }
      mapProviderError(error);
    }
  }

  private async generateSite(
    payload: ReturnType<typeof GenerateSitePayloadSchema.parse>,
    lease: SiteJobLeaseContext,
  ): Promise<SiteJobResult> {
    const run = await this.loadRunForJob(lease.jobReference);
    await this.assertPayloadOwnership(run, payload.siteReference, payload.requestedByAgencyUserReference);
    if (run.blueprintReference !== payload.blueprintReference
      || (payload.knowledgePackReference
        && run.knowledgePackReference !== payload.knowledgePackReference)) {
      throw new SiteJobExecutionError(
        'TERMINAL_PERMISSION_FAILURE',
        'The stored generation job does not match its pinned run.',
      );
    }
    const runtime = await this.prepareRuntime(run);
    const persistence = new PostgresGenerationPersistence(
      this.database,
      run,
      runtime.plan,
      runtime.constraints,
    );
    const result = await executeStructuredSiteGeneration({
      plan: runtime.plan,
      constraints: runtime.constraints,
      facts: runtime.facts,
      knowledgeContexts: runtime.knowledgeContexts,
      provider: this.provider,
      persistence,
      maxRepairAttempts: this.config.maxRepairAttempts,
      maxOutputCharacters: this.config.maxOutputCharacters,
      signal: lease.signal,
      updateProgress: lease.updateProgress,
    });
    return {
      summary: 'The structured draft site is ready for agency review.',
      outputReferences: [run.reference, run.versionReference, ...result.pageReferences].slice(0, 50),
      metrics: {
        pages: result.pageReferences.length,
        findings: result.findingCount,
      },
    };
  }

  private async generatePage(
    payload: ReturnType<typeof GeneratePagePayloadSchema.parse>,
    lease: SiteJobLeaseContext,
  ): Promise<SiteJobResult> {
    const run = await this.loadRunForVersion(payload.siteReference, payload.siteVersionReference);
    await this.assertPayloadOwnership(run, payload.siteReference, payload.requestedByAgencyUserReference);
    const runtime = await this.prepareRuntime(run);
    const page = runtime.plan.pages.find(item =>
      item.blueprintPageReference === payload.blueprintPageReference);
    if (!page) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The approved blueprint page was not found.');
    const constraint = runtime.constraints.find(item => item.layoutReference === page.layoutReference)!;
    const knowledge = runtime.knowledgeContexts.get(page.pageReference)!;
    const generated = await executeStructuredPageGeneration({
      page,
      template: constraint,
      facts: runtime.facts,
      knowledge,
      approvedPageReferences: runtime.plan.pages.map(item => item.pageReference),
      provider: this.provider,
      maxRepairAttempts: this.config.maxRepairAttempts,
      maxOutputCharacters: this.config.maxOutputCharacters,
      signal: lease.signal,
    });
    const persistence = new PostgresGenerationPersistence(
      this.database, run, runtime.plan, runtime.constraints,
    );
    await persistence.replacePage({
      page: generated.page,
      knowledgeContext: knowledge,
      knowledgeContextDigestSha256: knowledge.contentDigest,
      outputContentDigestSha256: generated.outputContentDigestSha256,
      providerKey: generated.providerKey,
      modelKey: generated.modelKey,
      repairAttempts: generated.repairAttempts,
      findings: generated.findings,
    }, 'SITE_PAGE_REGENERATED');
    await lease.updateProgress({ current: 1, total: 1, message: 'The draft page was regenerated and validated.' });
    return {
      summary: 'The structured draft page was regenerated.',
      outputReferences: [run.reference, run.versionReference, page.pageReference],
      metrics: { pages: 1, repairs: generated.repairAttempts },
    };
  }

  private async regenerateSection(
    payload: ReturnType<typeof RegenerateSectionPayloadSchema.parse>,
    lease: SiteJobLeaseContext,
  ): Promise<SiteJobResult> {
    const run = await this.loadRunForVersion(payload.siteReference, payload.siteVersionReference);
    await this.assertPayloadOwnership(run, payload.siteReference, payload.requestedByAgencyUserReference);
    const runtime = await this.prepareRuntime(run);
    const currentPage = await this.loadGeneratedPage(run, payload.pageReference);
    const planPage = runtime.plan.pages.find(item => item.pageReference === currentPage.pageReference)!;
    const constraint = runtime.constraints.find(item => item.layoutReference === planPage.layoutReference)!;
    const knowledge = runtime.knowledgeContexts.get(planPage.pageReference)!;
    const result = await executeStructuredSectionRegeneration({
      currentPage,
      sectionReference: payload.sectionReference,
      instruction: payload.regenerationInstruction,
      template: constraint,
      facts: runtime.facts,
      knowledge,
      approvedPageReferences: runtime.plan.pages.map(item => item.pageReference),
      provider: this.provider,
      maxRepairAttempts: this.config.maxRepairAttempts,
      maxOutputCharacters: this.config.maxOutputCharacters,
      signal: lease.signal,
    });
    await this.persistRegeneratedSection(run, result.output, result.outputContentDigestSha256);
    await lease.updateProgress({ current: 1, total: 1, message: 'The draft section was regenerated and validated.' });
    return {
      summary: 'The structured draft section was regenerated.',
      outputReferences: [run.reference, payload.pageReference, payload.sectionReference],
      metrics: { sections: 1, repairs: result.repairAttempts },
    };
  }

  private async generateMetadata(
    payload: ReturnType<typeof GenerateMetadataPayloadSchema.parse>,
    lease: SiteJobLeaseContext,
  ): Promise<SiteJobResult> {
    const run = await this.loadRunForVersion(payload.siteReference, payload.siteVersionReference);
    await this.assertPayloadOwnership(run, payload.siteReference, payload.requestedByAgencyUserReference);
    const runtime = await this.prepareRuntime(run);
    const pageReferences = payload.pageReference
      ? [payload.pageReference]
      : runtime.plan.pages.map(page => page.pageReference);
    for (const [index, reference] of pageReferences.entries()) {
      const page = await this.loadGeneratedPage(run, reference);
      const knowledge = runtime.knowledgeContexts.get(reference)!;
      const result = await executeStructuredMetadataGeneration({
        page,
        facts: runtime.facts,
        knowledge,
        provider: this.provider,
        maxRepairAttempts: this.config.maxRepairAttempts,
        maxOutputCharacters: this.config.maxOutputCharacters,
        signal: lease.signal,
      });
      await this.database.transaction(async transaction => {
        await transaction.update(sitePages).set({
          seoTitle: result.output.seo.title,
          seoDescription: result.output.seo.description,
          seoJson: result.output.seo,
          updatedAt: new Date(),
        }).where(and(
          eq(sitePages.publicReference, reference),
          eq(sitePages.tenantId, run.tenantId),
          eq(sitePages.versionId, run.versionId),
        ));
        await this.audit(transaction, run, 'SITE_METADATA_GENERATED', 'SITE_PAGE', reference, {
          outputDigestSha256: result.outputContentDigestSha256,
        });
      });
      await lease.updateProgress({
        current: index + 1,
        total: pageReferences.length,
        message: `Generated metadata ${index + 1} of ${pageReferences.length}.`,
      });
    }
    return {
      summary: 'Structured page metadata was generated.',
      outputReferences: pageReferences,
      metrics: { pages: pageReferences.length },
    };
  }

  private async generateStructuredData(
    payload: ReturnType<typeof GenerateStructuredDataPayloadSchema.parse>,
    lease: SiteJobLeaseContext,
  ): Promise<SiteJobResult> {
    const run = await this.loadRunForVersion(payload.siteReference, payload.siteVersionReference);
    await this.assertPayloadOwnership(run, payload.siteReference, payload.requestedByAgencyUserReference);
    const runtime = await this.prepareRuntime(run);
    const pageReferences = payload.pageReference
      ? [payload.pageReference]
      : runtime.plan.pages.map(page => page.pageReference);
    for (const [index, reference] of pageReferences.entries()) {
      const page = await this.loadGeneratedPage(run, reference);
      const knowledge = runtime.knowledgeContexts.get(reference)!;
      const result = await executeStructuredDataGeneration({
        page,
        facts: runtime.facts,
        knowledge,
        provider: this.provider,
        maxRepairAttempts: this.config.maxRepairAttempts,
        maxOutputCharacters: this.config.maxOutputCharacters,
        signal: lease.signal,
      });
      await this.database.transaction(async transaction => {
        await transaction.update(sitePages).set({
          structuredDataInputsJson: result.output.inputs,
          updatedAt: new Date(),
        }).where(and(
          eq(sitePages.publicReference, reference),
          eq(sitePages.tenantId, run.tenantId),
          eq(sitePages.versionId, run.versionId),
        ));
        await this.audit(transaction, run, 'SITE_STRUCTURED_DATA_GENERATED', 'SITE_PAGE', reference, {
          inputCount: result.output.inputs.length,
          outputDigestSha256: result.outputContentDigestSha256,
        });
      });
      await lease.updateProgress({
        current: index + 1,
        total: pageReferences.length,
        message: `Generated structured-data inputs ${index + 1} of ${pageReferences.length}.`,
      });
    }
    return {
      summary: 'Validated structured-data inputs were generated.',
      outputReferences: pageReferences,
      metrics: { pages: pageReferences.length },
    };
  }

  private async loadRunForJob(jobReference: string): Promise<RunContext> {
    const [row] = await this.runSelect().where(eq(siteJobs.publicReference, jobReference)).limit(1);
    if (!row) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The pinned generation run was not found.');
    return row;
  }

  private async loadRunForVersion(siteReference: string, versionReference: string): Promise<RunContext> {
    const [row] = await this.runSelect().where(and(
      eq(sites.publicReference, siteReference),
      eq(siteVersions.publicReference, versionReference),
    )).orderBy(desc(siteGenerationRuns.createdAt)).limit(1);
    if (!row || row.versionStatus !== 'DRAFT') {
      throw new SiteJobExecutionError('TERMINAL_PERMISSION_FAILURE', 'Generation changes require an owned DRAFT version.');
    }
    return row;
  }

  private runSelect() {
    return this.database.select({
      id: siteGenerationRuns.id,
      reference: siteGenerationRuns.publicReference,
      status: siteGenerationRuns.status,
      tenantId: siteGenerationRuns.tenantId,
      tenantReference: tenants.businessReference,
      siteId: siteGenerationRuns.siteId,
      siteReference: sites.publicReference,
      versionId: siteVersions.id,
      versionReference: siteVersions.publicReference,
      versionStatus: siteVersions.status,
      blueprintId: siteGenerationRuns.blueprintId,
      blueprintReference: siteBlueprints.publicReference,
      blueprintRevision: siteGenerationRuns.blueprintRevision,
      blueprintStatus: siteBlueprints.status,
      templateVersionId: siteGenerationRuns.templateVersionId,
      templateVersionReference: templateVersions.publicReference,
      templateVersionStatus: templateVersions.status,
      templateSourceId: templateSources.id,
      templateSourceType: templateSources.sourceType,
      knowledgePackId: siteGenerationRuns.knowledgePackId,
      knowledgePackReference: knowledgePacks.publicReference,
      knowledgePackSemanticVersion: siteGenerationRuns.knowledgePackSemanticVersion,
      requestedByAgencyUserId: siteGenerationRuns.requestedByAgencyUserId,
      requestedByAgencyUserReference: agencyUsers.publicReference,
      generatorVersion: siteGenerationRuns.generatorVersion,
      providerKey: siteGenerationRuns.providerKey,
      modelKey: siteGenerationRuns.modelKey,
      sourceDataDigestSha256: siteGenerationRuns.sourceDataDigestSha256,
      promptTemplateVersion: siteGenerationRuns.promptTemplateVersion,
    }).from(siteGenerationRuns)
      .innerJoin(siteJobs, eq(siteGenerationRuns.siteJobId, siteJobs.id))
      .innerJoin(tenants, eq(siteGenerationRuns.tenantId, tenants.id))
      .innerJoin(sites, eq(siteGenerationRuns.siteId, sites.id))
      .innerJoin(siteVersions, eq(siteGenerationRuns.siteVersionId, siteVersions.id))
      .innerJoin(siteBlueprints, eq(siteGenerationRuns.blueprintId, siteBlueprints.id))
      .innerJoin(templateVersions, eq(siteGenerationRuns.templateVersionId, templateVersions.id))
      .innerJoin(templateSources, eq(templateVersions.templateSourceId, templateSources.id))
      .innerJoin(knowledgePacks, eq(siteGenerationRuns.knowledgePackId, knowledgePacks.id))
      .innerJoin(agencyUsers, eq(siteGenerationRuns.requestedByAgencyUserId, agencyUsers.id));
  }

  private async assertPayloadOwnership(run: RunContext, siteReference: string, actorReference: string) {
    const [actor] = await this.database.select({ id: agencyUsers.id })
      .from(agencyUsers).where(and(
        eq(agencyUsers.publicReference, actorReference),
        eq(agencyUsers.status, 'ACTIVE'),
      )).limit(1);
    if (run.siteReference !== siteReference
      || !actor
      || run.blueprintStatus !== 'APPROVED'
      || run.templateVersionStatus !== 'APPROVED') {
      throw new SiteJobExecutionError(
        'TERMINAL_PERMISSION_FAILURE',
        'The generation payload does not match its server-resolved ownership and approvals.',
      );
    }
  }

  private async prepareRuntime(run: RunContext): Promise<PreparedRuntime> {
    if (run.providerKey !== this.provider.providerKey
      || run.modelKey !== this.provider.modelKey
      || run.generatorVersion !== this.config.generatorVersion) {
      throw new SiteJobExecutionError(
        'TERMINAL_SCHEMA_VERSION_INCOMPATIBLE',
        'The worker configuration does not match the pinned generation provenance.',
      );
    }
    const pack = await loadActiveGenerationKnowledge(this.database, run.knowledgePackReference);
    if (pack.semanticVersion !== run.knowledgePackSemanticVersion) {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The pinned knowledge-pack version changed.');
    }
    const facts = await this.loadFacts(run);
    if (generationDigest(facts) !== run.sourceDataDigestSha256) {
      throw new SiteJobExecutionError(
        'TERMINAL_DATA_MISSING',
        'Verified business data changed after this draft generation run was created.',
      );
    }
    const pages = await this.database.select({
      id: siteBlueprintPages.id,
      reference: siteBlueprintPages.publicReference,
      pageType: siteBlueprintPages.pageType,
      conversionRole: siteBlueprintPages.conversionRole,
      title: siteBlueprintPages.title,
      slug: siteBlueprintPages.proposedSlug,
      layoutId: templateLayouts.id,
      layoutReference: templateLayouts.publicReference,
      layoutStatus: templateLayouts.status,
      templateVersionId: templateLayouts.templateVersionId,
      rendererKey: templateLayoutRenderers.rendererKey,
      rendererVersion: templateLayoutRenderers.rendererVersion,
      rendererStatus: templateLayoutRenderers.rendererStatus,
      sortOrder: siteBlueprintPages.sortOrder,
    }).from(siteBlueprintPages)
      .innerJoin(templateLayouts, eq(siteBlueprintPages.templateLayoutId, templateLayouts.id))
      .innerJoin(templateLayoutRenderers, eq(templateLayouts.id, templateLayoutRenderers.templateLayoutId))
      .where(and(
        eq(siteBlueprintPages.blueprintId, run.blueprintId),
        eq(siteBlueprintPages.tenantId, run.tenantId),
      )).orderBy(asc(siteBlueprintPages.sortOrder));
    if (!pages.length) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The approved blueprint has no pages.');
    await this.assertLicence(run);
    await this.database.transaction(async transaction => {
      for (const page of pages) {
        await transaction.insert(siteGenerationPageRuns).values({
          generationRunId: run.id,
          tenantId: run.tenantId,
          siteId: run.siteId,
          siteVersionId: run.versionId,
          blueprintPageId: page.id,
          templateLayoutId: page.layoutId,
          rendererKey: page.rendererKey!,
        }).onConflictDoNothing();
      }
    });
    const pageRuns = await this.database.select({
      blueprintPageId: siteGenerationPageRuns.blueprintPageId,
      plannedPageReference: siteGenerationPageRuns.plannedPageReference,
    }).from(siteGenerationPageRuns).where(eq(siteGenerationPageRuns.generationRunId, run.id));
    const pageRunReferences = new Map(pageRuns.map(item => [item.blueprintPageId, item.plannedPageReference]));
    const compatibleRows = await this.database.select({
      layoutId: templateLayoutPageTypes.templateLayoutId,
      pageType: templateLayoutPageTypes.pageType,
    }).from(templateLayoutPageTypes).where(inArray(
      templateLayoutPageTypes.templateLayoutId,
      pages.map(page => page.layoutId),
    ));
    const sectionRows = await this.database.select({
      layoutId: templateLayoutSections.layoutId,
      sectionType: templateLayoutSections.sectionType,
      required: templateLayoutSections.requiredForRecommendedPageType,
      order: templateLayoutSections.domOrder,
    }).from(templateLayoutSections).where(inArray(
      templateLayoutSections.layoutId,
      pages.map(page => page.layoutId),
    )).orderBy(asc(templateLayoutSections.domOrder));
    const available = new Set([...availableBusinessDataKeys(facts), 'tenant_id', 'native_crm_enabled']);
    const knowledgeContexts = new Map<string, SiteGenerationKnowledgeContext>();
    const planPages = pages.map(page => {
      const pagePlaybook = pack.bundle.pagePlaybooks.find(item =>
        item.pageType === page.pageType && item.conversionRole === page.conversionRole);
      if (!pagePlaybook?.sections.length) {
        throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The active knowledge pack has no matching page playbook.');
      }
      const plannedSections = pagePlaybook.sections
        .map(section => SiteSectionTypeSchema.parse(section.sectionType));
      const pageReference = pageRunReferences.get(page.id)!;
      const context = prepareDatabaseGenerationContext({
        pack,
        pageType: page.pageType as Parameters<typeof prepareDatabaseGenerationContext>[0]['pageType'],
        conversionRole: page.conversionRole as Parameters<typeof prepareDatabaseGenerationContext>[0]['conversionRole'],
        plannedSections,
        availableBusinessData: available,
        maximumContextCharacters: 100_000,
      });
      knowledgeContexts.set(pageReference, context);
      return {
        blueprintPageReference: page.reference,
        pageReference,
        title: page.title,
        slug: page.slug,
        pageType: page.pageType,
        conversionRole: page.conversionRole,
        layoutReference: page.layoutReference,
        plannedSectionTypes: plannedSections,
      };
    });
    const plan = GenerationPlanSchema.parse({
      siteReference: run.siteReference,
      blueprintReference: run.blueprintReference,
      blueprintRevision: run.blueprintRevision,
      templateVersionReference: run.templateVersionReference,
      knowledgePackReference: pack.reference,
      knowledgePackSemanticVersion: pack.semanticVersion,
      pages: planPages,
    });
    const constraints = pages.map(page => {
      const supportedSections = sectionRows
        .filter(item => item.layoutId === page.layoutId)
        .flatMap(item => {
          const parsed = SiteSectionTypeSchema.safeParse(item.sectionType);
          return parsed.success ? [{ ...item, sectionType: parsed.data }] : [];
        });
      return TemplateGenerationConstraintSchema.parse({
        templateVersionReference: run.templateVersionReference,
        templateSourceType: run.templateSourceType,
        templateVersionStatus: run.templateVersionStatus,
        licenceStatus: run.templateSourceType === 'ENVATO_HTML' ? 'ACTIVE' : 'NOT_REQUIRED',
        layoutReference: page.layoutReference,
        layoutStatus: page.layoutStatus,
        compatiblePageTypes: compatibleRows
          .filter(item => item.layoutId === page.layoutId)
          .map(item => item.pageType),
        rendererKey: page.rendererKey,
        rendererVersion: page.rendererVersion,
        rendererStatus: page.rendererStatus,
        requiredSectionTypes: supportedSections.filter(item => item.required).map(item => item.sectionType),
        prohibitedSectionTypes: [],
        sectionOrder: supportedSections.map(item => item.sectionType),
      });
    });
    return { run, plan, constraints, facts, knowledgeContexts };
  }

  private async assertLicence(run: RunContext) {
    if (run.templateSourceType !== 'ENVATO_HTML') return;
    const [licence] = await this.database.select({ id: templateLicenses.id })
      .from(templateLicenses).where(and(
        eq(templateLicenses.templateSourceId, run.templateSourceId),
        or(eq(templateLicenses.templateVersionId, run.templateVersionId), isNull(templateLicenses.templateVersionId)),
        or(eq(templateLicenses.tenantId, run.tenantId), isNull(templateLicenses.tenantId)),
        or(eq(templateLicenses.siteId, run.siteId), isNull(templateLicenses.siteId)),
        eq(templateLicenses.status, 'ACTIVE'),
      )).limit(1);
    if (!licence) throw new SiteJobExecutionError('TERMINAL_PERMISSION_FAILURE', 'An active applicable Envato licence is required.');
  }

  private async loadFacts(run: RunContext): Promise<VerifiedBusinessFacts> {
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
      }).from(tenants).where(eq(tenants.id, run.tenantId)).limit(1),
      this.database.select({
        reference: services.publicReference,
        name: services.name,
        description: services.description,
        duration: services.duration,
        price: services.price,
      }).from(services).where(and(eq(services.tenantId, run.tenantId), eq(services.isActive, true))),
      this.database.select({
        reference: locations.publicReference,
        name: locations.name,
        address: locations.address,
        postcode: locations.postcode,
        phone: locations.phone,
      }).from(locations).where(and(eq(locations.tenantId, run.tenantId), eq(locations.isActive, true))),
      this.database.select({
        reference: users.publicReference,
        name: users.name,
        jobTitle: users.jobTitle,
        biography: users.bio,
        bookingEnabled: users.bookingEnabled,
      }).from(users).where(and(eq(users.tenantId, run.tenantId), eq(users.accountStatus, 'ACTIVE'))),
      this.database.select({ reference: siteAssets.publicReference })
        .from(siteAssets).where(and(eq(siteAssets.tenantId, run.tenantId), eq(siteAssets.siteId, run.siteId), eq(siteAssets.status, 'READY'))),
    ]);
    const row = business[0];
    if (!row) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Verified business data is unavailable.');
    return buildVerifiedBusinessFacts({
      business: row,
      services: serviceRows,
      locations: locationRows,
      staff: staffRows,
      assetReferences: assetRows.map(asset => asset.reference),
    });
  }

  private async loadGeneratedPage(run: RunContext, pageReference: string): Promise<GeneratedPage> {
    const [page] = await this.database.select({
      reference: sitePages.publicReference,
      title: sitePages.title,
      navigationLabel: sitePages.navigationLabel,
      slug: sitePages.slug,
      pageType: sitePages.pageType,
      conversionRole: sitePages.conversionRole,
      layoutReference: templateLayouts.publicReference,
      seo: sitePages.seoJson,
      internalLinks: sitePages.internalLinksJson,
      structuredDataInputs: sitePages.structuredDataInputsJson,
      assetRequirements: sitePages.assetRequirementsJson,
    }).from(sitePages)
      .innerJoin(templateLayouts, eq(sitePages.templateLayoutId, templateLayouts.id))
      .where(and(
        eq(sitePages.publicReference, pageReference),
        eq(sitePages.tenantId, run.tenantId),
        eq(sitePages.versionId, run.versionId),
      )).limit(1);
    if (!page) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The generated draft page was not found.');
    const sections = await this.database.select({ content: siteSections.contentJson })
      .from(siteSections).where(and(
        eq(siteSections.tenantId, run.tenantId),
        eq(siteSections.versionId, run.versionId),
        eq(siteSections.pageId, this.database.select({ id: sitePages.id }).from(sitePages)
          .where(eq(sitePages.publicReference, pageReference))),
      )).orderBy(asc(siteSections.sortOrder));
    return GeneratedPageSchema.parse({
      pageReference: page.reference,
      title: page.title,
      navigationLabel: page.navigationLabel ?? page.title,
      slug: page.slug,
      pageType: page.pageType,
      conversionRole: page.conversionRole,
      layoutReference: page.layoutReference,
      seo: page.seo,
      sections: sections.map(section => section.content),
      internalLinks: page.internalLinks,
      structuredDataInputs: page.structuredDataInputs,
      assetRequirements: page.assetRequirements,
      missingDataFindings: [],
      claims: [],
    });
  }

  private async persistRegeneratedSection(
    run: RunContext,
    output: GeneratedSection,
    outputDigest: string,
  ) {
    await this.database.transaction(async transaction => {
      const [target] = await transaction.select({
        id: siteSections.id,
        content: siteSections.contentJson,
        actions: siteSections.actionsJson,
        pageRunId: siteGenerationPageRuns.id,
      }).from(siteSections)
        .innerJoin(sitePages, eq(siteSections.pageId, sitePages.id))
        .innerJoin(siteGenerationPageRuns, eq(siteGenerationPageRuns.sitePageId, sitePages.id))
        .where(and(
          eq(siteSections.publicReference, output.sectionReference),
          eq(sitePages.publicReference, output.pageReference),
          eq(siteSections.tenantId, run.tenantId),
          eq(siteGenerationPageRuns.generationRunId, run.id),
        )).limit(1);
      if (!target) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The draft section target was not found.');
      const [sectionRun] = await transaction.insert(siteGenerationSectionRuns).values({
        generationRunId: run.id,
        pageRunId: target.pageRunId,
        tenantId: run.tenantId,
        siteSectionId: target.id,
        previousSiteSectionId: target.id,
        previousContentJson: target.content,
        previousActionsJson: target.actions,
        sectionType: output.section.type,
        status: 'COMPLETED',
        outputContentDigestSha256: outputDigest,
        attemptCount: 1,
        completedAt: new Date(),
      }).returning({ id: siteGenerationSectionRuns.id });
      await transaction.update(siteSections).set({
        sectionType: output.section.type,
        contentJson: output.section,
        actionsJson: safeActions(output.section),
        updatedAt: new Date(),
      }).where(eq(siteSections.id, target.id));
      await this.persistClaimsAndFindings(transaction, run, target.pageRunId, sectionRun.id, output.claims, output.missingDataFindings);
      await this.audit(transaction, run, 'SITE_SECTION_REGENERATED', 'SITE_SECTION', output.sectionReference, {
        outputDigestSha256: outputDigest,
      });
    });
  }

  private async persistClaimsAndFindings(
    transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
    run: RunContext,
    pageRunId: string | null,
    sectionRunId: string | null,
    claims: GeneratedPage['claims'],
    findings: readonly GenerationFinding[],
  ) {
    if (claims.length) await transaction.insert(siteGenerationClaims).values(claims.map(claim => ({
      generationRunId: run.id,
      pageRunId,
      sectionRunId,
      tenantId: run.tenantId,
      agencyUserId: run.requestedByAgencyUserId,
      claimType: claim.claimType,
      claimStatus: claim.status,
      claimTextDigestSha256: generationDigest(claim.claimText),
      factKeysJson: claim.factKeys,
      safeExcerpt: safeExcerpt(claim.claimText),
    })));
    if (findings.length) await transaction.insert(siteGenerationFindings).values(findings.map(finding => ({
      generationRunId: run.id,
      pageRunId,
      sectionRunId,
      tenantId: run.tenantId,
      severity: finding.severity,
      category: finding.category,
      code: finding.code,
      message: finding.message,
      safeMetadataJson: finding.targetReference ? { targetReference: finding.targetReference } : {},
    })));
  }

  private async audit(
    transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
    run: RunContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    await transaction.insert(platformAuditEvents).values({
      tenantId: run.tenantId,
      action,
      targetType,
      targetId,
      outcome: 'SUCCESS',
      metadata: {
        ...metadata,
        generationRunReference: run.reference,
        siteReference: run.siteReference,
        providerKey: run.providerKey,
        modelKey: run.modelKey,
      },
      eventCategory: 'WEBSITE',
      description: 'A controlled structured site-generation operation completed.',
      environment: process.env.NODE_ENV || 'development',
      sourceComponent: 'site-worker',
    });
  }
}

class PostgresGenerationPersistence implements SiteGenerationPersistence {
  constructor(
    private readonly database: Database,
    private readonly run: RunContext,
    private readonly plan: GenerationPlan,
    private readonly constraints: readonly TemplateGenerationConstraint[],
  ) {}

  async beginRun(input: { pageCountPlanned: number; sectionCountPlanned: number }) {
    let cancelledBeforeStart = false;
    await this.database.transaction(async transaction => {
      const [current] = await transaction.select({ status: siteGenerationRuns.status })
        .from(siteGenerationRuns).where(eq(siteGenerationRuns.id, this.run.id)).limit(1);
      if (!current) throw new Error('Generation run disappeared before execution.');
      if (current.status === 'READY_FOR_REVIEW' || current.status === 'SUPERSEDED') {
        throw new SiteJobExecutionError(
          'TERMINAL_VALIDATION_FAILURE',
          'A completed or superseded generation run cannot be executed again.',
        );
      }
      if (current.status === 'FAILED' || current.status === 'CANCELLED') {
        await transaction.update(siteGenerationRuns).set({ status: 'PENDING' })
          .where(eq(siteGenerationRuns.id, this.run.id));
      }
      if (current.status === 'CANCEL_REQUESTED') {
        await transaction.update(siteGenerationRuns).set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          failureCode: 'CANCELLED_BY_USER',
          failureMessage: 'Cancellation was requested before generation started.',
        }).where(eq(siteGenerationRuns.id, this.run.id));
        await transaction.update(siteVersions).set({
          generationStatus: 'CANCELLED',
          updatedAt: new Date(),
        }).where(eq(siteVersions.id, this.run.versionId));
        await this.audit(transaction, 'SITE_GENERATION_CANCELLED', 'CANCELLED', {
          failureCode: 'CANCELLED_BY_USER',
        });
        cancelledBeforeStart = true;
        return;
      }
      if (['PENDING', 'FAILED', 'CANCELLED'].includes(current.status)) {
        await transaction.update(siteGenerationRuns).set({ status: 'PREPARING_CONTEXT' })
          .where(eq(siteGenerationRuns.id, this.run.id));
      }
      if (current.status === 'VALIDATING') {
        await transaction.update(siteGenerationRuns).set({ status: 'REPAIRING' })
          .where(eq(siteGenerationRuns.id, this.run.id));
      }
      await transaction.update(siteGenerationRuns).set({
        status: 'GENERATING',
        pageCountPlanned: input.pageCountPlanned,
        sectionCountPlanned: input.sectionCountPlanned,
        attemptCount: sql`${siteGenerationRuns.attemptCount} + 1`,
        startedAt: new Date(),
        failureCode: null,
        failureMessage: null,
      }).where(eq(siteGenerationRuns.id, this.run.id));
      await transaction.update(siteVersions).set({
        generationStatus: 'GENERATING',
        updatedAt: new Date(),
      }).where(eq(siteVersions.id, this.run.versionId));
      await this.audit(transaction, 'SITE_GENERATION_STARTED', 'SUCCESS', {});
    });
    if (cancelledBeforeStart) {
      throw new SiteJobExecutionError(
        'CANCELLED_BY_USER',
        'Cancellation was requested before generation started.',
      );
    }
  }

  async completedPages() {
    return this.database.select({
      pageReference: siteGenerationPageRuns.plannedPageReference,
      outputContentDigestSha256: siteGenerationPageRuns.outputContentDigestSha256,
    }).from(siteGenerationPageRuns).where(and(
      eq(siteGenerationPageRuns.generationRunId, this.run.id),
      eq(siteGenerationPageRuns.status, 'COMPLETED'),
    )).then(rows => rows.flatMap(row => row.outputContentDigestSha256
      ? [{ pageReference: row.pageReference, outputContentDigestSha256: row.outputContentDigestSha256 }]
      : []));
  }

  async persistPage(input: Parameters<SiteGenerationPersistence['persistPage']>[0]) {
    await this.replacePage(input, 'SITE_PAGE_GENERATION_COMPLETED');
  }

  async replacePage(
    input: Parameters<SiteGenerationPersistence['persistPage']>[0],
    auditAction: 'SITE_PAGE_GENERATION_COMPLETED' | 'SITE_PAGE_REGENERATED',
  ) {
    await this.database.transaction(async transaction => {
      const [pageRun] = await transaction.select({
        id: siteGenerationPageRuns.id,
        sitePageId: siteGenerationPageRuns.sitePageId,
        blueprintPageId: siteGenerationPageRuns.blueprintPageId,
        templateLayoutId: siteGenerationPageRuns.templateLayoutId,
        entitlementKind: siteBlueprintPages.entitlementKind,
        allocation: siteBlueprintPages.allocation,
        sortOrder: siteBlueprintPages.sortOrder,
      }).from(siteGenerationPageRuns)
        .innerJoin(siteBlueprintPages, eq(siteGenerationPageRuns.blueprintPageId, siteBlueprintPages.id))
        .where(and(
          eq(siteGenerationPageRuns.generationRunId, this.run.id),
          eq(siteGenerationPageRuns.plannedPageReference, input.page.pageReference),
        )).limit(1);
      if (!pageRun) throw new Error('The generated page is outside the pinned blueprint.');
      let pageId = pageRun.sitePageId;
      if (!pageId) {
        const [created] = await transaction.insert(sitePages).values({
          publicReference: input.page.pageReference,
          tenantId: this.run.tenantId,
          siteId: this.run.siteId,
          versionId: this.run.versionId,
          pageType: input.page.pageType,
          conversionRole: input.page.conversionRole,
          entitlementKind: pageRun.entitlementKind,
          allocation: pageRun.allocation,
          templateLayoutId: pageRun.templateLayoutId,
          title: input.page.title,
          navigationLabel: input.page.navigationLabel,
          slug: input.page.slug,
          sortOrder: pageRun.sortOrder,
          seoTitle: input.page.seo.title,
          seoDescription: input.page.seo.description,
          seoJson: input.page.seo,
          internalLinksJson: input.page.internalLinks,
          structuredDataInputsJson: input.page.structuredDataInputs,
          assetRequirementsJson: input.page.assetRequirements,
        }).returning({ id: sitePages.id });
        pageId = created.id;
      } else {
        await transaction.update(sitePages).set({
          title: input.page.title,
          navigationLabel: input.page.navigationLabel,
          seoTitle: input.page.seo.title,
          seoDescription: input.page.seo.description,
          seoJson: input.page.seo,
          internalLinksJson: input.page.internalLinks,
          structuredDataInputsJson: input.page.structuredDataInputs,
          assetRequirementsJson: input.page.assetRequirements,
          updatedAt: new Date(),
        }).where(eq(sitePages.id, pageId));
      }
      const existingSections = await transaction.select().from(siteSections)
        .where(eq(siteSections.pageId, pageId)).orderBy(asc(siteSections.sortOrder));
      if (existingSections.length && existingSections.length !== input.page.sections.length) {
        throw new Error('Page regeneration cannot silently change the approved section count.');
      }
      for (const [index, section] of input.page.sections.entries()) {
        const existing = existingSections[index];
        if (existing) {
          if (existing.sectionType !== section.type) {
            throw new Error('Page regeneration cannot silently change an approved section type.');
          }
          const [sectionRun] = await transaction.insert(siteGenerationSectionRuns).values({
            generationRunId: this.run.id,
            pageRunId: pageRun.id,
            tenantId: this.run.tenantId,
            siteSectionId: existing.id,
            previousSiteSectionId: existing.id,
            previousContentJson: existing.contentJson,
            previousActionsJson: existing.actionsJson,
            sectionType: section.type,
            status: 'COMPLETED',
            outputContentDigestSha256: generationDigest(section),
            attemptCount: 1,
            completedAt: new Date(),
          }).returning({ id: siteGenerationSectionRuns.id });
          const stableSection = { ...section, reference: existing.publicReference } as SiteSection;
          await transaction.update(siteSections).set({
            contentJson: stableSection,
            actionsJson: safeActions(stableSection),
            updatedAt: new Date(),
          }).where(eq(siteSections.id, existing.id));
          await this.persistClaimsAndFindings(transaction, pageRun.id, sectionRun.id, [], []);
        } else {
          const [createdSection] = await transaction.insert(siteSections).values({
            publicReference: section.reference,
            tenantId: this.run.tenantId,
            siteId: this.run.siteId,
            versionId: this.run.versionId,
            pageId,
            sectionKey: `${section.type.toLowerCase().replace(/_/g, '-')}-${index + 1}`,
            sectionType: section.type,
            sortOrder: index,
            contentJson: section,
            actionsJson: safeActions(section),
          }).returning({ id: siteSections.id });
          await transaction.insert(siteGenerationSectionRuns).values({
            generationRunId: this.run.id,
            pageRunId: pageRun.id,
            tenantId: this.run.tenantId,
            siteSectionId: createdSection.id,
            sectionType: section.type,
            status: 'COMPLETED',
            outputContentDigestSha256: generationDigest(section),
            attemptCount: 1,
            completedAt: new Date(),
          });
        }
      }
      await transaction.update(siteGenerationFindings).set({ current: false })
        .where(and(
          eq(siteGenerationFindings.generationRunId, this.run.id),
          eq(siteGenerationFindings.pageRunId, pageRun.id),
          eq(siteGenerationFindings.current, true),
        ));
      await transaction.delete(siteGenerationContexts).where(and(
        eq(siteGenerationContexts.generationRunId, this.run.id),
        eq(siteGenerationContexts.pageRunId, pageRun.id),
      ));
      await transaction.insert(siteGenerationContexts).values({
        generationRunId: this.run.id,
        pageRunId: pageRun.id,
        tenantId: this.run.tenantId,
        knowledgePackId: this.run.knowledgePackId,
        contextDigestSha256: input.knowledgeContextDigestSha256,
        promptTemplateVersion: this.run.promptTemplateVersion,
        selectedRuleIdsJson: input.knowledgeContext.applicableRuleIds,
        missingBusinessDataKeysJson: input.knowledgeContext.missingBusinessDataRequirements,
        safeContextSummaryJson: {
          ruleCount: input.knowledgeContext.applicableRuleIds.length,
          sourceReferenceCount: input.knowledgeContext.sourceReferences.length,
          omittedRuleCount: input.knowledgeContext.omittedRuleCount,
        },
        inputCharacterEstimate: input.knowledgeContext.estimatedCharacterCount,
      });
      await this.persistClaimsAndFindings(transaction, pageRun.id, null, input.page.claims, [
        ...input.findings,
        ...input.page.missingDataFindings,
      ]);
      await transaction.update(siteGenerationPageRuns).set({
        sitePageId: pageId,
        status: 'COMPLETED',
        attemptCount: 1,
        repairAttemptCount: input.repairAttempts,
        generationContextDigestSha256: input.knowledgeContextDigestSha256,
        outputContentDigestSha256: input.outputContentDigestSha256,
        startedAt: new Date(),
        completedAt: new Date(),
        failureCode: null,
        failureMessage: null,
      }).where(eq(siteGenerationPageRuns.id, pageRun.id));
      const completedPages = await transaction.select({ id: siteGenerationPageRuns.id })
        .from(siteGenerationPageRuns).where(and(
          eq(siteGenerationPageRuns.generationRunId, this.run.id),
          eq(siteGenerationPageRuns.status, 'COMPLETED'),
        ));
      const completedSections = await transaction.select({ id: siteSections.id })
        .from(siteSections).where(and(
          eq(siteSections.tenantId, this.run.tenantId),
          eq(siteSections.versionId, this.run.versionId),
        ));
      await transaction.update(siteGenerationRuns).set({
        pageCountCompleted: completedPages.length,
        sectionCountCompleted: completedSections.length,
      }).where(eq(siteGenerationRuns.id, this.run.id));
      await this.audit(transaction, auditAction, 'SUCCESS', {
        pageReference: input.page.pageReference,
        sectionCount: input.page.sections.length,
        repairAttempts: input.repairAttempts,
        outputDigestSha256: input.outputContentDigestSha256,
      });
    });
  }

  async persistFindings(findings: readonly GenerationFinding[]) {
    if (!findings.length) return;
    await this.database.insert(siteGenerationFindings).values(findings.map(finding => ({
      generationRunId: this.run.id,
      tenantId: this.run.tenantId,
      severity: finding.severity,
      category: finding.category,
      code: finding.code,
      message: finding.message,
      safeMetadataJson: finding.targetReference ? { targetReference: finding.targetReference } : {},
    })));
  }

  async completeRun(input: {
    outputContentDigestSha256: string;
    pageCountCompleted: number;
    sectionCountCompleted: number;
  }) {
    await this.database.transaction(async transaction => {
      await transaction.update(siteGenerationRuns).set({ status: 'VALIDATING' })
        .where(eq(siteGenerationRuns.id, this.run.id));
      const [blockingFinding] = await transaction.select({ id: siteGenerationFindings.id })
        .from(siteGenerationFindings).where(and(
          eq(siteGenerationFindings.generationRunId, this.run.id),
          eq(siteGenerationFindings.current, true),
          eq(siteGenerationFindings.severity, 'ERROR'),
        )).limit(1);
      const [prohibitedClaim] = await transaction.select({ id: siteGenerationClaims.id })
        .from(siteGenerationClaims).where(and(
          eq(siteGenerationClaims.generationRunId, this.run.id),
          inArray(siteGenerationClaims.claimStatus, ['UNSUPPORTED', 'PROHIBITED']),
        )).limit(1);
      if (blockingFinding || prohibitedClaim || input.pageCountCompleted !== this.plan.pages.length) {
        throw new Error('Blocking generation findings prevent agency review readiness.');
      }
      const contexts = await transaction.select({ digest: siteGenerationContexts.contextDigestSha256 })
        .from(siteGenerationContexts).where(eq(siteGenerationContexts.generationRunId, this.run.id))
        .orderBy(asc(siteGenerationContexts.contextDigestSha256));
      const contextDigest = generationDigest(contexts.map(item => item.digest));
      const completedSections = await transaction.select({ id: siteSections.id })
        .from(siteSections).where(and(
          eq(siteSections.tenantId, this.run.tenantId),
          eq(siteSections.versionId, this.run.versionId),
        ));
      const provenance = {
        generationRunReference: this.run.reference,
        blueprintReference: this.run.blueprintReference,
        blueprintRevision: this.run.blueprintRevision,
        templateVersionReference: this.run.templateVersionReference,
        layoutReferences: this.constraints.map(item => item.layoutReference),
        rendererKeys: this.constraints.map(item => item.rendererKey),
        knowledgePackReference: this.run.knowledgePackReference,
        knowledgePackSemanticVersion: this.run.knowledgePackSemanticVersion,
        knowledgeContextDigestSha256: contextDigest,
        generatorVersion: this.run.generatorVersion,
        promptTemplateVersion: this.run.promptTemplateVersion,
        providerKey: this.run.providerKey,
        modelKey: this.run.modelKey,
        verifiedBusinessDataDigestSha256: this.run.sourceDataDigestSha256,
        outputContentDigestSha256: input.outputContentDigestSha256,
        requestedByAgencyUserReference: this.run.requestedByAgencyUserReference,
        generatedAt: new Date().toISOString(),
      };
      await transaction.update(siteGenerationRuns).set({
        status: 'READY_FOR_REVIEW',
        generationContextDigestSha256: contextDigest,
        outputContentDigestSha256: input.outputContentDigestSha256,
        pageCountCompleted: input.pageCountCompleted,
        sectionCountCompleted: completedSections.length,
        completedAt: new Date(),
      }).where(eq(siteGenerationRuns.id, this.run.id));
      await transaction.update(siteVersions).set({
        generationStatus: 'READY_FOR_REVIEW',
        generationProvenanceJson: provenance,
        generationContentDigestSha256: input.outputContentDigestSha256,
        generationCompletedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(siteVersions.id, this.run.versionId),
        eq(siteVersions.status, 'DRAFT'),
      ));
      await this.audit(transaction, 'SITE_GENERATION_COMPLETED', 'SUCCESS', {
        pageCount: input.pageCountCompleted,
        sectionCount: completedSections.length,
        outputDigestSha256: input.outputContentDigestSha256,
      });
    });
  }

  async failRun(input: { failureCode: string; failureMessage: string }) {
    await this.database.transaction(async transaction => {
      const [current] = await transaction.select({ status: siteGenerationRuns.status })
        .from(siteGenerationRuns).where(eq(siteGenerationRuns.id, this.run.id)).limit(1);
      if (!current || current.status === 'READY_FOR_REVIEW') return;
      const cancelled = current.status === 'CANCEL_REQUESTED'
        || input.failureCode === 'CANCELLED_BY_USER';
      if (input.failureCode === 'CANCELLED_BY_USER' && current.status !== 'CANCEL_REQUESTED') {
        await transaction.update(siteGenerationRuns).set({ status: 'CANCEL_REQUESTED' })
          .where(eq(siteGenerationRuns.id, this.run.id));
      }
      await transaction.update(siteGenerationRuns).set({
        status: cancelled ? 'CANCELLED' : 'FAILED',
        failureCode: input.failureCode.slice(0, 100),
        failureMessage: input.failureMessage.slice(0, 500),
        ...(cancelled ? { cancelledAt: new Date() } : {}),
      }).where(eq(siteGenerationRuns.id, this.run.id));
      await transaction.update(siteVersions).set({
        generationStatus: cancelled ? 'CANCELLED' : 'FAILED',
        updatedAt: new Date(),
      }).where(eq(siteVersions.id, this.run.versionId));
      await this.audit(
        transaction,
        cancelled ? 'SITE_GENERATION_CANCELLED' : 'SITE_GENERATION_FAILED',
        cancelled ? 'CANCELLED' : 'FAILED',
        { failureCode: input.failureCode },
      );
    });
  }

  private async persistClaimsAndFindings(
    transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
    pageRunId: string,
    sectionRunId: string | null,
    claims: GeneratedPage['claims'],
    findings: readonly GenerationFinding[],
  ) {
    if (claims.length) await transaction.insert(siteGenerationClaims).values(claims.map(claim => ({
      generationRunId: this.run.id,
      pageRunId,
      sectionRunId,
      tenantId: this.run.tenantId,
      agencyUserId: this.run.requestedByAgencyUserId,
      claimType: claim.claimType,
      claimStatus: claim.status,
      claimTextDigestSha256: generationDigest(claim.claimText),
      factKeysJson: claim.factKeys,
      safeExcerpt: safeExcerpt(claim.claimText),
    })));
    if (findings.length) await transaction.insert(siteGenerationFindings).values(findings.map(finding => ({
      generationRunId: this.run.id,
      pageRunId,
      sectionRunId,
      tenantId: this.run.tenantId,
      severity: finding.severity,
      category: finding.category,
      code: finding.code,
      message: finding.message,
      safeMetadataJson: finding.targetReference ? { targetReference: finding.targetReference } : {},
    })));
  }

  private async audit(
    transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
    action: string,
    outcome: string,
    metadata: Record<string, unknown>,
  ) {
    await transaction.insert(platformAuditEvents).values({
      tenantId: this.run.tenantId,
      action,
      targetType: 'SITE_GENERATION_RUN',
      targetId: this.run.reference,
      outcome,
      metadata: {
        ...metadata,
        siteReference: this.run.siteReference,
        versionReference: this.run.versionReference,
        providerKey: this.run.providerKey,
        modelKey: this.run.modelKey,
      },
      eventCategory: 'WEBSITE',
      description: 'A controlled structured site-generation lifecycle event occurred.',
      environment: process.env.NODE_ENV || 'development',
      sourceComponent: 'site-worker',
    });
  }
}
