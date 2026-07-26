import {
  EMPTY_TEMPLATE_DESIGN_SIGNALS,
  EMPTY_TEMPLATE_RESPONSIVE_SIGNALS,
  SitePageTypeSchema,
  TemplateBookingCtaPositionSchema,
  TemplateDesignSignalsSchema,
  TemplateManifestSchema,
  TemplateResponsiveSignalsSchema,
  type CreateTemplateLicence,
  type CreateTemplateSource,
  type CreateTemplateVersion,
  type ResolveTemplateFinding,
  type SitePageType,
  type StartTemplateAnalysis,
  type TemplateManifest,
  type UpdateTemplateLayout,
  type UpdateTemplateSource,
} from '@ks-os/contracts';
import {
  getDatabase,
  sites,
  templateAnalysisFindings,
  templateAnalysisRuns,
  templateFiles,
  templateLayoutPageTypes,
  templateLayouts,
  templateLayoutSections,
  templateLicenses,
  templateSources,
  templateVersions,
} from '@ks-os/database';
import {
  TemplateCompatibilityService,
  TemplateLayoutCompatibilityError,
  TemplateLicenceGuard,
  assertTemplateApprovalReady,
  assertTemplateVersionMutable,
  type ApprovedLayoutCompatibility,
  type TemplateCompatibilityRepository,
  type TemplateLicenceContext,
  type TemplateLicenceRepository,
  type TrustedTemplateAnalysis,
} from '@ks-os/template-intelligence';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  sql,
} from 'drizzle-orm';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function safeSourceMetadata(input: {
  industryTags?: string[];
  agencyNotes?: string | null;
}, current: unknown = {}) {
  const metadata = record(current);
  return {
    ...metadata,
    ...(input.industryTags ? { industryTags: input.industryTags } : {}),
    ...(input.agencyNotes !== undefined
      ? { agencyNotes: input.agencyNotes }
      : {}),
  };
}

function layoutKeyFromPath(path: string, position: number) {
  const file = path.split('/').at(-1)?.replace(/\.[^.]+$/, '') || `layout-${position}`;
  const normalized = file
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(normalized) && normalized.length > 1
    ? normalized.slice(0, 120)
    : `layout-${position}`;
}

export class TemplateIntelligenceService {
  private readonly audit: AgencyAuditService;

  constructor(
    private readonly db = getDatabase(),
    audit = new AgencyAuditService(),
  ) {
    this.audit = audit;
  }

  async listSources() {
    const rows = await this.db
      .select({ id: templateSources.id })
      .from(templateSources)
      .orderBy(desc(templateSources.updatedAt));
    return Promise.all(rows.map((row) => this.sourceView(row.id)));
  }

  async getSource(sourceReference: string) {
    const source = await this.sourceContext(sourceReference);
    return this.sourceView(source.id);
  }

  async createSource(actor: AgencyActor, input: CreateTemplateSource) {
    const [source] = await this.db
      .insert(templateSources)
      .values({
        sourceType: input.sourceType,
        name: input.name,
        status: 'DRAFT',
        sourceReference: input.sourceReference,
        metadataJson: safeSourceMetadata(input),
        createdByAgencyUserId: actor.agencyUserId,
      })
      .returning();
    await this.audit.write(
      actor,
      'TEMPLATE_SOURCE_CREATED',
      'TEMPLATE_SOURCE',
      source.id,
      {
        category: 'WEBSITE',
        metadata: {
          templateSourceReference: source.publicReference,
          sourceType: source.sourceType,
        },
      },
    );
    return this.sourceView(source.id);
  }

