import {
  and,
  asc,
  desc,
  eq,
  getDatabase,
  inArray,
  isNull,
  siteChangeProposals,
  siteImpactAssessments,
  siteLiveCampaigns,
  siteOperationalChangeEvents,
  sitePageSeoBriefs,
  sitePublicationPointers,
  siteRenderSnapshots,
  sites,
  siteVersions,
  tenants,
} from '@ks-os/database';
import {
  LIVE_SITE_CACHE_POLICIES,
  LiveSiteDataResolver,
  SiteChangeProposalSchema,
  SiteImpactAssessmentSchema,
  assessSiteImpact,
  evaluateLiveRule,
  type SiteImpactPageContext,
  type SiteOperationalChange,
} from '@ks-os/live-site-intelligence';
import { DrizzleLiveSiteDataSource } from '@ks-os/live-site-intelligence/database';
import { componentForSection } from '@ks-os/site-components';
import {
  validatePublishedSnapshot,
  type PublishedSiteSnapshot,
  type SiteSection,
} from '@ks-os/site-schema';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';

type Database = ReturnType<typeof getDatabase>;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function sectionEntityReferences(section: SiteSection) {
  if (section.type === 'FEATURED_SERVICES' || section.type === 'SERVICE_GRID') return section.serviceReferences;
  if (section.type === 'SERVICE_DETAILS') return [section.serviceReference];
  if (section.type === 'TEAM') return section.staffReferences;
  if (section.type === 'STAFF_PROFILE') return [section.staffReference];
  if (section.type === 'LOCATION' || section.type === 'OPENING_HOURS') return [section.locationReference];
  if (section.type === 'CONTACT' && section.locationReference) return [section.locationReference];
  return [];
}

function internalPageTargets(value: unknown, output = new Set<string>()) {
  if (Array.isArray(value)) {
    value.forEach(item => internalPageTargets(item, output));
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.type === 'INTERNAL_PAGE' && typeof record.pageReference === 'string') {
      output.add(record.pageReference);
    }
    Object.values(record).forEach(item => internalPageTargets(item, output));
  }
  return output;
}

function pageContexts(
  snapshot: PublishedSiteSnapshot,
  seoBriefByPage: ReadonlyMap<string, string>,
): SiteImpactPageContext[] {
  return snapshot.pages.map(page => ({
    pageReference: page.publicReference,
    path: page.path,
    pageType: page.pageType,
    entityReferences: [...new Set(page.sections.flatMap(sectionEntityReferences))],
    structuredDataTypes: [...(page.structuredDataEligibility ?? [])],
    internalLinkTargets: [...internalPageTargets(page.sections)],
    ...(seoBriefByPage.get(page.publicReference)
      ? { seoBriefReference: seoBriefByPage.get(page.publicReference)! }
      : {}),
  }));
}

export interface CreateLiveCampaignInput {
  message: string;
  placement: 'ANNOUNCEMENT' | 'HERO' | 'PAGE_BODY' | 'PAGE_END';
  actionLabel: string;
  serviceReference?: string;
  locationReference?: string;
  staffReference?: string;
  startsAt: string;
  endsAt: string;
}

export class LiveSiteIntelligenceService {
  private readonly resolver: LiveSiteDataResolver;

  constructor(
    private readonly database: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
  ) {
    this.resolver = new LiveSiteDataResolver(new DrizzleLiveSiteDataSource(database));
  }

  private async context(siteReference: string) {
    const [row] = await this.database.select({
      tenantId: tenants.id,
      tenantReference: tenants.businessReference,
      siteId: sites.id,
      siteReference: sites.publicReference,
    }).from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .where(eq(sites.publicReference, siteReference)).limit(1);
    if (!row) throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    return row;
  }

  private async publishedSnapshot(siteId: string) {
    const [row] = await this.database.select({
      snapshotReference: siteRenderSnapshots.publicReference,
      content: siteRenderSnapshots.contentJson,
      versionReference: siteVersions.publicReference,
    }).from(sitePublicationPointers)
      .innerJoin(siteRenderSnapshots, eq(sitePublicationPointers.activeSnapshotId, siteRenderSnapshots.id))
      .innerJoin(siteVersions, eq(siteRenderSnapshots.siteVersionId, siteVersions.id))
      .where(eq(sitePublicationPointers.siteId, siteId)).limit(1);
    return row ? { ...row, snapshot: validatePublishedSnapshot(row.content) } : null;
  }

