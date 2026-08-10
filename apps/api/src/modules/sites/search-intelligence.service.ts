import { and, desc, eq } from 'drizzle-orm';
import {
  agencyUsers,
  getDatabase,
  siteBlueprintPages,
  siteBlueprints,
  sitePageSeoBriefs,
  siteSearchInternalLinks,
  siteSearchResearchEvidence,
  siteSearchStrategies,
  siteSearchTopicOwnership,
  sites,
  tenants,
} from '@ks-os/database';
import {
  PageSeoBriefSchema,
  SearchIntelligenceStrategyV2Schema,
  SearchResearchEvidenceSchema,
  pageSeoBriefDigest,
  searchStrategyDigest,
  validateSearchIntelligencePlan,
  type PageSeoBrief,
  type SearchIntelligenceStrategyV2,
  type SearchResearchEvidence,
} from '@ks-os/site-generation';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';

type Database = ReturnType<typeof getDatabase>;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export interface SearchIntelligenceBundle {
  strategy: SearchIntelligenceStrategyV2;
  briefs: readonly PageSeoBrief[];
  evidence: readonly SearchResearchEvidence[];
}

export class SearchIntelligenceService {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
  ) {}

  async createDraft(actor: AgencyActor, siteReference: string, input: SearchIntelligenceBundle) {
    const strategy = SearchIntelligenceStrategyV2Schema.parse(input.strategy);
    const briefs = input.briefs.map(brief => PageSeoBriefSchema.parse(brief));
    const evidence = input.evidence.map(item => SearchResearchEvidenceSchema.parse(item));
    if (strategy.status !== 'DRAFT' || briefs.some(brief => brief.status !== 'DRAFT')) {
      throw fail(409, 'SEARCH_INTELLIGENCE_MUST_START_DRAFT', 'Imported strategies and page briefs must start in DRAFT status.');
    }
    if (searchStrategyDigest(strategy) !== strategy.provenance.outputDigestSha256
      || briefs.some(brief => pageSeoBriefDigest(brief) !== brief.provenance.outputDigestSha256)) {
      throw fail(409, 'SEARCH_INTELLIGENCE_DIGEST_MISMATCH', 'Strategy and brief digests must match their governed content.');
    }
    const [context] = await this.database.select({
      tenantId: tenants.id,
      siteId: sites.id,
      blueprintId: siteBlueprints.id,
      blueprintReference: siteBlueprints.publicReference,
      blueprintRevision: siteBlueprints.revision,
      blueprintStatus: siteBlueprints.status,
    }).from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .innerJoin(siteBlueprints, and(
        eq(siteBlueprints.siteId, sites.id),
        eq(siteBlueprints.publicReference, strategy.blueprintReference),
      ))
      .where(eq(sites.publicReference, siteReference))
      .limit(1);
    if (!context || context.blueprintStatus !== 'APPROVED') {
      throw fail(409, 'SEARCH_INTELLIGENCE_BLUEPRINT_NOT_APPROVED', 'The strategy requires an approved blueprint owned by this site.');
    }
    if (strategy.siteReference !== siteReference
      || strategy.blueprintReference !== context.blueprintReference
      || strategy.blueprintRevision !== context.blueprintRevision) {
      throw fail(409, 'SEARCH_INTELLIGENCE_SCOPE_MISMATCH', 'Strategy provenance does not match the selected site and blueprint revision.');
    }
    const pages = await this.database.select({
      id: siteBlueprintPages.id,
      blueprintPageReference: siteBlueprintPages.publicReference,
      pageType: siteBlueprintPages.pageType,
    }).from(siteBlueprintPages).where(and(
      eq(siteBlueprintPages.tenantId, context.tenantId),
      eq(siteBlueprintPages.blueprintId, context.blueprintId),
    ));
    const pageIdByReference = new Map(pages.map(page => [page.blueprintPageReference, page.id]));
    if (briefs.length !== pages.length
      || briefs.some(brief => !pageIdByReference.has(brief.blueprintPageReference))) {
      throw fail(409, 'SEARCH_INTELLIGENCE_PAGE_SET_MISMATCH', 'Exactly one draft brief is required for every approved blueprint page.');
    }
    const evidenceReferences = new Set(evidence.map(item => item.reference));
    if (strategy.provenance.researchEvidenceReferences.some(reference => !evidenceReferences.has(reference))) {
      throw fail(409, 'SEARCH_INTELLIGENCE_EVIDENCE_MISSING', 'Every research evidence reference must be supplied with the draft.');
    }
    if (strategy.serpAnalyses.some(analysis => !evidenceReferences.has(analysis.evidenceReference))) {
      throw fail(409, 'SEARCH_INTELLIGENCE_SERP_EVIDENCE_MISSING', 'Every SERP analysis must bind to supplied provider evidence.');
    }
    const pageReferences = new Set(briefs.map(brief => brief.pageReference));
    if (pageReferences.size !== pages.length
      || strategy.pageOpportunityMap.some(item => !pageReferences.has(item.pageReference))) {
      throw fail(409, 'SEARCH_INTELLIGENCE_PAGE_IDENTITY_INVALID', 'Page opportunities and briefs must share the exact stable page identity set.');
    }

    return this.database.transaction(async tx => {
      const [created] = await tx.insert(siteSearchStrategies).values({
        publicReference: strategy.reference,
        tenantId: context.tenantId,
        siteId: context.siteId,
        blueprintId: context.blueprintId,
        blueprintRevision: strategy.blueprintRevision,
        strategyVersion: strategy.strategyVersion,
        status: 'DRAFT',
        strategyJson: strategy,
        inputDigestSha256: strategy.provenance.inputDigestSha256,
        researchDigestSha256: strategy.provenance.researchDigestSha256,
        outputDigestSha256: strategy.provenance.outputDigestSha256,
        providerKey: strategy.provenance.providerKey,
        modelKey: strategy.provenance.modelKey,
        generatedAt: new Date(strategy.provenance.generatedAt),
        generatedByAgencyUserId: actor.agencyUserId,
      }).returning({ id: siteSearchStrategies.id, reference: siteSearchStrategies.publicReference });

      if (evidence.length) {
        await tx.insert(siteSearchResearchEvidence).values(evidence.map(item => ({
          publicReference: item.reference,
          tenantId: context.tenantId,
          siteId: context.siteId,
          strategyId: created.id,
          providerKey: item.providerKey,
          query: item.query,
          market: item.market,
          locale: item.locale,
          searchLocation: item.location,
          language: item.language,
          device: item.device,
          capturedAt: new Date(item.capturedAt),
          expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
          sourceUrl: item.sourceUrl ?? null,
          sourceDigestSha256: item.sourceDigestSha256,
          payloadDigestSha256: item.payloadDigestSha256,
          notesJson: item.notes,
        })));
      }
      await tx.insert(sitePageSeoBriefs).values(briefs.map(brief => ({
        publicReference: brief.reference,
        tenantId: context.tenantId,
        siteId: context.siteId,
        blueprintId: context.blueprintId,
        blueprintPageId: pageIdByReference.get(brief.blueprintPageReference)!,
        strategyId: created.id,
        pageReference: brief.pageReference,
        briefVersion: brief.briefVersion,
        status: 'DRAFT',
        briefJson: brief,
        outputDigestSha256: brief.provenance.outputDigestSha256,
      })));
      await tx.insert(siteSearchTopicOwnership).values(briefs.map(brief => ({
        tenantId: context.tenantId,
        siteId: context.siteId,
        strategyId: created.id,
        topicClusterKey: brief.topicClusterKey,
        pageReference: brief.pageReference,
        primaryKeyword: brief.primaryKeyword,
        intentionalOverlap: false,
      })));
      const links = briefs.flatMap(brief => brief.internalLinks.map(link => ({
        tenantId: context.tenantId,
        siteId: context.siteId,
        strategyId: created.id,
        sourcePageReference: brief.pageReference,
        targetPageReference: link.targetPageReference,
        anchorText: link.anchorText,
        purpose: link.purpose,
      })));
      if (links.length) await tx.insert(siteSearchInternalLinks).values(links);
      await this.audit.write(actor, 'SITE_SEARCH_INTELLIGENCE_DRAFT_CREATED', 'SITE_SEARCH_STRATEGY', created.reference, {
        tenantId: context.tenantId,
        category: 'WEBSITE',
        metadata: {
          siteReference,
          blueprintReference: context.blueprintReference,
          blueprintRevision: context.blueprintRevision,
          strategyVersion: strategy.strategyVersion,
          pageCount: briefs.length,
          providerKey: strategy.provenance.providerKey,
          modelKey: strategy.provenance.modelKey,
        },
        tx,
      });
      return { reference: created.reference, status: 'DRAFT' as const, pageCount: briefs.length };
    });
  }

  async get(siteReference: string, strategyReference?: string) {
    const conditions = [eq(sites.publicReference, siteReference)];
    if (strategyReference) conditions.push(eq(siteSearchStrategies.publicReference, strategyReference));
    const [strategy] = await this.database.select({
      id: siteSearchStrategies.id,
      reference: siteSearchStrategies.publicReference,
      status: siteSearchStrategies.status,
      value: siteSearchStrategies.strategyJson,
      outputDigestSha256: siteSearchStrategies.outputDigestSha256,
      approvedAt: siteSearchStrategies.approvedAt,
    }).from(siteSearchStrategies)
      .innerJoin(sites, eq(siteSearchStrategies.siteId, sites.id))
      .where(and(...conditions))
      .orderBy(desc(siteSearchStrategies.createdAt))
      .limit(1);
    if (!strategy) throw fail(404, 'SEARCH_INTELLIGENCE_NOT_FOUND', 'No search strategy was found for this site.');
    const [briefs, evidence] = await Promise.all([
      this.database.select({ value: sitePageSeoBriefs.briefJson, status: sitePageSeoBriefs.status })
        .from(sitePageSeoBriefs).where(eq(sitePageSeoBriefs.strategyId, strategy.id)),
      this.database.select({
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
      }).from(siteSearchResearchEvidence).where(eq(siteSearchResearchEvidence.strategyId, strategy.id)),
    ]);
    const now = Date.now();
    return {
      strategy: strategy.value,
      briefs: briefs.map(item => item.value),
      evidence,
      status: strategy.status,
      outputDigestSha256: strategy.outputDigestSha256,
      approvedAt: strategy.approvedAt?.toISOString() ?? null,
      researchFreshness: {
        staleCount: evidence.filter(item => item.expiresAt && item.expiresAt.getTime() <= now).length,
        evidenceCount: evidence.length,
      },
    };
  }

  async updateDraftBriefMetadata(
    actor: AgencyActor,
    siteReference: string,
    strategyReference: string,
    briefReference: string,
    input: { recommendedTitle: string; recommendedMetaDescription: string },
  ) {
    const [row] = await this.database.select({
      id: sitePageSeoBriefs.id,
      tenantId: sitePageSeoBriefs.tenantId,
      strategyStatus: siteSearchStrategies.status,
      briefStatus: sitePageSeoBriefs.status,
      value: sitePageSeoBriefs.briefJson,
    }).from(sitePageSeoBriefs)
      .innerJoin(siteSearchStrategies, eq(sitePageSeoBriefs.strategyId, siteSearchStrategies.id))
      .innerJoin(sites, eq(sitePageSeoBriefs.siteId, sites.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteSearchStrategies.publicReference, strategyReference),
        eq(sitePageSeoBriefs.publicReference, briefReference),
      )).limit(1);
    if (!row) throw fail(404, 'PAGE_SEO_BRIEF_NOT_FOUND', 'No page SEO brief was found in this strategy.');
    if (row.strategyStatus !== 'DRAFT' || row.briefStatus !== 'DRAFT') {
      throw fail(409, 'APPROVED_PAGE_SEO_BRIEF_IMMUTABLE', 'Only a draft page SEO brief may be edited.');
    }
    const current = PageSeoBriefSchema.parse(row.value);
    const draft = PageSeoBriefSchema.parse({
      ...current,
      recommendedTitle: input.recommendedTitle,
      recommendedMetaDescription: input.recommendedMetaDescription,
    });
    const updated = PageSeoBriefSchema.parse({
      ...draft,
      provenance: {
        ...draft.provenance,
        outputDigestSha256: pageSeoBriefDigest(draft),
      },
    });
    await this.database.transaction(async tx => {
      await tx.update(sitePageSeoBriefs).set({
        briefJson: updated,
        outputDigestSha256: updated.provenance.outputDigestSha256,
        updatedAt: new Date(),
      }).where(and(
        eq(sitePageSeoBriefs.id, row.id),
        eq(sitePageSeoBriefs.status, 'DRAFT'),
      ));
      await this.audit.write(actor, 'SITE_PAGE_SEO_BRIEF_METADATA_UPDATED', 'SITE_PAGE_SEO_BRIEF', briefReference, {
        tenantId: row.tenantId,
        category: 'WEBSITE',
        metadata: { siteReference, strategyReference, pageReference: updated.pageReference },
        tx,
      });
    });
    return { brief: updated, status: 'DRAFT' as const };
  }

  async approve(actor: AgencyActor, siteReference: string, strategyReference: string) {
    const [agencyUser] = await this.database.select({ reference: agencyUsers.publicReference })
      .from(agencyUsers)
      .where(and(eq(agencyUsers.id, actor.agencyUserId), eq(agencyUsers.status, 'ACTIVE')))
      .limit(1);
    if (!agencyUser) throw fail(403, 'AGENCY_ACCESS_DENIED', 'The agency actor is not active.');
    const [row] = await this.database.select({
      id: siteSearchStrategies.id,
      tenantId: siteSearchStrategies.tenantId,
      siteId: siteSearchStrategies.siteId,
      blueprintId: siteSearchStrategies.blueprintId,
      status: siteSearchStrategies.status,
      value: siteSearchStrategies.strategyJson,
    }).from(siteSearchStrategies)
      .innerJoin(sites, eq(siteSearchStrategies.siteId, sites.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteSearchStrategies.publicReference, strategyReference),
      )).limit(1);
    if (!row) throw fail(404, 'SEARCH_INTELLIGENCE_NOT_FOUND', 'No search strategy was found for this site.');
    if (row.status === 'APPROVED') return { reference: strategyReference, status: 'APPROVED' as const, idempotentReplay: true };
    if (row.status !== 'DRAFT') throw fail(409, 'SEARCH_INTELLIGENCE_NOT_APPROVABLE', 'Only a draft strategy can be approved.');
    const [briefRows, pages] = await Promise.all([
      this.database.select({ id: sitePageSeoBriefs.id, value: sitePageSeoBriefs.briefJson })
        .from(sitePageSeoBriefs).where(eq(sitePageSeoBriefs.strategyId, row.id)),
      this.database.select({
        blueprintPageReference: siteBlueprintPages.publicReference,
        pageType: siteBlueprintPages.pageType,
      }).from(siteBlueprintPages).where(eq(siteBlueprintPages.blueprintId, row.blueprintId)),
    ]);
    const approvedAt = new Date();
    const approvedAtIso = approvedAt.toISOString();
    const approvedStrategy = SearchIntelligenceStrategyV2Schema.parse({
      ...(row.value as Record<string, unknown>),
      status: 'APPROVED',
      approvedAt: approvedAtIso,
      approvedByAgencyUserReference: agencyUser.reference,
    });
    const approvedBriefs = briefRows.map(brief => PageSeoBriefSchema.parse({
      ...(brief.value as Record<string, unknown>),
      status: 'APPROVED',
      approvedAt: approvedAtIso,
      approvedByAgencyUserReference: agencyUser.reference,
    }));
    const findings = validateSearchIntelligencePlan({
      strategy: approvedStrategy,
      briefs: approvedBriefs,
      plannedPages: pages.map(page => {
        const matching = approvedBriefs.find(brief => brief.blueprintPageReference === page.blueprintPageReference);
        return {
          blueprintPageReference: page.blueprintPageReference,
          pageReference: matching?.pageReference ?? '',
          pageType: page.pageType,
        };
      }),
    });
    const blocking = findings.filter(finding => finding.blocking);
    if (blocking.length) {
      throw fail(409, 'SEARCH_INTELLIGENCE_NOT_READY', `Approval is blocked by: ${blocking.map(item => item.code).join(', ')}.`);
    }

    return this.database.transaction(async tx => {
      for (const [index, briefRow] of briefRows.entries()) {
        const approved = approvedBriefs[index]!;
        await tx.update(sitePageSeoBriefs).set({
          status: 'APPROVED',
          briefJson: approved,
          approvedAt,
          approvedByAgencyUserId: actor.agencyUserId,
        }).where(and(eq(sitePageSeoBriefs.id, briefRow.id), eq(sitePageSeoBriefs.status, 'DRAFT')));
      }
      await tx.update(siteSearchStrategies).set({
        status: 'APPROVED',
        strategyJson: approvedStrategy,
        approvedAt,
        approvedByAgencyUserId: actor.agencyUserId,
      }).where(and(eq(siteSearchStrategies.id, row.id), eq(siteSearchStrategies.status, 'DRAFT')));
      await this.audit.write(actor, 'SITE_SEARCH_INTELLIGENCE_APPROVED', 'SITE_SEARCH_STRATEGY', strategyReference, {
        tenantId: row.tenantId,
        category: 'WEBSITE',
        metadata: { siteReference, pageCount: approvedBriefs.length, outputDigestSha256: searchStrategyDigest(approvedStrategy) },
        tx,
      });
      return { reference: strategyReference, status: 'APPROVED' as const, idempotentReplay: false };
    });
  }
}