  async updateSource(
    actor: AgencyActor,
    sourceReference: string,
    input: UpdateTemplateSource,
  ) {
    const source = await this.sourceContext(sourceReference);
    const [updated] = await this.db
      .update(templateSources)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.industryTags !== undefined || input.agencyNotes !== undefined
          ? {
            metadataJson: safeSourceMetadata(input, source.metadataJson),
          }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(templateSources.id, source.id))
      .returning();
    await this.audit.write(
      actor,
      'TEMPLATE_SOURCE_UPDATED',
      'TEMPLATE_SOURCE',
      source.id,
      {
        category: 'WEBSITE',
        metadata: {
          templateSourceReference: sourceReference,
          fields: Object.keys(input),
        },
      },
    );
    return this.sourceView(updated.id);
  }

  async listVersions(sourceReference: string) {
    const source = await this.sourceContext(sourceReference);
    const rows = await this.db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(eq(templateVersions.templateSourceId, source.id))
      .orderBy(desc(templateVersions.versionNumber));
    return Promise.all(rows.map((row) => this.versionView(row.id)));
  }

  async createVersion(
    actor: AgencyActor,
    sourceReference: string,
    input: CreateTemplateVersion,
  ) {
    const source = await this.sourceContext(sourceReference);
    if (source.sourceType === 'ENVATO_HTML' && input.manualLayouts.length > 0) {
      throw fail(
        400,
        'ENVATO_ANALYSIS_REQUIRED',
        'Envato HTML layouts must come from deterministic artefact analysis.',
      );
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`template-version:${source.id}`}::text, 0)
        )
      `);
      const [latest] = await tx
        .select({ highest: max(templateVersions.versionNumber) })
        .from(templateVersions)
        .where(eq(templateVersions.templateSourceId, source.id));
      const [version] = await tx
        .insert(templateVersions)
        .values({
          templateSourceId: source.id,
          versionNumber: Number(latest?.highest || 0) + 1,
          status: 'DRAFT',
          analysisStatus: input.manualLayouts.length
            ? 'REVIEW_REQUIRED'
            : 'PENDING',
          artifactDigestSha256: input.artifactDigestSha256,
          artifactReference: input.artifactReference,
          analyserVersion: input.analyserVersion,
          checksumSha256: input.artifactDigestSha256,
          manifestJson: {},
        })
        .returning();

      let runId: string | null = null;
      if (input.manualLayouts.length > 0) {
        const [run] = await tx
          .insert(templateAnalysisRuns)
          .values({
            templateVersionId: version.id,
            status: 'REVIEW_REQUIRED',
            analyserVersion: input.analyserVersion,
            artifactDigestSha256: input.artifactDigestSha256,
            attemptCount: 1,
            startedAt: new Date(),
            completedAt: new Date(),
            summaryJson: {
              mode: 'AGENCY_MANUAL_CLASSIFICATION',
              designSignals: EMPTY_TEMPLATE_DESIGN_SIGNALS,
              layoutSignals: {},
            },
            createdByAgencyUserId: actor.agencyUserId,
          })
          .returning();
        runId = run.id;
        for (const manual of input.manualLayouts) {
          const [layout] = await tx
            .insert(templateLayouts)
            .values({
              templateVersionId: version.id,
              name: manual.name,
              semanticKey: manual.layoutKey,
              status: 'DRAFT',
              detectedPageType: manual.recommendedPageType || 'UNKNOWN',
              recommendedPageType: manual.recommendedPageType,
              conversionRole: manual.conversionRole,
              classificationConfidenceBp: 10000,
              classificationEvidenceJson: ['AGENCY_MANUAL_CLASSIFICATION'],
              requiresAgencyReview: false,
              agencyNotes: manual.agencyNotes,
              analysisRunId: run.id,
            })
            .returning();
          if (manual.allowedPageTypes.length) {
            await tx.insert(templateLayoutPageTypes).values(
              manual.allowedPageTypes.map((pageType) => ({
                templateLayoutId: layout.id,
                pageType,
                approvedByAgencyUserId: actor.agencyUserId,
                approvedAt: new Date(),
              })),
            );
          }
        }
        const manifest = await this.rebuildManifest(version.id, tx);
        await tx
          .update(templateVersions)
          .set({ manifestJson: manifest })
          .where(eq(templateVersions.id, version.id));
      }

      await this.audit.write(
        actor,
        'TEMPLATE_VERSION_CREATED',
        'TEMPLATE_VERSION',
        version.id,
        {
          category: 'WEBSITE',
          metadata: {
            templateSourceReference: sourceReference,
            templateVersionReference: version.publicReference,
            versionNumber: version.versionNumber,
            manualLayoutCount: input.manualLayouts.length,
            analysisRunCreated: Boolean(runId),
          },
          tx,
        },
      );
      return this.versionView(version.id, tx);
    });
  }

  async getVersion(versionReference: string) {
    const version = await this.versionContext(versionReference);
    return this.versionView(version.id);
  }

  async startAnalysis(
    actor: AgencyActor,
    versionReference: string,
    input: StartTemplateAnalysis,
  ) {
    const version = await this.versionContext(versionReference);
    this.assertVersionMutable(version);
    if (
      version.artifactDigestSha256
      && version.artifactDigestSha256 !== input.artifactDigestSha256
    ) {
      throw fail(
        409,
        'TEMPLATE_ARTIFACT_DIGEST_MISMATCH',
        'The analysis digest does not match the registered template artefact.',
      );
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`template-analysis:${version.id}`}::text, 0)
        )
      `);
      const [existing] = await tx
        .select()
        .from(templateAnalysisRuns)
        .where(and(
          eq(templateAnalysisRuns.templateVersionId, version.id),
          eq(templateAnalysisRuns.artifactDigestSha256, input.artifactDigestSha256),
          eq(templateAnalysisRuns.analyserVersion, input.analyserVersion),
        ))
        .limit(1);
      if (existing) return this.analysisRunView(existing.id, tx);

      const [run] = await tx
        .insert(templateAnalysisRuns)
        .values({
          templateVersionId: version.id,
          status: 'PENDING',
          analyserVersion: input.analyserVersion,
          artifactDigestSha256: input.artifactDigestSha256,
          createdByAgencyUserId: actor.agencyUserId,
        })
        .returning();
      await tx
        .update(templateVersions)
        .set({
          analysisStatus: 'PENDING',
          artifactDigestSha256: input.artifactDigestSha256,
          analyserVersion: input.analyserVersion,
        })
        .where(eq(templateVersions.id, version.id));
      await this.audit.write(
        actor,
        'TEMPLATE_ANALYSIS_STARTED',
        'TEMPLATE_ANALYSIS_RUN',
        run.id,
        {
          category: 'WEBSITE',
          metadata: {
            templateVersionReference: versionReference,
            analysisRunReference: run.publicReference,
            analyserVersion: input.analyserVersion,
          },
          tx,
        },
      );
      return this.analysisRunView(run.id, tx);
    });
  }

  async getAnalysis(versionReference: string) {
    const version = await this.versionContext(versionReference);
    const [run] = await this.db
      .select({ id: templateAnalysisRuns.id })
      .from(templateAnalysisRuns)
      .where(eq(templateAnalysisRuns.templateVersionId, version.id))
      .orderBy(desc(templateAnalysisRuns.createdAt))
      .limit(1);
    return run ? this.analysisRunView(run.id) : null;
  }

  async getManifest(versionReference: string) {
    const version = await this.versionContext(versionReference);
    const parsed = TemplateManifestSchema.safeParse(version.manifestJson);
    return parsed.success ? parsed.data : null;
  }

  async recordTrustedAnalysis(
    actor: AgencyActor,
    runReference: string,
    analysis: TrustedTemplateAnalysis,
  ) {
    const context = await this.runContext(runReference);
    this.assertVersionMutable(context.version);
    if (context.run.artifactDigestSha256 !== analysis.artifactDigestSha256) {
      throw fail(
        409,
        'TEMPLATE_ARTIFACT_DIGEST_MISMATCH',
        'Trusted analysis output does not match the registered artefact digest.',
      );
    }
    if (['READY_FOR_APPROVAL', 'REVIEW_REQUIRED'].includes(context.run.status)) {
      return this.analysisRunView(context.run.id);
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`template-analysis:${context.version.id}`}::text, 0)
        )
      `);
      const now = new Date();
      await tx
        .update(templateAnalysisRuns)
        .set({
          status: 'ANALYSING',
          startedAt: context.run.startedAt || now,
          attemptCount: sql`${templateAnalysisRuns.attemptCount} + 1`,
          failureCode: null,
        })
        .where(eq(templateAnalysisRuns.id, context.run.id));

      if (analysis.files.length) {
        await tx.insert(templateFiles).values(analysis.files.map((file) => ({
          analysisRunId: context.run.id,
          relativePath: file.relativePath,
          category: file.category,
          extension: file.extension,
          byteSize: file.byteSize,
          checksumSha256: file.sha256,
          likelyPageCandidate: file.likelyPageCandidate,
          referencedByAnalysedFile: file.referencedByAnalysedFile,
          containsExecutableCode: file.containsExecutableCode,
          safeForPublicUse: file.safeForPublicUse,
          requiresAgencyReview: file.requiresAgencyReview,
        })));
      }

      const layoutSignals: Record<string, unknown> = {};
      for (const [index, analysed] of analysis.layouts.entries()) {
        const [layout] = await tx
          .insert(templateLayouts)
          .values({
            templateVersionId: context.version.id,
            name: analysed.analysis.title || `Detected layout ${index + 1}`,
            semanticKey: layoutKeyFromPath(analysed.sourceFile, index + 1),
            status: 'DRAFT',
            sourceFilePath: analysed.sourceFile,
            detectedPageType: analysed.classification.detectedPageType,
            recommendedPageType: analysed.classification.recommendedPageType,
            conversionRole: analysed.classification.conversionRole,
            classificationConfidenceBp: Math.round(
              analysed.classification.confidence * 10000,
            ),
            classificationEvidenceJson: analysed.classification.evidence,
            requiresAgencyReview: analysed.classification.requiresAgencyReview,
            analysisRunId: context.run.id,
          })
          .returning();
        if (analysed.analysis.sections.length) {
          await tx.insert(templateLayoutSections).values(
            analysed.analysis.sections.map((section) => ({
              analysisRunId: context.run.id,
              layoutId: layout.id,
              sectionType: section.sectionType,
              confidenceBp: Math.round(section.confidence * 10000),
              domOrder: section.domOrder,
              structuralReference: section.structuralReference,
              requiredForRecommendedPageType:
                section.requiredForRecommendedPageType,
              containsBookingAction: section.containsBookingAction,
              requiresAgencyReview: section.requiresAgencyReview,
            })),
          );
        }
        layoutSignals[analysed.sourceFile] = {
          suggestedAdditionalPageTypes:
            analysed.classification.suggestedAdditionalPageTypes,
          incompatiblePageTypes:
            analysed.classification.incompatiblePageTypes,
          bookingCtaPositions: [
            ...new Set(analysed.analysis.bookingCtas.map((cta) => cta.position)),
          ],
          responsiveSignals: analysed.analysis.responsiveSignals,
          accessibilityConcerns: analysed.analysis.accessibilityConcerns,
          securityConcerns: analysed.analysis.securityConcerns,
        };
      }
      if (analysis.findings.length) {
        await tx.insert(templateAnalysisFindings).values(
          analysis.findings.map((finding) => ({
            analysisRunId: context.run.id,
            severity: finding.severity,
            category: finding.category,
            code: finding.code,
            filePath: finding.filePath,
            message: finding.message,
          })),
        );
      }
      const requiresReview =
        analysis.layouts.some((layout) => layout.classification.requiresAgencyReview)
        || analysis.findings.some((finding) => finding.severity === 'BLOCKING');
      const status = requiresReview ? 'REVIEW_REQUIRED' : 'READY_FOR_APPROVAL';
      await tx
        .update(templateAnalysisRuns)
        .set({
          status,
          completedAt: now,
          summaryJson: {
            designSignals: analysis.designSignals,
            layoutSignals,
          },
        })
        .where(eq(templateAnalysisRuns.id, context.run.id));
      await tx
        .update(templateVersions)
        .set({
          analysisStatus: status,
          manifestJson: await this.rebuildManifest(context.version.id, tx),
        })
        .where(eq(templateVersions.id, context.version.id));
      await this.audit.write(
        actor,
        'TEMPLATE_ANALYSIS_COMPLETED',
        'TEMPLATE_ANALYSIS_RUN',
        context.run.id,
        {
          category: 'WEBSITE',
          metadata: {
            templateVersionReference: context.version.publicReference,
            analysisRunReference: runReference,
            fileCount: analysis.files.length,
            layoutCount: analysis.layouts.length,
            findingCount: analysis.findings.length,
            status,
          },
          tx,
        },
      );
      return this.analysisRunView(context.run.id, tx);
    });
  }

  async failAnalysis(
    actor: AgencyActor,
    runReference: string,
    failureCode: string,
  ) {
    const context = await this.runContext(runReference);
    this.assertVersionMutable(context.version);
    await this.db.transaction(async (tx) => {
      await tx
        .update(templateAnalysisRuns)
        .set({
          status: 'FAILED',
          failureCode: failureCode.slice(0, 100),
          completedAt: new Date(),
        })
        .where(eq(templateAnalysisRuns.id, context.run.id));
      await tx
        .update(templateVersions)
        .set({ analysisStatus: 'FAILED' })
        .where(eq(templateVersions.id, context.version.id));
      await this.audit.write(
        actor,
        'TEMPLATE_ANALYSIS_FAILED',
        'TEMPLATE_ANALYSIS_RUN',
        context.run.id,
        {
          category: 'WEBSITE',
          outcome: 'FAILURE',
          metadata: {
            templateVersionReference: context.version.publicReference,
            analysisRunReference: runReference,
            failureCode: failureCode.slice(0, 100),
          },
          tx,
        },
      );
    });
  }

  async updateLayout(
    actor: AgencyActor,
    layoutReference: string,
    input: UpdateTemplateLayout,
  ) {
    const context = await this.layoutContext(layoutReference);
    this.assertVersionMutable(context.version);
    await this.db.transaction(async (tx) => {
      await tx
        .update(templateLayouts)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.layoutKey !== undefined
            ? { semanticKey: input.layoutKey }
            : {}),
          ...(input.recommendedPageType !== undefined
            ? { recommendedPageType: input.recommendedPageType }
            : {}),
          ...(input.conversionRole !== undefined
            ? { conversionRole: input.conversionRole }
            : {}),
          ...(input.requiresAgencyReview !== undefined
            ? { requiresAgencyReview: input.requiresAgencyReview }
            : {}),
          ...(input.disabled !== undefined
            ? {
              disabledAt: input.disabled ? new Date() : null,
              status: input.disabled ? 'RETIRED' : 'DRAFT',
            }
            : {}),
          ...(input.agencyNotes !== undefined
            ? { agencyNotes: input.agencyNotes }
            : {}),
        })
        .where(eq(templateLayouts.id, context.layout.id));
      const manifest = await this.rebuildManifest(context.version.id, tx);
      await tx
        .update(templateVersions)
        .set({
          manifestJson: manifest,
          analysisStatus: 'REVIEW_REQUIRED',
        })
        .where(eq(templateVersions.id, context.version.id));
      await this.audit.write(
        actor,
        input.disabled === true
          ? 'TEMPLATE_LAYOUT_DISABLED'
          : 'TEMPLATE_LAYOUT_CLASSIFICATION_UPDATED',
        'TEMPLATE_LAYOUT',
        context.layout.id,
        {
          category: 'WEBSITE',
          metadata: {
            layoutReference,
            templateVersionReference: context.version.publicReference,
            fields: Object.keys(input),
          },
          tx,
        },
      );
    });
    return this.layoutView(context.layout.id);
  }

  async addLayoutPageType(
    actor: AgencyActor,
    layoutReference: string,
    pageType: SitePageType,
  ) {
    const context = await this.layoutContext(layoutReference);
    this.assertVersionMutable(context.version);
    if (context.layout.disabledAt) {
      throw fail(
        409,
        'TEMPLATE_LAYOUT_DISABLED',
        'A disabled layout cannot expose compatibility records.',
      );
    }
    if (pageType === 'BOOKING') {
      const [bookingSection] = await this.db
        .select({ id: templateLayoutSections.id })
        .from(templateLayoutSections)
        .where(and(
          eq(templateLayoutSections.layoutId, context.layout.id),
          eq(templateLayoutSections.containsBookingAction, true),
        ))
        .limit(1);
      if (
        !bookingSection
        && context.layout.recommendedPageType !== 'BOOKING'
        && context.layout.detectedPageType !== 'BOOKING'
      ) {
        throw fail(
          409,
          'TEMPLATE_BOOKING_CONTRACT_EVIDENCE_REQUIRED',
          'BOOKING compatibility requires detected or agency-confirmed native booking structure.',
        );
      }
    }

    await this.db.transaction(async (tx) => {
      await tx
        .insert(templateLayoutPageTypes)
        .values({
          templateLayoutId: context.layout.id,
          pageType,
          approvedByAgencyUserId: actor.agencyUserId,
          approvedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            templateLayoutPageTypes.templateLayoutId,
            templateLayoutPageTypes.pageType,
          ],
          set: {
            approvedByAgencyUserId: actor.agencyUserId,
            approvedAt: new Date(),
          },
        });
      const manifest = await this.rebuildManifest(context.version.id, tx);
      await tx
        .update(templateVersions)
        .set({
          manifestJson: manifest,
          analysisStatus: 'REVIEW_REQUIRED',
        })
        .where(eq(templateVersions.id, context.version.id));
      await this.audit.write(
        actor,
        'TEMPLATE_LAYOUT_CLASSIFICATION_UPDATED',
        'TEMPLATE_LAYOUT',
        context.layout.id,
        {
          category: 'WEBSITE',
          metadata: {
            layoutReference,
            templateVersionReference: context.version.publicReference,
            pageType,
            operation: 'ADDED',
          },
          tx,
        },
      );
    });
    return this.layoutView(context.layout.id);
  }

  async removeLayoutPageType(
    actor: AgencyActor,
    layoutReference: string,
    pageType: SitePageType,
  ) {
    const context = await this.layoutContext(layoutReference);
    this.assertVersionMutable(context.version);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(templateLayoutPageTypes)
        .where(and(
          eq(templateLayoutPageTypes.templateLayoutId, context.layout.id),
          eq(templateLayoutPageTypes.pageType, pageType),
        ));
      const manifest = await this.rebuildManifest(context.version.id, tx);
      await tx
        .update(templateVersions)
        .set({
          manifestJson: manifest,
          analysisStatus: 'REVIEW_REQUIRED',
        })
        .where(eq(templateVersions.id, context.version.id));
      await this.audit.write(
        actor,
        'TEMPLATE_LAYOUT_CLASSIFICATION_UPDATED',
        'TEMPLATE_LAYOUT',
        context.layout.id,
        {
          category: 'WEBSITE',
          metadata: {
            layoutReference,
            templateVersionReference: context.version.publicReference,
            pageType,
            operation: 'REMOVED',
          },
          tx,
        },
      );
    });
    return this.layoutView(context.layout.id);
  }

  async resolveFinding(
    actor: AgencyActor,
    findingReference: string,
    input: ResolveTemplateFinding,
  ) {
    const [context] = await this.db
      .select({
        findingId: templateAnalysisFindings.id,
        runId: templateAnalysisRuns.id,
        versionId: templateVersions.id,
        versionReference: templateVersions.publicReference,
        status: templateVersions.status,
        analysisStatus: templateVersions.analysisStatus,
      })
      .from(templateAnalysisFindings)
      .innerJoin(
        templateAnalysisRuns,
        eq(templateAnalysisFindings.analysisRunId, templateAnalysisRuns.id),
      )
      .innerJoin(
        templateVersions,
        eq(templateAnalysisRuns.templateVersionId, templateVersions.id),
      )
      .where(eq(templateAnalysisFindings.publicReference, findingReference))
      .limit(1);
    if (!context) {
      throw fail(404, 'TEMPLATE_FINDING_NOT_FOUND', 'Template finding not found.');
    }
    this.assertVersionMutable(context);
    await this.db.transaction(async (tx) => {
      await tx
        .update(templateAnalysisFindings)
        .set({
          resolvedAt: input.resolved ? new Date() : null,
          resolvedByAgencyUserId: input.resolved ? actor.agencyUserId : null,
          agencyNote: input.agencyNote,
        })
        .where(eq(templateAnalysisFindings.id, context.findingId));
      const manifest = await this.rebuildManifest(context.versionId, tx);
      await tx
        .update(templateVersions)
        .set({ manifestJson: manifest })
        .where(eq(templateVersions.id, context.versionId));
      await this.audit.write(
        actor,
        'TEMPLATE_ANALYSIS_FINDING_UPDATED',
        'TEMPLATE_ANALYSIS_FINDING',
        context.findingId,
        {
          category: 'WEBSITE',
          metadata: {
            findingReference,
            templateVersionReference: context.versionReference,
            resolved: input.resolved,
          },
          tx,
        },
      );
    });
  }

  async approveVersion(
    actor: AgencyActor,
    versionReference: string,
    reason: string,
  ) {
    const version = await this.versionContext(versionReference);
    this.assertVersionMutable(version);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`template-approval:${version.id}`}::text, 0)
        )
      `);
      const manifest = await this.rebuildManifest(version.id, tx);
      const [blocking] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(templateAnalysisFindings)
        .innerJoin(
          templateAnalysisRuns,
          eq(templateAnalysisFindings.analysisRunId, templateAnalysisRuns.id),
        )
        .where(and(
          eq(templateAnalysisRuns.templateVersionId, version.id),
          eq(templateAnalysisFindings.severity, 'BLOCKING'),
          isNull(templateAnalysisFindings.resolvedAt),
        ));
      let approval: ReturnType<typeof assertTemplateApprovalReady>;
      try {
        approval = assertTemplateApprovalReady({
          manifest,
          unresolvedBlockingFindings: Number(blocking?.count || 0),
        });
      } catch (error) {
        if (error instanceof Error && 'code' in error) {
          throw fail(409, String(error.code), error.message);
        }
        throw error;
      }

      const [latestRun] = await tx
        .select({ id: templateAnalysisRuns.id })
        .from(templateAnalysisRuns)
        .where(eq(templateAnalysisRuns.templateVersionId, version.id))
        .orderBy(desc(templateAnalysisRuns.createdAt))
        .limit(1);
      if (!latestRun) {
        throw fail(
          409,
          'TEMPLATE_ANALYSIS_REQUIRED',
          'A template analysis or agency manual review record is required.',
        );
      }
      if (approval.warnings.length > 0) {
        const [existingWarning] = await tx
          .select({ id: templateAnalysisFindings.id })
          .from(templateAnalysisFindings)
          .where(and(
            eq(templateAnalysisFindings.analysisRunId, latestRun.id),
            eq(
              templateAnalysisFindings.code,
              'TEMPLATE_SERVICE_DETAIL_LAYOUT_RECOMMENDED',
            ),
          ))
          .limit(1);
        if (!existingWarning) {
          await tx.insert(templateAnalysisFindings).values({
            analysisRunId: latestRun.id,
            severity: 'WARNING',
            category: 'CLASSIFICATION',
            code: 'TEMPLATE_SERVICE_DETAIL_LAYOUT_RECOMMENDED',
            message:
              'A production template should normally include a SERVICE_DETAIL-compatible layout.',
          });
        }
      }

      const now = new Date();
      await tx
        .update(templateLayouts)
        .set({ status: 'APPROVED' })
        .where(and(
          eq(templateLayouts.templateVersionId, version.id),
          isNull(templateLayouts.disabledAt),
        ));
      await tx
        .update(templateAnalysisRuns)
        .set({ status: 'APPROVED', completedAt: now })
        .where(eq(templateAnalysisRuns.id, latestRun.id));
      const finalManifest = await this.rebuildManifest(version.id, tx);
      await tx
        .update(templateVersions)
        .set({
          status: 'APPROVED',
          analysisStatus: 'APPROVED',
          manifestJson: finalManifest,
          approvedByAgencyUserId: actor.agencyUserId,
          approvedAt: now,
        })
        .where(eq(templateVersions.id, version.id));
      await tx
        .update(templateSources)
        .set({ status: 'APPROVED', updatedAt: now })
        .where(eq(templateSources.id, version.templateSourceId));
      await this.audit.write(
        actor,
        'TEMPLATE_VERSION_APPROVED',
        'TEMPLATE_VERSION',
        version.id,
        {
          category: 'WEBSITE',
          reason,
          metadata: {
            templateVersionReference: versionReference,
            warnings: approval.warnings,
          },
          tx,
        },
      );
      return this.versionView(version.id, tx);
    });
  }

  async rejectVersion(
    actor: AgencyActor,
    versionReference: string,
    reason: string,
  ) {
    const version = await this.versionContext(versionReference);
    this.assertVersionMutable(version);
    await this.db.transaction(async (tx) => {
      await tx
        .update(templateVersions)
        .set({ analysisStatus: 'REJECTED' })
        .where(eq(templateVersions.id, version.id));
      await tx
        .update(templateAnalysisRuns)
        .set({ status: 'REJECTED', completedAt: new Date() })
        .where(eq(templateAnalysisRuns.templateVersionId, version.id));
      await this.audit.write(
        actor,
        'TEMPLATE_VERSION_REJECTED',
        'TEMPLATE_VERSION',
        version.id,
        {
          category: 'WEBSITE',
          reason,
          metadata: { templateVersionReference: versionReference },
          tx,
        },
      );
    });
    return this.versionView(version.id);
  }

  async listLicences(siteReference: string, tenantId?: string) {
    const site = await this.siteContext(siteReference, tenantId);
    return this.db
      .select({
        reference: templateLicenses.publicReference,
        templateVersionReference: templateVersions.publicReference,
        sourceType: templateSources.sourceType,
        envatoItemReference: templateLicenses.envatoItemReference,
        projectRegistrationReference:
          templateLicenses.projectRegistrationReference,
        status: templateLicenses.status,
        recordedAt: templateLicenses.acquiredAt,
        verifiedAt: templateLicenses.verifiedAt,
      })
      .from(templateLicenses)
      .innerJoin(
        templateVersions,
        eq(templateLicenses.templateVersionId, templateVersions.id),
      )
      .innerJoin(
        templateSources,
        eq(templateLicenses.templateSourceId, templateSources.id),
      )
      .where(and(
        eq(templateLicenses.siteId, site.id),
        eq(templateLicenses.tenantId, site.tenantId),
      ))
      .orderBy(desc(templateLicenses.acquiredAt));
  }

  async recordLicence(
    actor: AgencyActor,
    siteReference: string,
    input: CreateTemplateLicence,
  ) {
    const site = await this.siteContext(siteReference);
    const version = await this.versionContext(input.templateVersionReference);
    const [source] = await this.db
      .select()
      .from(templateSources)
      .where(eq(templateSources.id, version.templateSourceId))
      .limit(1);
    if (source?.sourceType !== 'ENVATO_HTML') {
      throw fail(
        409,
        'ENVATO_LICENCE_NOT_REQUIRED',
        'Envato licence records apply only to ENVATO_HTML template sources.',
      );
    }
    const [licence] = await this.db
      .insert(templateLicenses)
      .values({
        templateSourceId: source.id,
        templateVersionId: version.id,
        tenantId: site.tenantId,
        siteId: site.id,
        provider: 'ENVATO',
        licenseReference: input.licenceReference,
        envatoItemReference: input.envatoItemReference,
        projectRegistrationReference: input.projectRegistrationReference,
        status: 'ACTIVE',
        evidenceStoragePath: input.evidenceStorageReference,
        acquiredAt: new Date(),
        createdByAgencyUserId: actor.agencyUserId,
      })
      .returning();
    await this.audit.write(
      actor,
      'TEMPLATE_LICENCE_RECORDED',
      'TEMPLATE_LICENCE',
      licence.id,
      {
        tenantId: site.tenantId,
        category: 'WEBSITE',
        metadata: {
          siteReference,
          templateVersionReference: input.templateVersionReference,
          envatoItemReference: input.envatoItemReference,
        },
      },
    );
    return this.licenceView(licence.id, site.tenantId);
  }

  async revokeLicence(
    actor: AgencyActor,
    siteReference: string,
    licenceReference: string,
    reason: string,
  ) {
    const site = await this.siteContext(siteReference);
    const [licence] = await this.db
      .select()
      .from(templateLicenses)
      .where(and(
        eq(templateLicenses.publicReference, licenceReference),
        eq(templateLicenses.siteId, site.id),
        eq(templateLicenses.tenantId, site.tenantId),
      ))
      .limit(1);
    if (!licence) {
      throw fail(404, 'TEMPLATE_LICENCE_NOT_FOUND', 'Template licence not found.');
    }
    await this.db
      .update(templateLicenses)
      .set({ status: 'REVOKED' })
      .where(eq(templateLicenses.id, licence.id));
    await this.audit.write(
      actor,
      'TEMPLATE_LICENCE_REVOKED',
      'TEMPLATE_LICENCE',
      licence.id,
      {
        tenantId: site.tenantId,
        category: 'WEBSITE',
        reason,
        metadata: { siteReference, licenceReference },
      },
    );
    return this.licenceView(licence.id, site.tenantId);
  }

  private assertVersionMutable(version: {
    status: string;
    analysisStatus: string;
  }) {
    try {
      assertTemplateVersionMutable(
        version.status === 'APPROVED' ? 'APPROVED' : version.analysisStatus,
      );
    } catch (error) {
      throw fail(
        409,
        'TEMPLATE_VERSION_IMMUTABLE',
        error instanceof Error
          ? error.message
          : 'Approved template versions are immutable.',
      );
    }
    if (['REJECTED', 'SUPERSEDED'].includes(version.analysisStatus)) {
      throw fail(
        409,
        'TEMPLATE_VERSION_TERMINAL',
        'Create a new template version after rejection or supersession.',
      );
    }
  }

  private async sourceContext(sourceReference: string) {
    const [source] = await this.db
      .select()
      .from(templateSources)
      .where(eq(templateSources.publicReference, sourceReference))
      .limit(1);
    if (!source) {
      throw fail(404, 'TEMPLATE_SOURCE_NOT_FOUND', 'Template source not found.');
    }
    return source;
  }

  private async versionContext(
    versionReference: string,
    executor: Executor = this.db,
  ) {
    const [version] = await executor
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.publicReference, versionReference))
      .limit(1);
    if (!version) {
      throw fail(404, 'TEMPLATE_VERSION_NOT_FOUND', 'Template version not found.');
    }
    return version;
  }

  private async layoutContext(layoutReference: string) {
    const [row] = await this.db
      .select({
        layout: templateLayouts,
        version: templateVersions,
      })
      .from(templateLayouts)
      .innerJoin(
        templateVersions,
        eq(templateLayouts.templateVersionId, templateVersions.id),
      )
      .where(eq(templateLayouts.publicReference, layoutReference))
      .limit(1);
    if (!row) {
      throw fail(404, 'TEMPLATE_LAYOUT_NOT_FOUND', 'Template layout not found.');
    }
    return row;
  }

  private async runContext(runReference: string) {
    const [row] = await this.db
      .select({
        run: templateAnalysisRuns,
        version: templateVersions,
      })
      .from(templateAnalysisRuns)
      .innerJoin(
        templateVersions,
        eq(templateAnalysisRuns.templateVersionId, templateVersions.id),
      )
      .where(eq(templateAnalysisRuns.publicReference, runReference))
      .limit(1);
    if (!row) {
      throw fail(404, 'TEMPLATE_ANALYSIS_NOT_FOUND', 'Template analysis not found.');
    }
    return row;
  }

  private async siteContext(siteReference: string, tenantId?: string) {
    const [site] = await this.db
      .select({
        id: sites.id,
        tenantId: sites.tenantId,
        reference: sites.publicReference,
      })
      .from(sites)
      .where(and(
        eq(sites.publicReference, siteReference),
        tenantId ? eq(sites.tenantId, tenantId) : undefined,
      ))
      .limit(1);
    if (!site) throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    return site;
  }

  private async sourceView(sourceId: string, executor: Executor = this.db) {
    const [source] = await executor
      .select()
      .from(templateSources)
      .where(eq(templateSources.id, sourceId))
      .limit(1);
    if (!source) {
      throw fail(404, 'TEMPLATE_SOURCE_NOT_FOUND', 'Template source not found.');
    }
    const metadata = record(source.metadataJson);
    return {
      reference: source.publicReference,
      sourceType: source.sourceType,
      name: source.name,
      status: source.status,
      industryTags: stringArray(metadata.industryTags),
      agencyNotes:
        typeof metadata.agencyNotes === 'string' ? metadata.agencyNotes : null,
      artefactRegistered: Boolean(source.sourceReference),
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  }

  private async versionView(versionId: string, executor: Executor = this.db) {
    const [version] = await executor
      .select({
        reference: templateVersions.publicReference,
        sourceReference: templateSources.publicReference,
        sourceType: templateSources.sourceType,
        versionNumber: templateVersions.versionNumber,
        status: templateVersions.status,
        analysisStatus: templateVersions.analysisStatus,
        artifactDigestSha256: templateVersions.artifactDigestSha256,
        analyserVersion: templateVersions.analyserVersion,
        approvedAt: templateVersions.approvedAt,
        createdAt: templateVersions.createdAt,
      })
      .from(templateVersions)
      .innerJoin(
        templateSources,
        eq(templateVersions.templateSourceId, templateSources.id),
      )
      .where(eq(templateVersions.id, versionId))
      .limit(1);
    if (!version) {
      throw fail(404, 'TEMPLATE_VERSION_NOT_FOUND', 'Template version not found.');
    }
    return version;
  }

  private async layoutView(layoutId: string, executor: Executor = this.db) {
    const [layout] = await executor
      .select({
        reference: templateLayouts.publicReference,
        templateVersionReference: templateVersions.publicReference,
        name: templateLayouts.name,
        layoutKey: templateLayouts.semanticKey,
        status: templateLayouts.status,
        sourceFile: templateLayouts.sourceFilePath,
        detectedPageType: templateLayouts.detectedPageType,
        recommendedPageType: templateLayouts.recommendedPageType,
        conversionRole: templateLayouts.conversionRole,
        classificationConfidenceBp:
          templateLayouts.classificationConfidenceBp,
        classificationEvidence: templateLayouts.classificationEvidenceJson,
        requiresAgencyReview: templateLayouts.requiresAgencyReview,
        disabledAt: templateLayouts.disabledAt,
        agencyNotes: templateLayouts.agencyNotes,
      })
      .from(templateLayouts)
      .innerJoin(
        templateVersions,
        eq(templateLayouts.templateVersionId, templateVersions.id),
      )
      .where(eq(templateLayouts.id, layoutId))
      .limit(1);
    if (!layout) {
      throw fail(404, 'TEMPLATE_LAYOUT_NOT_FOUND', 'Template layout not found.');
    }
    const pageTypes = await executor
      .select({ pageType: templateLayoutPageTypes.pageType })
      .from(templateLayoutPageTypes)
      .where(and(
        eq(templateLayoutPageTypes.templateLayoutId, layoutId),
        isNotNull(templateLayoutPageTypes.approvedAt),
      ))
      .orderBy(asc(templateLayoutPageTypes.pageType));
    return {
      ...layout,
      classificationConfidence: layout.classificationConfidenceBp / 10000,
      allowedPageTypes: pageTypes.map((row) => row.pageType),
      enabled: !layout.disabledAt,
    };
  }

  private async analysisRunView(runId: string, executor: Executor = this.db) {
    const [run] = await executor
      .select({
        reference: templateAnalysisRuns.publicReference,
        templateVersionReference: templateVersions.publicReference,
        status: templateAnalysisRuns.status,
        analyserVersion: templateAnalysisRuns.analyserVersion,
        artifactDigestSha256: templateAnalysisRuns.artifactDigestSha256,
        startedAt: templateAnalysisRuns.startedAt,
        completedAt: templateAnalysisRuns.completedAt,
        attemptCount: templateAnalysisRuns.attemptCount,
        failureCode: templateAnalysisRuns.failureCode,
        createdAt: templateAnalysisRuns.createdAt,
      })
      .from(templateAnalysisRuns)
      .innerJoin(
        templateVersions,
        eq(templateAnalysisRuns.templateVersionId, templateVersions.id),
      )
      .where(eq(templateAnalysisRuns.id, runId))
      .limit(1);
    if (!run) {
      throw fail(404, 'TEMPLATE_ANALYSIS_NOT_FOUND', 'Template analysis not found.');
    }
    const [files, findings, layouts] = await Promise.all([
      executor
        .select({
          reference: templateFiles.publicReference,
          relativePath: templateFiles.relativePath,
          category: templateFiles.category,
          extension: templateFiles.extension,
          byteSize: templateFiles.byteSize,
          checksumSha256: templateFiles.checksumSha256,
          likelyPageCandidate: templateFiles.likelyPageCandidate,
          referencedByAnalysedFile: templateFiles.referencedByAnalysedFile,
          containsExecutableCode: templateFiles.containsExecutableCode,
          safeForPublicUse: templateFiles.safeForPublicUse,
          requiresAgencyReview: templateFiles.requiresAgencyReview,
        })
        .from(templateFiles)
        .where(eq(templateFiles.analysisRunId, runId))
        .orderBy(asc(templateFiles.relativePath)),
      executor
        .select({
          reference: templateAnalysisFindings.publicReference,
          severity: templateAnalysisFindings.severity,
          category: templateAnalysisFindings.category,
          code: templateAnalysisFindings.code,
          filePath: templateAnalysisFindings.filePath,
          layoutReference: templateLayouts.publicReference,
          message: templateAnalysisFindings.message,
          resolvedAt: templateAnalysisFindings.resolvedAt,
          agencyNote: templateAnalysisFindings.agencyNote,
        })
        .from(templateAnalysisFindings)
        .leftJoin(
          templateLayouts,
          eq(templateAnalysisFindings.layoutId, templateLayouts.id),
        )
        .where(eq(templateAnalysisFindings.analysisRunId, runId))
        .orderBy(asc(templateAnalysisFindings.createdAt)),
      executor
        .select({ id: templateLayouts.id })
        .from(templateLayouts)
        .where(eq(templateLayouts.analysisRunId, runId))
        .orderBy(asc(templateLayouts.semanticKey)),
    ]);
    return {
      ...run,
      files,
      findings,
      layouts: await Promise.all(
        layouts.map((layout) => this.layoutView(layout.id, executor)),
      ),
    };
  }

  private async licenceView(
    licenceId: string,
    tenantId: string,
    executor: Executor = this.db,
  ) {
    const [licence] = await executor
      .select({
        reference: templateLicenses.publicReference,
        templateVersionReference: templateVersions.publicReference,
        sourceType: templateSources.sourceType,
        envatoItemReference: templateLicenses.envatoItemReference,
        projectRegistrationReference:
          templateLicenses.projectRegistrationReference,
        status: templateLicenses.status,
        recordedAt: templateLicenses.acquiredAt,
        verifiedAt: templateLicenses.verifiedAt,
      })
      .from(templateLicenses)
      .innerJoin(
        templateVersions,
        eq(templateLicenses.templateVersionId, templateVersions.id),
      )
      .innerJoin(
        templateSources,
        eq(templateLicenses.templateSourceId, templateSources.id),
      )
      .where(and(
        eq(templateLicenses.id, licenceId),
        eq(templateLicenses.tenantId, tenantId),
      ))
      .limit(1);
    if (!licence) {
      throw fail(404, 'TEMPLATE_LICENCE_NOT_FOUND', 'Template licence not found.');
    }
    return licence;
  }

  private async rebuildManifest(
    versionId: string,
    executor: Executor = this.db,
  ): Promise<TemplateManifest> {
    const [version] = await executor
      .select({
        reference: templateVersions.publicReference,
        sourceType: templateSources.sourceType,
        sourceName: templateSources.name,
        sourceMetadata: templateSources.metadataJson,
      })
      .from(templateVersions)
      .innerJoin(
        templateSources,
        eq(templateVersions.templateSourceId, templateSources.id),
      )
      .where(eq(templateVersions.id, versionId))
      .limit(1);
    if (!version) {
      throw fail(404, 'TEMPLATE_VERSION_NOT_FOUND', 'Template version not found.');
    }
    const [latestRun] = await executor
      .select({
        id: templateAnalysisRuns.id,
        summaryJson: templateAnalysisRuns.summaryJson,
      })
      .from(templateAnalysisRuns)
      .where(eq(templateAnalysisRuns.templateVersionId, versionId))
      .orderBy(desc(templateAnalysisRuns.createdAt))
      .limit(1);
    const layouts = await executor
      .select()
      .from(templateLayouts)
      .where(eq(templateLayouts.templateVersionId, versionId))
      .orderBy(asc(templateLayouts.semanticKey));
    const layoutIds = layouts.map((layout) => layout.id);
    const compatibilities = layoutIds.length
      ? await executor
        .select()
        .from(templateLayoutPageTypes)
        .where(and(
          inArray(templateLayoutPageTypes.templateLayoutId, layoutIds),
          isNotNull(templateLayoutPageTypes.approvedAt),
        ))
      : [];
    const sections = layoutIds.length
      ? await executor
        .select()
        .from(templateLayoutSections)
        .where(inArray(templateLayoutSections.layoutId, layoutIds))
        .orderBy(asc(templateLayoutSections.domOrder))
      : [];
    const findings = latestRun
      ? await executor
        .select({
          reference: templateAnalysisFindings.publicReference,
          severity: templateAnalysisFindings.severity,
          category: templateAnalysisFindings.category,
          code: templateAnalysisFindings.code,
          filePath: templateAnalysisFindings.filePath,
          layoutId: templateAnalysisFindings.layoutId,
          message: templateAnalysisFindings.message,
          resolvedAt: templateAnalysisFindings.resolvedAt,
        })
        .from(templateAnalysisFindings)
        .where(eq(templateAnalysisFindings.analysisRunId, latestRun.id))
      : [];

    const summary = record(latestRun?.summaryJson);
    const layoutSignals = record(summary.layoutSignals);
    const designParse = TemplateDesignSignalsSchema.safeParse(
      summary.designSignals,
    );
    const layoutReferenceById = new Map(
      layouts.map((layout) => [layout.id, layout.publicReference]),
    );
    const manifest = {
      schemaVersion: 1 as const,
      templateVersionReference: version.reference,
      sourceType: version.sourceType,
      name: version.sourceName,
      industryTags: stringArray(record(version.sourceMetadata).industryTags),
      designSignals: designParse.success
        ? designParse.data
        : EMPTY_TEMPLATE_DESIGN_SIGNALS,
      layouts: layouts.map((layout) => {
        const allowedPageTypes = layout.disabledAt
          ? []
          : compatibilities
            .filter((item) => item.templateLayoutId === layout.id)
            .map((item) => item.pageType as SitePageType);
        const signals = record(
          layout.sourceFilePath
            ? layoutSignals[layout.sourceFilePath]
            : undefined,
        );
        const responsive = TemplateResponsiveSignalsSchema.safeParse(
          signals.responsiveSignals,
        );
        const bookingCtaPositions = stringArray(signals.bookingCtaPositions)
          .flatMap((position) => {
            const parsed = TemplateBookingCtaPositionSchema.safeParse(position);
            return parsed.success ? [parsed.data] : [];
          });
        const rawSuggestedPageTypes = stringArray(
          signals.suggestedAdditionalPageTypes,
        ).flatMap((pageType) => {
          const parsed = SitePageTypeSchema.safeParse(pageType);
          return parsed.success ? [parsed.data] : [];
        });
        const suggestedAdditionalPageTypes = rawSuggestedPageTypes.filter(
          (pageType) =>
            pageType !== layout.recommendedPageType
            && !allowedPageTypes.includes(pageType),
        );
        const rawIncompatiblePageTypes = stringArray(
          signals.incompatiblePageTypes,
        ).flatMap((pageType) => {
          const parsed = SitePageTypeSchema.safeParse(pageType);
          return parsed.success ? [parsed.data] : [];
        });
        const incompatiblePageTypes = (
          rawIncompatiblePageTypes.length > 0
            ? rawIncompatiblePageTypes
            : SitePageTypeSchema.options
        ).filter(
          (pageType) =>
            pageType !== layout.recommendedPageType
            && !allowedPageTypes.includes(pageType)
            && !suggestedAdditionalPageTypes.includes(pageType),
        );
        return {
          layoutReference: layout.publicReference,
          layoutKey: layout.semanticKey,
          sourceFile: layout.sourceFilePath,
          detectedPageType: layout.detectedPageType,
          recommendedPageType: layout.recommendedPageType,
          suggestedAdditionalPageTypes,
          allowedPageTypes,
          incompatiblePageTypes,
          conversionRole: layout.conversionRole,
          classificationConfidence:
            layout.classificationConfidenceBp / 10000,
          classificationEvidence: stringArray(
            layout.classificationEvidenceJson,
          ),
          sections: sections
            .filter((section) => section.layoutId === layout.id)
            .map((section) => ({
              sectionType: section.sectionType,
              confidence: section.confidenceBp / 10000,
              domOrder: section.domOrder,
              structuralReference: section.structuralReference,
              requiredForRecommendedPageType:
                section.requiredForRecommendedPageType,
              containsBookingAction: section.containsBookingAction,
              requiresAgencyReview: section.requiresAgencyReview,
            })),
          bookingCtaPositions,
          responsiveSignals: responsive.success
            ? responsive.data
            : EMPTY_TEMPLATE_RESPONSIVE_SIGNALS,
          accessibilityConcerns: stringArray(signals.accessibilityConcerns),
          securityConcerns: stringArray(signals.securityConcerns),
          requiresAgencyReview: layout.requiresAgencyReview,
          enabled: !layout.disabledAt,
        };
      }),
      findings: findings.map((finding) => ({
        reference: finding.reference,
        severity: finding.severity,
        category: finding.category,
        code: finding.code,
        filePath: finding.filePath,
        layoutReference: finding.layoutId
          ? layoutReferenceById.get(finding.layoutId) || null
          : null,
        message: finding.message,
        resolved: Boolean(finding.resolvedAt),
      })),
    };
    return TemplateManifestSchema.parse(manifest);
  }
}

