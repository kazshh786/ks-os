import { PublicReferenceSchema } from '@ks-os/contracts';
import { z } from 'zod';
import type { GenerationPlan, VerifiedBusinessFacts } from './contracts.js';
import { selectGenerationSafeFacts } from './facts.js';
import { stableGenerationStringify } from './normalization.js';
import type { SiteGenerationProvider } from './provider.js';
import {
  SearchIntentSchema,
  SearchKeywordClassSchema,
  type PageSeoBrief,
  type SearchIntelligenceStrategyV2,
  type SearchResearchEvidence,
} from './search-intelligence.js';
import type { SpecialistKnowledgeGuidance } from './specialist-agents.js';

const KeywordSchema = z.string().trim().min(1).max(240);
const CompetitorSchema = z.string().trim().min(1).max(255);

export const KeywordResearchOpportunityTypeSchema = z.enum([
  'COMPETITOR_OVERLAP',
  'COMPETITOR_GAP',
  'LONG_TAIL',
  'QUESTION',
  'LOCAL',
  'COMMERCIAL',
  'TRANSACTIONAL',
  'CONTENT_DEPTH',
]);

const KeywordResearchCoverageSchema = z.object({
  keywordUniverseCount: z.number().int().nonnegative(),
  researchEvidenceCount: z.number().int().nonnegative(),
  measuredKeywordCount: z.number().int().nonnegative(),
  observedCompetitorCount: z.number().int().nonnegative(),
  competitorKeywordObservationCount: z.number().int().nonnegative(),
  rankedObservationCount: z.number().int().nonnegative(),
}).strict();

const CompetitorKeywordFindingSchema = z.object({
  competitor: CompetitorSchema,
  observedKeywords: z.array(KeywordSchema).min(1).max(250),
  evidenceReferences: z.array(PublicReferenceSchema).min(1).max(250),
  patternSummary: z.string().trim().min(10).max(1_500),
}).strict();

const KeywordResearchOpportunitySchema = z.object({
  keyword: KeywordSchema,
  intent: SearchIntentSchema,
  classes: z.array(SearchKeywordClassSchema).min(1).max(13),
  opportunityType: KeywordResearchOpportunityTypeSchema,
  competitors: z.array(CompetitorSchema).max(50).default([]),
  evidenceReferences: z.array(PublicReferenceSchema).min(1).max(100),
  rationale: z.string().trim().min(10).max(1_500),
}).strict();

const KeywordResearchClusterSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  intent: SearchIntentSchema,
  keywords: z.array(KeywordSchema).min(2).max(250),
  competitors: z.array(CompetitorSchema).max(50).default([]),
  evidenceReferences: z.array(PublicReferenceSchema).min(1).max(250),
  insight: z.string().trim().min(10).max(1_500),
}).strict();

export const KeywordResearchReportSchema = z.object({
  specialist: z.literal('KEYWORD_RESEARCH'),
  researchOnly: z.literal(true),
  objective: z.string().trim().min(10).max(1_000),
  methodology: z.array(z.string().trim().min(10).max(1_000)).min(2).max(20),
  coverage: KeywordResearchCoverageSchema,
  competitorFindings: z.array(CompetitorKeywordFindingSchema).max(100),
  keywordOpportunities: z.array(KeywordResearchOpportunitySchema).max(250),
  clusters: z.array(KeywordResearchClusterSchema).max(100),
  limitations: z.array(z.string().trim().min(10).max(1_000)).min(1).max(20),
  handoffToSeo: z.array(z.string().trim().min(10).max(1_000)).min(1).max(30),
}).strict();
export type KeywordResearchReport = z.infer<typeof KeywordResearchReportSchema>;

export interface KeywordResearchObservation {
  keyword: string;
  evidenceReference: string;
  providerKey: string;
  capturedAt: string;
  competitor?: string;
  observedPosition?: number;
  observedUrl?: string;
}

export interface KeywordResearchDataset {
  coverage: z.infer<typeof KeywordResearchCoverageSchema>;
  keywordUniverse: SearchIntelligenceStrategyV2['keywordUniverse'];
  competitorLandscape: SearchIntelligenceStrategyV2['competitorLandscape'];
  observations: KeywordResearchObservation[];
}

