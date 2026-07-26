import {
  BlueprintBookingRequirementSchema,
  BlueprintPageInputSchema,
  BlueprintReadinessAssessmentSchema,
  type BlueprintAgencyOverride,
  type BlueprintApprovalRequest,
  type BlueprintGenerationRequest,
  type BlueprintPageInput,
  type BlueprintPagePatch,
  type BlueprintRejectRequest,
  type BlueprintStatus,
  type SitePageType,
} from '@ks-os/contracts';
import {
  agencyUsers,
  getDatabase,
  locations,
  services,
  siteBlueprintActionItems,
  siteBlueprintGenerationRuns,
  siteBlueprintPages,
  siteBlueprints,
  sitePages,
  sites,
  staffServiceAssignments,
  templateLayoutPageTypes,
  templateLayouts,
  templateSources,
  templateVersions,
  tenantOnboarding,
  tenants,
  users,
} from '@ks-os/database';
import {
  assertBlueprintMutable,
  assertBlueprintPageRemovalAllowed,
  assertBlueprintValidForApproval,
  bookingRequirementsForPage,
  canonicalPathIssue,
  generateBlueprintPlan,
  validateBlueprint,
  type BlueprintEngineInput,
  type BlueprintLocationInput,
  type BlueprintServiceInput,
  type BlueprintStaffInput,
  type BlueprintTemplateInput,
  type BlueprintValidationContext,
} from '@ks-os/site-blueprints';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  sql,
} from 'drizzle-orm';
import { TemplateLicenceRequiredError } from '@ks-os/template-intelligence';
import {
  createTemplateCompatibilityService,
  createTemplateLicenceGuard,
} from './template-intelligence.service.js';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';
import {
  SiteEntitlementService,
  type SiteDatabaseExecutor,
} from './site-entitlement.service.js';

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const dateString = (value: Date | null | undefined) =>
  value ? value.toISOString() : null;

const pageTypes = [
  'HOME',
  'SERVICE_HUB',
  'SERVICE_DETAIL',
  'LOCATION_HUB',
  'LOCATION_DETAIL',
  'ABOUT',
  'TEAM_HUB',
  'TEAM_DETAIL',
  'CONTACT',
  'FAQ',
  'POLICIES',
  'RESULTS',
  'NEW_CLIENT_GUIDE',
  'AFTERCARE_GUIDE',
  'CONSULTATION_GUIDE',
  'BOOKING',
] as const satisfies readonly SitePageType[];

interface SiteContext {
  id: string;
  tenantId: string;
  reference: string;
  displayName: string;
  tenantReference: string;
  tenantName: string;
}

interface ResolvedGenerationContext {
  engineInput: BlueprintEngineInput;
  site: SiteContext;
  templateVersionId: string;
  planAssignmentId: string;
  serviceIds: Map<string, string>;
  locationIds: Map<string, string>;
  staffIds: Map<string, string>;
  layoutIds: Map<string, string>;
}

export class SiteBlueprintService {
  private readonly entitlements: SiteEntitlementService;
  private readonly audit: AgencyAuditService;

  constructor(
    private readonly db = getDatabase(),
    entitlements = new SiteEntitlementService(db),
    audit = new AgencyAuditService(),
  ) {
    this.entitlements = entitlements;
    this.audit = audit;
  }

  async list(siteReference: string) {
    const site = await this.siteContext(siteReference);
    const rows = await this.db
      .select({ id: siteBlueprints.id })
      .from(siteBlueprints)
      .where(and(
        eq(siteBlueprints.siteId, site.id),
        eq(siteBlueprints.tenantId, site.tenantId),
      ))
      .orderBy(desc(siteBlueprints.revision));
    return Promise.all(rows.map((row) => this.summaryView(row.id, site)));
  }

