import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  getDatabase,
  inArray,
  isNull,
  max,
  monthlyPageEntitlements,
  monthlyPageOpportunities,
  services,
  sitePages,
  siteRenderSnapshots,
  siteReviewCycles,
  siteReviewItems,
  siteSections,
  sites,
  siteVersions,
  sql,
  templateLayoutPageTypes,
  templateLayoutRenderers,
  templateLayouts,
  templateVersions,
  tenants,
} from '@ks-os/database';
import {
  assertSitePageCreationAllowed,
  type SiteEntitlementSummary,
} from '@ks-os/contracts';
import {
  prepareSiteRenderSnapshotForStorage,
  validatePublishedSnapshot,
  type PublishedPageSnapshot,
  type PublishedSiteSnapshot,
  type SiteSection,
} from '@ks-os/site-schema';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';
import { SiteEntitlementService } from './site-entitlement.service.js';

const monthPeriod = (now = new Date()) => ({
  periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
});

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return slug || 'service';
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rewriteReferences(value: unknown, references: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return references.get(value) ?? value;
  if (Array.isArray(value)) return value.map(item => rewriteReferences(item, references));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => [key, rewriteReferences(child, references)]));
}

function sectionActions(section: SiteSection) {
  const output: unknown[] = [];
  for (const key of ['primaryAction', 'secondaryAction', 'secondaryActions'] as const) {
    if (!(key in section)) continue;
    const value = section[key as keyof SiteSection];
    if (Array.isArray(value)) output.push(...value);
    else if (value) output.push(value);
  }
  return output;
}

function serviceReferenceFromPage(page: PublishedPageSnapshot) {
  return page.sections.find(
    (section): section is Extract<SiteSection, { type: 'SERVICE_DETAILS' }> =>
      section.type === 'SERVICE_DETAILS',
  )?.serviceReference ?? null;
}

function serviceDescription(name: string, description: string | null, tenantName: string) {
  const supplied = description?.replace(/\s+/g, ' ').trim();
  return supplied || `Find out about ${name} at ${tenantName} and check current appointment availability.`;
}

function currencyPrice(minor: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(Math.max(0, minor) / 100);
}

export class SiteServicePageService {
  private readonly entitlements: SiteEntitlementService;

  constructor(
    private readonly database: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
  ) {
    this.entitlements = new SiteEntitlementService(database);
  }

  async list(siteReference: string) {
    const context = await this.context(siteReference);
    const source = await this.sourceSnapshot(context.siteId);
    if (!source) {
      return {
        siteReference,
        liveDataSync: true,
        allocation: context.publishedVersionId ? 'MONTHLY' : 'INITIAL',
        allowanceRemaining: 0,
        items: [],
      };
    }
    const snapshot = validatePublishedSnapshot(source.content);
    const existing = new Map(snapshot.pages
      .filter(page => page.pageType === 'SERVICE_DETAIL')
      .map(page => [serviceReferenceFromPage(page), page])
      .filter((entry): entry is [string, PublishedPageSnapshot] => Boolean(entry[0])));
    const summary = await this.entitlements.forVersion(
      context.tenantId,
      context.siteId,
      source.versionId,
    );
    const allocation = context.publishedVersionId ? 'MONTHLY' as const : 'INITIAL' as const;
    const remaining = allocation === 'MONTHLY' ? summary.monthly.remaining : summary.initial.remaining;
    const rows = await this.database.select({
      reference: services.publicReference,
      name: services.name,
      description: services.description,
      duration: services.duration,
      price: services.price,
      discount: services.discount,
      createdAt: services.createdAt,
      updatedAt: services.updatedAt,
    }).from(services).where(and(
      eq(services.tenantId, context.tenantId),
      eq(services.isActive, true),
    )).orderBy(desc(services.createdAt));

    return {
      siteReference,
      liveDataSync: true,
      allocation,
      allowanceRemaining: remaining,
      items: rows.map(service => {
        const page = existing.get(service.reference);
        return {
          serviceReference: service.reference,
          name: service.name,
          description: service.description,
          durationMinutes: service.duration,
          priceMinor: Math.max(0, service.price - service.discount),
          pageStatus: page ? 'PAGE_EXISTS' as const : 'READY_TO_PROVISION' as const,
          pageReference: page?.publicReference ?? null,
          pagePath: page?.path ?? null,
          canProvision: !page && remaining > 0,
          createdAt: service.createdAt,
          updatedAt: service.updatedAt,
        };
      }),
    };
  }

