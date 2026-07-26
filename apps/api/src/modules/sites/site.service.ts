import {
  assertSitePageCreationAllowed,
  sitePageEntitlementKind,
  utcMonthPeriod,
  type CreateSite,
  type CreateSitePage,
  type CreateSiteVersion,
  type SitePageType,
  type UpdateDraftSitePage,
  type UpdateSite,
} from '@ks-os/contracts';
import {
  siteApprovalDecisions,
  siteApprovals,
  getDatabase,
  monthlyPageEntitlements,
  monthlyPageOpportunities,
  sitePages,
  siteReviewActivity,
  siteReviewComments,
  siteReviewCycles,
  siteReviewItems,
  siteSections,
  sites,
  siteVersions,
  templateLayoutPageTypes,
  templateLayouts,
  tenants,
} from '@ks-os/database';
import { generationDigest } from '@ks-os/site-generation';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  max,
  or,
  sql,
} from 'drizzle-orm';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';
import {
  SiteEntitlementService,
  type SiteDatabaseExecutor,
} from './site-entitlement.service.js';

type Database = ReturnType<typeof getDatabase>;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export class SiteService {
  private readonly entitlements: SiteEntitlementService;

  constructor(
    private readonly db: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
    entitlements?: SiteEntitlementService,
  ) {
    this.entitlements = entitlements || new SiteEntitlementService(db);
  }

  async list() {
    return this.db
      .select({
        reference: sites.publicReference,
        tenantReference: tenants.businessReference,
        tenantName: tenants.name,
        displayName: sites.displayName,
        status: sites.status,
        publishedVersionReference: siteVersions.publicReference,
        createdAt: sites.createdAt,
        updatedAt: sites.updatedAt,
      })
      .from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .leftJoin(siteVersions, eq(sites.publishedVersionId, siteVersions.id))
      .orderBy(desc(sites.updatedAt));
  }

  async create(actor: AgencyActor, input: CreateSite) {
    const [tenant] = await this.db
      .select({
        id: tenants.id,
        businessReference: tenants.businessReference,
      })
      .from(tenants)
      .where(eq(tenants.businessReference, input.tenantReference))
      .limit(1);
    if (!tenant) {
      throw fail(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`site-create:${tenant.id}`}::text, 0)
        )
      `);

      const [existing] = await tx
        .select()
        .from(sites)
        .where(eq(sites.tenantId, tenant.id))
        .limit(1);
      if (existing) {
        if (
          input.idempotencyKey
          && existing.creationIdempotencyKey === input.idempotencyKey
        ) {
          return this.getById(existing.id, tx);
        }
        throw fail(
          409,
          'SITE_ALREADY_EXISTS',
          'This tenant already has a managed website.',
        );
      }

      const [site] = await tx
        .insert(sites)
        .values({
          tenantId: tenant.id,
          displayName: input.displayName,
          status: 'DRAFT',
          creationIdempotencyKey: input.idempotencyKey,
          createdByAgencyUserId: actor.agencyUserId,
        })
        .returning();
      const [version] = await tx
        .insert(siteVersions)
        .values({
          tenantId: tenant.id,
          siteId: site.id,
          versionNumber: 1,
          status: 'DRAFT',
          changeSummary: 'Initial managed website draft',
          createdByAgencyUserId: actor.agencyUserId,
        })
        .returning();

      await this.audit.write(actor, 'SITE_CREATED', 'SITE', site.id, {
        tenantId: tenant.id,
        category: 'WEBSITE',
        metadata: {
          siteReference: site.publicReference,
          versionReference: version.publicReference,
        },
        tx,
      });
      return this.getById(site.id, tx);
    });
  }

  async get(siteReference: string) {
    const context = await this.siteContext(siteReference);
    return this.getById(context.id);
  }

  async getForTenant(siteReference: string, tenantId: string) {
    const [site] = await this.db
      .select({ id: sites.id })
      .from(sites)
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(sites.tenantId, tenantId),
      ))
      .limit(1);
    if (!site) {
      throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    }
    return this.getById(site.id);
  }

  async update(actor: AgencyActor, siteReference: string, input: UpdateSite) {
    const site = await this.siteContext(siteReference);
    const [updated] = await this.db
      .update(sites)
      .set({
        displayName: input.displayName,
        status: input.status,
        updatedAt: new Date(),
      })
      .where(eq(sites.id, site.id))
      .returning();
    await this.audit.write(actor, 'SITE_UPDATED', 'SITE', site.id, {
      tenantId: site.tenantId,
      category: 'WEBSITE',
      previousValues: {
        displayName: site.displayName,
        status: site.status,
      },
      newValues: {
        displayName: updated.displayName,
        status: updated.status,
      },
    });
    return this.getById(site.id);
  }

  async entitlementSummary(siteReference: string) {
    const site = await this.siteContext(siteReference);
    const version = await this.latestVersion(site.id, site.tenantId);
    return this.entitlements.forVersion(
      site.tenantId,
      site.id,
      version.id,
    );
  }

  async listVersions(siteReference: string) {
    const site = await this.siteContext(siteReference);
    return this.db
      .select({
        reference: siteVersions.publicReference,
        basedOnVersionReference: sql<string | null>`
          (select source.public_reference from site_versions source
           where source.id = ${siteVersions.basedOnVersionId})
        `,
        versionNumber: siteVersions.versionNumber,
        status: siteVersions.status,
        changeSummary: siteVersions.changeSummary,
        publishedAt: siteVersions.publishedAt,
        createdAt: siteVersions.createdAt,
        updatedAt: siteVersions.updatedAt,
      })
      .from(siteVersions)
      .where(and(
        eq(siteVersions.siteId, site.id),
        eq(siteVersions.tenantId, site.tenantId),
      ))
      .orderBy(desc(siteVersions.versionNumber));
  }

  async createVersion(
    actor: AgencyActor,
    siteReference: string,
    input: CreateSiteVersion,
  ) {
    const site = await this.siteContext(siteReference);
    let basedOnVersionId: string | null = null;
    if (input.basedOnVersionReference) {
      const [base] = await this.db
        .select({ id: siteVersions.id })
        .from(siteVersions)
        .where(and(
          eq(siteVersions.publicReference, input.basedOnVersionReference),
          eq(siteVersions.siteId, site.id),
          eq(siteVersions.tenantId, site.tenantId),
        ))
        .limit(1);
      if (!base) {
        throw fail(
          404,
          'SITE_VERSION_NOT_FOUND',
          'The source version does not belong to this site.',
        );
      }
      basedOnVersionId = base.id;
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`site-version:${site.id}`}::text, 0)
        )
      `);
      const [current] = await tx
        .select({ highest: max(siteVersions.versionNumber) })
        .from(siteVersions)
        .where(and(
          eq(siteVersions.siteId, site.id),
          eq(siteVersions.tenantId, site.tenantId),
        ));
      const [version] = await tx
        .insert(siteVersions)
        .values({
          tenantId: site.tenantId,
          siteId: site.id,
          basedOnVersionId,
          versionNumber: Number(current?.highest || 0) + 1,
          status: 'DRAFT',
          changeSummary: input.changeSummary,
          createdByAgencyUserId: actor.agencyUserId,
        })
        .returning();
      await this.audit.write(
        actor,
        'SITE_VERSION_CREATED',
        'SITE_VERSION',
        version.id,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          metadata: {
            siteReference,
            versionReference: version.publicReference,
            basedOnVersionReference: input.basedOnVersionReference,
          },
          tx,
        },
      );
      return this.versionView(version.id, tx);
    });
  }

  async getVersion(siteReference: string, versionReference: string) {
    const site = await this.siteContext(siteReference);
    const [version] = await this.db
      .select({ id: siteVersions.id })
      .from(siteVersions)
      .where(and(
        eq(siteVersions.publicReference, versionReference),
        eq(siteVersions.siteId, site.id),
        eq(siteVersions.tenantId, site.tenantId),
      ))
      .limit(1);
    if (!version) {
      throw fail(404, 'SITE_VERSION_NOT_FOUND', 'Site version not found.');
    }
    return this.versionView(version.id);
  }

  async listPages(siteReference: string, versionReference?: string) {
    const site = await this.siteContext(siteReference);
    const version = versionReference
      ? await this.versionContext(site, versionReference)
      : await this.latestVersion(site.id, site.tenantId);
    return this.db
      .select({
        reference: sitePages.publicReference,
        versionReference: siteVersions.publicReference,
        pageType: sitePages.pageType,
        conversionRole: sitePages.conversionRole,
        entitlementKind: sitePages.entitlementKind,
        allocation: sitePages.allocation,
        title: sitePages.title,
        slug: sitePages.slug,
        layoutReference: templateLayouts.publicReference,
        sortOrder: sitePages.sortOrder,
        seoTitle: sitePages.seoTitle,
        seoDescription: sitePages.seoDescription,
        createdAt: sitePages.createdAt,
        updatedAt: sitePages.updatedAt,
      })
      .from(sitePages)
      .innerJoin(siteVersions, eq(sitePages.versionId, siteVersions.id))
      .leftJoin(templateLayouts, eq(sitePages.templateLayoutId, templateLayouts.id))
      .where(and(
        eq(sitePages.tenantId, site.tenantId),
        eq(sitePages.siteId, site.id),
        eq(sitePages.versionId, version.id),
        isNull(sitePages.archivedAt),
      ))
      .orderBy(asc(sitePages.sortOrder));
  }

  async createPage(
    actor: AgencyActor,
    siteReference: string,
    input: CreateSitePage,
  ) {
    const site = await this.siteContext(siteReference);
    const version = await this.versionContext(site, input.versionReference);
    if (version.status !== 'DRAFT') {
      throw fail(
        409,
        'SITE_VERSION_IMMUTABLE',
        'Only draft site versions can be edited.',
      );
    }
    const entitlementKind = sitePageEntitlementKind(input.pageType);
    const layoutId = input.layoutReference
      ? await this.assertLayoutCompatible(input.layoutReference, input.pageType)
      : null;

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`site-page:${site.id}:${input.allocation}`}::text, 0)
        )
      `);
      const [lockedVersion] = await tx
        .select({ status: siteVersions.status })
        .from(siteVersions)
        .where(and(
          eq(siteVersions.id, version.id),
          eq(siteVersions.tenantId, site.tenantId),
          eq(siteVersions.siteId, site.id),
        ))
        .limit(1);
      if (lockedVersion?.status !== 'DRAFT') {
        throw fail(
          409,
          'SITE_VERSION_IMMUTABLE',
          'Only draft site versions can be edited.',
        );
      }

      const summary = await this.entitlements.forVersion(
        site.tenantId,
        site.id,
        version.id,
        new Date(),
        tx,
      );
      try {
        assertSitePageCreationAllowed({
          pageType: input.pageType,
          allocation: input.allocation,
          summary,
        });
      } catch (error) {
        if (
          error instanceof Error
          && 'code' in error
          && error.code === 'SITE_PAGE_ENTITLEMENT_EXCEEDED'
        ) {
          throw fail(409, error.code, error.message);
        }
        throw error;
      }

      let monthlyOpportunityId: string | null = null;
      if (entitlementKind === 'MARKETING' && input.allocation === 'MONTHLY') {
        if (!input.monthlyOpportunityReference) {
          throw fail(
            400,
            'MONTHLY_PAGE_OPPORTUNITY_REQUIRED',
            'A current monthly page opportunity is required.',
          );
        }
        const { periodStart, periodEnd } = utcMonthPeriod();
        const [opportunity] = await tx
          .select({
            id: monthlyPageOpportunities.id,
            pageId: monthlyPageOpportunities.sitePageId,
          })
          .from(monthlyPageOpportunities)
          .innerJoin(
            monthlyPageEntitlements,
            eq(
              monthlyPageOpportunities.monthlyEntitlementId,
              monthlyPageEntitlements.id,
            ),
          )
          .where(and(
            eq(
              monthlyPageOpportunities.publicReference,
              input.monthlyOpportunityReference,
            ),
            eq(monthlyPageOpportunities.tenantId, site.tenantId),
            eq(monthlyPageOpportunities.siteId, site.id),
            isNull(monthlyPageOpportunities.sitePageId),
            gte(monthlyPageEntitlements.periodStart, periodStart),
            lte(monthlyPageEntitlements.periodEnd, periodEnd),
            inArray(monthlyPageOpportunities.status, [
              'IDENTIFIED',
              'PLANNED',
              'IN_PROGRESS',
              'APPROVED',
            ]),
          ))
          .limit(1);
        if (!opportunity || opportunity.pageId) {
          throw fail(
            409,
            'MONTHLY_PAGE_OPPORTUNITY_UNAVAILABLE',
            'The monthly page opportunity is unavailable or belongs to another tenant.',
          );
        }
        monthlyOpportunityId = opportunity.id;
      }

      const [page] = await tx
        .insert(sitePages)
        .values({
          tenantId: site.tenantId,
          siteId: site.id,
          versionId: version.id,
          pageType: input.pageType,
          conversionRole: input.conversionRole,
          entitlementKind,
          allocation: entitlementKind === 'MARKETING' ? input.allocation : 'INITIAL',
          monthlyOpportunityId,
          templateLayoutId: layoutId,
          title: input.title,
          slug: input.slug,
          sortOrder: input.sortOrder,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
        })
        .returning();
      if (monthlyOpportunityId) {
        await tx
          .update(monthlyPageOpportunities)
          .set({
            sitePageId: page.id,
            status: 'IN_PROGRESS',
          })
          .where(and(
            eq(monthlyPageOpportunities.id, monthlyOpportunityId),
            eq(monthlyPageOpportunities.tenantId, site.tenantId),
            isNull(monthlyPageOpportunities.sitePageId),
          ));
      }
      await this.supersedeReviewsAfterMaterialPageChange(
        tx,
        actor,
        site.tenantId,
        version.id,
        'AGENCY_PAGE_ADDED',
      );
      await this.audit.write(actor, 'SITE_PAGE_CREATED', 'SITE_PAGE', page.id, {
        tenantId: site.tenantId,
        category: 'WEBSITE',
        metadata: {
          siteReference,
          versionReference: input.versionReference,
          pageReference: page.publicReference,
          pageType: page.pageType,
          entitlementKind,
          allocation: page.allocation,
        },
        tx,
      });
      return this.pageView(page.id, site.tenantId, tx);
    });
  }

  async updatePage(
    actor: AgencyActor,
    siteReference: string,
    pageReference: string,
    input: UpdateDraftSitePage,
  ) {
    const site = await this.siteContext(siteReference);
    const [current] = await this.db
      .select({
        id: sitePages.id,
        versionId: sitePages.versionId,
        versionStatus: siteVersions.status,
        pageType: sitePages.pageType,
        conversionRole: sitePages.conversionRole,
        entitlementKind: sitePages.entitlementKind,
        allocation: sitePages.allocation,
        templateLayoutId: sitePages.templateLayoutId,
        title: sitePages.title,
        slug: sitePages.slug,
        sortOrder: sitePages.sortOrder,
        seoTitle: sitePages.seoTitle,
        seoDescription: sitePages.seoDescription,
      })
      .from(sitePages)
      .innerJoin(siteVersions, eq(sitePages.versionId, siteVersions.id))
      .where(and(
        eq(sitePages.publicReference, pageReference),
        eq(sitePages.tenantId, site.tenantId),
        eq(sitePages.siteId, site.id),
        isNull(sitePages.archivedAt),
      ))
      .limit(1);
    if (!current) {
      throw fail(404, 'SITE_PAGE_NOT_FOUND', 'Site page not found.');
    }
    if (current.versionStatus !== 'DRAFT') {
      throw fail(
        409,
        'SITE_VERSION_IMMUTABLE',
        'Published and review-stage site versions cannot be edited.',
      );
    }

    const pageType = (input.pageType || current.pageType) as SitePageType;
    const entitlementKind = sitePageEntitlementKind(pageType);
    if (
      current.entitlementKind !== 'MARKETING'
      && entitlementKind === 'MARKETING'
    ) {
      const summary = await this.entitlements.forVersion(
        site.tenantId,
        site.id,
        current.versionId,
      );
      try {
        assertSitePageCreationAllowed({
          pageType,
          allocation: current.allocation as 'INITIAL' | 'MONTHLY',
          summary,
        });
      } catch (error) {
        if (
          error instanceof Error
          && 'code' in error
          && error.code === 'SITE_PAGE_ENTITLEMENT_EXCEEDED'
        ) {
          throw fail(409, error.code, error.message);
        }
        throw error;
      }
    }

    let layoutId = current.templateLayoutId;
    if (input.layoutReference === null) {
      layoutId = null;
    } else if (input.layoutReference) {
      layoutId = await this.assertLayoutCompatible(
        input.layoutReference,
        pageType,
      );
    } else if (layoutId && pageType !== current.pageType) {
      await this.assertLayoutIdCompatible(layoutId, pageType);
    }

    const updated = await this.db.transaction(async (tx) => {
      const [page] = await tx
        .update(sitePages)
        .set({
          pageType,
          conversionRole: input.conversionRole,
          entitlementKind,
          templateLayoutId: layoutId,
          title: input.title,
          slug: input.slug,
          sortOrder: input.sortOrder,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          updatedAt: new Date(),
        })
        .where(and(
          eq(sitePages.id, current.id),
          eq(sitePages.tenantId, site.tenantId),
          eq(sitePages.siteId, site.id),
        ))
        .returning();
      if (!page) {
        throw fail(409, 'SITE_PAGE_UPDATE_CONFLICT', 'The page changed; refresh and retry.');
      }

      const [versionPages, versionSections] = await Promise.all([
        tx.select({
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
          eq(sitePages.versionId, current.versionId),
          isNull(sitePages.archivedAt),
        )).orderBy(asc(sitePages.sortOrder)),
        tx.select({
          reference: siteSections.publicReference,
          pageId: siteSections.pageId,
          sectionType: siteSections.sectionType,
          sortOrder: siteSections.sortOrder,
          content: siteSections.contentJson,
          actions: siteSections.actionsJson,
        }).from(siteSections).where(eq(siteSections.versionId, current.versionId))
          .orderBy(asc(siteSections.pageId), asc(siteSections.sortOrder)),
      ]);
      const contentDigestSha256 = generationDigest({
        pages: versionPages,
        sections: versionSections,
      });
      await tx.update(siteVersions).set({
        generationContentDigestSha256: contentDigestSha256,
        updatedAt: new Date(),
      }).where(eq(siteVersions.id, current.versionId));

      const cycles = await tx.select({
        id: siteReviewCycles.id,
        reference: siteReviewCycles.publicReference,
      }).from(siteReviewCycles).where(and(
        eq(siteReviewCycles.siteVersionId, current.versionId),
        inArray(siteReviewCycles.status, [
          'DRAFT',
          'INTERNAL_REVIEW',
          'INTERNAL_CHANGES_REQUIRED',
          'READY_FOR_CLIENT_REVIEW',
          'CLIENT_REVIEW',
          'CLIENT_CHANGES_REQUESTED',
          'CLIENT_APPROVED',
          'AGENCY_FINAL_REVIEW',
          'AGENCY_APPROVED',
        ]),
      ));
      for (const cycle of cycles) {
        const approvals = await tx.update(siteApprovals).set({
          status: 'WITHDRAWN',
          invalidatedAt: new Date(),
          invalidationReason: 'AGENCY_PAGE_REVISION',
        }).where(and(
          eq(siteApprovals.reviewCycleId, cycle.id),
          isNull(siteApprovals.invalidatedAt),
          or(
            eq(siteApprovals.pageId, current.id),
            inArray(siteApprovals.approvalLevel, ['FULL_SITE', 'CLIENT_FINAL', 'AGENCY_FINAL']),
          ),
        )).returning({
          id: siteApprovals.id,
          reference: siteApprovals.publicReference,
        });
        for (const approval of approvals) {
          await tx.update(siteApprovalDecisions).set({
            invalidatedAt: new Date(),
            invalidationReason: 'AGENCY_PAGE_REVISION',
          }).where(and(
            eq(siteApprovalDecisions.approvalId, approval.id),
            isNull(siteApprovalDecisions.invalidatedAt),
          ));
          await tx.insert(siteReviewActivity).values({
            reviewCycleId: cycle.id,
            eventType: 'SITE_APPROVAL_INVALIDATED',
            actorType: 'AGENCY_USER',
            agencyUserId: actor.agencyUserId,
            targetType: 'SITE_APPROVAL',
            targetPublicReference: approval.reference,
            safeMetadataJson: { reasonCode: 'AGENCY_PAGE_REVISION' },
          });
          await this.audit.write(actor, 'SITE_APPROVAL_INVALIDATED', 'SITE_APPROVAL', approval.reference, {
            tenantId: site.tenantId,
            reason: 'AGENCY_PAGE_REVISION',
            category: 'WEBSITE',
            tx,
          });
        }
        await tx.update(siteReviewComments).set({
          anchorStatus: 'OUTDATED',
          updatedAt: new Date(),
        }).where(and(
          eq(siteReviewComments.reviewCycleId, cycle.id),
          eq(siteReviewComments.pageId, current.id),
        ));
        await tx.update(siteReviewItems).set({
          status: 'SUPERSEDED',
          updatedAt: new Date(),
        }).where(and(
          eq(siteReviewItems.reviewCycleId, cycle.id),
          eq(siteReviewItems.pageId, current.id),
        ));
        await tx.update(siteReviewCycles).set({
          status: 'SUPERSEDED',
          updatedAt: new Date(),
        }).where(eq(siteReviewCycles.id, cycle.id));
      }
      await this.audit.write(
        actor,
        'SITE_PAGE_UPDATED',
        'SITE_PAGE',
        page.publicReference,
        {
          tenantId: site.tenantId,
          category: 'WEBSITE',
          previousValues: {
            pageType: current.pageType,
            conversionRole: current.conversionRole,
            entitlementKind: current.entitlementKind,
            title: current.title,
            slug: current.slug,
            sortOrder: current.sortOrder,
            seoTitle: current.seoTitle,
            seoDescription: current.seoDescription,
          },
          newValues: {
            pageType: page.pageType,
            conversionRole: page.conversionRole,
            entitlementKind: page.entitlementKind,
            title: page.title,
            slug: page.slug,
            sortOrder: page.sortOrder,
            seoTitle: page.seoTitle,
            seoDescription: page.seoDescription,
            contentDigestSha256,
          },
          tx,
        },
      );
      return page;
    });
    return this.pageView(updated.id, site.tenantId);
  }

  private async supersedeReviewsAfterMaterialPageChange(
    tx: SiteDatabaseExecutor,
    actor: AgencyActor,
    tenantId: string,
    versionId: string,
    reason: string,
  ) {
    const [versionPages, versionSections] = await Promise.all([
      tx.select({
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
        eq(sitePages.versionId, versionId),
        isNull(sitePages.archivedAt),
      )).orderBy(asc(sitePages.sortOrder)),
      tx.select({
        reference: siteSections.publicReference,
        pageId: siteSections.pageId,
        sectionType: siteSections.sectionType,
        sortOrder: siteSections.sortOrder,
        content: siteSections.contentJson,
        actions: siteSections.actionsJson,
      }).from(siteSections).where(eq(siteSections.versionId, versionId))
        .orderBy(asc(siteSections.pageId), asc(siteSections.sortOrder)),
    ]);
    const contentDigestSha256 = generationDigest({
      pages: versionPages,
      sections: versionSections,
    });
    await tx.update(siteVersions).set({
      generationContentDigestSha256: contentDigestSha256,
      updatedAt: new Date(),
    }).where(eq(siteVersions.id, versionId));

    const cycles = await tx.select({
      id: siteReviewCycles.id,
      reference: siteReviewCycles.publicReference,
    }).from(siteReviewCycles).where(and(
      eq(siteReviewCycles.siteVersionId, versionId),
      inArray(siteReviewCycles.status, [
        'DRAFT',
        'INTERNAL_REVIEW',
        'INTERNAL_CHANGES_REQUIRED',
        'READY_FOR_CLIENT_REVIEW',
        'CLIENT_REVIEW',
        'CLIENT_CHANGES_REQUESTED',
        'CLIENT_APPROVED',
        'AGENCY_FINAL_REVIEW',
        'AGENCY_APPROVED',
      ]),
    ));
    for (const cycle of cycles) {
      const approvals = await tx.update(siteApprovals).set({
        status: 'WITHDRAWN',
        invalidatedAt: new Date(),
        invalidationReason: reason,
      }).where(and(
        eq(siteApprovals.reviewCycleId, cycle.id),
        isNull(siteApprovals.invalidatedAt),
      )).returning({
        id: siteApprovals.id,
        reference: siteApprovals.publicReference,
      });
      for (const approval of approvals) {
        await tx.update(siteApprovalDecisions).set({
          invalidatedAt: new Date(),
          invalidationReason: reason,
        }).where(and(
          eq(siteApprovalDecisions.approvalId, approval.id),
          isNull(siteApprovalDecisions.invalidatedAt),
        ));
        await this.audit.write(
          actor,
          'SITE_APPROVAL_INVALIDATED',
          'SITE_APPROVAL',
          approval.reference,
          { tenantId, reason, category: 'WEBSITE', tx },
        );
      }
      await tx.update(siteReviewComments).set({
        anchorStatus: 'OUTDATED',
        updatedAt: new Date(),
      }).where(eq(siteReviewComments.reviewCycleId, cycle.id));
      await tx.update(siteReviewItems).set({
        status: 'SUPERSEDED',
        updatedAt: new Date(),
      }).where(eq(siteReviewItems.reviewCycleId, cycle.id));
      await tx.update(siteReviewCycles).set({
        status: 'SUPERSEDED',
        updatedAt: new Date(),
      }).where(eq(siteReviewCycles.id, cycle.id));
      await tx.insert(siteReviewActivity).values({
        reviewCycleId: cycle.id,
        eventType: 'SITE_REVIEW_SUPERSEDED',
        actorType: 'AGENCY_USER',
        agencyUserId: actor.agencyUserId,
        targetType: 'SITE_REVIEW_CYCLE',
        targetPublicReference: cycle.reference,
        safeMetadataJson: { reasonCode: reason, contentDigestSha256 },
      });
      await this.audit.write(
        actor,
        'SITE_REVIEW_SUPERSEDED',
        'SITE_REVIEW_CYCLE',
        cycle.reference,
        {
          tenantId,
          reason,
          category: 'WEBSITE',
          metadata: { contentDigestSha256 },
          tx,
        },
      );
    }
    return contentDigestSha256;
  }

  private async siteContext(
    siteReference: string,
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const [site] = await executor
      .select({
        id: sites.id,
        tenantId: sites.tenantId,
        displayName: sites.displayName,
        status: sites.status,
      })
      .from(sites)
      .where(eq(sites.publicReference, siteReference))
      .limit(1);
    if (!site) throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    return site;
  }

  private async latestVersion(siteId: string, tenantId: string) {
    const [version] = await this.db
      .select()
      .from(siteVersions)
      .where(and(
        eq(siteVersions.siteId, siteId),
        eq(siteVersions.tenantId, tenantId),
      ))
      .orderBy(desc(siteVersions.versionNumber))
      .limit(1);
    if (!version) {
      throw fail(409, 'SITE_VERSION_REQUIRED', 'The site has no version.');
    }
    return version;
  }

  private async versionContext(
    site: { id: string; tenantId: string },
    versionReference: string,
  ) {
    const [version] = await this.db
      .select()
      .from(siteVersions)
      .where(and(
        eq(siteVersions.publicReference, versionReference),
        eq(siteVersions.siteId, site.id),
        eq(siteVersions.tenantId, site.tenantId),
      ))
      .limit(1);
    if (!version) {
      throw fail(
        404,
        'SITE_VERSION_NOT_FOUND',
        'The version does not belong to this site.',
      );
    }
    return version;
  }

  private async getById(
    siteId: string,
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const [site] = await executor
      .select({
        reference: sites.publicReference,
        tenantReference: tenants.businessReference,
        tenantName: tenants.name,
        displayName: sites.displayName,
        status: sites.status,
        publishedVersionReference: siteVersions.publicReference,
        createdAt: sites.createdAt,
        updatedAt: sites.updatedAt,
      })
      .from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .leftJoin(siteVersions, eq(sites.publishedVersionId, siteVersions.id))
      .where(eq(sites.id, siteId))
      .limit(1);
    if (!site) throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    return site;
  }

  private async versionView(
    versionId: string,
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const [version] = await executor
      .select({
        reference: siteVersions.publicReference,
        versionNumber: siteVersions.versionNumber,
        status: siteVersions.status,
        changeSummary: siteVersions.changeSummary,
        publishedAt: siteVersions.publishedAt,
        createdAt: siteVersions.createdAt,
        updatedAt: siteVersions.updatedAt,
      })
      .from(siteVersions)
      .where(eq(siteVersions.id, versionId))
      .limit(1);
    if (!version) {
      throw fail(404, 'SITE_VERSION_NOT_FOUND', 'Site version not found.');
    }
    return version;
  }

  private async pageView(
    pageId: string,
    tenantId: string,
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const [page] = await executor
      .select({
        reference: sitePages.publicReference,
        versionReference: siteVersions.publicReference,
        pageType: sitePages.pageType,
        conversionRole: sitePages.conversionRole,
        entitlementKind: sitePages.entitlementKind,
        allocation: sitePages.allocation,
        title: sitePages.title,
        slug: sitePages.slug,
        layoutReference: templateLayouts.publicReference,
        sortOrder: sitePages.sortOrder,
        seoTitle: sitePages.seoTitle,
        seoDescription: sitePages.seoDescription,
        createdAt: sitePages.createdAt,
        updatedAt: sitePages.updatedAt,
      })
      .from(sitePages)
      .innerJoin(siteVersions, eq(sitePages.versionId, siteVersions.id))
      .leftJoin(templateLayouts, eq(sitePages.templateLayoutId, templateLayouts.id))
      .where(and(
        eq(sitePages.id, pageId),
        eq(sitePages.tenantId, tenantId),
      ))
      .limit(1);
    if (!page) throw fail(404, 'SITE_PAGE_NOT_FOUND', 'Site page not found.');
    return page;
  }

  private async assertLayoutCompatible(
    layoutReference: string,
    pageType: SitePageType,
  ) {
    const [layout] = await this.db
      .select({ id: templateLayouts.id })
      .from(templateLayouts)
      .innerJoin(
        templateLayoutPageTypes,
        eq(templateLayoutPageTypes.templateLayoutId, templateLayouts.id),
      )
      .where(and(
        eq(templateLayouts.publicReference, layoutReference),
        eq(templateLayouts.status, 'APPROVED'),
        eq(templateLayoutPageTypes.pageType, pageType),
      ))
      .limit(1);
    if (!layout) {
      throw fail(
        409,
        'SITE_LAYOUT_PAGE_TYPE_INCOMPATIBLE',
        'The selected layout is not approved for this page type.',
      );
    }
    return layout.id;
  }

  private async assertLayoutIdCompatible(
    layoutId: string,
    pageType: SitePageType,
  ) {
    const [layout] = await this.db
      .select({ id: templateLayouts.id })
      .from(templateLayouts)
      .innerJoin(
        templateLayoutPageTypes,
        eq(templateLayoutPageTypes.templateLayoutId, templateLayouts.id),
      )
      .where(and(
        eq(templateLayouts.id, layoutId),
        eq(templateLayouts.status, 'APPROVED'),
        eq(templateLayoutPageTypes.pageType, pageType),
      ))
      .limit(1);
    if (!layout) {
      throw fail(
        409,
        'SITE_LAYOUT_PAGE_TYPE_INCOMPATIBLE',
        'The existing layout is not approved for this page type.',
      );
    }
  }

}