const KEYWORD_RESEARCH_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'specialist', 'researchOnly', 'objective', 'methodology', 'coverage',
    'competitorFindings', 'keywordOpportunities', 'clusters', 'limitations', 'handoffToSeo',
  ],
  properties: {
    specialist: { type: 'string', enum: ['KEYWORD_RESEARCH'] },
    researchOnly: { type: 'boolean', enum: [true] },
    objective: { type: 'string' },
    methodology: { type: 'array', items: { type: 'string' } },
    coverage: {
      type: 'object',
      additionalProperties: false,
      required: [
        'keywordUniverseCount', 'researchEvidenceCount', 'measuredKeywordCount',
        'observedCompetitorCount', 'competitorKeywordObservationCount', 'rankedObservationCount',
      ],
      properties: Object.fromEntries([
        'keywordUniverseCount', 'researchEvidenceCount', 'measuredKeywordCount',
        'observedCompetitorCount', 'competitorKeywordObservationCount', 'rankedObservationCount',
      ].map(key => [key, { type: 'integer', minimum: 0 }])),
    },
    competitorFindings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['competitor', 'observedKeywords', 'evidenceReferences', 'patternSummary'],
        properties: {
          competitor: { type: 'string' },
          observedKeywords: { type: 'array', items: { type: 'string' } },
          evidenceReferences: { type: 'array', items: { type: 'string', format: 'uuid' } },
          patternSummary: { type: 'string' },
        },
      },
    },
    keywordOpportunities: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['keyword', 'intent', 'classes', 'opportunityType', 'competitors', 'evidenceReferences', 'rationale'],
        properties: {
          keyword: { type: 'string' },
          intent: { type: 'string', enum: SearchIntentSchema.options },
          classes: { type: 'array', items: { type: 'string', enum: SearchKeywordClassSchema.options } },
          opportunityType: { type: 'string', enum: KeywordResearchOpportunityTypeSchema.options },
          competitors: { type: 'array', items: { type: 'string' } },
          evidenceReferences: { type: 'array', items: { type: 'string', format: 'uuid' } },
          rationale: { type: 'string' },
        },
      },
    },
    clusters: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'intent', 'keywords', 'competitors', 'evidenceReferences', 'insight'],
        properties: {
          key: { type: 'string' },
          intent: { type: 'string', enum: SearchIntentSchema.options },
          keywords: { type: 'array', items: { type: 'string' } },
          competitors: { type: 'array', items: { type: 'string' } },
          evidenceReferences: { type: 'array', items: { type: 'string', format: 'uuid' } },
          insight: { type: 'string' },
        },
      },
    },
    limitations: { type: 'array', items: { type: 'string' } },
    handoffToSeo: { type: 'array', items: { type: 'string' } },
  },
};

function noteValue(notes: readonly string[], prefix: string) {
  const normalizedPrefix = prefix.toLocaleLowerCase();
  const note = notes.find(item => item.toLocaleLowerCase().startsWith(normalizedPrefix));
  return note?.slice(prefix.length).trim() || undefined;
}

