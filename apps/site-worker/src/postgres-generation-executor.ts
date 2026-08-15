import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  or,
  sql,
} from 'drizzle-orm';
import {
  agencyUsers,
  emailOutbox,
  emailSuppressions,
  factFindingUploads,
  getDatabase,
  locations,
  knowledgePacks,
  platformAuditEvents,
  services,
  siteAssets,
  siteBlueprintPages,
  siteBlueprints,
  siteApprovalDecisions,
  siteApprovals,
  siteChangeRequestEvents,
  siteChangeRequests,
  siteFactVerifications,
  siteGenerationClaims,
  siteGenerationContexts,
  siteGenerationFindings,
  siteGenerationPageRuns,
  siteGenerationRuns,
  siteGenerationSectionRuns,
  siteJobs,
  sitePages,
  sitePageSeoBriefs,
  siteSearchResearchEvidence,
  siteSearchStrategies,
  siteRenderSnapshots,
  siteReviewActivity,
  siteReviewComments,
  siteReviewCycles,
  siteReviewItems,
  siteReviewParticipants,
  siteSections,
  staffServiceAssignments,
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
  createSiteGenerationProvider,
  GOVERNED_SITE_ASSET_CATEGORIES,
  GOVERNED_SITE_ASSET_CONSENT_STATUSES,
  GOVERNED_SITE_ASSET_MIME_TYPES,
  GOVERNED_SITE_ASSET_SCAN_STATUSES,
  ApprovedGenerationAssetSchema,
  GeneratedPageSchema,
  GenerationPlanSchema,
  SiteGenerationProviderError,
  TemplateGenerationConstraintSchema,
  applyGovernedEntityAssetBindings,
  availableBusinessDataKeys,
  buildVerifiedBusinessFacts,
  executeStructuredDataGeneration,
  executeStructuredMetadataGeneration,
  executeStructuredPageGeneration,
  executeStructuredSectionRegeneration,
  executeStructuredSiteGeneration,
  generationDigest,
  searchStrategyDigest,
  assertSearchIntelligenceReady,
  PageSeoBriefSchema,
  parseSearchResearchEvidenceDatabaseRow,
  SearchIntelligenceStrategyV2Schema,
  type GeneratedPage,
  type GeneratedSection,
  type GenerationFinding,
  type GenerationPlan,
  type SiteGenerationPersistence,
  type SiteGenerationProvider,
  type SiteCompositionStrategy,
  type PageCompositionPlan,
  type AssetCoveragePlan,
  type TemplateGenerationConstraint,
  type VerifiedBusinessFacts,
  type ApprovedSearchIntelligenceInput,
  type ApprovedGenerationAsset,
} from '@ks-os/site-generation';
import { getNativeLayoutManifest } from '@ks-os/site-templates';
import {
  SiteSlugSchema,
} from '@ks-os/contracts';
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
import {
  prepareSiteRenderSnapshotForStorage,
  SiteSectionSchema,
  SiteSectionTypeSchema,
  type SiteSection,
} from '@ks-os/site-schema';
import type { SiteGenerationKnowledgeContext } from '@ks-os/site-knowledge';
import type { SiteWorkerConfig } from './config.js';
import {
  loadActiveGenerationKnowledge,
  prepareDatabaseGenerationContext,
} from './generation-knowledge.js';
import type { SiteGenerationJobExecutor } from './handlers.js';
import {
  failProvisionedWorkspace,
  finalizeProvisionedWorkspace,
} from './provisioning-finalization.js';

type Database = ReturnType<typeof getDatabase>;

export function blueprintPathToSiteSlug(path: string): string {
  if (path === '/') return 'home';
  const slug = path.startsWith('/')
    ? SiteSlugSchema.safeParse(path.slice(1))
    : null;
  if (!slug?.success) {
    throw new SiteJobExecutionError(
      'TERMINAL_VALIDATION_FAILURE',
      'A blueprint page path must be canonical and site-relative.',
    );
  }
  return slug.data;
}

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
  templateManifest: unknown;
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
  assetInputJson: unknown | null;
  promptTemplateVersion: string;
  provisioningRunId: string | null;
  searchStrategyId: string | null;
  searchStrategyVersion: number | null;
  searchStrategyDigestSha256: string | null;
}

interface PreparedRuntime {
  run: RunContext;
  pipelineVersion: 1 | 2;
  plan: GenerationPlan;
  constraints: TemplateGenerationConstraint[];
  facts: VerifiedBusinessFacts;
  knowledgeContexts: Map<string, SiteGenerationKnowledgeContext>;
  searchIntelligence?: ApprovedSearchIntelligenceInput;
}

type PinnedSearchIntelligenceRun = Pick<RunContext,
  'tenantId' | 'siteId' | 'blueprintId' | 'searchStrategyId'
  | 'searchStrategyVersion' | 'searchStrategyDigestSha256'>;

interface PinnedSearchIntelligencePage {
  reference: string;
  pageType: string;
}

function generationPipelineVersion(run: Pick<RunContext, 'templateManifest'>): 1 | 2 {
  const manifest = run.templateManifest
    && typeof run.templateManifest === 'object'
    && !Array.isArray(run.templateManifest)
    ? run.templateManifest as Record<string, unknown>
    : {};
  return manifest.componentRegistryVersion === 2
    && manifest.generationPipelineVersion === 2
    ? 2
    : 1;
}

export async function loadPinnedSearchIntelligence(
  database: Database,
  run: PinnedSearchIntelligenceRun,
  pages: readonly PinnedSearchIntelligencePage[],
): Promise<ApprovedSearchIntelligenceInput> {
  if (!run.searchStrategyId || !run.searchStrategyVersion || !run.searchStrategyDigestSha256) {
    throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'V2 generation has no pinned approved Search Intelligence strategy.');
  }
  const [row] = await database.select({
    value: siteSearchStrategies.strategyJson,
    status: siteSearchStrategies.status,
    version: siteSearchStrategies.strategyVersion,
    digestSha256: siteSearchStrategies.outputDigestSha256,
  }).from(siteSearchStrategies).where(and(
    eq(siteSearchStrategies.id, run.searchStrategyId),
    eq(siteSearchStrategies.tenantId, run.tenantId),
    eq(siteSearchStrategies.siteId, run.siteId),
    eq(siteSearchStrategies.blueprintId, run.blueprintId),
  )).limit(1);
  if (!row || row.status !== 'APPROVED'
    || row.version !== run.searchStrategyVersion
    || row.digestSha256 !== run.searchStrategyDigestSha256) {
    throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The pinned Search Intelligence approval or provenance changed.');
  }
  const strategy = SearchIntelligenceStrategyV2Schema.parse(row.value);
  if (searchStrategyDigest(strategy) !== row.digestSha256) {
    throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The pinned Search Intelligence digest is invalid.');
  }
  const [briefRows, evidenceRows] = await Promise.all([
    database.select({ value: sitePageSeoBriefs.briefJson })
      .from(sitePageSeoBriefs).where(and(
        eq(sitePageSeoBriefs.strategyId, run.searchStrategyId),
        eq(sitePageSeoBriefs.tenantId, run.tenantId),
        eq(sitePageSeoBriefs.siteId, run.siteId),
        eq(sitePageSeoBriefs.blueprintId, run.blueprintId),
        eq(sitePageSeoBriefs.status, 'APPROVED'),
      )),
    database.select({
      tenantId: siteSearchResearchEvidence.tenantId,
      siteId: siteSearchResearchEvidence.siteId,
      strategyId: siteSearchResearchEvidence.strategyId,
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
      eq(siteSearchResearchEvidence.tenantId, run.tenantId),
      eq(siteSearchResearchEvidence.siteId, run.siteId),
      eq(siteSearchResearchEvidence.strategyId, run.searchStrategyId),
    )),
  ]);
  const briefs = briefRows.map(item => PageSeoBriefSchema.parse(item.value));
  const evidence = evidenceRows
    .filter(item => item.tenantId === run.tenantId
      && item.siteId === run.siteId
      && item.strategyId === run.searchStrategyId)
    .map(parseSearchResearchEvidenceDatabaseRow);
  const byBlueprintPage = new Map(briefs.map(brief => [brief.blueprintPageReference, brief]));
  try {
    assertSearchIntelligenceReady({
      strategy,
      briefs,
      evidence,
      plannedPages: pages.map(page => ({
        blueprintPageReference: page.reference,
        pageReference: byBlueprintPage.get(page.reference)?.pageReference ?? '',
        pageType: page.pageType,
      })),
    });
  } catch {
    throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The pinned Search Intelligence page/brief plan is incomplete or stale.');
  }
  return { strategy, briefs, evidence };
}

