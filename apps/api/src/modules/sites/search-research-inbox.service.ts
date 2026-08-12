import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  getDatabase,
  sitePageSeoBriefs,
  siteSearchResearchEvidence,
  siteSearchResearchSources,
  siteSearchStrategies,
  sites,
  tenants,
} from '@ks-os/database';
import {
  PageSeoBriefSchema,
  SearchIntelligenceStrategyV2Schema,
  generationDigest,
  pageSeoBriefDigest,
  searchStrategyDigest,
  type PageSeoBrief,
  type SearchIntelligenceStrategyV2,
} from '@ks-os/site-generation';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';
import {
  extractSearchResearch,
  searchResearchFileMatchesMime,
  type ExtractedSearchResearch,
  type ExtractedSearchResearchRow,
} from './search-research-parser.js';

const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const supportedMimes = new Set([
  'text/csv',
  'text/plain',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const storageBucket = () => process.env.FACT_FINDING_STORAGE_BUCKET || 'private-fact-finding';

type Device = 'DESKTOP' | 'MOBILE';
export interface SearchResearchUploadInput {
  fileName: string;
  mimeType: string;
  byteSize: number;
  digestSha256: string;
  providerHint?: string;
  market: string;
  locale: string;
  location: string;
  language: string;
  device: Device;
  capturedAt?: string;
}

function keywordClasses(keyword: string, location: string): SearchIntelligenceStrategyV2['keywordUniverse'][number]['classes'] {
  const lower = keyword.toLocaleLowerCase();
  if (/^(who|what|when|where|why|how|can|does|is|are|should|which)\b/.test(lower) || keyword.endsWith('?')) return ['QUESTION'];
  if (lower.includes('near me') || (location && lower.includes(location.toLocaleLowerCase()))) return ['LOCAL'];
  if (/\b(price|cost|book|booking|buy|quote|appointment)\b/.test(lower)) return ['TRANSACTIONAL'];
  return [keyword.split(/\s+/).length >= 4 ? 'LONG_TAIL' : 'MID_TAIL'];
}
function keywordIntent(keyword: string, location: string): SearchIntelligenceStrategyV2['keywordUniverse'][number]['intent'] {
  const lower = keyword.toLocaleLowerCase();
  if (lower.includes('near me') || (location && lower.includes(location.toLocaleLowerCase()))) return 'LOCAL';
  if (/\b(book|booking|appointment|buy|order)\b/.test(lower)) return 'TRANSACTIONAL';
  if (/\b(price|cost|best|compare|reviews?|vs)\b/.test(lower)) return 'COMMERCIAL_INVESTIGATION';
  return 'INFORMATIONAL';
}
function tokens(value: string) {
  return new Set(value.toLocaleLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(token => token.length > 2));
}
function pageScore(keyword: string, brief: PageSeoBrief) {
  const source = tokens(keyword);
  const candidate = tokens(`${brief.primaryKeyword} ${brief.primaryTopic} ${brief.secondaryTopics.join(' ')}`);
  let score = 0;
  for (const token of source) if (candidate.has(token)) score += 1;
  return score;
}
function boundedProviderHint(value: string | undefined) {
  return (value || 'FILE_UPLOAD').trim().replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'FILE_UPLOAD';
}
function persistedPreview(extracted: ExtractedSearchResearch) {
  return {
    keywordCount: extracted.keywordCount,
    metricRowCount: extracted.metricRowCount,
    headers: extracted.headers,
    rows: extracted.rows,
    textPreview: extracted.textPreview,
    warnings: extracted.warnings,
  };
}

export class SearchResearchInboxService {
  private readonly db = getDatabase();
  private readonly audit = new AgencyAuditService();

  private async siteContext(siteReference: string) {
    const [context] = await this.db.select({
      siteId: sites.id,
      tenantId: tenants.id,
      tenantReference: tenants.agencyReference,
      tenantName: tenants.name,
    }).from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .where(eq(sites.publicReference, siteReference))
      .limit(1);
    if (!context) throw fail(404, 'SEARCH_RESEARCH_SITE_NOT_FOUND', 'Website was not found.');
    return context;
  }

  async list(siteReference: string) {
    const context = await this.siteContext(siteReference);
    const rows = await this.db.select({
      reference: siteSearchResearchSources.publicReference,
      fileName: siteSearchResearchSources.safeFilename,
      mimeType: siteSearchResearchSources.mimeType,
      byteSize: siteSearchResearchSources.byteSize,
      providerHint: siteSearchResearchSources.providerHint,
      market: siteSearchResearchSources.market,
      locale: siteSearchResearchSources.locale,
      location: siteSearchResearchSources.searchLocation,
      language: siteSearchResearchSources.language,
      device: siteSearchResearchSources.device,
      capturedAt: siteSearchResearchSources.capturedAt,
      status: siteSearchResearchSources.status,
      extracted: siteSearchResearchSources.extractedJson,
      extractedAt: siteSearchResearchSources.extractedAt,
      appliedAt: siteSearchResearchSources.appliedAt,
      rejectedAt: siteSearchResearchSources.rejectedAt,
      createdAt: siteSearchResearchSources.createdAt,
    }).from(siteSearchResearchSources)
      .where(and(eq(siteSearchResearchSources.siteId, context.siteId), eq(siteSearchResearchSources.tenantId, context.tenantId)))
      .orderBy(desc(siteSearchResearchSources.createdAt))
      .limit(100);
    return {
      tenantName: context.tenantName,
      siteReference,
      sources: rows.map(row => ({
        ...row,
        capturedAt: row.capturedAt.toISOString(),
        extractedAt: row.extractedAt?.toISOString() ?? null,
        appliedAt: row.appliedAt?.toISOString() ?? null,
        rejectedAt: row.rejectedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async initiate(actor: AgencyActor, siteReference: string, input: SearchResearchUploadInput) {
    if (!supportedMimes.has(input.mimeType)) throw fail(400, 'SEARCH_RESEARCH_FILE_TYPE_UNSUPPORTED', 'Upload CSV, XLSX, JSON, PDF or plain text research.');
    if (input.byteSize < 1 || input.byteSize > 20 * 1024 * 1024) throw fail(400, 'SEARCH_RESEARCH_FILE_SIZE_INVALID', 'Research files must be smaller than 20 MB.');
    if (!/^[a-f0-9]{64}$/.test(input.digestSha256)) throw fail(400, 'SEARCH_RESEARCH_DIGEST_INVALID', 'Research file digest is invalid.');
    const context = await this.siteContext(siteReference);
    const reference = randomUUID();
    const fileName = input.fileName.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 255);
    const bucket = storageBucket();
    const path = `${context.tenantReference}/search-research/${siteReference}/${reference}/${fileName}`;
    const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
    if (Number.isNaN(capturedAt.getTime())) throw fail(400, 'SEARCH_RESEARCH_CAPTURED_AT_INVALID', 'Research capture date is invalid.');

    const [source] = await this.db.insert(siteSearchResearchSources).values({
      publicReference: reference,
      tenantId: context.tenantId,
      siteId: context.siteId,
      uploadedByAgencyUserId: actor.agencyUserId,
      storageBucket: bucket,
      storagePath: path,
      safeFilename: fileName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      digestSha256: input.digestSha256,
      providerHint: boundedProviderHint(input.providerHint),
      market: input.market.trim(),
      locale: input.locale.trim(),
      searchLocation: input.location.trim(),
      language: input.language.trim(),
      device: input.device,
      capturedAt,
      status: 'PENDING_UPLOAD',
      extractedJson: {},
    }).returning();
    const { data, error } = await getSupabaseAdmin().storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) {
      await this.db.update(siteSearchResearchSources).set({ status: 'QUARANTINED', updatedAt: new Date() }).where(eq(siteSearchResearchSources.id, source.id));
      throw fail(503, 'SEARCH_RESEARCH_UPLOAD_UNAVAILABLE', 'A private upload URL could not be created.');
    }
    await this.audit.write(actor, 'SEARCH_RESEARCH_SOURCE_UPLOAD_STARTED', 'SITE_SEARCH_RESEARCH_SOURCE', reference, {
      tenantId: context.tenantId,
      category: 'WEBSITE',
      metadata: { siteReference, mimeType: input.mimeType, byteSize: input.byteSize, providerHint: boundedProviderHint(input.providerHint) },
    });
    return { reference, signedUploadUrl: data.signedUrl, expiresInSeconds: 7_200, public: false };
  }

  async complete(actor: AgencyActor, siteReference: string, sourceReference: string) {
    const context = await this.siteContext(siteReference);
    const [source] = await this.db.select().from(siteSearchResearchSources).where(and(
      eq(siteSearchResearchSources.publicReference, sourceReference),
      eq(siteSearchResearchSources.siteId, context.siteId),
      eq(siteSearchResearchSources.tenantId, context.tenantId),
      eq(siteSearchResearchSources.status, 'PENDING_UPLOAD'),
    )).limit(1);
    if (!source) throw fail(404, 'SEARCH_RESEARCH_SOURCE_NOT_FOUND', 'Pending research upload was not found.');
    const { data, error } = await getSupabaseAdmin().storage.from(source.storageBucket).download(source.storagePath);
    if (error || !data) throw fail(409, 'SEARCH_RESEARCH_UPLOAD_INCOMPLETE', 'The private research upload has not completed.');
    const bytes = Buffer.from(await data.arrayBuffer());
    const valid = bytes.byteLength === source.byteSize
      && createHash('sha256').update(bytes).digest('hex') === source.digestSha256
      && searchResearchFileMatchesMime(bytes, source.mimeType);
    if (!valid) {
      await this.db.update(siteSearchResearchSources).set({ status: 'QUARANTINED', updatedAt: new Date() }).where(eq(siteSearchResearchSources.id, source.id));
      await getSupabaseAdmin().storage.from(source.storageBucket).remove([source.storagePath]);
      throw fail(400, 'SEARCH_RESEARCH_UPLOAD_VERIFICATION_FAILED', 'The uploaded research file did not match the declared safe file.');
    }
    const extracted = extractSearchResearch(bytes, source.mimeType);
    const now = new Date();
    await this.db.update(siteSearchResearchSources).set({
      status: 'EXTRACTED',
      extractedJson: persistedPreview(extracted),
      extractedAt: now,
      updatedAt: now,
    }).where(and(eq(siteSearchResearchSources.id, source.id), eq(siteSearchResearchSources.status, 'PENDING_UPLOAD')));
    await this.audit.write(actor, 'SEARCH_RESEARCH_SOURCE_EXTRACTED', 'SITE_SEARCH_RESEARCH_SOURCE', sourceReference, {
      tenantId: context.tenantId,
      category: 'WEBSITE',
      metadata: { siteReference, keywordCount: extracted.keywordCount, metricRowCount: extracted.metricRowCount },
    });
    return { reference: sourceReference, status: 'EXTRACTED' as const, extracted };
  }

  async reject(actor: AgencyActor, siteReference: string, sourceReference: string) {
    const context = await this.siteContext(siteReference);
    const [source] = await this.db.update(siteSearchResearchSources).set({
      status: 'REJECTED', rejectedAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(siteSearchResearchSources.publicReference, sourceReference),
      eq(siteSearchResearchSources.siteId, context.siteId),
      eq(siteSearchResearchSources.tenantId, context.tenantId),
      eq(siteSearchResearchSources.status, 'EXTRACTED'),
    )).returning();
    if (!source) throw fail(409, 'SEARCH_RESEARCH_SOURCE_NOT_REJECTABLE', 'Only extracted, unapplied research can be dismissed.');
    await this.audit.write(actor, 'SEARCH_RESEARCH_SOURCE_REJECTED', 'SITE_SEARCH_RESEARCH_SOURCE', sourceReference, {
      tenantId: context.tenantId, category: 'WEBSITE', metadata: { siteReference },
    });
    return { reference: sourceReference, status: 'REJECTED' as const };
  }

  async apply(actor: AgencyActor, siteReference: string, sourceReference: string) {
    const context = await this.siteContext(siteReference);
    const [source] = await this.db.select().from(siteSearchResearchSources).where(and(
      eq(siteSearchResearchSources.publicReference, sourceReference),
      eq(siteSearchResearchSources.siteId, context.siteId),
      eq(siteSearchResearchSources.tenantId, context.tenantId),
    )).limit(1);
    if (!source) throw fail(404, 'SEARCH_RESEARCH_SOURCE_NOT_FOUND', 'Research source was not found.');
    if (source.status === 'APPLIED') return { reference: sourceReference, status: 'APPLIED' as const, idempotentReplay: true };
    if (source.status !== 'EXTRACTED') throw fail(409, 'SEARCH_RESEARCH_SOURCE_NOT_REVIEWABLE', 'Extract the research file before adding it to the strategy.');
    const extracted = source.extractedJson as ExtractedSearchResearch;
    if (!Array.isArray(extracted?.rows) || extracted.rows.length === 0) {
      throw fail(409, 'SEARCH_RESEARCH_SOURCE_NOT_APPLICABLE', 'No structured keyword rows were extracted. Keep this file as reference or upload a CSV, XLSX or JSON keyword export.');
    }

    const [strategyRow] = await this.db.select({ id: siteSearchStrategies.id, value: siteSearchStrategies.strategyJson })
      .from(siteSearchStrategies)
      .where(and(eq(siteSearchStrategies.siteId, context.siteId), eq(siteSearchStrategies.status, 'DRAFT')))
      .orderBy(desc(siteSearchStrategies.createdAt))
      .limit(1);
    if (!strategyRow) throw fail(409, 'SEARCH_RESEARCH_DRAFT_REQUIRED', 'Create a draft search strategy for the approved website structure before adding research.');
    const briefRows = await this.db.select({ id: sitePageSeoBriefs.id, value: sitePageSeoBriefs.briefJson })
      .from(sitePageSeoBriefs)
      .where(and(eq(sitePageSeoBriefs.strategyId, strategyRow.id), eq(sitePageSeoBriefs.status, 'DRAFT')));
    let strategy = SearchIntelligenceStrategyV2Schema.parse(strategyRow.value);
    let briefs = briefRows.map(row => ({ id: row.id, value: PageSeoBriefSchema.parse(row.value) }));
    if (!briefs.length) throw fail(409, 'SEARCH_RESEARCH_BRIEFS_REQUIRED', 'The draft search strategy has no editable page briefs.');

    const available = Math.max(0, 5000 - strategy.keywordUniverse.length);
    const rows = extracted.rows.slice(0, Math.min(1000, Math.max(1, available + strategy.keywordUniverse.length)));
    const sourceEvidence = rows.map(row => ({
      reference: randomUUID(),
      providerKey: `uploaded-${boundedProviderHint(source.providerHint).toLocaleLowerCase()}`.slice(0, 80),
      query: row.keyword,
      market: source.market,
      locale: source.locale,
      location: source.searchLocation,
      language: source.language,
      device: source.device as Device,
      capturedAt: source.capturedAt.toISOString(),
      expiresAt: new Date(source.capturedAt.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      sourceDigestSha256: source.digestSha256,
      payloadDigestSha256: generationDigest(row),
      notes: [
        `Uploaded research source: ${source.safeFilename}`,
        ...(row.clicks !== undefined ? [`Clicks: ${row.clicks}`] : []),
        ...(row.impressions !== undefined ? [`Impressions: ${row.impressions}`] : []),
        ...(row.position !== undefined ? [`Average position/rank: ${row.position}`] : []),
        ...(row.url ? [`Observed URL: ${row.url}`] : []),
        ...(row.competitor ? [`Observed competitor/domain: ${row.competitor}`] : []),
      ].slice(0, 100),
    }));
    const evidenceByKeyword = new Map(sourceEvidence.map(item => [item.query.toLocaleLowerCase(), item]));
    const originalByKeyword = new Map(strategy.keywordUniverse.map((item, index) => [item.keyword.toLocaleLowerCase(), { item, index }]));
    const assignments = new Map<string, string[]>();
    const evidenceUsed = new Set<string>();
    const nextKeywords = [...strategy.keywordUniverse];

    for (const row of rows) {
      const lower = row.keyword.toLocaleLowerCase();
      const evidence = evidenceByKeyword.get(lower)!;
      const existing = originalByKeyword.get(lower);
      const rankedBrief = [...briefs].sort((left, right) => pageScore(row.keyword, right.value) - pageScore(row.keyword, left.value))[0]!.value;
      const targetPageReference = existing?.item.targetPageReference || rankedBrief.pageReference;
      const targetBrief = briefs.find(item => item.value.pageReference === targetPageReference)?.value || rankedBrief;
      const measured = row.monthlySearchVolume !== undefined || row.keywordDifficulty !== undefined;
      const metrics = measured ? {
        ...(row.monthlySearchVolume !== undefined ? { monthlySearchVolume: row.monthlySearchVolume } : {}),
        ...(row.keywordDifficulty !== undefined ? { keywordDifficulty: row.keywordDifficulty } : {}),
        sourceClassification: 'SEARCH_RESEARCH' as const,
        evidenceReference: evidence.reference,
        measuredAt: source.capturedAt.toISOString(),
      } : undefined;
      const researchRationale = {
        statement: `Reviewed research source ${source.safeFilename} confirms this search term for planning.`,
        sourceClassification: 'SEARCH_RESEARCH' as const,
        evidenceReferences: [evidence.reference],
        confidence: 1,
      };
      if (existing) {
        nextKeywords[existing.index] = { ...existing.item, ...(metrics ? { metrics } : {}), rationale: researchRationale };
      } else if (nextKeywords.length < 5000) {
        nextKeywords.push({
          keyword: row.keyword,
          classes: keywordClasses(row.keyword, source.searchLocation),
          intent: keywordIntent(row.keyword, source.searchLocation),
          topicClusterKey: targetBrief.topicClusterKey,
          targetPageReference: targetBrief.pageReference,
          ...(metrics ? { metrics } : {}),
          rationale: researchRationale,
        });
      } else continue;
      evidenceUsed.add(evidence.reference);
      if (row.keyword.toLocaleLowerCase() !== targetBrief.primaryKeyword.toLocaleLowerCase()) {
        const assigned = assignments.get(targetBrief.reference) ?? [];
        assigned.push(row.keyword);
        assignments.set(targetBrief.reference, assigned);
      }
    }
    const usedEvidence = sourceEvidence.filter(item => evidenceUsed.has(item.reference));
    if (!usedEvidence.length) throw fail(409, 'SEARCH_RESEARCH_NO_APPLICABLE_ROWS', 'No extracted rows could be added to the current draft search strategy.');

    const newByCluster = new Map<string, string[]>();
    for (const keyword of nextKeywords.slice(strategy.keywordUniverse.length)) {
      const values = newByCluster.get(keyword.topicClusterKey) ?? [];
      values.push(keyword.keyword); newByCluster.set(keyword.topicClusterKey, values);
    }
    const generatedAt = new Date().toISOString();
    const provenance = {
      ...strategy.provenance,
      providerKey: 'ks-os-research-inbox',
      modelKey: 'deterministic-file-extraction-v1',
      researchDigestSha256: generationDigest({ previous: strategy.provenance.researchDigestSha256, sourceReference, evidence: usedEvidence }),
      researchEvidenceReferences: [...new Set([...strategy.provenance.researchEvidenceReferences, ...usedEvidence.map(item => item.reference)])],
      generatedAt,
      outputDigestSha256: '0'.repeat(64),
    };
    const draftStrategy = SearchIntelligenceStrategyV2Schema.parse({
      ...strategy,
      keywordUniverse: nextKeywords,
      searchIntentClusters: strategy.searchIntentClusters.map(cluster => ({
        ...cluster,
        keywords: [...new Set([...cluster.keywords, ...(newByCluster.get(cluster.key) ?? [])])].slice(0, 500),
      })),
      provenance,
    });
    strategy = SearchIntelligenceStrategyV2Schema.parse({
      ...draftStrategy,
      provenance: { ...draftStrategy.provenance, outputDigestSha256: searchStrategyDigest(draftStrategy) },
    });

    briefs = briefs.map(item => {
      const imported = assignments.get(item.value.reference) ?? [];
      if (!imported.length) return item;
      const questions = imported.filter(keyword => keywordClasses(keyword, source.searchLocation).includes('QUESTION'));
      const longTail = imported.filter(keyword => keyword.split(/\s+/).length >= 4 && !questions.includes(keyword));
      const draftBrief = PageSeoBriefSchema.parse({
        ...item.value,
        secondaryKeywords: [...new Set([...item.value.secondaryKeywords, ...imported])].slice(0, 100),
        longTailKeywords: [...new Set([...item.value.longTailKeywords, ...longTail])].slice(0, 100),
        questionKeywords: [...new Set([...item.value.questionKeywords, ...questions])].slice(0, 100),
        provenance: {
          ...item.value.provenance,
          providerKey: 'ks-os-research-inbox',
          modelKey: 'deterministic-file-extraction-v1',
          researchDigestSha256: strategy.provenance.researchDigestSha256,
          researchEvidenceReferences: strategy.provenance.researchEvidenceReferences,
          strategyDigestSha256: strategy.provenance.outputDigestSha256,
          generatedAt,
          outputDigestSha256: '0'.repeat(64),
        },
      });
      return {
        id: item.id,
        value: PageSeoBriefSchema.parse({
          ...draftBrief,
          provenance: { ...draftBrief.provenance, outputDigestSha256: pageSeoBriefDigest(draftBrief) },
        }),
      };
    });

    await this.db.transaction(async tx => {
      await tx.insert(siteSearchResearchEvidence).values(usedEvidence.map(item => ({
        publicReference: item.reference,
        tenantId: context.tenantId,
        siteId: context.siteId,
        strategyId: strategyRow.id,
        providerKey: item.providerKey,
        query: item.query,
        market: item.market,
        locale: item.locale,
        searchLocation: item.location,
        language: item.language,
        device: item.device,
        capturedAt: new Date(item.capturedAt),
        expiresAt: new Date(item.expiresAt),
        sourceUrl: null,
        sourceDigestSha256: item.sourceDigestSha256,
        payloadDigestSha256: item.payloadDigestSha256,
        notesJson: item.notes,
      })));
      await tx.update(siteSearchStrategies).set({
        strategyJson: strategy,
        researchDigestSha256: strategy.provenance.researchDigestSha256,
        outputDigestSha256: strategy.provenance.outputDigestSha256,
        providerKey: strategy.provenance.providerKey,
        modelKey: strategy.provenance.modelKey,
        generatedAt: new Date(strategy.provenance.generatedAt),
        updatedAt: new Date(),
      }).where(and(eq(siteSearchStrategies.id, strategyRow.id), eq(siteSearchStrategies.status, 'DRAFT')));
      for (const brief of briefs) {
        await tx.update(sitePageSeoBriefs).set({
          briefJson: brief.value,
          outputDigestSha256: brief.value.provenance.outputDigestSha256,
          updatedAt: new Date(),
        }).where(and(eq(sitePageSeoBriefs.id, brief.id), eq(sitePageSeoBriefs.status, 'DRAFT')));
      }
      await tx.update(siteSearchResearchSources).set({
        status: 'APPLIED',
        appliedStrategyId: strategyRow.id,
        appliedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(siteSearchResearchSources.id, source.id), eq(siteSearchResearchSources.status, 'EXTRACTED')));
    });
    await this.audit.write(actor, 'SEARCH_RESEARCH_SOURCE_APPLIED', 'SITE_SEARCH_RESEARCH_SOURCE', sourceReference, {
      tenantId: context.tenantId,
      category: 'WEBSITE',
      metadata: { siteReference, strategyReference: strategy.reference, evidenceCount: usedEvidence.length, keywordCount: rows.length },
    });
    return {
      reference: sourceReference,
      status: 'APPLIED' as const,
      strategyReference: strategy.reference,
      evidenceCount: usedEvidence.length,
      reviewedRowCount: rows.length,
      idempotentReplay: false,
    };
  }
}
