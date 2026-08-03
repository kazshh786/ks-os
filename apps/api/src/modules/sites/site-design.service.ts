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
      await tx.update(siteVersions).set({
        status: 'INTERNAL_REVIEW',
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
        qualityRerunRequired: true,
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