function observedPosition(notes: readonly string[]) {
  const raw = noteValue(notes, 'Average position/rank: ');
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function createKeywordResearchDataset(input: {
  strategy: SearchIntelligenceStrategyV2;
  evidence: readonly SearchResearchEvidence[];
}): KeywordResearchDataset {
  const observations = input.evidence.map(evidence => ({
    keyword: evidence.query,
    evidenceReference: evidence.reference,
    providerKey: evidence.providerKey,
    capturedAt: evidence.capturedAt,
    competitor: noteValue(evidence.notes, 'Observed competitor/domain: '),
    observedPosition: observedPosition(evidence.notes),
    observedUrl: noteValue(evidence.notes, 'Observed URL: '),
  })).filter(item => item.competitor || item.observedPosition !== undefined || item.observedUrl);

  const observedCompetitors = new Set<string>();
  for (const competitor of input.strategy.competitorLandscape) {
    observedCompetitors.add((competitor.hostname || competitor.name).trim().toLocaleLowerCase());
  }
  for (const observation of observations) {
    if (observation.competitor) observedCompetitors.add(observation.competitor.trim().toLocaleLowerCase());
  }

  return {
    coverage: {
      keywordUniverseCount: input.strategy.keywordUniverse.length,
      researchEvidenceCount: input.evidence.length,
      measuredKeywordCount: input.strategy.keywordUniverse.filter(keyword => keyword.metrics).length,
      observedCompetitorCount: observedCompetitors.size,
      competitorKeywordObservationCount: observations.filter(item => item.competitor).length,
      rankedObservationCount: observations.filter(item => item.observedPosition !== undefined).length,
    },
    keywordUniverse: input.strategy.keywordUniverse,
    competitorLandscape: input.strategy.competitorLandscape,
    observations,
  };
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function assertKeywordResearchGrounded(input: {
  report: KeywordResearchReport;
  strategy: SearchIntelligenceStrategyV2;
  evidence: readonly SearchResearchEvidence[];
}) {
  const evidenceByReference = new Map(input.evidence.map(item => [item.reference, item]));
  const keywordEvidence = new Map<string, Set<string>>();
  const allowedKeywords = new Set<string>();
  for (const keyword of input.strategy.keywordUniverse) {
    const key = normalized(keyword.keyword);
    allowedKeywords.add(key);
    const references = keywordEvidence.get(key) ?? new Set<string>();
    for (const reference of keyword.rationale.evidenceReferences) references.add(reference);
    if (keyword.metrics?.evidenceReference) references.add(keyword.metrics.evidenceReference);
    keywordEvidence.set(key, references);
  }
  for (const evidence of input.evidence) {
    const key = normalized(evidence.query);
    allowedKeywords.add(key);
    const references = keywordEvidence.get(key) ?? new Set<string>();
    references.add(evidence.reference);
    keywordEvidence.set(key, references);
  }

  const allowedCompetitors = new Set<string>();
  for (const competitor of input.strategy.competitorLandscape) {
    allowedCompetitors.add(normalized(competitor.name));
    if (competitor.hostname) allowedCompetitors.add(normalized(competitor.hostname));
  }
  for (const evidence of input.evidence) {
    const competitor = noteValue(evidence.notes, 'Observed competitor/domain: ');
    if (competitor) allowedCompetitors.add(normalized(competitor));
  }

  const assertEvidence = (references: readonly string[], label: string) => {
    for (const reference of references) {
      if (!evidenceByReference.has(reference)) {
        throw new Error(`KEYWORD_RESEARCH_UNGROUNDED_EVIDENCE:${label}:${reference}`);
      }
    }
  };
  const assertKeyword = (keyword: string, references: readonly string[], label: string) => {
    const key = normalized(keyword);
    if (!allowedKeywords.has(key)) {
      throw new Error(`KEYWORD_RESEARCH_UNGROUNDED_KEYWORD:${label}:${keyword}`);
    }
    assertEvidence(references, label);
    const referencesForKeyword = keywordEvidence.get(key) ?? new Set<string>();
    if (!references.some(reference => referencesForKeyword.has(reference))) {
      throw new Error(`KEYWORD_RESEARCH_KEYWORD_EVIDENCE_MISMATCH:${label}:${keyword}`);
    }
  };

  for (const finding of input.report.competitorFindings) {
    if (!allowedCompetitors.has(normalized(finding.competitor))) {
      throw new Error(`KEYWORD_RESEARCH_UNGROUNDED_COMPETITOR:${finding.competitor}`);
    }
    assertEvidence(finding.evidenceReferences, `competitor:${finding.competitor}`);
    for (const keyword of finding.observedKeywords) {
      assertKeyword(keyword, finding.evidenceReferences, `competitor:${finding.competitor}`);
    }
  }
  for (const opportunity of input.report.keywordOpportunities) {
    assertKeyword(opportunity.keyword, opportunity.evidenceReferences, `opportunity:${opportunity.keyword}`);
    for (const competitor of opportunity.competitors) {
      if (!allowedCompetitors.has(normalized(competitor))) {
        throw new Error(`KEYWORD_RESEARCH_UNGROUNDED_COMPETITOR:${competitor}`);
      }
    }
  }
  for (const cluster of input.report.clusters) {
    assertEvidence(cluster.evidenceReferences, `cluster:${cluster.key}`);
    for (const keyword of cluster.keywords) {
      assertKeyword(keyword, cluster.evidenceReferences, `cluster:${cluster.key}`);
    }
    for (const competitor of cluster.competitors) {
      if (!allowedCompetitors.has(normalized(competitor))) {
        throw new Error(`KEYWORD_RESEARCH_UNGROUNDED_COMPETITOR:${competitor}`);
      }
    }
  }
}

export function composeKeywordResearchPrompt(input: {
  plan: GenerationPlan;
  facts: VerifiedBusinessFacts;
  strategy: SearchIntelligenceStrategyV2;
  briefs: readonly PageSeoBrief[];
  evidence: readonly SearchResearchEvidence[];
  knowledgeGuidelines: readonly SpecialistKnowledgeGuidance[];
}) {
  const dataset = createKeywordResearchDataset({ strategy: input.strategy, evidence: input.evidence });
  return stableGenerationStringify({
    systemContract: [
      'Act only as a research analyst specialising in competitor keyword intelligence. This stage is research-only and does not make final SEO, content, page-targeting or design decisions.',
      'Analyse the complete supplied researched keyword universe and every supplied search-research evidence record. Do not sample away awkward or low-volume terms when identifying patterns.',
      'Treat observed competitor/domain, observed URL and observed position/rank values as facts only when they appear in the supplied evidence. Never infer that a competitor ranks for a keyword without evidence.',
      'Treat monthly search volume, keyword difficulty and CPC as measured facts only when the approved keyword metrics contain them. Never estimate or manufacture metrics.',
      'Separate observed evidence from interpretation. A gap or opportunity is an analytical conclusion, not a claim that the site currently ranks or does not rank unless evidence explicitly shows that.',
      'Use competitor keyword overlap, recurring themes, commercial/local intent, long-tail terms, questions, observed landing pages, rank positions and measured metrics to identify research opportunities for the SEO specialist.',
      'The scope is the supplied evidence, not the entire internet. Explicitly state material limitations when competitor coverage, rank data, volumes, difficulty, URLs or market breadth are incomplete.',
      'Pinned Knowledge Pack rules and verified business facts govern safe interpretation. Do not invent services, locations, claims, competitors or customer needs to fill a research gap.',
      'Return structured JSON only. Do not write public-facing copy, metadata, page plans, HTML, CSS or implementation code.',
    ],
    operation: 'KEYWORD_COMPETITOR_RESEARCH_V1',
    researchStandard: 'Evidence-grounded competitor keyword analysis suitable for Semrush/Ahrefs-style exported datasets without pretending to have proprietary provider data that was not supplied.',
    approvedBlueprint: input.plan,
    pinnedKnowledgePackGuidelines: input.knowledgeGuidelines,
    verifiedBusinessFacts: selectGenerationSafeFacts(input.facts),
    approvedSearchStrategy: input.strategy,
    approvedPageSeoBriefs: input.briefs,
    keywordResearchDataset: dataset,
    rawResearchEvidence: input.evidence,
  });
}

export async function runKeywordResearchAgent(input: {
  plan: GenerationPlan;
  facts: VerifiedBusinessFacts;
  strategy: SearchIntelligenceStrategyV2;
  briefs: readonly PageSeoBrief[];
  evidence: readonly SearchResearchEvidence[];
  knowledgeGuidelines: readonly SpecialistKnowledgeGuidance[];
  provider: SiteGenerationProvider;
  maxOutputCharacters: number;
  signal?: AbortSignal;
}): Promise<KeywordResearchReport> {
  const dataset = createKeywordResearchDataset({ strategy: input.strategy, evidence: input.evidence });
  const response = await input.provider.generateStructuredOutput({
    prompt: composeKeywordResearchPrompt(input),
    outputSchema: KeywordResearchReportSchema,
    responseJsonSchema: KEYWORD_RESEARCH_RESPONSE_JSON_SCHEMA,
    maxOutputCharacters: Math.min(input.maxOutputCharacters, 80_000),
    signal: input.signal,
  });
  const report = KeywordResearchReportSchema.parse({
    ...response.value,
    coverage: dataset.coverage,
  });
  assertKeywordResearchGrounded({ report, strategy: input.strategy, evidence: input.evidence });
  return report;
}
