import { randomUUID } from 'node:crypto';
import {
  and,
  desc,
  eq,
  getDatabase,
  inArray,
} from '@ks-os/database';
import {
  sitePages,
  siteGenerationRuns,
  siteRenderSnapshots,
  siteReviewCycles,
  siteSections,
  sites,
  siteVersions,
  tenants,
} from '@ks-os/database';
import {
  SITE_DESIGN_PRESETS,
  SiteStudioSectionVariantSchema,
  SiteThemeEditorSchema,
  siteThemeAccessibilityIssues,
  type SiteStudioSectionVariant,
  type SiteThemeEditor,
} from '@ks-os/contracts';
import {
  listSiteComponents,
  resolveSiteComponent,
  SITE_COMPONENT_REGISTRY_VERSION,
} from '@ks-os/site-components';
import {
  SiteSectionSchema,
  prepareSiteRenderSnapshotForStorage,
  validatePublishedSnapshot,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

const editableVersionStatuses = new Set([
  'DRAFT',
  'INTERNAL_REVIEW',
  'CLIENT_REVIEW',
  'APPROVED',
]);

function cloneSnapshot(snapshot: PublishedSiteSnapshot): PublishedSiteSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as PublishedSiteSnapshot;
}

export class SiteDesignService {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
  ) {}

  async get(siteReference: string) {
    const context = await this.context(siteReference);
    const snapshot = await this.latestSnapshot(context.siteId, context.versionId);
    return {
      editable: editableVersionStatuses.has(context.versionStatus),
      versionReference: context.versionReference,
      theme: snapshot?.theme ?? SITE_DESIGN_PRESETS[0].theme,
      presets: SITE_DESIGN_PRESETS,
      sectionVariants: SiteStudioSectionVariantSchema.options,
      componentRegistryVersion: SITE_COMPONENT_REGISTRY_VERSION,
      componentCatalog: listSiteComponents().map(component => ({
        componentKey: component.componentKey,
        sectionType: component.sectionType,
        compatibleSectionTypes: component.compatibleSectionTypes,
        supportedPageTypes: component.supportedPageTypes,
        supportedConversionRoles: component.supportedConversionRoles,
        layoutIntent: component.layoutIntent,
        visualWeight: component.visualWeight,
        recommendedPosition: component.recommendedPosition,
        requiredDataBindings: component.requiredDataBindings,
        requiredAssetSlots: component.requiredAssetSlots,
        mobileBehaviour: component.mobileBehaviour,
      })),
      approvedAssets: snapshot?.assets.map(asset => ({
        publicReference: asset.publicReference,
        purpose: asset.purpose,
        alt: asset.alt,
        url: asset.url,
        width: asset.width,
        height: asset.height,
      })) ?? [],
    };
  }

  async updateTheme(
    actor: AgencyActor,
    siteReference: string,
    input: { presetKey?: string; theme: SiteThemeEditor },
  ) {
    const theme = SiteThemeEditorSchema.parse(input.theme);
    const issues = siteThemeAccessibilityIssues(theme);
    if (issues.length) {
      throw fail(
        422,
        'SITE_THEME_ACCESSIBILITY_FAILED',
        `The colour palette is not accessible. ${issues.join(' ')}`,
      );
    }
    const result = await this.persistDesignChange(
      actor,
      siteReference,
      snapshot => ({ ...snapshot, theme }),
      async (tx, context) => {
        await tx.update(tenants).set({
          primaryColor: theme.primaryColour,
          secondaryColor: theme.secondaryColour,
          accentColor: theme.accentColour,
          updatedAt: new Date(),
        }).where(eq(tenants.id, context.tenantId));
      },
      {
        action: 'SITE_THEME_UPDATED',
        targetType: 'SITE',
        metadata: { presetKey: input.presetKey ?? null },
        newValues: theme,
      },
    );
    return { ...result, theme };
  }

  async updateSectionVariant(
    actor: AgencyActor,
    siteReference: string,
    pageReference: string,
    sectionReference: string,
    variantInput: SiteStudioSectionVariant,
  ) {
    const variant = SiteStudioSectionVariantSchema.parse(variantInput);
    return this.persistDesignChange(
      actor,
      siteReference,
      snapshot => {
        const next = cloneSnapshot(snapshot);
        const page = next.pages.find(item => item.publicReference === pageReference);
        const section = page?.sections.find(item => item.reference === sectionReference);
        if (!page || !section) {
          throw fail(404, 'SITE_SECTION_NOT_FOUND', 'The selected section is not part of this site version.');
        }
        section.variant = variant;
        return next;
      },
      async (tx, context) => {
        const [row] = await tx.select({
          id: siteSections.id,
          content: siteSections.contentJson,
        }).from(siteSections)
          .innerJoin(sitePages, eq(siteSections.pageId, sitePages.id))
          .where(and(
            eq(siteSections.siteId, context.siteId),
            eq(siteSections.versionId, context.versionId),
            eq(sitePages.publicReference, pageReference),
            eq(siteSections.publicReference, sectionReference),
          ))
          .limit(1);
        if (!row) throw fail(404, 'SITE_SECTION_NOT_FOUND', 'The selected section could not be found.');
        const content = row.content && typeof row.content === 'object'
          ? row.content as Record<string, unknown>
          : {};
        await tx.update(siteSections).set({
          contentJson: { ...content, variant },
          updatedAt: new Date(),
        }).where(eq(siteSections.id, row.id));
      },
      {
        action: 'SITE_SECTION_VARIANT_UPDATED',
        targetType: 'SITE_SECTION',
        targetId: sectionReference,
        metadata: { pageReference },
        newValues: { variant },
      },
    );
  }

  async updateSectionComponent(
    actor: AgencyActor,
    siteReference: string,
    pageReference: string,
    sectionReference: string,
    componentKey: string,
  ) {
    return this.persistDesignChange(
      actor,
      siteReference,
      snapshot => {
        const next = cloneSnapshot(snapshot);
        const page = next.pages.find(item => item.publicReference === pageReference);
        const section = page?.sections.find(item => item.reference === sectionReference);
        if (!page || !section) {
          throw fail(404, 'SITE_SECTION_NOT_FOUND', 'The selected section is not part of this site version.');
        }
        try {
          resolveSiteComponent({
            sectionType: section.type,
            componentKey,
            pageType: page.pageType,
            conversionRole: page.conversionRole,
          });
        } catch (error) {
          throw fail(
            422,
            'SITE_COMPONENT_INCOMPATIBLE',
            error instanceof Error ? error.message : 'The selected component is incompatible.',
          );
        }
        section.componentKey = componentKey;
        return next;
      },
      async (tx, context) => {
        const [row] = await tx.select({
          id: siteSections.id,
          content: siteSections.contentJson,
        }).from(siteSections)
          .innerJoin(sitePages, eq(siteSections.pageId, sitePages.id))
          .where(and(
            eq(siteSections.siteId, context.siteId),
            eq(siteSections.versionId, context.versionId),
            eq(sitePages.publicReference, pageReference),
            eq(siteSections.publicReference, sectionReference),
          ))
          .limit(1);
        if (!row) throw fail(404, 'SITE_SECTION_NOT_FOUND', 'The selected section could not be found.');
        const content = row.content && typeof row.content === 'object'
          ? row.content as Record<string, unknown>
          : {};
        await tx.update(siteSections).set({
          contentJson: { ...content, componentKey },
          updatedAt: new Date(),
        }).where(eq(siteSections.id, row.id));
      },
      {
        action: 'SITE_SECTION_COMPONENT_UPDATED',
        targetType: 'SITE_SECTION',
        targetId: sectionReference,
        metadata: { pageReference },
        newValues: { componentKey },
      },
    );
  }

  async updateSectionContent(
    actor: AgencyActor,
    siteReference: string,
    pageReference: string,
    sectionReference: string,
    patch: Record<string, unknown>,
  ) {
    return this.persistDesignChange(
      actor,
      siteReference,
      snapshot => {
        const next = cloneSnapshot(snapshot);
        const page = next.pages.find(item => item.publicReference === pageReference);
        const index = page?.sections.findIndex(item => item.reference === sectionReference) ?? -1;
        const section = page?.sections[index];
        if (!page || !section || index < 0) {
          throw fail(404, 'SITE_SECTION_NOT_FOUND', 'The selected section is not part of this site version.');
        }
        page.sections[index] = SiteSectionSchema.parse({
          ...section,
          ...patch,
          reference: section.reference,
          type: section.type,
        });
        return next;
      },
      async (tx, context) => {
        const [row] = await tx.select({ id: siteSections.id, content: siteSections.contentJson })
          .from(siteSections)
          .innerJoin(sitePages, eq(siteSections.pageId, sitePages.id))
          .where(and(
            eq(siteSections.siteId, context.siteId),
            eq(siteSections.versionId, context.versionId),
            eq(sitePages.publicReference, pageReference),
            eq(siteSections.publicReference, sectionReference),
          )).limit(1);
        if (!row) throw fail(404, 'SITE_SECTION_NOT_FOUND', 'The selected section could not be found.');
        const content = row.content && typeof row.content === 'object'
          ? row.content as Record<string, unknown>
          : {};
        await tx.update(siteSections).set({
          contentJson: { ...content, ...patch, reference: sectionReference },
          updatedAt: new Date(),
        }).where(eq(siteSections.id, row.id));
      },
      {
        action: 'SITE_SECTION_CONTENT_UPDATED',
        targetType: 'SITE_SECTION',
        targetId: sectionReference,
        metadata: { pageReference, fields: Object.keys(patch).sort() },
      },
    );
  }

  async reorderSections(
    actor: AgencyActor,
    siteReference: string,
    pageReference: string,
    sectionReferences: readonly string[],
  ) {
    return this.persistDesignChange(
      actor,
      siteReference,
      snapshot => {
        const next = cloneSnapshot(snapshot);
        const page = next.pages.find(item => item.publicReference === pageReference);
        if (!page) throw fail(404, 'SITE_PAGE_NOT_FOUND', 'The selected page is not part of this site version.');
        const current = new Map(page.sections.map(section => [section.reference, section]));
        if (current.size !== sectionReferences.length
          || sectionReferences.some(reference => !current.has(reference))) {
          throw fail(422, 'SITE_SECTION_ORDER_INVALID', 'Section order must contain every current page section exactly once.');
        }
        page.sections = sectionReferences.map(reference => current.get(reference)!);
        return next;
      },
      async (tx, context) => {
        const rows = await tx.select({ id: siteSections.id, reference: siteSections.publicReference })
          .from(siteSections)
          .innerJoin(sitePages, eq(siteSections.pageId, sitePages.id))
          .where(and(
            eq(siteSections.siteId, context.siteId),
            eq(siteSections.versionId, context.versionId),
            eq(sitePages.publicReference, pageReference),
          ));
        const byReference = new Map(rows.map(row => [row.reference, row.id]));
        for (const [index, reference] of sectionReferences.entries()) {
          await tx.update(siteSections).set({ sortOrder: -10_000 - index })
            .where(eq(siteSections.id, byReference.get(reference)!));
        }
        for (const [index, reference] of sectionReferences.entries()) {
          await tx.update(siteSections).set({ sortOrder: index, updatedAt: new Date() })
            .where(eq(siteSections.id, byReference.get(reference)!));
        }
      },
      {
        action: 'SITE_SECTIONS_REORDERED',
        targetType: 'SITE_PAGE',
        targetId: pageReference,
        newValues: { sectionReferences },
      },
    );
  }

  async duplicateSection(
    actor: AgencyActor,
    siteReference: string,
    pageReference: string,
    sectionReference: string,
  ) {
    const duplicateReference = randomUUID();
    return this.persistDesignChange(
      actor,
      siteReference,
      snapshot => {
        const next = cloneSnapshot(snapshot);
        const page = next.pages.find(item => item.publicReference === pageReference);
        const section = page?.sections.find(item => item.reference === sectionReference);
        if (!page || !section) throw fail(404, 'SITE_SECTION_NOT_FOUND', 'The selected section is not part of this site version.');
        if (['HEADER', 'FOOTER', 'BOOKING_CTA', 'FINAL_CTA'].includes(section.type)) {
          throw fail(422, 'SITE_SECTION_DUPLICATION_FORBIDDEN', 'Site chrome and final conversion sections cannot be duplicated.');
        }
        page.sections.push({ ...JSON.parse(JSON.stringify(section)), reference: duplicateReference });
        return next;
      },
      async (tx, context) => {
        const [source] = await tx.select({
          pageId: siteSections.pageId,
          sectionKey: siteSections.sectionKey,
          sectionType: siteSections.sectionType,
          content: siteSections.contentJson,
          actions: siteSections.actionsJson,
        }).from(siteSections)
          .innerJoin(sitePages, eq(siteSections.pageId, sitePages.id))
          .where(and(
            eq(siteSections.siteId, context.siteId),
            eq(siteSections.versionId, context.versionId),
            eq(sitePages.publicReference, pageReference),
            eq(siteSections.publicReference, sectionReference),
          )).limit(1);
        if (!source) throw fail(404, 'SITE_SECTION_NOT_FOUND', 'The selected section could not be found.');
        const [last] = await tx.select({ sortOrder: siteSections.sortOrder })
          .from(siteSections).where(eq(siteSections.pageId, source.pageId))
          .orderBy(desc(siteSections.sortOrder)).limit(1);
        await tx.insert(siteSections).values({
          publicReference: duplicateReference,
          tenantId: context.tenantId,
          siteId: context.siteId,
          versionId: context.versionId,
          pageId: source.pageId,
          sectionKey: `${source.sectionKey.slice(0, 90)}-copy-${duplicateReference.slice(0, 8)}`,
          sectionType: source.sectionType,
          sortOrder: (last?.sortOrder ?? -1) + 1,
          contentJson: {
            ...(source.content && typeof source.content === 'object' ? source.content as Record<string, unknown> : {}),
            reference: duplicateReference,
          },
          actionsJson: source.actions,
        });
      },
      {
        action: 'SITE_SECTION_DUPLICATED',
        targetType: 'SITE_SECTION',
        targetId: duplicateReference,
        metadata: { pageReference, sourceSectionReference: sectionReference },
      },
    );
  }

  async removeSection(
    actor: AgencyActor,
    siteReference: string,
    pageReference: string,
    sectionReference: string,
  ) {
    return this.persistDesignChange(
      actor,
      siteReference,
      snapshot => {
        const next = cloneSnapshot(snapshot);
        const page = next.pages.find(item => item.publicReference === pageReference);
        const section = page?.sections.find(item => item.reference === sectionReference);
        if (!page || !section) throw fail(404, 'SITE_SECTION_NOT_FOUND', 'The selected section is not part of this site version.');
        if (['HEADER', 'FOOTER', 'BOOKING_CTA', 'FINAL_CTA'].includes(section.type)) {
          throw fail(422, 'SITE_SECTION_REMOVAL_FORBIDDEN', 'Required site chrome and final conversion sections cannot be removed.');
        }
        page.sections = page.sections.filter(item => item.reference !== sectionReference);
        return next;
      },
      async (tx, context) => {
        await tx.delete(siteSections).where(and(
          eq(siteSections.siteId, context.siteId),
          eq(siteSections.versionId, context.versionId),
          eq(siteSections.publicReference, sectionReference),
        ));
      },
      {
        action: 'SITE_SECTION_REMOVED',
        targetType: 'SITE_SECTION',
        targetId: sectionReference,
        metadata: { pageReference },
      },
    );
  }

  private async persistDesignChange(
    actor: AgencyActor,
    siteReference: string,
    transform: (snapshot: PublishedSiteSnapshot) => PublishedSiteSnapshot,
    persistSource: (
      tx: Transaction,
      context: Awaited<ReturnType<SiteDesignService['context']>>,
    ) => Promise<void>,
    audit: {
      action: string;
      targetType: string;
      targetId?: string;
      metadata?: Record<string, unknown>;
      newValues?: unknown;
    },
  ) {
    const context = await this.context(siteReference);
    if (!editableVersionStatuses.has(context.versionStatus)) {
      throw fail(
        409,
        'SITE_VERSION_NOT_EDITABLE',
        'Published, superseded or archived versions cannot be edited. Create a new draft version first.',
      );
    }

    return this.database.transaction(async tx => {
      const [latest] = await tx.select({
        reference: siteRenderSnapshots.publicReference,
        templateVersionId: siteRenderSnapshots.templateVersionId,
        revision: siteRenderSnapshots.revision,
        content: siteRenderSnapshots.contentJson,
      }).from(siteRenderSnapshots)
        .where(and(
          eq(siteRenderSnapshots.siteId, context.siteId),
          eq(siteRenderSnapshots.siteVersionId, context.versionId),
          inArray(siteRenderSnapshots.snapshotKind, ['PREVIEW', 'PUBLISHED']),
        ))
        .orderBy(desc(siteRenderSnapshots.revision))
        .limit(1);
      if (!latest) {
        throw fail(409, 'SITE_PREVIEW_UNAVAILABLE', 'Generate a secure site preview before editing its design.');
      }

      const current = validatePublishedSnapshot(latest.content);
      const next = transform(cloneSnapshot(current));
      const snapshotReference = randomUUID();
      const prepared = prepareSiteRenderSnapshotForStorage({
        ...next,
        publicReference: snapshotReference,
        visibility: 'PREVIEW',
        versionStatus: 'INTERNAL_REVIEW',
        createdAt: new Date().toISOString(),
        publishedAt: null,
      });

      await persistSource(tx, context);
      await tx.insert(siteRenderSnapshots).values({
        publicReference: snapshotReference,
        tenantId: context.tenantId,
        siteId: context.siteId,
        siteVersionId: context.versionId,
        templateVersionId: latest.templateVersionId,
        snapshotKind: 'PREVIEW',
        revision: latest.revision + 1,
        schemaVersion: prepared.schemaVersion,
        contentJson: prepared.content,
        contentDigestSha256: prepared.contentDigestSha256,
        sourceContentDigestSha256: prepared.contentDigestSha256,
        createdByAgencyUserId: actor.agencyUserId,
      });
      if (context.generationRunId
        && ['DESIGN_COMPLETE', 'READY_FOR_REVIEW'].includes(context.generationStatus ?? '')) {
        await tx.update(siteGenerationRuns).set({
          ...(context.generationStatus === 'READY_FOR_REVIEW' ? { status: 'DESIGN_COMPLETE' } : {}),
          outputContentDigestSha256: prepared.contentDigestSha256,
          updatedAt: new Date(),
        }).where(eq(siteGenerationRuns.id, context.generationRunId));
      }
      await tx.update(siteVersions).set({
        status: 'INTERNAL_REVIEW',
        generationStatus: context.generationRunId
          && ['DESIGN_COMPLETE', 'READY_FOR_REVIEW'].includes(context.generationStatus ?? '')
          ? 'DESIGN_COMPLETE'
          : context.generationStatus,
        generationContentDigestSha256: prepared.contentDigestSha256,
        changeSummary: 'Design updated in Site Studio.',
        updatedAt: new Date(),
      }).where(eq(siteVersions.id, context.versionId));

      const [review] = await tx.select({ id: siteReviewCycles.id })
        .from(siteReviewCycles)
        .where(eq(siteReviewCycles.siteVersionId, context.versionId))
        .orderBy(desc(siteReviewCycles.reviewRevision))
        .limit(1);
      if (review) {
        await tx.update(siteReviewCycles).set({
          pinnedContentDigestSha256: prepared.contentDigestSha256,
          status: 'INTERNAL_REVIEW',
          clientApprovedAt: null,
          agencyApprovedAt: null,
          updatedAt: new Date(),
        }).where(eq(siteReviewCycles.id, review.id));
      }

      await this.audit.write(actor, audit.action, audit.targetType, audit.targetId ?? siteReference, {
        tx,
        tenantId: context.tenantId,
        category: 'SITE_DESIGN',
        description: 'A controlled Site Studio design setting was changed.',
        metadata: audit.metadata,
        newValues: audit.newValues,
        sourceComponent: 'site-studio',
      });
      return {
        snapshotReference,
        contentDigest: prepared.contentDigestSha256,
        reviewReopened: true,
        qualityRerunRequired: Boolean(
          context.generationRunId
          && ['DESIGN_COMPLETE', 'READY_FOR_REVIEW'].includes(context.generationStatus ?? ''),
        ),
      };
    });
  }

  private async context(siteReference: string) {
    const [row] = await this.database.select({
      tenantId: sites.tenantId,
      siteId: sites.id,
      versionId: siteVersions.id,
      versionReference: siteVersions.publicReference,
      versionStatus: siteVersions.status,
      generationRunId: siteVersions.generationRunId,
      generationStatus: siteVersions.generationStatus,
    }).from(sites)
      .innerJoin(siteVersions, eq(siteVersions.siteId, sites.id))
      .where(eq(sites.publicReference, siteReference))
      .orderBy(desc(siteVersions.versionNumber))
      .limit(1);
    if (!row) throw fail(404, 'SITE_NOT_FOUND', 'Site or site version not found.');
    return row;
  }

  private async latestSnapshot(siteId: string, versionId: string) {
    const [row] = await this.database.select({ content: siteRenderSnapshots.contentJson })
      .from(siteRenderSnapshots)
      .where(and(
        eq(siteRenderSnapshots.siteId, siteId),
        eq(siteRenderSnapshots.siteVersionId, versionId),
        inArray(siteRenderSnapshots.snapshotKind, ['PREVIEW', 'PUBLISHED']),
      ))
      .orderBy(desc(siteRenderSnapshots.revision))
      .limit(1);
    return row ? validatePublishedSnapshot(row.content) : null;
  }
}