  async get(siteReference: string, blueprintReference: string) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    return this.detailView(blueprint.id, site);
  }

  async generate(
    actor: AgencyActor,
    siteReference: string,
    request: BlueprintGenerationRequest,
  ) {
    const resolved = await this.resolveGenerationContext(
      siteReference,
      request,
    );
    const plan = generateBlueprintPlan(resolved.engineInput);
    const persisted = await this.db.transaction(async (tx) => {
      await this.lockSite(tx, resolved.site.id);
      const [existing] = await tx
        .select({ id: siteBlueprints.id })
        .from(siteBlueprints)
        .where(and(
          eq(siteBlueprints.siteId, resolved.site.id),
          eq(siteBlueprints.tenantId, resolved.site.tenantId),
          eq(siteBlueprints.sourceDataDigest, plan.sourceDataDigest),
          eq(siteBlueprints.engineVersion, plan.engineVersion),
          inArray(siteBlueprints.status, [
            'DRAFT',
            'REVIEW_REQUIRED',
            'READY_FOR_APPROVAL',
            'APPROVED',
          ]),
        ))
        .orderBy(desc(siteBlueprints.revision))
        .limit(1);
      if (existing) {
        const [run] = await tx
          .insert(siteBlueprintGenerationRuns)
          .values({
            tenantId: resolved.site.tenantId,
            siteId: resolved.site.id,
            blueprintId: existing.id,
            templateVersionId: resolved.templateVersionId,
            planAssignmentId: resolved.planAssignmentId,
            sourceDataDigest: plan.sourceDataDigest,
            engineVersion: plan.engineVersion,
            status: 'COMPLETED',
            idempotentReplay: true,
            requestedByAgencyUserId: actor.agencyUserId,
            completedAt: new Date(),
          })
          .returning();
        await this.audit.write(
          actor,
          'SITE_BLUEPRINT_GENERATED',
          'SITE_BLUEPRINT',
          existing.id,
          {
            tenantId: resolved.site.tenantId,
            category: 'WEBSITE',
            metadata: {
              siteReference,
              idempotentReplay: true,
              sourceDataDigest: plan.sourceDataDigest,
            },
            tx,
          },
        );
        return {
          blueprintId: existing.id,
          generationRunReference: run.publicReference,
          idempotentReplay: true,
        };
      }

      const [highest] = await tx
        .select({ revision: max(siteBlueprints.revision) })
        .from(siteBlueprints)
        .where(and(
          eq(siteBlueprints.siteId, resolved.site.id),
          eq(siteBlueprints.tenantId, resolved.site.tenantId),
        ));
      const now = new Date();
      const [blueprint] = await tx
        .insert(siteBlueprints)
        .values({
          tenantId: resolved.site.tenantId,
          siteId: resolved.site.id,
          templateVersionId: resolved.templateVersionId,
          planAssignmentId: resolved.planAssignmentId,
          name: request.name || `${resolved.site.displayName} architecture`,
          status: 'GENERATING',
          revision: Number(highest?.revision || 0) + 1,
          sourceDataDigest: plan.sourceDataDigest,
          engineVersion: plan.engineVersion,
          proposedMarketingPageCount:
            plan.entitlementUsage.proposedMarketingPageCount,
          entitlementMarketingPageLimit:
            plan.entitlementUsage.marketingPageLimit,
          functionalPageCount: plan.entitlementUsage.functionalPageCount,
          requiredLegalPageCount:
            plan.entitlementUsage.requiredLegalPageCount,
          unusedMarketingPageAllowance:
            plan.entitlementUsage.unusedMarketingPageAllowance,
          entitlementOverrideApplied:
            plan.entitlementUsage.overrideApplied,
          readinessJson: plan.readiness,
          generatedAt: now,
          generatedByAgencyUserId: actor.agencyUserId,
        })
        .returning();
      const pageValues = plan.pages.map((page, index) => ({
        tenantId: resolved.site.tenantId,
        blueprintId: blueprint.id,
        pageType: page.pageType,
        conversionRole: page.conversionRole,
        entitlementKind: page.entitlementKind,
        allocation: 'INITIAL',
        title: page.titleLabel,
        proposedSlug: page.plannedSlug,
        templateLayoutId: page.layoutReference
          ? resolved.layoutIds.get(page.layoutReference) || null
          : null,
        serviceId: page.pageType === 'SERVICE_DETAIL'
          ? resolved.serviceIds.get(page.serviceReference) || null
          : null,
        locationId: page.pageType === 'LOCATION_DETAIL'
          ? resolved.locationIds.get(page.locationReference) || null
          : null,
        staffUserId: page.pageType === 'TEAM_DETAIL'
          ? resolved.staffIds.get(page.staffReference) || null
          : null,
        navigationGroup: page.navigationGroup,
        navigationOrder: page.navigationOrder,
        consumesMarketingEntitlement: page.consumesMarketingEntitlement,
        generationPriority: page.generationPriority,
        selectionScore: page.selectionScore,
        selectionReasonsJson: page.selectionReasons,
        bookingRequirementsJson: page.bookingRequirements,
        layoutSelectionReason: page.layoutSelectionReason,
        agencyNotes: page.agencyNotes || null,
        sortOrder: index,
        rationale: page.selectionReasons.join(', ').slice(0, 1000),
      }));
      const insertedPages = pageValues.length > 0
        ? await tx.insert(siteBlueprintPages).values(pageValues).returning({
          id: siteBlueprintPages.id,
          reference: siteBlueprintPages.publicReference,
        })
        : [];
      const pageIdByReference = new Map(
        insertedPages.map((page) => [page.reference, page.id]),
      );
      if (plan.actionItems.length > 0) {
        await tx.insert(siteBlueprintActionItems).values(
          plan.actionItems.map((item) => ({
            tenantId: resolved.site.tenantId,
            blueprintId: blueprint.id,
            blueprintPageId: item.pageReference
              ? pageIdByReference.get(item.pageReference) || null
              : null,
            category: item.category,
            severity: item.severity,
            code: item.code,
            message: item.message,
            subjectPublicReference: item.subjectReference,
            safeMetadataJson: item.safeMetadata,
          })),
        );
      }
      await tx
        .update(siteBlueprints)
        .set({ status: 'REVIEW_REQUIRED', updatedAt: now })
        .where(eq(siteBlueprints.id, blueprint.id));
      const [run] = await tx
        .insert(siteBlueprintGenerationRuns)
        .values({
          tenantId: resolved.site.tenantId,
          siteId: resolved.site.id,
          blueprintId: blueprint.id,
          templateVersionId: resolved.templateVersionId,
          planAssignmentId: resolved.planAssignmentId,
          sourceDataDigest: plan.sourceDataDigest,
          engineVersion: plan.engineVersion,
          status: 'COMPLETED',
          requestedByAgencyUserId: actor.agencyUserId,
          completedAt: now,
        })
        .returning();
      await this.audit.write(
        actor,
        'SITE_BLUEPRINT_GENERATED',
        'SITE_BLUEPRINT',
        blueprint.id,
        {
          tenantId: resolved.site.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            blueprintReference: blueprint.publicReference,
            revision: blueprint.revision,
            entitlementUsage: plan.entitlementUsage,
          },
          tx,
        },
      );
      return {
        blueprintId: blueprint.id,
        generationRunReference: run.publicReference,
        idempotentReplay: false,
      };
    });
    return {
      blueprint: await this.detailView(
        persisted.blueprintId,
        resolved.site,
      ),
      idempotentReplay: persisted.idempotentReplay,
      generationRunReference: persisted.generationRunReference,
    };
  }

  async validation(
    siteReference: string,
    blueprintReference: string,
  ) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    return this.validationFor(blueprint.id, site);
  }

  async validateAndTransition(
    actor: AgencyActor,
    siteReference: string,
    blueprintReference: string,
  ) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    if (!['DRAFT', 'REVIEW_REQUIRED', 'READY_FOR_APPROVAL'].includes(
      blueprint.status,
    )) {
      throw fail(
        409,
        'BLUEPRINT_VALIDATION_STATUS_INVALID',
        'The blueprint is not in a validateable state.',
      );
    }
    const result = await this.validationFor(blueprint.id, site);
    await this.db.transaction(async (tx) => {
      await this.lockBlueprint(tx, blueprint.id);
      await tx
        .update(siteBlueprints)
        .set({
          status: result.approvalReady
            ? 'READY_FOR_APPROVAL'
            : 'REVIEW_REQUIRED',
          updatedAt: new Date(),
        })
        .where(eq(siteBlueprints.id, blueprint.id));
      await this.audit.write(
        actor,
        'SITE_BLUEPRINT_VALIDATED',
        'SITE_BLUEPRINT',
        blueprint.id,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            blueprintReference,
            valid: result.valid,
            findingCount: result.findings.length,
            blockingCount: result.findings.filter(
              (item) => item.severity === 'BLOCKING',
            ).length,
          },
          tx,
        },
      );
    });
    return result;
  }

  async listActionItems(
    siteReference: string,
    blueprintReference: string,
  ) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    return this.actionItemViews(blueprint.id, site.tenantId);
  }

  async updateBlueprint(
    actor: AgencyActor,
    siteReference: string,
    blueprintReference: string,
    override: Extract<
      BlueprintAgencyOverride,
      { operation: 'UPDATE_BLUEPRINT' | 'RESOLVE_ACTION_ITEM' }
    >,
  ) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    assertBlueprintMutable(blueprint.status as BlueprintStatus);
    if (override.operation === 'RESOLVE_ACTION_ITEM') {
      const [item] = await this.db
        .select()
        .from(siteBlueprintActionItems)
        .where(and(
          eq(
            siteBlueprintActionItems.publicReference,
            override.actionItemReference,
          ),
          eq(siteBlueprintActionItems.blueprintId, blueprint.id),
          eq(siteBlueprintActionItems.tenantId, site.tenantId),
        ))
        .limit(1);
      if (!item) throw fail(404, 'BLUEPRINT_ACTION_ITEM_NOT_FOUND', 'Action item not found.');
      if (item.status === 'RESOLVED') {
        return this.detailView(blueprint.id, site);
      }
      await this.db.transaction(async (tx) => {
        await this.lockBlueprint(tx, blueprint.id);
        await tx
          .update(siteBlueprintActionItems)
          .set({
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedByAgencyUserId: actor.agencyUserId,
            resolutionNote: override.resolutionNote,
            updatedAt: new Date(),
          })
          .where(eq(siteBlueprintActionItems.id, item.id));
        await this.audit.write(
          actor,
          'SITE_BLUEPRINT_ACTION_ITEM_RESOLVED',
          'SITE_BLUEPRINT_ACTION_ITEM',
          item.id,
          {
            tenantId: site.tenantId,
            category: 'WEBSITE',
            metadata: {
              siteReference,
              blueprintReference,
              actionItemReference: item.publicReference,
              reasonCode: item.code,
            },
            tx,
          },
        );
      });
      return this.detailView(blueprint.id, site);
    }
    if (!override.name && !override.status) {
      throw fail(400, 'BLUEPRINT_UPDATE_REQUIRED', 'At least one change is required.');
    }
    if (override.status === 'READY_FOR_APPROVAL') {
      throw fail(
        409,
        'BLUEPRINT_VALIDATION_REQUIRED',
        'Use the validate operation before readiness for approval.',
      );
    }
    await this.db.transaction(async (tx) => {
      await this.lockBlueprint(tx, blueprint.id);
      await tx
        .update(siteBlueprints)
        .set({
          ...(override.name ? { name: override.name } : {}),
          ...(override.status ? { status: override.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(siteBlueprints.id, blueprint.id));
      await this.audit.write(
        actor,
        'SITE_BLUEPRINT_UPDATED',
        'SITE_BLUEPRINT',
        blueprint.id,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            blueprintReference,
            fields: [
              ...(override.name ? ['name'] : []),
              ...(override.status ? ['status'] : []),
            ],
          },
          tx,
        },
      );
    });
    return this.detailView(blueprint.id, site);
  }

  async addPage(
    actor: AgencyActor,
    siteReference: string,
    blueprintReference: string,
    input: BlueprintPageInput,
  ) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    assertBlueprintMutable(blueprint.status as BlueprintStatus);
    const resolved = await this.resolveBlueprintSources(site, blueprint);
    const page = await this.normaliseAgencyPage(input, resolved);
    const current = await this.pageInputs(blueprint.id, site.tenantId);
    const nextUsage = current.filter(
      (item) => item.consumesMarketingEntitlement,
    ).length + Number(page.consumesMarketingEntitlement);
    if (nextUsage > resolved.engineInput.marketingPageLimit) {
      throw fail(
        409,
        'BLUEPRINT_ENTITLEMENT_OVERFLOW',
        'The server-resolved marketing page allowance would be exceeded.',
      );
    }
    if (current.some((item) => item.plannedSlug === page.plannedSlug)) {
      throw fail(409, 'BLUEPRINT_DUPLICATE_SLUG', 'The planned path is already in use.');
    }
    this.assertNoDuplicateMapping(current, page);
    const created = await this.db.transaction(async (tx) => {
      await this.lockBlueprint(tx, blueprint.id);
      const [highest] = await tx
        .select({ order: max(siteBlueprintPages.sortOrder) })
        .from(siteBlueprintPages)
        .where(eq(siteBlueprintPages.blueprintId, blueprint.id));
      const values = this.pagePersistenceValues(
        page,
        resolved,
        blueprint.id,
        site.tenantId,
        Number(highest?.order ?? -1) + 1,
      );
      const [inserted] = await tx
        .insert(siteBlueprintPages)
        .values(values)
        .returning();
      await this.refreshUsage(
        tx,
        blueprint.id,
        resolved.engineInput.marketingPageLimit,
        resolved.engineInput.entitlementOverrideApplied,
      );
      await tx
        .update(siteBlueprints)
        .set({ status: 'REVIEW_REQUIRED', updatedAt: new Date() })
        .where(eq(siteBlueprints.id, blueprint.id));
      await this.audit.write(
        actor,
        'SITE_BLUEPRINT_PAGE_ADDED',
        'SITE_BLUEPRINT_PAGE',
        inserted.id,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            blueprintReference,
            pageReference: inserted.publicReference,
            pageType: page.pageType,
          },
          tx,
        },
      );
      return inserted;
    });
    return this.pageView(created.id, site.tenantId);
  }

  async updatePage(
    actor: AgencyActor,
    siteReference: string,
    blueprintReference: string,
    pageReference: string,
    changes: BlueprintPagePatch,
  ) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    assertBlueprintMutable(blueprint.status as BlueprintStatus);
    const [page] = await this.db
      .select()
      .from(siteBlueprintPages)
      .where(and(
        eq(siteBlueprintPages.publicReference, pageReference),
        eq(siteBlueprintPages.blueprintId, blueprint.id),
        eq(siteBlueprintPages.tenantId, site.tenantId),
      ))
      .limit(1);
    if (!page) throw fail(404, 'BLUEPRINT_PAGE_NOT_FOUND', 'Blueprint page not found.');
    if (changes.plannedSlug) {
      const issue = canonicalPathIssue(
        changes.plannedSlug,
        page.pageType as SitePageType,
      );
      if (issue) throw fail(400, issue, 'The planned path is invalid.');
      const [duplicate] = await this.db
        .select({ id: siteBlueprintPages.id })
        .from(siteBlueprintPages)
        .where(and(
          eq(siteBlueprintPages.blueprintId, blueprint.id),
          eq(siteBlueprintPages.proposedSlug, changes.plannedSlug),
        ))
        .limit(1);
      if (duplicate && duplicate.id !== page.id) {
        throw fail(409, 'BLUEPRINT_DUPLICATE_SLUG', 'The planned path is already in use.');
      }
    }
    let layoutId: string | undefined;
    if (changes.layoutReference) {
      await createTemplateCompatibilityService(this.db).assertLayoutCompatible({
        layoutReference: changes.layoutReference,
        pageType: page.pageType as SitePageType,
      });
      const [layout] = await this.db
        .select({
          id: templateLayouts.id,
          templateVersionId: templateLayouts.templateVersionId,
        })
        .from(templateLayouts)
        .where(eq(templateLayouts.publicReference, changes.layoutReference))
        .limit(1);
      if (!layout || layout.templateVersionId !== blueprint.templateVersionId) {
        throw fail(
          409,
          'BLUEPRINT_LAYOUT_TEMPLATE_MISMATCH',
          'The layout is not part of the pinned template version.',
        );
      }
      layoutId = layout.id;
    }
    await this.db.transaction(async (tx) => {
      await this.lockBlueprint(tx, blueprint.id);
      await tx
        .update(siteBlueprintPages)
        .set({
          ...(changes.titleLabel ? { title: changes.titleLabel } : {}),
          ...(changes.plannedSlug ? { proposedSlug: changes.plannedSlug } : {}),
          ...(changes.navigationGroup
            ? { navigationGroup: changes.navigationGroup }
            : {}),
          ...(changes.navigationOrder !== undefined
            ? { navigationOrder: changes.navigationOrder }
            : {}),
          ...(changes.conversionRole
            ? { conversionRole: changes.conversionRole }
            : {}),
          ...(layoutId ? {
            templateLayoutId: layoutId,
            layoutSelectionReason: 'AGENCY_APPROVED_COMPATIBLE_OVERRIDE',
          } : {}),
          ...(changes.agencyNotes !== undefined
            ? { agencyNotes: changes.agencyNotes }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(siteBlueprintPages.id, page.id));
      await tx
        .update(siteBlueprints)
        .set({ status: 'REVIEW_REQUIRED', updatedAt: new Date() })
        .where(eq(siteBlueprints.id, blueprint.id));
      await this.audit.write(
        actor,
        'SITE_BLUEPRINT_PAGE_UPDATED',
        'SITE_BLUEPRINT_PAGE',
        page.id,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            blueprintReference,
            pageReference,
            pageType: page.pageType,
            fields: Object.keys(changes),
          },
          tx,
        },
      );
    });
    return this.pageView(page.id, site.tenantId);
  }

  async removePage(
    actor: AgencyActor,
    siteReference: string,
    blueprintReference: string,
    pageReference: string,
  ) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    assertBlueprintMutable(blueprint.status as BlueprintStatus);
    const [page] = await this.db
      .select()
      .from(siteBlueprintPages)
      .where(and(
        eq(siteBlueprintPages.publicReference, pageReference),
        eq(siteBlueprintPages.blueprintId, blueprint.id),
        eq(siteBlueprintPages.tenantId, site.tenantId),
      ))
      .limit(1);
    if (!page) throw fail(404, 'BLUEPRINT_PAGE_NOT_FOUND', 'Blueprint page not found.');
    assertBlueprintPageRemovalAllowed({
      pageType: page.pageType as SitePageType,
    });
    await this.db.transaction(async (tx) => {
      await this.lockBlueprint(tx, blueprint.id);
      await tx
        .delete(siteBlueprintPages)
        .where(eq(siteBlueprintPages.id, page.id));
      await this.refreshUsage(
        tx,
        blueprint.id,
        blueprint.entitlementMarketingPageLimit,
        blueprint.entitlementOverrideApplied,
      );
      await tx
        .update(siteBlueprints)
        .set({ status: 'REVIEW_REQUIRED', updatedAt: new Date() })
        .where(eq(siteBlueprints.id, blueprint.id));
      await this.audit.write(
        actor,
        'SITE_BLUEPRINT_PAGE_REMOVED',
        'SITE_BLUEPRINT_PAGE',
        page.id,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            blueprintReference,
            pageReference,
            pageType: page.pageType,
          },
          tx,
        },
      );
    });
    return { reference: pageReference, removed: true };
  }

  async reorder(
    actor: AgencyActor,
    siteReference: string,
    blueprintReference: string,
    pageReferences: string[],
  ) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    assertBlueprintMutable(blueprint.status as BlueprintStatus);
    const pages = await this.db
      .select({
        id: siteBlueprintPages.id,
        reference: siteBlueprintPages.publicReference,
      })
      .from(siteBlueprintPages)
      .where(and(
        eq(siteBlueprintPages.blueprintId, blueprint.id),
        eq(siteBlueprintPages.tenantId, site.tenantId),
      ));
    if (
      pageReferences.length !== pages.length
      || new Set(pageReferences).size !== pages.length
      || pageReferences.some(
        (reference) => !pages.some((page) => page.reference === reference),
      )
    ) {
      throw fail(
        400,
        'BLUEPRINT_REORDER_INVALID',
        'Reordering must include every blueprint page exactly once.',
      );
    }
    const idByReference = new Map(
      pages.map((page) => [page.reference, page.id]),
    );
    await this.db.transaction(async (tx) => {
      await this.lockBlueprint(tx, blueprint.id);
      await tx
        .update(siteBlueprintPages)
        .set({ sortOrder: sql`${siteBlueprintPages.sortOrder} + 10000` })
        .where(eq(siteBlueprintPages.blueprintId, blueprint.id));
      for (const [order, reference] of pageReferences.entries()) {
        await tx
          .update(siteBlueprintPages)
          .set({ sortOrder: order, navigationOrder: order, updatedAt: new Date() })
          .where(eq(siteBlueprintPages.id, idByReference.get(reference)!));
      }
      await tx
        .update(siteBlueprints)
        .set({ status: 'REVIEW_REQUIRED', updatedAt: new Date() })
        .where(eq(siteBlueprints.id, blueprint.id));
      await this.audit.write(
        actor,
        'SITE_BLUEPRINT_REORDERED',
        'SITE_BLUEPRINT',
        blueprint.id,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          metadata: { siteReference, blueprintReference, pageCount: pages.length },
          tx,
        },
      );
    });
    return this.detailView(blueprint.id, site);
  }

  async approve(
    actor: AgencyActor,
    siteReference: string,
    blueprintReference: string,
    request: BlueprintApprovalRequest,
  ) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    if (blueprint.revision !== request.expectedRevision) {
      throw fail(
        409,
        'BLUEPRINT_REVISION_CONFLICT',
        'The blueprint revision changed before approval.',
      );
    }
    if (!['REVIEW_REQUIRED', 'READY_FOR_APPROVAL'].includes(blueprint.status)) {
      throw fail(
        409,
        'BLUEPRINT_APPROVAL_STATUS_INVALID',
        'The blueprint is not in an approvable state.',
      );
    }
    const result = await this.validationFor(blueprint.id, site);
    try {
      assertBlueprintValidForApproval(result);
    } catch {
      throw fail(
        409,
        'BLUEPRINT_APPROVAL_BLOCKED',
        'Resolve all blocking validation findings before approval.',
      );
    }
    await this.db.transaction(async (tx) => {
      await this.lockBlueprint(tx, blueprint.id);
      const [current] = await tx
        .select({ status: siteBlueprints.status, revision: siteBlueprints.revision })
        .from(siteBlueprints)
        .where(eq(siteBlueprints.id, blueprint.id))
        .limit(1);
      if (
        current?.revision !== request.expectedRevision
        || !['REVIEW_REQUIRED', 'READY_FOR_APPROVAL'].includes(current.status)
      ) {
        throw fail(
          409,
          'BLUEPRINT_REVISION_CONFLICT',
          'The blueprint changed before approval.',
        );
      }
      await tx
        .update(siteBlueprints)
        .set({
          status: 'APPROVED',
          approvedByAgencyUserId: actor.agencyUserId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(siteBlueprints.id, blueprint.id));
      await this.audit.write(
        actor,
        'SITE_BLUEPRINT_APPROVED',
        'SITE_BLUEPRINT',
        blueprint.id,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          reason: request.reason,
          metadata: {
            siteReference,
            blueprintReference,
            revision: blueprint.revision,
            entitlementUsage: result.entitlementUsage,
          },
          tx,
        },
      );
    });
    return this.detailView(blueprint.id, site);
  }

  async reject(
    actor: AgencyActor,
    siteReference: string,
    blueprintReference: string,
    request: BlueprintRejectRequest,
  ) {
    const site = await this.siteContext(siteReference);
    const blueprint = await this.blueprintContext(site, blueprintReference);
    if (!['DRAFT', 'REVIEW_REQUIRED', 'READY_FOR_APPROVAL'].includes(
      blueprint.status,
    )) {
      throw fail(
        409,
        'BLUEPRINT_REJECTION_STATUS_INVALID',
        'The blueprint is not in a rejectable state.',
      );
    }
    await this.db.transaction(async (tx) => {
      await this.lockBlueprint(tx, blueprint.id);
      await tx
        .update(siteBlueprints)
        .set({
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectionReason: request.reason,
          updatedAt: new Date(),
        })
        .where(eq(siteBlueprints.id, blueprint.id));
      await this.audit.write(
        actor,
        'SITE_BLUEPRINT_REJECTED',
        'SITE_BLUEPRINT',
        blueprint.id,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          reason: request.reason,
          metadata: { siteReference, blueprintReference },
          tx,
        },
      );
    });
    return this.detailView(blueprint.id, site);
  }

  async revise(
    actor: AgencyActor,
    siteReference: string,
    blueprintReference: string,
  ) {
    const site = await this.siteContext(siteReference);
    const source = await this.blueprintContext(site, blueprintReference);
    if (source.status !== 'APPROVED') {
      throw fail(
        409,
        'BLUEPRINT_REVISION_SOURCE_NOT_APPROVED',
        'Only an approved blueprint can be revised.',
      );
    }
    const result = await this.db.transaction(async (tx) => {
      await this.lockSite(tx, site.id);
      const [highest] = await tx
        .select({ revision: max(siteBlueprints.revision) })
        .from(siteBlueprints)
        .where(eq(siteBlueprints.siteId, site.id));
      const [draft] = await tx
        .insert(siteBlueprints)
        .values({
          tenantId: source.tenantId,
          siteId: source.siteId,
          templateVersionId: source.templateVersionId,
          planAssignmentId: source.planAssignmentId,
          name: `${source.name} revision`,
          status: 'DRAFT',
          revision: Number(highest?.revision || source.revision) + 1,
          sourceDataDigest: source.sourceDataDigest,
          engineVersion: source.engineVersion,
          proposedMarketingPageCount: source.proposedMarketingPageCount,
          entitlementMarketingPageLimit: source.entitlementMarketingPageLimit,
          functionalPageCount: source.functionalPageCount,
          requiredLegalPageCount: source.requiredLegalPageCount,
          unusedMarketingPageAllowance: source.unusedMarketingPageAllowance,
          entitlementOverrideApplied: source.entitlementOverrideApplied,
          readinessJson: source.readinessJson,
          generatedAt: source.generatedAt,
          generatedByAgencyUserId: actor.agencyUserId,
        })
        .returning();
      const pages = await tx
        .select()
        .from(siteBlueprintPages)
        .where(eq(siteBlueprintPages.blueprintId, source.id))
        .orderBy(asc(siteBlueprintPages.sortOrder));
      if (pages.length > 0) {
        await tx.insert(siteBlueprintPages).values(pages.map((page) => ({
          tenantId: page.tenantId,
          blueprintId: draft.id,
          pageType: page.pageType,
          conversionRole: page.conversionRole,
          entitlementKind: page.entitlementKind,
          allocation: page.allocation,
          title: page.title,
          proposedSlug: page.proposedSlug,
          templateLayoutId: page.templateLayoutId,
          serviceId: page.serviceId,
          locationId: page.locationId,
          staffUserId: page.staffUserId,
          navigationGroup: page.navigationGroup,
          navigationOrder: page.navigationOrder,
          consumesMarketingEntitlement: page.consumesMarketingEntitlement,
          generationPriority: page.generationPriority,
          selectionScore: page.selectionScore,
          selectionReasonsJson: page.selectionReasonsJson,
          bookingRequirementsJson: page.bookingRequirementsJson,
          layoutSelectionReason: page.layoutSelectionReason,
          agencyNotes: page.agencyNotes,
          sortOrder: page.sortOrder,
          rationale: page.rationale,
        })));
      }
      const items = await tx
        .select()
        .from(siteBlueprintActionItems)
        .where(and(
          eq(siteBlueprintActionItems.blueprintId, source.id),
          eq(siteBlueprintActionItems.status, 'OPEN'),
        ));
      if (items.length > 0) {
        await tx.insert(siteBlueprintActionItems).values(items.map((item) => ({
          tenantId: item.tenantId,
          blueprintId: draft.id,
          category: item.category,
          severity: item.severity,
          code: item.code,
          message: item.message,
          subjectPublicReference: item.subjectPublicReference,
          safeMetadataJson: item.safeMetadataJson,
        })));
      }
      await this.audit.write(
        actor,
        'SITE_BLUEPRINT_REVISION_CREATED',
        'SITE_BLUEPRINT',
        draft.id,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            sourceBlueprintReference: blueprintReference,
            blueprintReference: draft.publicReference,
            revision: draft.revision,
          },
          tx,
        },
      );
      return draft;
    });
    return this.detailView(result.id, site);
  }

  private async resolveGenerationContext(
    siteReference: string,
    request: BlueprintGenerationRequest,
  ): Promise<ResolvedGenerationContext> {
    const site = await this.siteContext(siteReference);
    const [template] = await this.db
      .select({
        id: templateVersions.id,
        reference: templateVersions.publicReference,
        status: templateVersions.status,
        analysisStatus: templateVersions.analysisStatus,
        sourceType: templateSources.sourceType,
      })
      .from(templateVersions)
      .innerJoin(
        templateSources,
        eq(templateVersions.templateSourceId, templateSources.id),
      )
      .where(eq(
        templateVersions.publicReference,
        request.templateVersionReference,
      ))
      .limit(1);
    if (
      !template
      || template.status !== 'APPROVED'
      || template.analysisStatus !== 'APPROVED'
    ) {
      throw fail(
        409,
        'TEMPLATE_VERSION_NOT_APPROVED',
        'Blueprint generation requires an approved template version.',
      );
    }
    const plan = await this.entitlements.blueprintMarketingAllowance(
      site.tenantId,
    );
    const sourceData = await this.sourceData(site);
    const compatibility = createTemplateCompatibilityService(this.db);
    const compatible = (
      await Promise.all(pageTypes.map((pageType) =>
        compatibility.listCompatibleLayouts({
          templateVersionReference: template.reference,
          pageType,
        })))
    ).flat();
    const uniqueCompatibility = new Map(
      compatible.map((layout) => [layout.layoutReference, layout]),
    );
    const layoutRows = uniqueCompatibility.size > 0
      ? await this.db
        .select({
          id: templateLayouts.id,
          reference: templateLayouts.publicReference,
        })
        .from(templateLayouts)
        .where(inArray(
          templateLayouts.publicReference,
          [...uniqueCompatibility.keys()],
        ))
      : [];
    let licensedForSite = true;
    try {
      await createTemplateLicenceGuard(this.db)
        .assertTemplateLicensedForSite({
          siteReference,
          templateVersionReference: template.reference,
        });
    } catch (error) {
      if (error instanceof TemplateLicenceRequiredError) {
        licensedForSite = false;
      } else {
        throw error;
      }
    }
    const templateInput: BlueprintTemplateInput = {
      reference: template.reference,
      status: 'APPROVED',
      sourceType: template.sourceType as BlueprintTemplateInput['sourceType'],
      licensedForSite,
      layouts: [...uniqueCompatibility.values()].map((layout) => ({
        reference: layout.layoutReference,
        templateVersionReference: layout.templateVersionReference,
        approved: layout.templateVersionApproved,
        enabled: layout.enabled,
        approvedPageTypes: layout.approvedPageTypes,
      })),
    };
    return {
      site,
      templateVersionId: template.id,
      planAssignmentId: plan.id,
      serviceIds: sourceData.serviceIds,
      locationIds: sourceData.locationIds,
      staffIds: sourceData.staffIds,
      layoutIds: new Map(
        layoutRows.map((layout) => [layout.reference, layout.id]),
      ),
      engineInput: {
        tenantReference: site.tenantReference,
        siteReference,
        planKey: plan.planKey,
        planAssignmentReference: plan.id,
        marketingPageLimit: plan.marketingPageLimit,
        entitlementOverrideApplied: plan.overrideApplied,
        template: templateInput,
        services: sourceData.services,
        locations: sourceData.locations,
        staff: sourceData.staff,
        business: sourceData.business,
        existingCanonicalPaths: sourceData.existingCanonicalPaths,
        request,
      },
    };
  }

  private async resolveBlueprintSources(
    site: SiteContext,
    blueprint: typeof siteBlueprints.$inferSelect,
  ) {
    if (!blueprint.templateVersionId) {
      throw fail(
        409,
        'BLUEPRINT_TEMPLATE_VERSION_REQUIRED',
        'This legacy blueprint needs a new generated revision.',
      );
    }
    const [version] = await this.db
      .select({ reference: templateVersions.publicReference })
      .from(templateVersions)
      .where(eq(templateVersions.id, blueprint.templateVersionId))
      .limit(1);
    if (!version) {
      throw fail(409, 'BLUEPRINT_TEMPLATE_VERSION_REQUIRED', 'Template version not found.');
    }
    const context = await this.resolveGenerationContext(site.reference, {
      templateVersionReference: version.reference,
      preferences: {
        prioritisedServiceReferences: [],
        prioritisedLocationReferences: [],
        prioritisedStaffReferences: [],
        preferredLayoutReferences: {},
        includePageTypes: [],
      },
    });
    return context;
  }

  private async sourceData(site: SiteContext) {
    const [serviceRows, locationRows, staffRows, assignmentRows, onboarding, existing] =
      await Promise.all([
        this.db.select().from(services).where(eq(services.tenantId, site.tenantId)),
        this.db.select().from(locations).where(eq(locations.tenantId, site.tenantId)),
        this.db.select().from(users).where(eq(users.tenantId, site.tenantId)),
        this.db
          .select({
            staffUserId: staffServiceAssignments.staffUserId,
            assignmentCount: count(staffServiceAssignments.id),
          })
          .from(staffServiceAssignments)
          .where(and(
            eq(staffServiceAssignments.tenantId, site.tenantId),
            eq(staffServiceAssignments.isActive, true),
          ))
          .groupBy(staffServiceAssignments.staffUserId),
        this.db
          .select({
            businessProfile: tenantOnboarding.businessProfile,
            brandingProfile: tenantOnboarding.brandingProfile,
          })
          .from(tenantOnboarding)
          .where(eq(tenantOnboarding.tenantId, site.tenantId))
          .limit(1),
        this.db
          .select({ slug: sitePages.slug, pageType: sitePages.pageType })
          .from(sitePages)
          .where(and(
            eq(sitePages.siteId, site.id),
            eq(sitePages.tenantId, site.tenantId),
            isNull(sitePages.archivedAt),
          )),
      ]);
    const assignmentCounts = new Map(
      assignmentRows.map((row) => [
        row.staffUserId,
        Number(row.assignmentCount),
      ]),
    );
    const serviceInputs: BlueprintServiceInput[] = serviceRows.map((service) => ({
      reference: service.publicReference,
      tenantReference: site.tenantReference,
      name: service.name,
      description: service.description,
      durationMinutes: service.duration,
      priceMinor: service.price,
      active: service.isActive,
      bookingEligible: service.isActive,
      updatedAt: service.updatedAt.toISOString(),
    }));
    const locationInputs: BlueprintLocationInput[] = locationRows.map((location) => ({
      reference: location.publicReference,
      tenantReference: site.tenantReference,
      name: location.name,
      active: location.isActive,
      primary: location.isPrimary,
      addressComplete: Boolean(location.address.trim() && location.postcode.trim()),
      openingHoursComplete: false,
      telephonePresent: Boolean(location.phone?.trim()),
      updatedAt: location.updatedAt.toISOString(),
    }));
    const staffInputs: BlueprintStaffInput[] = staffRows.map((staff) => ({
      reference: staff.publicReference,
      tenantReference: site.tenantReference,
      name: staff.name,
      active: staff.accountStatus === 'ACTIVE' && !staff.deactivatedAt,
      bookingEnabled: staff.bookingEnabled,
      publicProfileAllowed:
        staff.bookingEnabled
        && staff.accountStatus === 'ACTIVE'
        && !staff.deactivatedAt,
      biographyPresent: Boolean(staff.bio?.trim()),
      rolePresent: Boolean(staff.jobTitle?.trim()),
      imagePresent: Boolean(staff.profileImageUrl?.trim()),
      serviceAssignmentCount: assignmentCounts.get(staff.id) || 0,
      updatedAt: staff.updatedAt.toISOString(),
    }));
    const businessProfile = record(onboarding[0]?.businessProfile);
    const brandProfile = record(onboarding[0]?.brandingProfile);
    const profileValues = Object.values(businessProfile).filter(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
    const contactComplete = locationInputs.some(
      (location) => location.primary && location.addressComplete,
    );
    return {
      services: serviceInputs,
      locations: locationInputs,
      staff: staffInputs,
      business: {
        name: site.tenantName,
        businessType: typeof businessProfile.businessType === 'string'
          ? businessProfile.businessType
          : null,
        profileComplete: profileValues.length >= 2,
        contactComplete,
        brandComplete: Object.keys(brandProfile).length >= 2,
        approvedResultsAssetCount: 0,
      },
      existingCanonicalPaths: existing.map((page) => {
        if (page.pageType === 'HOME') return '/';
        if (page.pageType === 'BOOKING') return '/book';
        if (page.slug.startsWith('/')) return page.slug;
        if (page.pageType === 'SERVICE_DETAIL') return `/services/${page.slug}`;
        if (page.pageType === 'LOCATION_DETAIL') return `/locations/${page.slug}`;
        if (page.pageType === 'TEAM_DETAIL') return `/team/${page.slug}`;
        return `/${page.slug}`;
      }),
      serviceIds: new Map(
        serviceRows.map((service) => [service.publicReference, service.id]),
      ),
      locationIds: new Map(
        locationRows.map((location) => [location.publicReference, location.id]),
      ),
      staffIds: new Map(
        staffRows.map((staff) => [staff.publicReference, staff.id]),
      ),
    };
  }

  private async validationFor(blueprintId: string, site: SiteContext) {
    const [blueprint] = await this.db
      .select()
      .from(siteBlueprints)
      .where(and(
        eq(siteBlueprints.id, blueprintId),
        eq(siteBlueprints.siteId, site.id),
        eq(siteBlueprints.tenantId, site.tenantId),
      ))
      .limit(1);
    if (!blueprint) throw fail(404, 'BLUEPRINT_NOT_FOUND', 'Blueprint not found.');
    const resolved = await this.resolveBlueprintSources(site, blueprint);
    const pages = await this.pageInputs(blueprint.id, site.tenantId);
    const context: BlueprintValidationContext = {
      tenantReference: site.tenantReference,
      planKey: resolved.engineInput.planKey,
      marketingPageLimit: resolved.engineInput.marketingPageLimit,
      entitlementOverrideApplied:
        resolved.engineInput.entitlementOverrideApplied,
      template: resolved.engineInput.template,
      services: resolved.engineInput.services,
      locations: resolved.engineInput.locations,
      staff: resolved.engineInput.staff,
    };
    const validation = validateBlueprint({ pages, context });
    const openBlockingItems = await this.db
      .select({
        reference: siteBlueprintActionItems.publicReference,
        code: siteBlueprintActionItems.code,
        message: siteBlueprintActionItems.message,
        subjectReference: siteBlueprintActionItems.subjectPublicReference,
      })
      .from(siteBlueprintActionItems)
      .where(and(
        eq(siteBlueprintActionItems.blueprintId, blueprint.id),
        eq(siteBlueprintActionItems.tenantId, site.tenantId),
        eq(siteBlueprintActionItems.status, 'OPEN'),
        eq(siteBlueprintActionItems.severity, 'BLOCKING'),
      ));
    const knownCodes = new Set(validation.findings.map((finding) => finding.code));
    for (const item of openBlockingItems) {
      if (knownCodes.has(item.code)) continue;
      validation.findings.push({
        code: item.code,
        severity: 'BLOCKING',
        message: item.message,
        pageReference: null,
        subjectReference: item.subjectReference,
      });
    }
    validation.valid = !validation.findings.some(
      (finding) => finding.severity === 'BLOCKING',
    );
    validation.approvalReady = validation.valid;
    return validation;
  }

  private async normaliseAgencyPage(
    page: BlueprintPageInput,
    resolved: ResolvedGenerationContext,
  ) {
    const pathIssue = canonicalPathIssue(page.plannedSlug, page.pageType);
    if (pathIssue) throw fail(400, pathIssue, 'The planned path is invalid.');
    if (!page.layoutReference) {
      throw fail(
        409,
        'BLUEPRINT_LAYOUT_REQUIRED',
        'Agency-added pages require an approved compatible layout.',
      );
    }
    await createTemplateCompatibilityService(this.db).assertLayoutCompatible({
      layoutReference: page.layoutReference,
      pageType: page.pageType,
    });
    if (!resolved.layoutIds.has(page.layoutReference)) {
      throw fail(
        409,
        'BLUEPRINT_LAYOUT_TEMPLATE_MISMATCH',
        'The layout is not part of the pinned template version.',
      );
    }
    const expectedKind = page.pageType === 'BOOKING'
      ? 'FUNCTIONAL'
      : page.pageType === 'POLICIES'
        ? 'REQUIRED_LEGAL'
        : 'MARKETING';
    if (
      page.entitlementKind !== expectedKind
      || page.consumesMarketingEntitlement !== (expectedKind === 'MARKETING')
    ) {
      throw fail(
        400,
        'BLUEPRINT_PAGE_ENTITLEMENT_INVALID',
        'Page entitlement accounting is determined server-side.',
      );
    }
    if (
      page.pageType === 'SERVICE_DETAIL'
      && !resolved.engineInput.services.some((service) =>
        service.reference === page.serviceReference
        && service.active
        && service.bookingEligible)
    ) {
      throw fail(409, 'SERVICE_MAPPING_INVALID', 'Service is not an active tenant service.');
    }
    if (
      page.pageType === 'LOCATION_DETAIL'
      && !resolved.engineInput.locations.some((location) =>
        location.reference === page.locationReference
        && location.active
        && location.addressComplete)
    ) {
      throw fail(409, 'LOCATION_MAPPING_INVALID', 'Location is not an active tenant location.');
    }
    if (
      page.pageType === 'TEAM_DETAIL'
      && !resolved.engineInput.staff.some((staff) =>
        staff.reference === page.staffReference
        && staff.active
        && staff.publicProfileAllowed)
    ) {
      throw fail(409, 'STAFF_MAPPING_INVALID', 'Staff is not an eligible tenant profile.');
    }
    return BlueprintPageInputSchema.parse({
      ...page,
      bookingRequirements: bookingRequirementsForPage({
        pageType: page.pageType,
        serviceReference: page.pageType === 'SERVICE_DETAIL'
          ? page.serviceReference
          : undefined,
        locationReference: page.pageType === 'LOCATION_DETAIL'
          ? page.locationReference
          : undefined,
        staffReference: page.pageType === 'TEAM_DETAIL'
          ? page.staffReference
          : undefined,
      }),
    });
  }

  private assertNoDuplicateMapping(
    current: readonly BlueprintPageInput[],
    page: BlueprintPageInput,
  ) {
    if (
      page.pageType === 'SERVICE_DETAIL'
      && current.some((item) =>
        item.pageType === 'SERVICE_DETAIL'
        && item.serviceReference === page.serviceReference)
    ) {
      throw fail(409, 'DUPLICATE_SERVICE_MAPPING', 'Service detail mapping already exists.');
    }
    if (
      page.pageType === 'LOCATION_DETAIL'
      && current.some((item) =>
        item.pageType === 'LOCATION_DETAIL'
        && item.locationReference === page.locationReference)
    ) {
      throw fail(409, 'DUPLICATE_LOCATION_MAPPING', 'Location detail mapping already exists.');
    }
    if (
      page.pageType === 'TEAM_DETAIL'
      && current.some((item) =>
        item.pageType === 'TEAM_DETAIL'
        && item.staffReference === page.staffReference)
    ) {
      throw fail(409, 'DUPLICATE_STAFF_MAPPING', 'Staff detail mapping already exists.');
    }
  }

  private pagePersistenceValues(
    page: BlueprintPageInput,
    resolved: ResolvedGenerationContext,
    blueprintId: string,
    tenantId: string,
    sortOrder: number,
  ) {
    return {
      tenantId,
      blueprintId,
      pageType: page.pageType,
      conversionRole: page.conversionRole,
      entitlementKind: page.entitlementKind,
      allocation: 'INITIAL',
      title: page.titleLabel,
      proposedSlug: page.plannedSlug,
      templateLayoutId: page.layoutReference
        ? resolved.layoutIds.get(page.layoutReference) || null
        : null,
      serviceId: page.pageType === 'SERVICE_DETAIL'
        ? resolved.serviceIds.get(page.serviceReference) || null
        : null,
      locationId: page.pageType === 'LOCATION_DETAIL'
        ? resolved.locationIds.get(page.locationReference) || null
        : null,
      staffUserId: page.pageType === 'TEAM_DETAIL'
        ? resolved.staffIds.get(page.staffReference) || null
        : null,
      navigationGroup: page.navigationGroup,
      navigationOrder: page.navigationOrder,
      consumesMarketingEntitlement: page.consumesMarketingEntitlement,
      generationPriority: page.generationPriority,
      selectionScore: page.selectionScore,
      selectionReasonsJson: page.selectionReasons,
      bookingRequirementsJson: page.bookingRequirements,
      layoutSelectionReason: 'AGENCY_APPROVED_COMPATIBLE_OVERRIDE',
      agencyNotes: page.agencyNotes || null,
      sortOrder,
      rationale: page.selectionReasons.join(', ').slice(0, 1000),
    };
  }

  private async pageInputs(blueprintId: string, tenantId: string) {
    const rows = await this.db
      .select({
        page: siteBlueprintPages,
        layoutReference: templateLayouts.publicReference,
        serviceReference: services.publicReference,
        locationReference: locations.publicReference,
        staffReference: users.publicReference,
      })
      .from(siteBlueprintPages)
      .leftJoin(
        templateLayouts,
        eq(siteBlueprintPages.templateLayoutId, templateLayouts.id),
      )
      .leftJoin(services, eq(siteBlueprintPages.serviceId, services.id))
      .leftJoin(locations, eq(siteBlueprintPages.locationId, locations.id))
      .leftJoin(users, eq(siteBlueprintPages.staffUserId, users.id))
      .where(and(
        eq(siteBlueprintPages.blueprintId, blueprintId),
        eq(siteBlueprintPages.tenantId, tenantId),
      ))
      .orderBy(asc(siteBlueprintPages.sortOrder));
    return rows.map((row) => this.pageInput(row));
  }

  private pageInput(row: {
    page: typeof siteBlueprintPages.$inferSelect;
    layoutReference: string | null;
    serviceReference: string | null;
    locationReference: string | null;
    staffReference: string | null;
  }): BlueprintPageInput {
    const requirements = BlueprintBookingRequirementSchema.array().safeParse(
      row.page.bookingRequirementsJson,
    );
    const common = {
      reference: row.page.publicReference,
      pageType: row.page.pageType as SitePageType,
      conversionRole: row.page.conversionRole as BlueprintPageInput['conversionRole'],
      titleLabel: row.page.title,
      plannedSlug: row.page.proposedSlug,
      navigationGroup:
        row.page.navigationGroup as BlueprintPageInput['navigationGroup'],
      navigationOrder: row.page.navigationOrder,
      layoutReference: row.layoutReference,
      entitlementKind:
        row.page.entitlementKind as BlueprintPageInput['entitlementKind'],
      consumesMarketingEntitlement:
        row.page.consumesMarketingEntitlement,
      generationPriority: row.page.generationPriority,
      selectionScore: row.page.selectionScore,
      selectionReasons: Array.isArray(row.page.selectionReasonsJson)
        ? row.page.selectionReasonsJson.filter(
          (item): item is string => typeof item === 'string',
        )
        : [],
      layoutSelectionReason: row.page.layoutSelectionReason,
      bookingRequirements: requirements.success ? requirements.data : [],
      agencyNotes: row.page.agencyNotes,
    };
    if (row.page.pageType === 'SERVICE_DETAIL' && row.serviceReference) {
      return { ...common, pageType: 'SERVICE_DETAIL', serviceReference: row.serviceReference };
    }
    if (row.page.pageType === 'LOCATION_DETAIL' && row.locationReference) {
      return { ...common, pageType: 'LOCATION_DETAIL', locationReference: row.locationReference };
    }
    if (row.page.pageType === 'TEAM_DETAIL' && row.staffReference) {
      return { ...common, pageType: 'TEAM_DETAIL', staffReference: row.staffReference };
    }
    return common as BlueprintPageInput;
  }

  private async refreshUsage(
    tx: Transaction,
    blueprintId: string,
    limit: number,
    overrideApplied: boolean,
  ) {
    const [usage] = await tx
      .select({
        marketing: sql<number>`count(*) filter (
          where ${siteBlueprintPages.consumesMarketingEntitlement} = true
        )::int`,
        functional: sql<number>`count(*) filter (
          where ${siteBlueprintPages.entitlementKind} = 'FUNCTIONAL'
        )::int`,
        legal: sql<number>`count(*) filter (
          where ${siteBlueprintPages.entitlementKind} = 'REQUIRED_LEGAL'
        )::int`,
      })
      .from(siteBlueprintPages)
      .where(eq(siteBlueprintPages.blueprintId, blueprintId));
    const marketing = Number(usage?.marketing || 0);
    if (marketing > limit) {
      throw fail(
        409,
        'BLUEPRINT_ENTITLEMENT_OVERFLOW',
        'The server-resolved marketing page allowance would be exceeded.',
      );
    }
    await tx
      .update(siteBlueprints)
      .set({
        proposedMarketingPageCount: marketing,
        entitlementMarketingPageLimit: limit,
        functionalPageCount: Number(usage?.functional || 0),
        requiredLegalPageCount: Number(usage?.legal || 0),
        unusedMarketingPageAllowance: Math.max(0, limit - marketing),
        entitlementOverrideApplied: overrideApplied,
        updatedAt: new Date(),
      })
      .where(eq(siteBlueprints.id, blueprintId));
  }

  private async detailView(
    blueprintId: string,
    site: SiteContext,
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const summary = await this.summaryView(blueprintId, site, executor);
    const pages = await this.pageViews(blueprintId, site.tenantId, executor);
    const readiness = BlueprintReadinessAssessmentSchema.array().safeParse(
      (await executor
        .select({ readiness: siteBlueprints.readinessJson })
        .from(siteBlueprints)
        .where(eq(siteBlueprints.id, blueprintId))
        .limit(1))[0]?.readiness,
    );
    return {
      ...summary,
      pages,
      readiness: readiness.success ? readiness.data : [],
      actionItems: await this.actionItemViews(
        blueprintId,
        site.tenantId,
        executor,
      ),
    };
  }

  private async summaryView(
    blueprintId: string,
    site: SiteContext,
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const [blueprint] = await executor
      .select({
        reference: siteBlueprints.publicReference,
        templateVersionReference: templateVersions.publicReference,
        name: siteBlueprints.name,
        status: siteBlueprints.status,
        revision: siteBlueprints.revision,
        sourceDataDigest: siteBlueprints.sourceDataDigest,
        engineVersion: siteBlueprints.engineVersion,
        planKey: sql<string>`coalesce((
          select p.key
          from tenant_plan_assignments a
          join platform_plan_versions pv on pv.id = a.plan_version_id
          join platform_plans p on p.id = pv.plan_id
          where a.id = ${siteBlueprints.planAssignmentId}
        ), 'CORE')`,
        proposedMarketingPageCount:
          siteBlueprints.proposedMarketingPageCount,
        entitlementMarketingPageLimit:
          siteBlueprints.entitlementMarketingPageLimit,
        functionalPageCount: siteBlueprints.functionalPageCount,
        requiredLegalPageCount: siteBlueprints.requiredLegalPageCount,
        unusedMarketingPageAllowance:
          siteBlueprints.unusedMarketingPageAllowance,
        entitlementOverrideApplied:
          siteBlueprints.entitlementOverrideApplied,
        generatedAt: siteBlueprints.generatedAt,
        approvedAt: siteBlueprints.approvedAt,
        createdAt: siteBlueprints.createdAt,
        updatedAt: siteBlueprints.updatedAt,
        blockingActionItemCount: sql<number>`(
          select count(*)::int
          from site_blueprint_action_items i
          where i.blueprint_id = ${siteBlueprints.id}
            and i.status = 'OPEN'
            and i.severity = 'BLOCKING'
        )`,
      })
      .from(siteBlueprints)
      .leftJoin(
        templateVersions,
        eq(siteBlueprints.templateVersionId, templateVersions.id),
      )
      .where(and(
        eq(siteBlueprints.id, blueprintId),
        eq(siteBlueprints.siteId, site.id),
        eq(siteBlueprints.tenantId, site.tenantId),
      ))
      .limit(1);
    if (!blueprint) throw fail(404, 'BLUEPRINT_NOT_FOUND', 'Blueprint not found.');
    return {
      reference: blueprint.reference,
      siteReference: site.reference,
      templateVersionReference: blueprint.templateVersionReference,
      name: blueprint.name,
      status: blueprint.status as BlueprintStatus,
      revision: blueprint.revision,
      sourceDataDigest: blueprint.sourceDataDigest,
      engineVersion: blueprint.engineVersion,
      entitlementUsage: {
        planKey: ['CORE', 'GROWTH', 'SCALE'].includes(blueprint.planKey)
          ? blueprint.planKey as 'CORE' | 'GROWTH' | 'SCALE'
          : 'CORE',
        marketingPageLimit: blueprint.entitlementMarketingPageLimit,
        proposedMarketingPageCount: blueprint.proposedMarketingPageCount,
        functionalPageCount: blueprint.functionalPageCount,
        requiredLegalPageCount: blueprint.requiredLegalPageCount,
        unusedMarketingPageAllowance: blueprint.unusedMarketingPageAllowance,
        overrideApplied: blueprint.entitlementOverrideApplied,
      },
      blockingActionItemCount: Number(blueprint.blockingActionItemCount),
      generatedAt: (
        blueprint.generatedAt || blueprint.createdAt
      ).toISOString(),
      approvedAt: dateString(blueprint.approvedAt),
      createdAt: blueprint.createdAt.toISOString(),
      updatedAt: blueprint.updatedAt.toISOString(),
    };
  }

  private async pageViews(
    blueprintId: string,
    tenantId: string,
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const rows = await executor
      .select({
        page: siteBlueprintPages,
        layoutReference: templateLayouts.publicReference,
        serviceReference: services.publicReference,
        locationReference: locations.publicReference,
        staffReference: users.publicReference,
      })
      .from(siteBlueprintPages)
      .leftJoin(
        templateLayouts,
        eq(siteBlueprintPages.templateLayoutId, templateLayouts.id),
      )
      .leftJoin(services, eq(siteBlueprintPages.serviceId, services.id))
      .leftJoin(locations, eq(siteBlueprintPages.locationId, locations.id))
      .leftJoin(users, eq(siteBlueprintPages.staffUserId, users.id))
      .where(and(
        eq(siteBlueprintPages.blueprintId, blueprintId),
        eq(siteBlueprintPages.tenantId, tenantId),
      ))
      .orderBy(asc(siteBlueprintPages.sortOrder));
    return rows.map((row) => this.pageInput(row));
  }

  private async pageView(pageId: string, tenantId: string) {
    const rows = await this.db
      .select({
        page: siteBlueprintPages,
        layoutReference: templateLayouts.publicReference,
        serviceReference: services.publicReference,
        locationReference: locations.publicReference,
        staffReference: users.publicReference,
      })
      .from(siteBlueprintPages)
      .leftJoin(
        templateLayouts,
        eq(siteBlueprintPages.templateLayoutId, templateLayouts.id),
      )
      .leftJoin(services, eq(siteBlueprintPages.serviceId, services.id))
      .leftJoin(locations, eq(siteBlueprintPages.locationId, locations.id))
      .leftJoin(users, eq(siteBlueprintPages.staffUserId, users.id))
      .where(and(
        eq(siteBlueprintPages.id, pageId),
        eq(siteBlueprintPages.tenantId, tenantId),
      ))
      .limit(1);
    if (!rows[0]) throw fail(404, 'BLUEPRINT_PAGE_NOT_FOUND', 'Blueprint page not found.');
    return this.pageInput(rows[0]);
  }

  private async actionItemViews(
    blueprintId: string,
    tenantId: string,
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const rows = await executor
      .select({
        reference: siteBlueprintActionItems.publicReference,
        category: siteBlueprintActionItems.category,
        severity: siteBlueprintActionItems.severity,
        status: siteBlueprintActionItems.status,
        code: siteBlueprintActionItems.code,
        message: siteBlueprintActionItems.message,
        pageReference: siteBlueprintPages.publicReference,
        subjectReference: siteBlueprintActionItems.subjectPublicReference,
        safeMetadata: siteBlueprintActionItems.safeMetadataJson,
        resolvedAt: siteBlueprintActionItems.resolvedAt,
      })
      .from(siteBlueprintActionItems)
      .leftJoin(
        siteBlueprintPages,
        eq(siteBlueprintActionItems.blueprintPageId, siteBlueprintPages.id),
      )
      .where(and(
        eq(siteBlueprintActionItems.blueprintId, blueprintId),
        eq(siteBlueprintActionItems.tenantId, tenantId),
      ))
      .orderBy(
        asc(siteBlueprintActionItems.status),
        asc(siteBlueprintActionItems.severity),
        asc(siteBlueprintActionItems.createdAt),
      );
    return rows.map((item) => ({
      reference: item.reference,
      category: item.category,
      severity: item.severity,
      status: item.status,
      code: item.code,
      message: item.message,
      pageReference: item.pageReference,
      subjectReference: item.subjectReference,
      safeMetadata: record(item.safeMetadata),
      resolvedAt: dateString(item.resolvedAt),
    }));
  }

  private async siteContext(
    siteReference: string,
    executor: SiteDatabaseExecutor = this.db,
  ): Promise<SiteContext> {
    const [site] = await executor
      .select({
        id: sites.id,
        tenantId: sites.tenantId,
        reference: sites.publicReference,
        displayName: sites.displayName,
        tenantReference: tenants.businessReference,
        tenantName: tenants.name,
      })
      .from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .where(eq(sites.publicReference, siteReference))
      .limit(1);
    if (!site) throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    return site;
  }

  private async blueprintContext(
    site: SiteContext,
    blueprintReference: string,
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const [blueprint] = await executor
      .select()
      .from(siteBlueprints)
      .where(and(
        eq(siteBlueprints.publicReference, blueprintReference),
        eq(siteBlueprints.siteId, site.id),
        eq(siteBlueprints.tenantId, site.tenantId),
      ))
      .limit(1);
    if (!blueprint) throw fail(404, 'BLUEPRINT_NOT_FOUND', 'Blueprint not found.');
    return blueprint;
  }

  private async lockSite(tx: Transaction, siteId: string) {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`site-blueprint:${siteId}`}::text, 0)
      )
    `);
  }

  private async lockBlueprint(tx: Transaction, blueprintId: string) {
    await tx.execute(sql`
      SELECT id
      FROM site_blueprints
      WHERE id = ${blueprintId}
      FOR UPDATE
    `);
  }
}