export class DatabaseTemplateCompatibilityRepository
implements TemplateCompatibilityRepository {
  constructor(private readonly db = getDatabase()) {}

  async findLayout(
    layoutReference: string,
  ): Promise<ApprovedLayoutCompatibility | null> {
    const [layout] = await this.db
      .select({
        id: templateLayouts.id,
        layoutReference: templateLayouts.publicReference,
        templateVersionReference: templateVersions.publicReference,
        versionStatus: templateVersions.analysisStatus,
        disabledAt: templateLayouts.disabledAt,
      })
      .from(templateLayouts)
      .innerJoin(
        templateVersions,
        eq(templateLayouts.templateVersionId, templateVersions.id),
      )
      .where(eq(templateLayouts.publicReference, layoutReference))
      .limit(1);
    if (!layout) return null;
    const pageTypes = await this.db
      .select({ pageType: templateLayoutPageTypes.pageType })
      .from(templateLayoutPageTypes)
      .where(and(
        eq(templateLayoutPageTypes.templateLayoutId, layout.id),
        isNotNull(templateLayoutPageTypes.approvedAt),
      ));
    return {
      layoutReference: layout.layoutReference,
      templateVersionReference: layout.templateVersionReference,
      templateVersionApproved: layout.versionStatus === 'APPROVED',
      enabled: !layout.disabledAt,
      approvedPageTypes: pageTypes.map(
        (row) => row.pageType as SitePageType,
      ),
    };
  }

  async listLayouts(
    templateVersionReference: string,
  ): Promise<readonly ApprovedLayoutCompatibility[]> {
    const layouts = await this.db
      .select({ reference: templateLayouts.publicReference })
      .from(templateLayouts)
      .innerJoin(
        templateVersions,
        eq(templateLayouts.templateVersionId, templateVersions.id),
      )
      .where(eq(templateVersions.publicReference, templateVersionReference));
    return (await Promise.all(
      layouts.map((layout) => this.findLayout(layout.reference)),
    )).filter(
      (layout): layout is ApprovedLayoutCompatibility => Boolean(layout),
    );
  }
}