  async provision(actor: AgencyActor, siteReference: string, serviceReference: string) {
    const context = await this.context(siteReference);
    return this.database.transaction(async tx => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`service-page:${context.siteId}:${serviceReference}`}::text, 0)
        )
      `);
      const source = await this.sourceSnapshot(context.siteId, tx);
      if (!source) throw fail(409, 'SITE_PREVIEW_REQUIRED', 'Generate or publish the website before adding a service page.');
      const sourceSnapshot = validatePublishedSnapshot(source.content);
      const existingPage = sourceSnapshot.pages.find(page =>
        page.pageType === 'SERVICE_DETAIL' && serviceReferenceFromPage(page) === serviceReference);
      if (existingPage) {
        throw fail(409, 'SERVICE_PAGE_ALREADY_EXISTS', 'This service already has a website page.');
      }

      const [service] = await tx.select({
        id: services.id,
        reference: services.publicReference,
        name: services.name,
        description: services.description,
        duration: services.duration,
        price: services.price,
        discount: services.discount,
      }).from(services).where(and(
        eq(services.publicReference, serviceReference),
        eq(services.tenantId, context.tenantId),
        eq(services.isActive, true),
      )).limit(1);
      if (!service) throw fail(404, 'SERVICE_NOT_FOUND', 'The active service could not be found.');

      const allocation = context.publishedVersionId ? 'MONTHLY' as const : 'INITIAL' as const;
      const summary = await this.entitlements.forVersion(
        context.tenantId,
        context.siteId,
        source.versionId,
        new Date(),
        tx,
      );
      assertSitePageCreationAllowed({ pageType: 'SERVICE_DETAIL', allocation, summary });

      const layout = await this.serviceLayout(source.templateVersionId, tx);
      const [highest] = await tx.select({ value: max(siteVersions.versionNumber) })
        .from(siteVersions).where(eq(siteVersions.siteId, context.siteId));
      const [version] = await tx.insert(siteVersions).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        basedOnVersionId: source.versionId,
        versionNumber: Number(highest?.value ?? source.versionNumber) + 1,
        status: 'INTERNAL_REVIEW',
        changeSummary: `Add a dedicated page for ${service.name}.`,
        generationStatus: 'COMPLETE',
        generationProvenanceJson: {
          operation: 'MANUAL_SERVICE_PAGE_PROVISION',
          serviceReference,
          basedOnVersionReference: source.versionReference,
        },
        generationCompletedAt: new Date(),
        createdByAgencyUserId: actor.agencyUserId,
      }).returning({
        id: siteVersions.id,
        reference: siteVersions.publicReference,
        versionNumber: siteVersions.versionNumber,
      });

      const sourcePages = await tx.select().from(sitePages)
        .where(and(eq(sitePages.versionId, source.versionId), isNull(sitePages.archivedAt)))
        .orderBy(asc(sitePages.sortOrder));
      const sourceSections = await tx.select().from(siteSections)
        .where(eq(siteSections.versionId, source.versionId))
        .orderBy(asc(siteSections.pageId), asc(siteSections.sortOrder));
      const pageReferenceMap = new Map(sourcePages.map(page => [page.publicReference, randomUUID()]));
      const pageIdMap = new Map<string, string>();

      for (const page of sourcePages) {
        const [created] = await tx.insert(sitePages).values({
          publicReference: pageReferenceMap.get(page.publicReference)!,
          tenantId: context.tenantId,
          siteId: context.siteId,
          versionId: version.id,
          pageType: page.pageType,
          conversionRole: page.conversionRole,
          entitlementKind: page.entitlementKind,
          allocation: page.allocation,
          monthlyOpportunityId: null,
          templateLayoutId: page.templateLayoutId,
          title: page.title,
          navigationLabel: page.navigationLabel,
          slug: page.slug,
          sortOrder: page.sortOrder,
          seoTitle: page.seoTitle,
          seoDescription: page.seoDescription,
          seoJson: rewriteReferences(page.seoJson, pageReferenceMap),
          internalLinksJson: rewriteReferences(page.internalLinksJson, pageReferenceMap),
          structuredDataInputsJson: page.structuredDataInputsJson,
          assetRequirementsJson: page.assetRequirementsJson,
        }).returning({ id: sitePages.id });
        pageIdMap.set(page.id, created.id);
      }

      const sectionReferenceMap = new Map(sourceSections.map(section => [section.publicReference, randomUUID()]));
      for (const section of sourceSections) {
        const content = rewriteReferences(section.contentJson, pageReferenceMap) as Record<string, unknown>;
        const serviceReferences = Array.isArray(content.serviceReferences)
          ? content.serviceReferences.filter((value): value is string => typeof value === 'string')
          : null;
        const explicitServiceGrid = ['SERVICE_GRID', 'FEATURED_SERVICES'].includes(section.sectionType)
          && serviceReferences !== null;
        if (explicitServiceGrid && serviceReferences && !serviceReferences.includes(serviceReference)) {
          content.serviceReferences = [...serviceReferences, serviceReference];
        }
        if (typeof content.reference === 'string') {
          content.reference = sectionReferenceMap.get(section.publicReference)!;
        }
        await tx.insert(siteSections).values({
          publicReference: sectionReferenceMap.get(section.publicReference)!,
          tenantId: context.tenantId,
          siteId: context.siteId,
          versionId: version.id,
          pageId: pageIdMap.get(section.pageId)!,
          sectionKey: section.sectionKey,
          sectionType: section.sectionType,
          sortOrder: section.sortOrder,
          contentJson: content,
          actionsJson: rewriteReferences(section.actionsJson, pageReferenceMap),
        });
      }

      const existingSlugs = new Set(sourcePages.map(page => page.slug));
      const baseSlug = slugify(service.name);
      let slug = baseSlug;
      let suffix = 2;
      while (existingSlugs.has(slug)) slug = `${baseSlug.slice(0, 94)}-${suffix++}`;
      const pageReference = randomUUID();
      const newPageSortOrder = Math.max(-1, ...sourcePages.map(page => page.sortOrder)) + 1;
      const opportunity = allocation === 'MONTHLY'
        ? await this.monthlyOpportunity(tx, context, summary, service.reference, service.name)
        : null;
      const [newPage] = await tx.insert(sitePages).values({
        publicReference: pageReference,
        tenantId: context.tenantId,
        siteId: context.siteId,
        versionId: version.id,
        pageType: 'SERVICE_DETAIL',
        conversionRole: 'SERVICE_CONVERSION',
        entitlementKind: 'MARKETING',
        allocation,
        monthlyOpportunityId: opportunity?.id ?? null,
        templateLayoutId: layout.id,
        title: service.name,
        navigationLabel: service.name,
        slug,
        sortOrder: newPageSortOrder,
        seoTitle: `${service.name} | ${context.tenantName}`.slice(0, 70),
        seoDescription: serviceDescription(service.name, service.description, context.tenantName).slice(0, 170),
        seoJson: {},
        internalLinksJson: [],
        structuredDataInputsJson: [],
        assetRequirementsJson: [],
      }).returning({ id: sitePages.id });

      const headerTemplate = sourceSnapshot.pages.flatMap(page => page.sections)
        .find((section): section is Extract<SiteSection, { type: 'HEADER' }> => section.type === 'HEADER');
      const footerTemplate = sourceSnapshot.pages.flatMap(page => page.sections)
        .find((section): section is Extract<SiteSection, { type: 'FOOTER' }> => section.type === 'FOOTER');
      const body = serviceDescription(service.name, service.description, context.tenantName).slice(0, 4_000);
      const sections: SiteSection[] = [
        { ...(headerTemplate ? clone(headerTemplate) : { type: 'HEADER', primaryAction: { type: 'KS_OS_BOOKING', label: 'Book now' } }), reference: randomUUID() },
        {
          type: 'SERVICE_DETAILS',
          reference: randomUUID(),
          variant: 'split',
          heading: service.name,
          body,
          serviceReference,
          primaryAction: { type: 'KS_OS_BOOKING', label: `Book ${service.name}`.slice(0, 80), serviceReference },
        },
        {
          type: 'BOOKING_CTA',
          reference: randomUUID(),
          variant: 'featured',
          heading: `Check availability for ${service.name}`.slice(0, 240),
          body: 'Choose a current appointment time through the secure booking system.',
          primaryAction: { type: 'KS_OS_BOOKING', label: 'Check live availability', serviceReference },
        },
        { ...(footerTemplate ? clone(footerTemplate) : { type: 'FOOTER', primaryAction: { type: 'KS_OS_BOOKING', label: 'Book now' } }), reference: randomUUID() },
      ];
      for (const [index, section] of sections.entries()) {
        await tx.insert(siteSections).values({
          publicReference: section.reference,
          tenantId: context.tenantId,
          siteId: context.siteId,
          versionId: version.id,
          pageId: newPage.id,
          sectionKey: `service-${serviceReference}-${index + 1}`.slice(0, 120),
          sectionType: section.type,
          sortOrder: index,
          contentJson: section,
          actionsJson: sectionActions(section),
        });
      }

      if (opportunity) {
        await tx.update(monthlyPageOpportunities).set({
          sitePageId: newPage.id,
          status: 'IN_PROGRESS',
          approvedAt: new Date(),
        }).where(eq(monthlyPageOpportunities.id, opportunity.id));
      }

      const rewrittenSnapshot = rewriteReferences(clone(sourceSnapshot), pageReferenceMap) as PublishedSiteSnapshot;
      const snapshotPages = rewrittenSnapshot.pages.map(page => ({
        ...page,
        publicReference: pageReferenceMap.get(page.publicReference) ?? page.publicReference,
        sections: page.sections.map(section => ({
          ...section,
          reference: sectionReferenceMap.get(section.reference) ?? section.reference,
          ...(['SERVICE_GRID', 'FEATURED_SERVICES'].includes(section.type)
            && 'serviceReferences' in section
            && Array.isArray(section.serviceReferences)
            && !section.serviceReferences.includes(serviceReference)
            ? { serviceReferences: [...section.serviceReferences, serviceReference] }
            : {}),
        })),
      }));
      const serviceProfile = {
        publicReference: service.reference,
        name: service.name,
        shortDescription: body.slice(0, 500),
        durationMinutes: service.duration,
        priceText: currencyPrice(Math.max(0, service.price - service.discount), context.currency),
        bookingEnabled: true,
      };
      const newSnapshotReference = randomUUID();
      const nextSnapshot: PublishedSiteSnapshot = {
        ...rewrittenSnapshot,
        publicReference: newSnapshotReference,
        versionReference: version.reference,
        visibility: 'PREVIEW',
        versionStatus: 'INTERNAL_REVIEW',
        createdAt: new Date().toISOString(),
        publishedAt: null,
        navigation: {
          primary: rewrittenSnapshot.navigation.primary,
          footer: rewrittenSnapshot.navigation.footer,
          utility: rewrittenSnapshot.navigation.utility,
          legal: rewrittenSnapshot.navigation.legal,
        },
        services: rewrittenSnapshot.services.some(item => item.publicReference === serviceReference)
          ? rewrittenSnapshot.services.map(item => item.publicReference === serviceReference ? serviceProfile : item)
          : [...rewrittenSnapshot.services, serviceProfile],
        pages: [...snapshotPages, {
          publicReference: pageReference,
          pageType: 'SERVICE_DETAIL',
          conversionRole: 'SERVICE_CONVERSION',
          path: `/${slug}`,
          title: service.name,
          active: true,
          indexable: true,
          canonical: true,
          rendererKey: layout.rendererKey,
          rendererVersion: layout.rendererVersion,
          rendererStatus: 'READY',
          layoutReference: layout.reference,
          layoutStatus: 'APPROVED',
          templateVersionStatus: 'APPROVED',
          compatiblePageTypes: ['SERVICE_DETAIL'],
          seo: {
            title: `${service.name} | ${context.tenantName}`.slice(0, 70),
            description: body.slice(0, 170),
            canonicalPath: `/${slug}`,
            index: true,
            follow: true,
            openGraphTitle: service.name,
            openGraphDescription: body.slice(0, 200),
            twitterCard: 'summary_large_image',
          },
          sections,
        }],
      };
      const prepared = prepareSiteRenderSnapshotForStorage(nextSnapshot);
      await tx.insert(siteRenderSnapshots).values({
        publicReference: newSnapshotReference,
        tenantId: context.tenantId,
        siteId: context.siteId,
        siteVersionId: version.id,
        templateVersionId: source.templateVersionId,
        snapshotKind: 'PREVIEW',
        revision: 1,
        schemaVersion: prepared.schemaVersion,
        contentJson: prepared.content,
        contentDigestSha256: prepared.contentDigestSha256,
        sourceContentDigestSha256: prepared.contentDigestSha256,
        createdByAgencyUserId: actor.agencyUserId,
      });
      await tx.update(siteVersions).set({
        generationContentDigestSha256: prepared.contentDigestSha256,
        updatedAt: new Date(),
      }).where(eq(siteVersions.id, version.id));

      const [review] = await tx.insert(siteReviewCycles).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        siteVersionId: version.id,
        templateVersionId: source.templateVersionId,
        knowledgePackId: source.knowledgePackId,
        knowledgePackSemanticVersion: source.knowledgePackSemanticVersion,
        pinnedContentDigestSha256: prepared.contentDigestSha256,
        status: 'INTERNAL_REVIEW',
        reviewScope: 'PAGE',
        scopedPageId: newPage.id,
        reviewRevision: 1,
        agencyOwnerUserId: actor.agencyUserId,
        clientApprovalRequired: true,
        agencyApprovalRequired: true,
        openedAt: new Date(),
        createdByAgencyUserId: actor.agencyUserId,
      }).returning({ id: siteReviewCycles.id, reference: siteReviewCycles.publicReference });
      await tx.insert(siteReviewItems).values({
        reviewCycleId: review.id,
        targetType: 'PAGE',
        pageId: newPage.id,
        status: 'PENDING',
        requiredReviewerType: 'AGENCY',
        blocking: true,
        clientVisible: true,
        displayOrder: 1,
      });
      await this.audit.write(actor, 'SERVICE_PAGE_PROVISIONED', 'SITE_PAGE', pageReference, {
        tenantId: context.tenantId,
        category: 'WEBSITE',
        metadata: {
          siteReference,
          serviceReference,
          versionReference: version.reference,
          reviewReference: review.reference,
          allocation,
        },
        tx,
      });
      return {
        serviceReference,
        pageReference,
        pagePath: `/${slug}`,
        versionReference: version.reference,
        reviewReference: review.reference,
        status: 'INTERNAL_REVIEW' as const,
        liveSiteChanged: false,
        qualityRerunRequired: true,
      };
    });
  }

  private async context(siteReference: string) {
    const [row] = await this.database.select({
      siteId: sites.id,
      tenantId: sites.tenantId,
      tenantName: tenants.name,
      currency: tenants.currency,
      publishedVersionId: sites.publishedVersionId,
    }).from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .where(eq(sites.publicReference, siteReference))
      .limit(1);
    if (!row) throw fail(404, 'SITE_NOT_FOUND', 'The managed website could not be found.');
    return row;
  }

  private async sourceSnapshot(siteId: string, executor: Database | Transaction = this.database) {
    const [row] = await executor.select({
      content: siteRenderSnapshots.contentJson,
      versionId: siteVersions.id,
      versionReference: siteVersions.publicReference,
      versionNumber: siteVersions.versionNumber,
      templateVersionId: siteRenderSnapshots.templateVersionId,
      knowledgePackId: sql<string | null>`(
        select src.knowledge_pack_id from site_review_cycles src
        where src.site_version_id = ${siteVersions.id}
        order by src.review_revision desc limit 1
      )`,
      knowledgePackSemanticVersion: sql<string | null>`(
        select src.knowledge_pack_semantic_version from site_review_cycles src
        where src.site_version_id = ${siteVersions.id}
        order by src.review_revision desc limit 1
      )`,
    }).from(siteRenderSnapshots)
      .innerJoin(siteVersions, eq(siteRenderSnapshots.siteVersionId, siteVersions.id))
      .where(and(
        eq(siteRenderSnapshots.siteId, siteId),
        inArray(siteRenderSnapshots.snapshotKind, ['PREVIEW', 'PUBLISHED']),
      ))
      .orderBy(desc(siteVersions.versionNumber), desc(siteRenderSnapshots.revision))
      .limit(1);
    return row || null;
  }

  private async serviceLayout(templateVersionId: string, tx: Transaction) {
    const [row] = await tx.select({
      id: templateLayouts.id,
      reference: templateLayouts.publicReference,
      rendererKey: templateLayoutRenderers.rendererKey,
      rendererVersion: templateLayoutRenderers.rendererVersion,
    }).from(templateLayouts)
      .innerJoin(templateVersions, eq(templateLayouts.templateVersionId, templateVersions.id))
      .innerJoin(templateLayoutPageTypes, eq(templateLayoutPageTypes.templateLayoutId, templateLayouts.id))
      .innerJoin(templateLayoutRenderers, eq(templateLayoutRenderers.templateLayoutId, templateLayouts.id))
      .where(and(
        eq(templateLayouts.templateVersionId, templateVersionId),
        eq(templateLayouts.status, 'APPROVED'),
        eq(templateVersions.status, 'APPROVED'),
        eq(templateLayoutPageTypes.pageType, 'SERVICE_DETAIL'),
        eq(templateLayoutRenderers.rendererStatus, 'READY'),
        isNull(templateLayouts.disabledAt),
      )).orderBy(desc(templateLayouts.classificationConfidenceBp)).limit(1);
    if (!row?.rendererKey || !row.rendererVersion) {
      throw fail(409, 'SERVICE_PAGE_LAYOUT_UNAVAILABLE', 'The current website template has no approved service-page renderer.');
    }
    return { ...row, rendererKey: row.rendererKey, rendererVersion: row.rendererVersion };
  }

  private async monthlyOpportunity(
    tx: Transaction,
    context: Awaited<ReturnType<SiteServicePageService['context']>>,
    summary: SiteEntitlementSummary,
    serviceReference: string,
    serviceName: string,
  ) {
    const now = new Date();
    const { periodStart, periodEnd } = monthPeriod(now);
    const assignment = await this.entitlements.activePlanAssignment(context.tenantId, now, tx);
    await tx.insert(monthlyPageEntitlements).values({
      tenantId: context.tenantId,
      siteId: context.siteId,
      planAssignmentId: assignment.id,
      periodStart,
      periodEnd,
      allowance: summary.monthly.allowance,
      status: 'OPEN',
    }).onConflictDoNothing();
    const [entitlement] = await tx.select({ id: monthlyPageEntitlements.id })
      .from(monthlyPageEntitlements).where(and(
        eq(monthlyPageEntitlements.siteId, context.siteId),
        eq(monthlyPageEntitlements.periodStart, periodStart),
      )).limit(1);
    if (!entitlement) throw fail(409, 'MONTHLY_PAGE_ENTITLEMENT_REQUIRED', 'The current monthly page allowance is unavailable.');
    const source = `SERVICE:${serviceReference}`;
    const [existing] = await tx.select({ id: monthlyPageOpportunities.id })
      .from(monthlyPageOpportunities).where(and(
        eq(monthlyPageOpportunities.tenantId, context.tenantId),
        eq(monthlyPageOpportunities.siteId, context.siteId),
        eq(monthlyPageOpportunities.source, source),
        isNull(monthlyPageOpportunities.sitePageId),
      )).orderBy(desc(monthlyPageOpportunities.createdAt)).limit(1);
    if (existing) return existing;
    const [created] = await tx.insert(monthlyPageOpportunities).values({
      tenantId: context.tenantId,
      siteId: context.siteId,
      monthlyEntitlementId: entitlement.id,
      status: 'APPROVED',
      topic: serviceName.slice(0, 240),
      source,
      approvedAt: now,
    }).returning({ id: monthlyPageOpportunities.id });
    return created;
  }
}