  async get(siteReference: string) {
    const context = await this.context(siteReference);
    const published = await this.publishedSnapshot(context.siteId);
    const [events, assessments, proposals, campaigns] = await Promise.all([
      this.database.select({
        reference: siteOperationalChangeEvents.publicReference,
        entityType: siteOperationalChangeEvents.entityType,
        entityReference: siteOperationalChangeEvents.entityReference,
        kind: siteOperationalChangeEvents.changeKind,
        changedFields: siteOperationalChangeEvents.changedFields,
        occurredAt: siteOperationalChangeEvents.occurredAt,
        processedAt: siteOperationalChangeEvents.processedAt,
      }).from(siteOperationalChangeEvents)
        .where(eq(siteOperationalChangeEvents.siteId, context.siteId))
        .orderBy(desc(siteOperationalChangeEvents.occurredAt)).limit(100),
      this.database.select({
        reference: siteImpactAssessments.publicReference,
        classification: siteImpactAssessments.classification,
        assessment: siteImpactAssessments.assessmentJson,
        createdAt: siteImpactAssessments.createdAt,
      }).from(siteImpactAssessments)
        .where(eq(siteImpactAssessments.siteId, context.siteId))
        .orderBy(desc(siteImpactAssessments.createdAt)).limit(100),
      this.database.select({
        reference: siteChangeProposals.publicReference,
        assessmentReference: siteImpactAssessments.publicReference,
        status: siteChangeProposals.status,
        summary: siteChangeProposals.summary,
        affectedPageReferences: siteChangeProposals.affectedPageReferencesJson,
        recommendations: siteChangeProposals.recommendationsJson,
        requiresHumanApproval: siteChangeProposals.requiresHumanApproval,
        createdAt: siteChangeProposals.createdAt,
      }).from(siteChangeProposals)
        .innerJoin(siteImpactAssessments, eq(siteChangeProposals.assessmentId, siteImpactAssessments.id))
        .where(eq(siteChangeProposals.siteId, context.siteId))
        .orderBy(desc(siteChangeProposals.createdAt)).limit(100),
      this.database.select({
        reference: siteLiveCampaigns.publicReference,
        status: siteLiveCampaigns.status,
        message: siteLiveCampaigns.message,
        placement: siteLiveCampaigns.placement,
        startsAt: siteLiveCampaigns.startsAt,
        endsAt: siteLiveCampaigns.endsAt,
      }).from(siteLiveCampaigns)
        .where(eq(siteLiveCampaigns.siteId, context.siteId))
        .orderBy(desc(siteLiveCampaigns.createdAt)).limit(100),
    ]);

    const live = published
      ? await this.resolver.resolve({
        siteReference,
        tenantReference: context.tenantReference,
        serviceReferences: published.snapshot.services.map(item => item.publicReference),
        staffReferences: published.snapshot.staff.map(item => item.publicReference),
        locationReferences: published.snapshot.locations.map(item => item.publicReference),
      })
      : null;
    const componentBindings = published?.snapshot.pages.flatMap(page => page.sections.map(section => {
      const component = componentForSection(section, page);
      return {
        pageReference: page.publicReference,
        pagePath: page.path,
        sectionReference: section.reference,
        sectionType: section.type,
        componentKey: component.componentKey,
        source: 'PUBLISHED' as const,
        liveDataCapabilities: component.liveDataCapabilities,
        liveContentSlots: component.liveContentSlots,
        supportedConditions: component.supportedConditions,
        rule: section.showIf ?? null,
        ruleState: section.showIf ? evaluateLiveRule(section.showIf, live ?? undefined) : null,
        fallbackBehaviour: component.fallbackBehaviour,
        cacheClass: component.cacheClass,
        personalisationMode: component.personalisationMode,
        seoImpact: component.seoImpact,
      };
    })) ?? [];

    return {
      dataClasses: {
        published: 'Reviewed immutable snapshot content and stable SEO strategy.',
        live: 'Anonymous-safe operational facts resolved server-side through one governed DTO.',
        personal: 'Reserved for authenticated private requests; excluded from public output and shared caches.',
      },
      published: published ? {
        snapshotReference: published.snapshotReference,
        versionReference: published.versionReference,
        immutable: true,
        pageCount: published.snapshot.pages.length,
      } : null,
      live,
      cachePolicies: LIVE_SITE_CACHE_POLICIES,
      componentBindings,
      events: events.map(event => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
        processedAt: event.processedAt?.toISOString() ?? null,
      })),
      assessments: assessments.map(row => ({
        reference: row.reference,
        classification: row.classification,
        assessment: SiteImpactAssessmentSchema.parse(row.assessment),
        createdAt: row.createdAt.toISOString(),
      })),
      proposals: proposals.map(row => SiteChangeProposalSchema.parse({
        publicReference: row.reference,
        siteReference,
        assessmentReference: row.assessmentReference,
        status: row.status,
        summary: row.summary,
        affectedPageReferences: row.affectedPageReferences,
        recommendations: row.recommendations,
        requiresHumanApproval: row.requiresHumanApproval,
      })),
      campaigns: campaigns.map(campaign => ({
        ...campaign,
        startsAt: campaign.startsAt.toISOString(),
        endsAt: campaign.endsAt.toISOString(),
      })),
    };
  }

  async processPendingChanges(actor: AgencyActor, siteReference: string) {
    const context = await this.context(siteReference);
    const published = await this.publishedSnapshot(context.siteId);
    if (!published) throw fail(409, 'PUBLISHED_SNAPSHOT_REQUIRED', 'Impact analysis requires a published snapshot.');
    const [briefRows, pending] = await Promise.all([
      this.database.select({
        reference: sitePageSeoBriefs.publicReference,
        pageReference: sitePageSeoBriefs.pageReference,
      }).from(sitePageSeoBriefs).where(and(
        eq(sitePageSeoBriefs.siteId, context.siteId),
        eq(sitePageSeoBriefs.status, 'APPROVED'),
      )),
      this.database.select().from(siteOperationalChangeEvents)
        .where(and(
          eq(siteOperationalChangeEvents.siteId, context.siteId),
          isNull(siteOperationalChangeEvents.processedAt),
        )).orderBy(asc(siteOperationalChangeEvents.occurredAt)).limit(100),
    ]);
    const contexts = pageContexts(
      published.snapshot,
      new Map(briefRows.map(row => [row.pageReference, row.reference])),
    );
    const results = [];
    for (const row of pending) {
      const change: SiteOperationalChange = {
        publicReference: row.publicReference,
        tenantReference: context.tenantReference,
        siteReference,
        entityType: row.entityType as SiteOperationalChange['entityType'],
        entityReference: row.entityReference,
        kind: row.changeKind as SiteOperationalChange['kind'],
        changedFields: row.changedFields,
        occurredAt: row.occurredAt.toISOString(),
      };
      const assessment = assessSiteImpact({ change, pages: contexts });
      const result = await this.database.transaction(async tx => {
        const [claimed] = await tx.update(siteOperationalChangeEvents)
          .set({ processedAt: new Date() })
          .where(and(
            eq(siteOperationalChangeEvents.id, row.id),
            isNull(siteOperationalChangeEvents.processedAt),
          ))
          .returning({ id: siteOperationalChangeEvents.id });
        if (!claimed) return null;
        const [created] = await tx.insert(siteImpactAssessments).values({
          tenantId: context.tenantId,
          siteId: context.siteId,
          changeEventId: row.id,
          classification: assessment.classification,
          assessmentJson: assessment,
        }).returning({ id: siteImpactAssessments.id, reference: siteImpactAssessments.publicReference });
        let proposalReference: string | null = null;
        if (assessment.classification === 'REQUIRE_SITE_REVIEW') {
          const [proposal] = await tx.insert(siteChangeProposals).values({
            tenantId: context.tenantId,
            siteId: context.siteId,
            assessmentId: created.id,
            summary: `${change.kind.replaceAll('_', ' ')} requires a governed published-site review.`,
            affectedPageReferencesJson: assessment.affectedPages.map(page => page.pageReference),
            recommendationsJson: assessment.recommendedPublishedChanges,
            requiresHumanApproval: true,
          }).returning({ reference: siteChangeProposals.publicReference });
          proposalReference = proposal.reference;
        }
        return { assessmentReference: created.reference, proposalReference, classification: assessment.classification };
      });
      if (result) results.push(result);
    }
    await this.audit.write(actor, 'SITE_LIVE_IMPACT_QUEUE_PROCESSED', 'SITE', siteReference, {
      tenantId: context.tenantId,
      category: 'WEBSITE',
      metadata: { processedCount: results.length },
    });
    return { processedCount: results.length, results };
  }

  async createCampaign(actor: AgencyActor, siteReference: string, input: CreateLiveCampaignInput) {
    const context = await this.context(siteReference);
    const [created] = await this.database.insert(siteLiveCampaigns).values({
      tenantId: context.tenantId,
      siteId: context.siteId,
      status: 'DRAFT',
      audience: 'PUBLIC',
      message: input.message,
      placement: input.placement,
      actionLabel: input.actionLabel,
      serviceReference: input.serviceReference ?? null,
      locationReference: input.locationReference ?? null,
      staffReference: input.staffReference ?? null,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      createdByAgencyUserId: actor.agencyUserId,
    }).returning({ reference: siteLiveCampaigns.publicReference, status: siteLiveCampaigns.status });
    await this.audit.write(actor, 'SITE_LIVE_CAMPAIGN_DRAFT_CREATED', 'SITE_LIVE_CAMPAIGN', created.reference, {
      tenantId: context.tenantId,
      category: 'WEBSITE',
      metadata: { siteReference, placement: input.placement },
    });
    return created;
  }

  async approveCampaign(actor: AgencyActor, siteReference: string, campaignReference: string) {
    const context = await this.context(siteReference);
    const [updated] = await this.database.update(siteLiveCampaigns).set({
      status: 'APPROVED',
      approvedByAgencyUserId: actor.agencyUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(siteLiveCampaigns.siteId, context.siteId),
      eq(siteLiveCampaigns.publicReference, campaignReference),
      eq(siteLiveCampaigns.status, 'DRAFT'),
    )).returning({ reference: siteLiveCampaigns.publicReference, status: siteLiveCampaigns.status });
    if (!updated) throw fail(409, 'LIVE_CAMPAIGN_NOT_APPROVABLE', 'Only a draft campaign owned by this site can be approved.');
    await this.audit.write(actor, 'SITE_LIVE_CAMPAIGN_APPROVED', 'SITE_LIVE_CAMPAIGN', campaignReference, {
      tenantId: context.tenantId,
      category: 'WEBSITE',
      metadata: { siteReference },
    });
    return updated;
  }

  async reviewProposal(
    actor: AgencyActor,
    siteReference: string,
    proposalReference: string,
    decision: 'APPROVED' | 'REJECTED',
  ) {
    const context = await this.context(siteReference);
    const [updated] = await this.database.update(siteChangeProposals).set({
      status: decision,
      reviewedByAgencyUserId: actor.agencyUserId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(siteChangeProposals.siteId, context.siteId),
      eq(siteChangeProposals.publicReference, proposalReference),
      inArray(siteChangeProposals.status, ['DRAFT', 'IN_REVIEW']),
    )).returning({ reference: siteChangeProposals.publicReference, status: siteChangeProposals.status });
    if (!updated) throw fail(409, 'SITE_CHANGE_PROPOSAL_NOT_REVIEWABLE', 'Only an in-review proposal owned by this site can be reviewed.');
    await this.audit.write(actor, `SITE_CHANGE_PROPOSAL_${decision}`, 'SITE_CHANGE_PROPOSAL', proposalReference, {
      tenantId: context.tenantId,
      category: 'WEBSITE',
      metadata: { siteReference, appliesPublishedChange: false },
    });
    return updated;
  }
}