async function failGenerationRun(
  database: Database,
  run: RunContext,
  input: { failureCode: string; failureMessage: string },
) {
  const changed = await database.transaction(async transaction => {
    const [current] = await transaction.select({ status: siteGenerationRuns.status })
      .from(siteGenerationRuns).where(eq(siteGenerationRuns.id, run.id)).limit(1)
      .for('update');
    if (!current || ['DESIGN_COMPLETE', 'READY_FOR_REVIEW', 'FAILED', 'CANCELLED'].includes(current.status)) {
      return false;
    }
    const cancelled = current.status === 'CANCEL_REQUESTED'
      || input.failureCode === 'CANCELLED_BY_USER';
    if (input.failureCode === 'CANCELLED_BY_USER' && current.status !== 'CANCEL_REQUESTED') {
      await transaction.update(siteGenerationRuns).set({ status: 'CANCEL_REQUESTED' })
        .where(eq(siteGenerationRuns.id, run.id));
    }
    await transaction.update(siteGenerationRuns).set({
      status: cancelled ? 'CANCELLED' : 'FAILED',
      failureCode: input.failureCode.slice(0, 100),
      failureMessage: input.failureMessage.slice(0, 500),
      ...(cancelled ? { cancelledAt: new Date() } : {}),
      updatedAt: new Date(),
    }).where(eq(siteGenerationRuns.id, run.id));
    await transaction.update(siteVersions).set({
      generationStatus: cancelled ? 'CANCELLED' : 'FAILED',
      updatedAt: new Date(),
    }).where(eq(siteVersions.id, run.versionId));
    await transaction.insert(platformAuditEvents).values({
      tenantId: run.tenantId,
      action: cancelled ? 'SITE_GENERATION_CANCELLED' : 'SITE_GENERATION_FAILED',
      targetType: 'SITE_GENERATION_RUN',
      targetId: run.reference,
      outcome: cancelled ? 'CANCELLED' : 'FAILED',
      metadata: {
        failureCode: input.failureCode,
        siteReference: run.siteReference,
        versionReference: run.versionReference,
        providerKey: run.providerKey,
        modelKey: run.modelKey,
      },
      eventCategory: 'WEBSITE',
      description: 'A controlled structured site-generation lifecycle event occurred.',
      environment: process.env.NODE_ENV || 'development',
      sourceComponent: 'site-worker',
    });
    return true;
  });
  if (changed && run.provisioningRunId) {
    await failProvisionedWorkspace(database, run.id, {
      code: input.failureCode,
      message: input.failureMessage,
    });
  }
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

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function optionalPublicPhone(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^\+?[0-9 ()-]{7,30}$/.test(normalized)
    ? normalized
    : undefined;
}

function optionalPublicEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)
    ? normalized
    : undefined;
}

function approvedAssetUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function pinnedGenerationAssets(run: RunContext): ApprovedGenerationAsset[] | null {
  return run.assetInputJson === null
    ? null
    : ApprovedGenerationAssetSchema.array().parse(run.assetInputJson);
}