export class DatabaseTemplateLicenceRepository
implements TemplateLicenceRepository {
  constructor(private readonly db = getDatabase()) {}

  async findLicenceContext(input: {
    siteReference: string;
    templateVersionReference: string;
  }): Promise<TemplateLicenceContext | null> {
    const [context] = await this.db
      .select({
        siteId: sites.id,
        tenantId: sites.tenantId,
        siteReference: sites.publicReference,
        versionId: templateVersions.id,
        versionReference: templateVersions.publicReference,
        sourceId: templateSources.id,
        sourceType: templateSources.sourceType,
      })
      .from(sites)
      .innerJoin(
        templateVersions,
        eq(templateVersions.publicReference, input.templateVersionReference),
      )
      .innerJoin(
        templateSources,
        eq(templateVersions.templateSourceId, templateSources.id),
      )
      .where(eq(sites.publicReference, input.siteReference))
      .limit(1);
    if (!context) return null;
    const [licence] = await this.db
      .select({
        status: templateLicenses.status,
        expiresAt: templateLicenses.expiresAt,
      })
      .from(templateLicenses)
      .where(and(
        eq(templateLicenses.siteId, context.siteId),
        eq(templateLicenses.tenantId, context.tenantId),
        eq(templateLicenses.templateVersionId, context.versionId),
        eq(templateLicenses.templateSourceId, context.sourceId),
      ))
      .orderBy(desc(templateLicenses.acquiredAt))
      .limit(1);
    return {
      sourceType: context.sourceType as TemplateLicenceContext['sourceType'],
      siteReference: context.siteReference,
      templateVersionReference: context.versionReference,
      licence: licence
        ? {
          status: licence.status as 'ACTIVE' | 'EXPIRED' | 'REVOKED',
          expiresAt: licence.expiresAt,
        }
        : null,
    };
  }
}

export function createTemplateCompatibilityService(
  db = getDatabase(),
) {
  return new TemplateCompatibilityService(
    new DatabaseTemplateCompatibilityRepository(db),
  );
}

export function createTemplateLicenceGuard(db = getDatabase()) {
  return new TemplateLicenceGuard(new DatabaseTemplateLicenceRepository(db));
}