async function persistValidatedPreviewSnapshot(
  transaction: DatabaseTransaction,
  run: RunContext,
  sourceContentDigestSha256: string,
  designTokens?: SiteCompositionStrategy['recommendedDesignTokens'],
) {
  const [existing] = await transaction.select({ id: siteRenderSnapshots.id })
    .from(siteRenderSnapshots)
    .where(and(
      eq(siteRenderSnapshots.siteVersionId, run.versionId),
      eq(siteRenderSnapshots.snapshotKind, 'PREVIEW'),
      eq(siteRenderSnapshots.sourceContentDigestSha256, sourceContentDigestSha256),
    ))
    .limit(1);
  if (existing) return;

  const [context] = await transaction.select({
    siteStatus: sites.status,
    siteCreatedAt: sites.createdAt,
    versionStatus: siteVersions.status,
    versionCreatedAt: siteVersions.createdAt,
    templateStatus: templateVersions.status,
    tenantReference: tenants.businessReference,
    tenantName: tenants.name,
    tenantLegalName: tenants.legalBusinessName,
    tenantBusinessType: tenants.businessType,
    tenantSubdomain: tenants.subdomain,
    tenantPhone: tenants.operationalPhone,
    tenantEmail: tenants.replyToEmail,
    primaryColour: tenants.primaryColor,
    secondaryColour: tenants.secondaryColor,
    accentColour: tenants.accentColor,
  }).from(siteVersions)
    .innerJoin(sites, eq(siteVersions.siteId, sites.id))
    .innerJoin(tenants, eq(siteVersions.tenantId, tenants.id))
    .innerJoin(templateVersions, eq(templateVersions.id, run.templateVersionId))
    .where(and(
      eq(siteVersions.id, run.versionId),
      eq(siteVersions.tenantId, run.tenantId),
      eq(siteVersions.siteId, run.siteId),
    ))
    .limit(1);
  if (!context || context.templateStatus !== 'APPROVED') {
    throw new SiteJobExecutionError(
      'TERMINAL_VALIDATION_FAILURE',
      'A preview snapshot requires the pinned approved template.',
    );
  }

  const pinnedAssets = pinnedGenerationAssets(run);
  const assetConditions = [
    eq(siteAssets.tenantId, run.tenantId),
    eq(siteAssets.siteId, run.siteId),
    eq(siteAssets.status, 'READY'),
    or(
      isNull(siteAssets.sourceFactFindingUploadId),
      and(
        eq(factFindingUploads.uploadStatus, 'UPLOADED'),
        eq(factFindingUploads.agencyReviewStatus, 'APPROVED'),
        eq(factFindingUploads.publicUsePermission, true),
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
  if (pinnedAssets?.length) {
    assetConditions.push(inArray(
      siteAssets.publicReference,
      pinnedAssets.map(asset => asset.publicReference),
    ));
  }
  const assetRowsPromise = pinnedAssets?.length === 0
    ? Promise.resolve([])
    : transaction.select({
      reference: siteAssets.publicReference,
      kind: siteAssets.kind,
      storagePath: siteAssets.storagePath,
      mimeType: siteAssets.mimeType,
      altText: siteAssets.altText,
      width: siteAssets.width,
      height: siteAssets.height,
    }).from(siteAssets)
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
      .where(and(...assetConditions))
      .orderBy(asc(siteAssets.publicReference));

  const [pageRows, sectionRows, compatibilityRows, serviceRows, locationRows, staffRows, assignmentRows, assetRows] =
    await Promise.all([
      transaction.select({
        id: sitePages.id,
        reference: sitePages.publicReference,
        title: sitePages.title,
        navigationLabel: sitePages.navigationLabel,
        slug: sitePages.slug,
        pageType: sitePages.pageType,
        conversionRole: sitePages.conversionRole,
        sortOrder: sitePages.sortOrder,
        seo: sitePages.seoJson,
        layoutId: templateLayouts.id,
        layoutReference: templateLayouts.publicReference,
        layoutStatus: templateLayouts.status,
        rendererKey: templateLayoutRenderers.rendererKey,
        rendererStatus: templateLayoutRenderers.rendererStatus,
        rendererVersion: templateLayoutRenderers.rendererVersion,
        updatedAt: sitePages.updatedAt,
      }).from(sitePages)
        .innerJoin(templateLayouts, eq(sitePages.templateLayoutId, templateLayouts.id))
        .innerJoin(
          templateLayoutRenderers,
          eq(templateLayoutRenderers.templateLayoutId, templateLayouts.id),
        )
        .where(and(
          eq(sitePages.versionId, run.versionId),
          eq(sitePages.tenantId, run.tenantId),
          isNull(sitePages.archivedAt),
        ))
        .orderBy(asc(sitePages.sortOrder)),
      transaction.select({
        pageId: siteSections.pageId,
        reference: siteSections.publicReference,
        sortOrder: siteSections.sortOrder,
        content: siteSections.contentJson,
      }).from(siteSections)
        .where(and(
          eq(siteSections.versionId, run.versionId),
          eq(siteSections.tenantId, run.tenantId),
        ))
        .orderBy(asc(siteSections.pageId), asc(siteSections.sortOrder)),
      transaction.select({
        layoutId: templateLayoutPageTypes.templateLayoutId,
        pageType: templateLayoutPageTypes.pageType,
      }).from(templateLayoutPageTypes),
      transaction.select({
        reference: services.publicReference,
        name: services.name,
        description: services.description,
        duration: services.duration,
        price: services.price,
      }).from(services).where(and(
        eq(services.tenantId, run.tenantId),
        eq(services.isActive, true),
      )),
      transaction.select({
        reference: locations.publicReference,
        name: locations.name,
        address: locations.address,
        postcode: locations.postcode,
        phone: locations.phone,
      }).from(locations).where(and(
        eq(locations.tenantId, run.tenantId),
        eq(locations.isActive, true),
      )),
      transaction.select({
        id: users.id,
        reference: users.publicReference,
        name: users.name,
        jobTitle: users.jobTitle,
        biography: users.bio,
        bookingEnabled: users.bookingEnabled,
      }).from(users).where(and(
        eq(users.tenantId, run.tenantId),
        eq(users.accountStatus, 'ACTIVE'),
      )),
      transaction.select({
        staffId: staffServiceAssignments.staffUserId,
        serviceReference: services.publicReference,
      }).from(staffServiceAssignments)
        .innerJoin(services, eq(staffServiceAssignments.serviceId, services.id))
        .where(and(
          eq(staffServiceAssignments.tenantId, run.tenantId),
          eq(staffServiceAssignments.isActive, true),
          eq(services.isActive, true),
        )),
      assetRowsPromise,
    ]);

  const [approvedStrategyRow] = run.searchStrategyId
    ? await transaction.select({
      value: siteSearchStrategies.strategyJson,
      status: siteSearchStrategies.status,
    }).from(siteSearchStrategies).where(and(
      eq(siteSearchStrategies.id, run.searchStrategyId),
      eq(siteSearchStrategies.tenantId, run.tenantId),
      eq(siteSearchStrategies.siteId, run.siteId),
    )).limit(1)
    : [];
  if (run.searchStrategyId && approvedStrategyRow?.status !== 'APPROVED') {
    throw new SiteJobExecutionError(
      'TERMINAL_VALIDATION_FAILURE',
      'A V2 preview snapshot requires its pinned approved Search Intelligence strategy.',
    );
  }
  const approvedStrategy = approvedStrategyRow
    ? SearchIntelligenceStrategyV2Schema.parse(approvedStrategyRow.value)
    : undefined;
  const briefRows = run.searchStrategyId
    ? await transaction.select({ value: sitePageSeoBriefs.briefJson })
      .from(sitePageSeoBriefs)
      .where(and(
        eq(sitePageSeoBriefs.strategyId, run.searchStrategyId),
        eq(sitePageSeoBriefs.tenantId, run.tenantId),
        eq(sitePageSeoBriefs.siteId, run.siteId),
        eq(sitePageSeoBriefs.status, 'APPROVED'),
      ))
    : [];
  const briefByPageReference = new Map(
    briefRows.map(row => {
      const brief = PageSeoBriefSchema.parse(row.value);
      return [brief.pageReference, brief] as const;
    }),
  );
  if (briefByPageReference.size !== briefRows.length) {
    throw new SiteJobExecutionError(
      'TERMINAL_VALIDATION_FAILURE',
      'A V2 preview snapshot requires exactly one approved SEO brief per page.',
    );
  }
  const staffByReference = new Map(staffRows.map(staff => [staff.reference, staff]));
  const parsedSectionsByPageId = new Map(pageRows.map(page => [
    page.id,
    sectionRows
      .filter(section => section.pageId === page.id)
      .map(section => SiteSectionSchema.parse({
        ...(section.content && typeof section.content === 'object'
          ? section.content as Record<string, unknown>
          : {}),
        reference: section.reference,
      })),
  ]));
  const staffProfilePath = (staffReference: string) => {
    const profilePage = pageRows.find(candidate =>
      candidate.pageType === 'TEAM_DETAIL'
      && parsedSectionsByPageId.get(candidate.id)?.some(section =>
        section.type === 'STAFF_PROFILE' && section.staffReference === staffReference));
    if (!profilePage) return undefined;
    return profilePage.slug === 'home' ? '/' : `/${profilePage.slug}`;
  };

  const pageSnapshots = pageRows.map((page) => {
    if (
      !page.rendererKey
      || !page.rendererVersion
      || page.rendererStatus !== 'READY'
      || page.layoutStatus !== 'APPROVED'
    ) {
      throw new SiteJobExecutionError(
        'TERMINAL_VALIDATION_FAILURE',
        'Every preview page requires an approved ready renderer mapping.',
      );
    }
    const path = page.pageType === 'BOOKING'
      ? '/book'
      : page.slug === 'home' ? '/' : `/${page.slug}`;
    const seo = page.seo && typeof page.seo === 'object'
      ? page.seo as Record<string, unknown>
      : {};
    const brief = briefByPageReference.get(page.reference);
    if (run.searchStrategyId && !brief) {
      throw new SiteJobExecutionError(
        'TERMINAL_VALIDATION_FAILURE',
        'Every V2 preview page requires its pinned approved SEO brief.',
      );
    }
    const canonicalStaffProfile = (
      staffReference: string,
    ) => {
      const staff = staffByReference.get(staffReference);
      if (!staff) {
        throw new SiteJobExecutionError(
          'TERMINAL_VALIDATION_FAILURE',
          'Approved page authorship must resolve to canonical verified staff.',
        );
      }
      const profilePath = staffProfilePath(staffReference);
      return {
        staffReference,
        name: staff.name,
        ...(staff.jobTitle?.trim() ? { role: staff.jobTitle.trim() } : {}),
        ...(staff.biography?.trim() ? { bio: staff.biography.trim().slice(0, 2_000) } : {}),
        // Brief credentials are requirements, not proof that a person holds
        // them. The current canonical staff record has no verified credential
        // field, so JSON-LD must not manufacture hasCredential values.
        credentials: [],
        ...(profilePath ? { profilePath } : {}),
      };
    };
    return {
      publicReference: page.reference,
      pageType: page.pageType,
      conversionRole: page.conversionRole,
      path,
      title: page.title,
      active: true,
      indexable: page.pageType !== 'BOOKING' && seo.index !== false,
      canonical: true,
      rendererKey: page.rendererKey,
      rendererVersion: page.rendererVersion,
      rendererStatus: 'READY' as const,
      layoutReference: page.layoutReference,
      layoutStatus: 'APPROVED' as const,
      templateVersionStatus: 'APPROVED' as const,
      lastModifiedAt: page.updatedAt.toISOString(),
      compatiblePageTypes: compatibilityRows
        .filter((item) => item.layoutId === page.layoutId)
        .map((item) => item.pageType),
      seo: {
        title: String(seo.title ?? page.title).slice(0, 70),
        description: String(
          seo.description ?? `Learn more about ${page.title} and book securely through KS OS.`,
        ).slice(0, 170),
        canonicalPath: path,
        index: page.pageType !== 'BOOKING' && seo.index !== false,
        follow: seo.follow !== false,
        openGraphTitle: String(seo.openGraphTitle ?? seo.title ?? page.title).slice(0, 100),
        openGraphDescription: String(
          seo.openGraphDescription
          ?? seo.description
          ?? `Learn more about ${page.title} and book securely through KS OS.`,
        ).slice(0, 200),
        ...(typeof seo.openGraphImageAssetReference === 'string'
          ? { openGraphImageAssetReference: seo.openGraphImageAssetReference }
          : {}),
        twitterCard: seo.twitterCard === 'summary' ? 'summary' : 'summary_large_image',
      },
      sections: parsedSectionsByPageId.get(page.id) ?? [],
      ...(brief ? {
        structuredDataEligibility: [...new Set([
          ...(approvedStrategy?.structuredDataStrategy.globalTypes ?? []),
          ...brief.schemaTypes,
        ])],
      } : {}),
      ...(brief?.authorship.staffReference ? {
        authorship: {
          author: canonicalStaffProfile(
            brief.authorship.staffReference,
          ),
          ...(brief.reviewer.staffReference ? {
            reviewer: canonicalStaffProfile(
              brief.reviewer.staffReference,
            ),
          } : {}),
        },
      } : {}),
    };
  });
  if (pageSnapshots.length === 0) {
    throw new SiteJobExecutionError(
      'TERMINAL_VALIDATION_FAILURE',
      'A preview snapshot requires at least one generated page.',
    );
  }
  const navigationCandidates = pageRows.map((page) => ({
    label: (page.navigationLabel || page.title).slice(0, 80),
    pageReference: page.reference,
    pageType: page.pageType,
    children: [] as Array<{ label: string; pageReference: string }>,
  }));
  const pageByType = (pageType: string) => navigationCandidates.find(page => page.pageType === pageType);
  const groupedItem = (parentType: string, childType: string) => {
    const parent = pageByType(parentType);
    if (!parent) return null;
    return {
      ...parent,
      children: navigationCandidates
        .filter(page => page.pageType === childType)
        .map(({ label, pageReference }) => ({ label, pageReference }))
        .slice(0, 20),
    };
  };
  const primaryNavigation = [
    pageByType('HOME'),
    groupedItem('SERVICE_HUB', 'SERVICE_DETAIL'),
    pageByType('ABOUT'),
    groupedItem('TEAM_HUB', 'TEAM_DETAIL'),
    pageByType('RESULTS'),
    pageByType('LOCATION_DETAIL'),
    pageByType('CONTACT'),
  ].filter((page): page is NonNullable<typeof page> => Boolean(page)).slice(0, 12);
  const footerNavigation = navigationCandidates
    .filter(page => !['BOOKING', 'POLICIES'].includes(page.pageType))
    .slice(0, 20);
  const utilityNavigation = navigationCandidates
    .filter(page => ['BOOKING', 'CONTACT', 'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE'].includes(page.pageType))
    .slice(0, 8);
  const legalNavigation = navigationCandidates
    .filter(page => page.pageType === 'POLICIES')
    .slice(0, 8);

  const allowedAssetMimeTypes = new Set([
    'image/avif',
    'image/webp',
    'image/jpeg',
    'image/png',
    'image/gif',
  ]);
  const assets = assetRows.flatMap((asset) => {
    const url = approvedAssetUrl(asset.storagePath);
    if (
      !url
      || !asset.width
      || !asset.height
      || !allowedAssetMimeTypes.has(asset.mimeType)
    ) return [];
    const alt = asset.altText?.trim().slice(0, 500) ?? '';
    return [{
      publicReference: asset.reference,
      type: ['LOGO', 'ICON'].includes(asset.kind) ? asset.kind : 'IMAGE',
      publicationStatus: 'PUBLISHED' as const,
      mimeType: asset.mimeType,
      url,
      width: asset.width,
      height: asset.height,
      purpose: alt ? 'INFORMATIVE' as const : 'DECORATIVE' as const,
      alt,
      variants: [],
    }];
  });
  const staffServices = new Map<string, string[]>();
  for (const assignment of assignmentRows) {
    const references = staffServices.get(assignment.staffId) ?? [];
    references.push(assignment.serviceReference);
    staffServices.set(assignment.staffId, references);
  }
  const fallbackDomain = (
    process.env.PUBLIC_SITES_FALLBACK_DOMAIN || 'sites.kasimshah.com'
  ).trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const canonicalHostname = `${context.tenantSubdomain}.${fallbackDomain}`;
  const snapshotReference = randomUUID();
  const entityBindings = applyGovernedEntityAssetBindings({
    assets: pinnedAssets ?? [],
    availableAssetReferences: new Set(assets.map(asset => asset.publicReference)),
    business: {
      name: context.tenantName,
      ...(context.tenantLegalName ? { legalName: context.tenantLegalName } : {}),
      description: context.tenantBusinessType
        ? `${context.tenantName} provides ${context.tenantBusinessType.toLowerCase()} services.`
        : `${context.tenantName} services and secure online booking.`,
      ...(optionalPublicPhone(context.tenantPhone)
        ? { publicTelephone: optionalPublicPhone(context.tenantPhone) }
        : {}),
      ...(optionalPublicEmail(context.tenantEmail)
        ? { publicEmail: optionalPublicEmail(context.tenantEmail) }
        : {}),
      socialLinks: [],
    },
    services: serviceRows.map((service) => ({
      publicReference: service.reference,
      name: service.name,
      shortDescription: (
        service.description?.trim()
        || `${service.name} is available to book through KS OS.`
      ).slice(0, 500),
      durationMinutes: service.duration,
      priceText: `£${(service.price / 100).toFixed(2)}`,
      bookingEnabled: true,
    })),
    staff: staffRows.map((staff) => ({
      publicReference: staff.reference,
      displayName: staff.name,
      role: staff.jobTitle?.trim() || 'Team member',
      ...(staff.biography?.trim()
        ? { biography: staff.biography.trim().slice(0, 2_000) }
        : {}),
      bookingEnabled: staff.bookingEnabled,
      serviceReferences: staffServices.get(staff.id) ?? [],
    })),
  });
  const snapshot = {
    schemaVersion: 1,
    publicReference: snapshotReference,
    siteReference: run.siteReference,
    versionReference: run.versionReference,
    templateVersionReference: run.templateVersionReference,
    visibility: 'PREVIEW',
    siteStatus: context.siteStatus,
    versionStatus: context.versionStatus,
    createdAt: new Date().toISOString(),
    publishedAt: null,
    language: 'en-GB',
    theme: {
      primaryColour: context.primaryColour,
      secondaryColour: context.secondaryColour,
      accentColour: context.accentColour,
      backgroundColour: '#ffffff',
      surfaceColour: '#ffffff',
      textColour: '#111827',
      mutedTextColour: '#4b5563',
      borderColour: '#d1d5db',
      headingFontKey: 'SYSTEM_SANS',
      bodyFontKey: 'SYSTEM_SANS',
      radiusScale: 'MEDIUM',
      spacingDensity: 'COMFORTABLE',
      containerWidth: 'STANDARD',
      buttonStyle: 'SOLID',
      imageStyle: 'ROUNDED',
      motionPreference: 'REDUCED',
      ...(designTokens ? { designTokens } : {}),
    },
    navigation: {
      primary: primaryNavigation.map(({ pageType: _pageType, ...item }) => item),
      footer: footerNavigation.map(({ pageType: _pageType, ...item }) => item),
      utility: utilityNavigation.map(({ pageType: _pageType, ...item }) => item),
      legal: legalNavigation.map(({ pageType: _pageType, ...item }) => item),
    },
    business: entityBindings.business,
    locations: locationRows.map((location) => ({
      publicReference: location.reference,
      name: location.name,
      addressLines: location.address
        .split(/\r?\n|,\s*/)
        .map((line) => line.trim().slice(0, 240))
        .filter(Boolean)
        .slice(0, 5),
      locality: location.name,
      postalCode: location.postcode,
      countryCode: 'GB',
      ...(optionalPublicPhone(location.phone)
        ? { publicTelephone: optionalPublicPhone(location.phone) }
        : {}),
      openingHours: [],
    })),
    services: entityBindings.services,
    staff: entityBindings.staff,
    assets,
    domains: [{
      hostname: canonicalHostname,
      kind: 'FALLBACK',
      status: 'ACTIVE',
      primary: true,
    }],
    canonicalHostname,
    booking: {
      tenantReference: context.tenantReference,
      tenantSubdomain: context.tenantSubdomain,
      campaignReference: 'site-review',
    },
    pages: pageSnapshots,
  };
  const prepared = prepareSiteRenderSnapshotForStorage(snapshot);
  const [latest] = await transaction.select({
    value: max(siteRenderSnapshots.revision),
  }).from(siteRenderSnapshots).where(and(
    eq(siteRenderSnapshots.siteVersionId, run.versionId),
    eq(siteRenderSnapshots.snapshotKind, 'PREVIEW'),
  ));
  await transaction.insert(siteRenderSnapshots).values({
    publicReference: snapshotReference,
    tenantId: run.tenantId,
    siteId: run.siteId,
    siteVersionId: run.versionId,
    templateVersionId: run.templateVersionId,
    snapshotKind: 'PREVIEW',
    revision: (latest?.value ?? 0) + 1,
    schemaVersion: prepared.schemaVersion,
    contentJson: prepared.content,
    contentDigestSha256: prepared.contentDigestSha256,
    sourceContentDigestSha256,
    createdByAgencyUserId: run.requestedByAgencyUserId,
  });
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
  const provider = createSiteGenerationProvider(config);
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
    let runtime: PreparedRuntime;
    try {
      await this.assertPayloadOwnership(run, payload.siteReference, payload.requestedByAgencyUserReference);
      if (run.blueprintReference !== payload.blueprintReference
        || (payload.knowledgePackReference
          && run.knowledgePackReference !== payload.knowledgePackReference)) {
        throw new SiteJobExecutionError(
          'TERMINAL_PERMISSION_FAILURE',
          'The stored generation job does not match its pinned run.',
        );
      }
      runtime = await this.prepareRuntime(run);
    } catch (error) {
      if (error instanceof SiteJobExecutionError) {
        await failGenerationRun(this.database, run, {
          failureCode: error.code,
          failureMessage: error.message,
        });
      }
      throw error;
    }
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
      pipelineVersion: runtime.pipelineVersion,
      searchIntelligence: runtime.searchIntelligence,
    });
    await finalizeProvisionedWorkspace(this.database, run.id);
    return {
      summary: result.status === 'DESIGN_COMPLETE'
        ? 'The structured draft and governed design are complete and await full-site quality validation.'
        : 'The structured draft site is ready for agency review.',
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
    const currentPage = await this.loadGeneratedPage(run, page.pageReference);
    const generated = await executeStructuredPageGeneration({
      page,
      template: constraint,
      facts: runtime.facts,
      knowledge,
      approvedPageReferences: runtime.plan.pages.map(item => item.pageReference),
      currentPage,
      approvedSearchStrategy: runtime.searchIntelligence?.strategy,
      pageSeoBrief: runtime.searchIntelligence?.briefs.find(brief => brief.pageReference === page.pageReference),
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
    await this.completeReviewRegeneration(
      run,
      lease.jobReference,
      page.pageReference,
    );
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
      pageSeoBrief: runtime.searchIntelligence?.briefs.find(brief => brief.pageReference === planPage.pageReference),
      provider: this.provider,
      maxRepairAttempts: this.config.maxRepairAttempts,
      maxOutputCharacters: this.config.maxOutputCharacters,
      signal: lease.signal,
    });
    await this.persistRegeneratedSection(run, result.output, result.outputContentDigestSha256);
    await this.completeReviewRegeneration(
      run,
      lease.jobReference,
      payload.pageReference,
      payload.sectionReference,
    );
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
        pageSeoBrief: runtime.searchIntelligence?.briefs.find(brief => brief.pageReference === reference),
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
        pageSeoBrief: runtime.searchIntelligence?.briefs.find(brief => brief.pageReference === reference),
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
      templateManifest: templateVersions.manifestJson,
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
      assetInputJson: siteGenerationRuns.assetInputJson,
      promptTemplateVersion: siteGenerationRuns.promptTemplateVersion,
      provisioningRunId: siteGenerationRuns.provisioningRunId,
      searchStrategyId: siteGenerationRuns.searchStrategyId,
      searchStrategyVersion: siteGenerationRuns.searchStrategyVersion,
      searchStrategyDigestSha256: siteGenerationRuns.searchStrategyDigestSha256,
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
      layoutSemanticKey: templateLayouts.semanticKey,
      sectionManifest: templateLayouts.sectionManifestJson,
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
    const pipelineVersion = generationPipelineVersion(run);
    const searchIntelligence = pipelineVersion === 2
      ? await this.loadPinnedSearchIntelligence(run, pages)
      : undefined;
    const briefByBlueprintPage = new Map(
      searchIntelligence?.briefs.map(brief => [brief.blueprintPageReference, brief]) ?? [],
    );
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
          ...(pipelineVersion === 2
            ? { plannedPageReference: briefByBlueprintPage.get(page.reference)!.pageReference }
            : {}),
        }).onConflictDoNothing();
      }
    });
    const pageRuns = await this.database.select({
      blueprintPageId: siteGenerationPageRuns.blueprintPageId,
      plannedPageReference: siteGenerationPageRuns.plannedPageReference,
    }).from(siteGenerationPageRuns).where(eq(siteGenerationPageRuns.generationRunId, run.id));
    const pageRunReferences = new Map(pageRuns.map(item => [item.blueprintPageId, item.plannedPageReference]));
    if (pipelineVersion === 2 && pages.some(page =>
      pageRunReferences.get(page.id) !== briefByBlueprintPage.get(page.reference)?.pageReference)) {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'A persisted page-run identity does not match its approved SEO brief.');
    }
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
      const nativeManifest = pipelineVersion === 2
        ? getNativeLayoutManifest(page.layoutSemanticKey)
        : null;
      const knowledgeSections = nativeManifest?.componentRegistryVersion === 2
        ? nativeManifest.sections.map(section => section.sectionType)
        : plannedSections;
      const pageReference = pageRunReferences.get(page.id)!;
      const context = prepareDatabaseGenerationContext({
        pack,
        pageType: page.pageType as Parameters<typeof prepareDatabaseGenerationContext>[0]['pageType'],
        conversionRole: page.conversionRole as Parameters<typeof prepareDatabaseGenerationContext>[0]['conversionRole'],
        plannedSections: knowledgeSections,
        availableBusinessData: available,
        maximumContextCharacters: 100_000,
      });
      knowledgeContexts.set(pageReference, context);
      return {
        blueprintPageReference: page.reference,
        pageReference,
        title: page.title,
        slug: blueprintPathToSiteSlug(page.slug),
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
      const registeredSections = sectionRows
        .filter(item => item.layoutId === page.layoutId)
        .flatMap(item => {
          const parsed = SiteSectionTypeSchema.safeParse(item.sectionType);
          return parsed.success ? [{ ...item, sectionType: parsed.data }] : [];
        });
      const nativeManifest = pipelineVersion === 2
        ? getNativeLayoutManifest(page.layoutSemanticKey)
        : null;
      const supportedSections = registeredSections.length
        ? registeredSections
        : nativeManifest?.sections.map((section, order) => ({
            layoutId: page.layoutId,
            sectionType: section.sectionType,
            required: section.required,
            order,
          })) ?? [];
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
        componentRegistryVersion: nativeManifest?.componentRegistryVersion ?? 1,
        availableComponentKeys: nativeManifest?.sections.flatMap(section => section.componentKeys) ?? [],
      });
    });
    return { run, pipelineVersion, plan, constraints, facts, knowledgeContexts, searchIntelligence };
  }

  private async loadPinnedSearchIntelligence(
    run: RunContext,
    pages: ReadonlyArray<{ reference: string; pageType: string }>,
  ): Promise<ApprovedSearchIntelligenceInput> {
    return loadPinnedSearchIntelligence(this.database, run, pages);
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
    const pinnedAssets = pinnedGenerationAssets(run);
    const assetConditions = [
      eq(siteAssets.tenantId, run.tenantId),
      eq(siteAssets.siteId, run.siteId),
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
  if (pinnedAssets?.length) {
      assetConditions.push(inArray(
        siteAssets.publicReference,
        pinnedAssets.map(asset => asset.publicReference),
      ));
  }
    const assetRowsPromise = pinnedAssets?.length === 0
      ? Promise.resolve([])
      : this.database.select({
        reference: siteAssets.publicReference,
        kind: siteAssets.kind,
        alt: siteAssets.altText,
        width: siteAssets.width,
        height: siteAssets.height,
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
      assetRowsPromise,
    ]);
    const row = business[0];
    if (!row) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Verified business data is unavailable.');
    const pinnedByReference = new Map(
      (pinnedAssets ?? []).map(asset => [asset.publicReference, asset]),
    );
    return buildVerifiedBusinessFacts({
      business: row,
      services: serviceRows,
      locations: locationRows,
      staff: staffRows,
      assetReferences: assetRows.map(asset => asset.reference),
      assets: assetRows.map(asset => ({
        ...asset,
        entityReference: pinnedByReference.get(asset.reference)?.entityReference,
      })),
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

  private async completeReviewRegeneration(
    run: RunContext,
    jobReference: string,
    pageReference: string,
    sectionReference?: string,
  ) {
    await this.database.transaction(async transaction => {
      const [linked] = await transaction.select({
        requestId: siteChangeRequests.id,
        requestReference: siteChangeRequests.publicReference,
        requestStatus: siteChangeRequests.status,
        requestPageId: siteChangeRequests.pageId,
        requestSectionId: siteChangeRequests.sectionId,
        cycleId: siteReviewCycles.id,
        cycleReference: siteReviewCycles.publicReference,
        cycleStatus: siteReviewCycles.status,
        reviewScope: siteReviewCycles.reviewScope,
        scopedPageId: siteReviewCycles.scopedPageId,
        scopedSectionId: siteReviewCycles.scopedSectionId,
        reviewRevision: siteReviewCycles.reviewRevision,
        agencyOwnerUserId: siteReviewCycles.agencyOwnerUserId,
        clientApprovalRequired: siteReviewCycles.clientApprovalRequired,
        agencyApprovalRequired: siteReviewCycles.agencyApprovalRequired,
        createdByAgencyUserId: siteReviewCycles.createdByAgencyUserId,
        generationRunId: siteReviewCycles.generationRunId,
        blueprintId: siteReviewCycles.blueprintId,
        blueprintRevision: siteReviewCycles.blueprintRevision,
        templateVersionId: siteReviewCycles.templateVersionId,
        knowledgePackId: siteReviewCycles.knowledgePackId,
        knowledgePackSemanticVersion: siteReviewCycles.knowledgePackSemanticVersion,
        provenance: siteVersions.generationProvenanceJson,
      }).from(siteChangeRequests)
        .innerJoin(siteJobs, eq(siteChangeRequests.regenerationJobId, siteJobs.id))
        .innerJoin(siteReviewCycles, eq(siteChangeRequests.reviewCycleId, siteReviewCycles.id))
        .innerJoin(siteVersions, eq(siteReviewCycles.siteVersionId, siteVersions.id))
        .where(and(
          eq(siteJobs.publicReference, jobReference),
          eq(siteChangeRequests.tenantId, run.tenantId),
          eq(siteChangeRequests.siteId, run.siteId),
          eq(siteChangeRequests.versionId, run.versionId),
          eq(siteChangeRequests.status, 'IN_PROGRESS'),
        ))
        .limit(1);
      if (!linked) return;

      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`site-review-revision:${run.versionId}`}::text, 0)
        )
      `);
      const [pages, sections] = await Promise.all([
        transaction.select({
          reference: sitePages.publicReference,
          pageType: sitePages.pageType,
          title: sitePages.title,
          navigationLabel: sitePages.navigationLabel,
          slug: sitePages.slug,
          sortOrder: sitePages.sortOrder,
          seoTitle: sitePages.seoTitle,
          seoDescription: sitePages.seoDescription,
          seo: sitePages.seoJson,
          internalLinks: sitePages.internalLinksJson,
          structuredData: sitePages.structuredDataInputsJson,
          assets: sitePages.assetRequirementsJson,
        }).from(sitePages).where(and(
          eq(sitePages.versionId, run.versionId),
          isNull(sitePages.archivedAt),
        )).orderBy(asc(sitePages.sortOrder)),
        transaction.select({
          reference: siteSections.publicReference,
          pageId: siteSections.pageId,
          sectionType: siteSections.sectionType,
          sortOrder: siteSections.sortOrder,
          content: siteSections.contentJson,
          actions: siteSections.actionsJson,
        }).from(siteSections).where(eq(siteSections.versionId, run.versionId))
          .orderBy(asc(siteSections.pageId), asc(siteSections.sortOrder)),
      ]);
      const contentDigestSha256 = generationDigest({ pages, sections });
      const provenance = linked.provenance && typeof linked.provenance === 'object'
        ? linked.provenance as Record<string, unknown>
        : {};
      await transaction.update(siteVersions).set({
        generationStatus: 'READY_FOR_REVIEW',
        generationContentDigestSha256: contentDigestSha256,
        generationProvenanceJson: {
          ...provenance,
          outputContentDigestSha256: contentDigestSha256,
          revisedByJobReference: jobReference,
          revisedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      }).where(eq(siteVersions.id, run.versionId));
      await transaction.update(siteGenerationRuns).set({
        outputContentDigestSha256: contentDigestSha256,
        updatedAt: new Date(),
      }).where(eq(siteGenerationRuns.id, run.id));
      await persistValidatedPreviewSnapshot(
        transaction,
        run,
        contentDigestSha256,
      );

      const invalidatedApprovals = await transaction.update(siteApprovals).set({
        status: 'WITHDRAWN',
        invalidatedAt: new Date(),
        invalidationReason: 'CONTENT_REGENERATED',
      }).where(and(
        eq(siteApprovals.reviewCycleId, linked.cycleId),
        isNull(siteApprovals.invalidatedAt),
      )).returning({ id: siteApprovals.id, reference: siteApprovals.publicReference });
      for (const approval of invalidatedApprovals) {
        await transaction.update(siteApprovalDecisions).set({
          invalidatedAt: new Date(),
          invalidationReason: 'CONTENT_REGENERATED',
        }).where(and(
          eq(siteApprovalDecisions.approvalId, approval.id),
          isNull(siteApprovalDecisions.invalidatedAt),
        ));
        await transaction.insert(siteReviewActivity).values({
          reviewCycleId: linked.cycleId,
          eventType: 'SITE_APPROVAL_INVALIDATED',
          actorType: 'SYSTEM',
          targetType: 'SITE_APPROVAL',
          targetPublicReference: approval.reference,
          safeMetadataJson: { reasonCode: 'CONTENT_REGENERATED' },
        });
      }
      await transaction.update(siteReviewComments).set({
        anchorStatus: 'OUTDATED',
        updatedAt: new Date(),
      }).where(eq(siteReviewComments.reviewCycleId, linked.cycleId));
      await transaction.update(siteReviewItems).set({
        status: 'SUPERSEDED',
        updatedAt: new Date(),
      }).where(eq(siteReviewItems.reviewCycleId, linked.cycleId));
      await transaction.update(siteFactVerifications).set({
        status: 'SUPERSEDED',
        supersededAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(siteFactVerifications.reviewCycleId, linked.cycleId));
      await transaction.update(siteReviewCycles).set({
        status: 'SUPERSEDED',
        updatedAt: new Date(),
      }).where(eq(siteReviewCycles.id, linked.cycleId));
      await transaction.update(siteChangeRequests).set({
        status: 'READY_FOR_REVIEW',
        resultingSiteVersionId: run.versionId,
        resultingPageId: linked.requestPageId,
        resultingSectionId: linked.requestSectionId,
        updatedAt: new Date(),
      }).where(eq(siteChangeRequests.id, linked.requestId));
      await transaction.insert(siteChangeRequestEvents).values({
        changeRequestId: linked.requestId,
        reviewCycleId: linked.cycleId,
        eventType: 'READY_FOR_REVIEW',
        fromStatus: linked.requestStatus,
        toStatus: 'READY_FOR_REVIEW',
        actorType: 'SYSTEM',
        safeMetadataJson: {
          jobReference,
          pageReference,
          ...(sectionReference ? { sectionReference } : {}),
          contentDigestSha256,
        },
      });
      await transaction.insert(siteReviewActivity).values({
        reviewCycleId: linked.cycleId,
        eventType: 'SITE_REVISION_READY',
        actorType: 'SYSTEM',
        targetType: 'SITE_CHANGE_REQUEST',
        targetPublicReference: linked.requestReference,
        safeMetadataJson: { jobReference, contentDigestSha256 },
      });

      const [latestRevision] = await transaction.select({
        value: max(siteReviewCycles.reviewRevision),
      }).from(siteReviewCycles).where(eq(siteReviewCycles.siteVersionId, run.versionId));
      const [newCycle] = await transaction.insert(siteReviewCycles).values({
        tenantId: run.tenantId,
        siteId: run.siteId,
        siteVersionId: run.versionId,
        generationRunId: linked.generationRunId,
        blueprintId: linked.blueprintId,
        blueprintRevision: linked.blueprintRevision,
        templateVersionId: linked.templateVersionId,
        knowledgePackId: linked.knowledgePackId,
        knowledgePackSemanticVersion: linked.knowledgePackSemanticVersion,
        pinnedContentDigestSha256: contentDigestSha256,
        status: 'DRAFT',
        reviewScope: linked.reviewScope,
        scopedPageId: linked.scopedPageId,
        scopedSectionId: linked.scopedSectionId,
        reviewRevision: (latestRevision?.value ?? linked.reviewRevision) + 1,
        agencyOwnerUserId: linked.agencyOwnerUserId,
        clientApprovalRequired: linked.clientApprovalRequired,
        agencyApprovalRequired: linked.agencyApprovalRequired,
        createdByAgencyUserId: linked.createdByAgencyUserId,
      }).returning({
        id: siteReviewCycles.id,
        reference: siteReviewCycles.publicReference,
        revision: siteReviewCycles.reviewRevision,
      });

      const previousParticipants = await transaction.select()
        .from(siteReviewParticipants)
        .where(eq(siteReviewParticipants.reviewCycleId, linked.cycleId));
      const clonedParticipants = previousParticipants.length
        ? await transaction.insert(siteReviewParticipants).values(
          previousParticipants.map((participant) => ({
            reviewCycleId: newCycle.id,
            participantType: participant.participantType,
            agencyUserId: participant.agencyUserId,
            tenantUserId: participant.tenantUserId,
            contactReference: participant.contactReference,
            displayName: participant.displayName,
            emailNormalized: participant.emailNormalized,
            role: participant.role,
            status: participant.participantType === 'AGENCY_USER' ? 'ACTIVE' : 'INVITED',
            acceptedAt: participant.participantType === 'AGENCY_USER' ? new Date() : null,
          })),
        ).returning()
        : [];

      const currentPages = await transaction.select({
        id: sitePages.id,
        sortOrder: sitePages.sortOrder,
      }).from(sitePages).where(and(
        eq(sitePages.versionId, run.versionId),
        isNull(sitePages.archivedAt),
      )).orderBy(asc(sitePages.sortOrder));
      if (currentPages.length) {
        await transaction.insert(siteReviewItems).values(currentPages.map((page) => ({
          reviewCycleId: newCycle.id,
          targetType: 'PAGE',
          pageId: page.id,
          status: 'PENDING',
          requiredReviewerType: 'CLIENT',
          displayOrder: page.sortOrder,
        })));
      }
      const currentSections = await transaction.select({
        id: siteSections.id,
        pageId: siteSections.pageId,
        sortOrder: siteSections.sortOrder,
      }).from(siteSections).where(eq(siteSections.versionId, run.versionId));
      if (currentSections.length) {
        await transaction.insert(siteReviewItems).values(
          currentSections.map((section, index) => ({
            reviewCycleId: newCycle.id,
            targetType: 'SECTION',
            pageId: section.pageId,
            sectionId: section.id,
            status: 'PENDING',
            requiredReviewerType: 'CLIENT',
            displayOrder: (section.sortOrder * 100) + index,
          })),
        );
      }
      const findings = await transaction.select({
        id: siteGenerationFindings.id,
        severity: siteGenerationFindings.severity,
      }).from(siteGenerationFindings).where(and(
        eq(siteGenerationFindings.generationRunId, run.id),
        eq(siteGenerationFindings.current, true),
      ));
      if (findings.length) {
        await transaction.insert(siteReviewItems).values(findings.map((finding, index) => ({
          reviewCycleId: newCycle.id,
          targetType: 'GENERATION_FINDING',
          generationFindingId: finding.id,
          status: 'PENDING',
          requiredReviewerType: 'AGENCY',
          blocking: finding.severity === 'ERROR',
          clientVisible: false,
          displayOrder: 100_000 + index,
        })));
      }

      const previousFacts = await transaction.select({
        fact: siteFactVerifications,
        blocking: siteReviewItems.blocking,
      }).from(siteFactVerifications)
        .leftJoin(siteReviewItems, eq(siteFactVerifications.reviewItemId, siteReviewItems.id))
        .where(eq(siteFactVerifications.reviewCycleId, linked.cycleId));
      for (const [index, previous] of previousFacts.entries()) {
        const [item] = await transaction.insert(siteReviewItems).values({
          reviewCycleId: newCycle.id,
          targetType: 'FACT',
          status: 'PENDING',
          requiredReviewerType: 'FACT_VERIFIER',
          blocking: previous.blocking ?? false,
          clientVisible: true,
          displayOrder: 200_000 + index,
        }).returning({ id: siteReviewItems.id });
        await transaction.insert(siteFactVerifications).values({
          reviewCycleId: newCycle.id,
          reviewItemId: item.id,
          tenantId: run.tenantId,
          factType: previous.fact.factType,
          sourceEntityType: previous.fact.sourceEntityType,
          sourceEntityReference: previous.fact.sourceEntityReference,
          displayLabel: previous.fact.displayLabel,
          proposedPublicValue: previous.fact.proposedPublicValue,
          valueDigestSha256: previous.fact.valueDigestSha256,
          status: 'PENDING_REVIEW',
          evidenceRequired: previous.fact.evidenceRequired,
          evidenceReference: previous.fact.evidenceReference,
          evidencePrivate: previous.fact.evidencePrivate,
        });
      }

      await transaction.insert(siteReviewActivity).values({
        reviewCycleId: newCycle.id,
        eventType: 'SITE_REVIEW_CYCLE_CREATED',
        actorType: 'SYSTEM',
        targetType: 'SITE_REVIEW_CYCLE',
        targetPublicReference: newCycle.reference,
        safeMetadataJson: {
          previousReviewCycleReference: linked.cycleReference,
          reasonCode: 'CONTENT_REGENERATED',
          reviewRevision: newCycle.revision,
          contentDigestSha256,
        },
      });
      await transaction.insert(platformAuditEvents).values({
        tenantId: run.tenantId,
        action: 'SITE_REVISION_READY',
        targetType: 'SITE_CHANGE_REQUEST',
        targetId: linked.requestReference,
        outcome: 'SUCCESS',
        metadata: {
          previousReviewCycleReference: linked.cycleReference,
          newReviewCycleReference: newCycle.reference,
          reviewRevision: newCycle.revision,
          jobReference,
          contentDigestSha256,
        },
        eventCategory: 'WEBSITE',
        description: 'A controlled site regeneration completed and created a new review revision.',
        environment: process.env.NODE_ENV || 'development',
        sourceComponent: 'site-worker',
      });

      for (const participant of clonedParticipants.filter((item) =>
        item.participantType === 'AGENCY_USER')) {
        const [suppression] = await transaction.select({ id: emailSuppressions.id })
          .from(emailSuppressions)
          .where(eq(emailSuppressions.recipientEmailNormalized, participant.emailNormalized))
          .limit(1);
        if (suppression) continue;
        await transaction.insert(emailOutbox).values({
          tenantId: run.tenantId,
          recipientEmail: participant.emailNormalized,
          recipientName: participant.displayName,
          templateKey: 'site-review-notification',
          templateVersion: '1.0.0',
          templateDataJson: {
            tenantName: 'Your website team',
            participantName: participant.displayName,
            heading: 'A revised website draft is ready',
            message: 'A requested website revision completed and is ready for internal review.',
            siteReference: run.siteReference,
            reviewReference: newCycle.reference,
            reviewRevision: newCycle.revision,
          },
          idempotencyKey:
            `site-review-notify:${newCycle.reference}:revision-ready:${participant.publicReference}`,
          relatedEntityType: 'site_review_cycle',
          relatedEntityId: newCycle.id,
          status: 'PENDING',
          scheduledFor: new Date(),
          nextAttemptAt: new Date(),
        }).onConflictDoNothing({ target: emailOutbox.idempotencyKey });
      }
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
  private siteStrategy: SiteCompositionStrategy | undefined;

  constructor(
    private readonly database: Database,
    private readonly run: RunContext,
    private readonly plan: GenerationPlan,
    private readonly constraints: readonly TemplateGenerationConstraint[],
  ) {}

  async persistCompositionArtifacts(input: {
    strategy: SiteCompositionStrategy;
    pagePlans: readonly PageCompositionPlan[];
    assetCoveragePlan: AssetCoveragePlan;
  }) {
    this.siteStrategy = input.strategy;
    await this.database.transaction(transaction => this.audit(
      transaction,
      'SITE_COMPOSITION_PLANNED',
      'SUCCESS',
      {
        pagePlanCount: input.pagePlans.length,
        assetAssignmentCount: input.assetCoveragePlan.assignments.length,
        missingAssetCount: input.assetCoveragePlan.uncoveredRequirements.length,
        strategyDigestSha256: generationDigest(input.strategy),
        pagePlansDigestSha256: generationDigest(input.pagePlans),
      },
    ));
  }

  async updatePlannedSectionCount(sectionCountPlanned: number) {
    await this.database.update(siteGenerationRuns).set({
      sectionCountPlanned,
      updatedAt: new Date(),
    }).where(eq(siteGenerationRuns.id, this.run.id));
  }

  async beginRun(input: { pageCountPlanned: number; sectionCountPlanned: number }) {
    let cancelledBeforeStart = false;
    await this.database.transaction(async transaction => {
      const [current] = await transaction.select({ status: siteGenerationRuns.status })
        .from(siteGenerationRuns).where(eq(siteGenerationRuns.id, this.run.id)).limit(1);
      if (!current) throw new Error('Generation run disappeared before execution.');
      if (current.status === 'DESIGN_COMPLETE' || current.status === 'READY_FOR_REVIEW' || current.status === 'SUPERSEDED') {
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
    readinessStatus: 'DESIGN_COMPLETE' | 'READY_FOR_REVIEW';
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
        status: input.readinessStatus,
        generationContextDigestSha256: contextDigest,
        outputContentDigestSha256: input.outputContentDigestSha256,
        pageCountCompleted: input.pageCountCompleted,
        sectionCountCompleted: completedSections.length,
        completedAt: new Date(),
      }).where(eq(siteGenerationRuns.id, this.run.id));
      await transaction.update(siteVersions).set({
        generationStatus: input.readinessStatus,
        generationProvenanceJson: provenance,
        generationContentDigestSha256: input.outputContentDigestSha256,
        generationCompletedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(siteVersions.id, this.run.versionId),
        eq(siteVersions.status, 'DRAFT'),
      ));
      await persistValidatedPreviewSnapshot(
        transaction,
        this.run,
        input.outputContentDigestSha256,
        this.siteStrategy?.recommendedDesignTokens,
      );
      await this.audit(transaction, 'SITE_GENERATION_COMPLETED', 'SUCCESS', {
        pageCount: input.pageCountCompleted,
        sectionCount: completedSections.length,
        outputDigestSha256: input.outputContentDigestSha256,
        readinessStatus: input.readinessStatus,
      });
    });
  }

  async failRun(input: { failureCode: string; failureMessage: string }) {
    await failGenerationRun(this.database, this.run, input);
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
