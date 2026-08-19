import { PublicReferenceSchema } from '@ks-os/contracts';
import type { SiteGenerationKnowledgeContext } from '@ks-os/site-knowledge';
import { z } from 'zod';
import type { GenerationPlan, VerifiedBusinessFacts } from './contracts.js';
import { selectGenerationSafeFacts } from './facts.js';
import {
  KeywordResearchReportSchema,
  runKeywordResearchAgent,
  type KeywordResearchReport,
} from './keyword-research-agent.js';
import { stableGenerationStringify } from './normalization.js';
import type { SiteGenerationProvider } from './provider.js';
import type {
  PageSeoBrief,
  SearchIntelligenceStrategyV2,
  SearchResearchEvidence,
} from './search-intelligence.js';

export const SPECIALIST_AGENT_TEAM_VERSION = 'agent-team-3' as const;

export const SpecialistAgentNameSchema = z.enum([
  'SEO',
  'UX',
  'CONVERSION',
  'COPY',
  'DESIGN',
  'ACCESSIBILITY',
]);
export type SpecialistAgentName = z.infer<typeof SpecialistAgentNameSchema>;

export const SpecialistDisciplineNameSchema = z.enum([
  'KEYWORD_RESEARCH',
  ...SpecialistAgentNameSchema.options,
]);
export type SpecialistDisciplineName = z.infer<typeof SpecialistDisciplineNameSchema>;

export const SpecialistRecommendationSchema = z.object({
  priority: z.enum(['MUST', 'SHOULD', 'COULD']),
  instruction: z.string().trim().min(10).max(1_000),
  rationale: z.string().trim().min(10).max(1_000),
  pageReferences: z.array(PublicReferenceSchema).max(100).default([]),
}).strict();
export type SpecialistRecommendation = z.infer<typeof SpecialistRecommendationSchema>;

export const SpecialistBriefSchema = z.object({
  specialist: SpecialistAgentNameSchema,
  objective: z.string().trim().min(10).max(1_000),
  principles: z.array(z.string().trim().min(10).max(1_000)).min(2).max(20),
  recommendations: z.array(SpecialistRecommendationSchema).min(2).max(30),
  risks: z.array(z.string().trim().min(10).max(1_000)).max(20).default([]),
  handoffNotes: z.array(z.string().trim().min(10).max(1_000)).min(1).max(20),
}).strict();
export type SpecialistBrief = z.infer<typeof SpecialistBriefSchema>;

const SeoSpecialistBriefSchema = SpecialistBriefSchema.extend({ specialist: z.literal('SEO') });
const UxSpecialistBriefSchema = SpecialistBriefSchema.extend({ specialist: z.literal('UX') });
const ConversionSpecialistBriefSchema = SpecialistBriefSchema.extend({ specialist: z.literal('CONVERSION') });
const CopySpecialistBriefSchema = SpecialistBriefSchema.extend({ specialist: z.literal('COPY') });
const DesignSpecialistBriefSchema = SpecialistBriefSchema.extend({ specialist: z.literal('DESIGN') });
const AccessibilitySpecialistBriefSchema = SpecialistBriefSchema.extend({ specialist: z.literal('ACCESSIBILITY') });

export const SpecialistDirectorReviewSchema = z.object({
  verdict: z.enum(['APPROVED', 'REVISE']),
  summary: z.string().trim().min(20).max(1_500),
  conflicts: z.array(z.object({
    specialists: z.array(SpecialistDisciplineNameSchema).min(2).max(7),
    issue: z.string().trim().min(10).max(1_000),
    resolution: z.string().trim().min(10).max(1_000),
  }).strict()).max(20).default([]),
  crossDisciplinePriorities: z.array(z.string().trim().min(10).max(1_000)).min(2).max(20),
  nonNegotiables: z.array(z.string().trim().min(10).max(1_000)).min(2).max(20),
}).strict();
export type SpecialistDirectorReview = z.infer<typeof SpecialistDirectorReviewSchema>;

export const SpecialistAgentTeamOutputSchema = z.object({
  version: z.literal(SPECIALIST_AGENT_TEAM_VERSION),
  keywordResearch: KeywordResearchReportSchema,
  seo: SeoSpecialistBriefSchema,
  ux: UxSpecialistBriefSchema,
  conversion: ConversionSpecialistBriefSchema,
  copy: CopySpecialistBriefSchema,
  design: DesignSpecialistBriefSchema,
  accessibility: AccessibilitySpecialistBriefSchema,
  directorReview: SpecialistDirectorReviewSchema,
}).strict();
export type SpecialistAgentTeamOutput = z.infer<typeof SpecialistAgentTeamOutputSchema>;

export interface ApprovedSpecialistSearchContext {
  strategy: SearchIntelligenceStrategyV2;
  briefs: readonly PageSeoBrief[];
  evidence: readonly SearchResearchEvidence[];
}

export interface SpecialistKnowledgeGuidance {
  pageReference: string;
  pageType: string;
  conversionRole: string;
  knowledgePack: { reference: string; semanticVersion: string; schemaVersion: number; contentDigest: string };
  applicableRuleIds: readonly string[];
  requiredInstructions: readonly string[];
  prohibitedBehaviours: readonly string[];
  missingBusinessDataRequirements: readonly string[];
  deterministicRequirements: readonly string[];
  aiReviewInstructions: readonly string[];
  humanReviewInstructions: readonly string[];
  pagePlaybook: SiteGenerationKnowledgeContext['pagePlaybook'];
  sourceReferences: SiteGenerationKnowledgeContext['sourceReferences'];
  omittedRuleCount: number;
  requiredRulesExceededLimit: boolean;
}

const ROLE_MANDATES: Record<SpecialistAgentName, readonly string[]> = {
  SEO: [
    'Own organic-search interpretation, information discoverability, metadata direction, and internal-linking priorities.',
    'Use the evidence-grounded Keyword Research report as a research handoff, then make SEO decisions against the approved Search Intelligence strategy and page briefs.',
    'Use only the approved Search Intelligence strategy, briefs, and evidence. Do not invent keywords, rankings, volumes, competitors, locations, or market facts.',
    'Apply applicable Knowledge Pack technical SEO, local SEO, content SEO, trust, accessibility and UX instructions whenever they affect search quality.',
    'Protect search intent without keyword stuffing or weakening the user journey.',
  ],
  UX: [
    'Own user needs, information hierarchy, task flow, interaction clarity, content sequencing, and mobile journey quality.',
    'Apply applicable Knowledge Pack UX, mobile, accessibility, booking, trust and conversion instructions before making a recommendation.',
    'Recommend what each page must help the visitor understand or do; do not choose unsupported components or override approved layout constraints.',
    'Reduce cognitive load and ambiguity while preserving meaningful page depth.',
  ],
  CONVERSION: [
    'Own the path from visitor intent to the native KS OS booking action.',
    'Apply applicable Knowledge Pack booking, conversion, trust, UX, mobile, copywriting and accessibility instructions before optimising conversion.',
    'Identify trust needs, objections, friction, reassurance, CTA timing, and conversion continuity without creating false urgency or unsupported proof.',
    'The sole primary conversion is native KS OS appointment booking; never propose an external booking destination.',
  ],
  COPY: [
    'Own messaging hierarchy, voice, clarity, persuasion, heading direction, evidence usage, and CTA language.',
    'Apply applicable Knowledge Pack copywriting, content SEO, trust, conversion, accessibility and booking instructions to messaging guidance.',
    'Do not write final page copy in this planning step. Give guidance that the page generator can execute later.',
    'Never invent claims, testimonials, outcomes, credentials, guarantees, prices, availability, or business history.',
  ],
  DESIGN: [
    'Own visual hierarchy, layout rhythm, typography intent, image treatment, component density, responsive behaviour, and restrained motion.',
    'Apply applicable Knowledge Pack UX, mobile, accessibility, trust, performance and conversion instructions to visual recommendations.',
    'Treat the approved component registry and layout manifest as the buildable design vocabulary. Do not propose arbitrary UI outside it.',
    'Avoid formulaic sameness; recommend purposeful variation while keeping the brand coherent.',
  ],
  ACCESSIBILITY: [
    'Own accessible interaction, readable content hierarchy, keyboard and focus expectations, motion restraint, semantic clarity, and visual legibility.',
    'Apply every applicable Knowledge Pack accessibility rule plus related UX, mobile, copywriting and booking requirements.',
    'Accessibility requirements are hard constraints, not aesthetic preferences.',
    'Flag likely conflicts early so design, copy, and conversion guidance can resolve them before page generation.',
  ],
};

const SPECIALIST_BRIEF_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['specialist', 'objective', 'principles', 'recommendations', 'risks', 'handoffNotes'],
  properties: {
    specialist: { type: 'string', enum: SpecialistAgentNameSchema.options },
    objective: { type: 'string' },
    principles: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['priority', 'instruction', 'rationale', 'pageReferences'],
      properties: {
        priority: { type: 'string', enum: ['MUST', 'SHOULD', 'COULD'] },
        instruction: { type: 'string' }, rationale: { type: 'string' },
        pageReferences: { type: 'array', items: { type: 'string', format: 'uuid' } },
      },
    } },
    risks: { type: 'array', items: { type: 'string' } },
    handoffNotes: { type: 'array', items: { type: 'string' } },
  },
};

const DIRECTOR_REVIEW_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'summary', 'conflicts', 'crossDisciplinePriorities', 'nonNegotiables'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVED', 'REVISE'] }, summary: { type: 'string' },
    conflicts: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['specialists', 'issue', 'resolution'],
      properties: {
        specialists: { type: 'array', items: { type: 'string', enum: SpecialistDisciplineNameSchema.options } },
        issue: { type: 'string' }, resolution: { type: 'string' },
      },
    } },
    crossDisciplinePriorities: { type: 'array', items: { type: 'string' } },
    nonNegotiables: { type: 'array', items: { type: 'string' } },
  },
};

function specialistSchema(name: SpecialistAgentName) {
  switch (name) {
    case 'SEO': return SeoSpecialistBriefSchema;
    case 'UX': return UxSpecialistBriefSchema;
    case 'CONVERSION': return ConversionSpecialistBriefSchema;
    case 'COPY': return CopySpecialistBriefSchema;
    case 'DESIGN': return DesignSpecialistBriefSchema;
    case 'ACCESSIBILITY': return AccessibilitySpecialistBriefSchema;
  }
}

function specialistResponseJsonSchema(name: SpecialistAgentName) {
  return {
    ...SPECIALIST_BRIEF_RESPONSE_JSON_SCHEMA,
    properties: {
      ...(SPECIALIST_BRIEF_RESPONSE_JSON_SCHEMA.properties as Record<string, unknown>),
      specialist: { type: 'string', enum: [name] },
    },
  };
}

export function createSpecialistKnowledgeGuidance(input: {
  plan: GenerationPlan;
  knowledgeContexts: ReadonlyMap<string, SiteGenerationKnowledgeContext>;
}): SpecialistKnowledgeGuidance[] {
  return input.plan.pages.map(page => {
    const context = input.knowledgeContexts.get(page.pageReference);
    if (!context) throw new Error(`SPECIALIST_KNOWLEDGE_CONTEXT_MISSING:${page.pageReference}`);
    if (context.packReference !== input.plan.knowledgePackReference
      || context.semanticVersion !== input.plan.knowledgePackSemanticVersion) {
      throw new Error(`SPECIALIST_KNOWLEDGE_CONTEXT_PROVENANCE_MISMATCH:${page.pageReference}`);
    }
    return {
      pageReference: page.pageReference, pageType: page.pageType, conversionRole: page.conversionRole,
      knowledgePack: {
        reference: context.packReference, semanticVersion: context.semanticVersion,
        schemaVersion: context.schemaVersion, contentDigest: context.contentDigest,
      },
      applicableRuleIds: context.applicableRuleIds,
      requiredInstructions: context.requiredInstructions,
      prohibitedBehaviours: context.prohibitedBehaviours,
      missingBusinessDataRequirements: context.missingBusinessDataRequirements,
      deterministicRequirements: context.deterministicRequirements,
      aiReviewInstructions: context.aiReviewInstructions,
      humanReviewInstructions: context.humanReviewInstructions,
      pagePlaybook: context.pagePlaybook,
      sourceReferences: context.sourceReferences,
      omittedRuleCount: context.omittedRuleCount,
      requiredRulesExceededLimit: context.requiredRulesExceededLimit,
    };
  });
}

export function composeSpecialistAgentPrompt(input: {
  specialist: SpecialistAgentName;
  plan: GenerationPlan;
  facts: VerifiedBusinessFacts;
  searchIntelligence: ApprovedSpecialistSearchContext;
  knowledgeGuidelines: readonly SpecialistKnowledgeGuidance[];
  keywordResearch?: KeywordResearchReport;
  collaboratorBriefs?: Partial<Record<SpecialistAgentName, SpecialistBrief>>;
}) {
  return stableGenerationStringify({
    systemContract: [
      `Act only as the ${input.specialist} specialist in a governed website-generation team.`,
      'Return structured planning guidance only. Do not return final page copy, HTML, CSS, JavaScript, framework code, URLs, or embeds.',
      'The supplied pinned Knowledge Pack context and approved Search Intelligence are governing inputs, not optional inspiration.',
      'Follow every applicable Knowledge Pack requiredInstruction and deterministicRequirement. Never recommend a prohibitedBehaviour. When required business data is missing, flag the dependency instead of inventing or inferring it.',
      'Treat approved Search Intelligence strategy, page briefs and research evidence as immutable market/search guidance. Do not invent or substitute keywords, intent, locations, competitors, volumes or evidence.',
      'The Keyword Research report is an evidence-grounded research handoff. It can highlight patterns and opportunities but cannot override approved Search Intelligence or claim evidence beyond its supplied scope.',
      'Verified facts, blueprint identity, template constraints, component compatibility, native booking rules, accessibility rules, and downstream validators remain authoritative.',
      'If a specialist preference conflicts with a Knowledge Pack rule, approved Search Intelligence, verified fact, or downstream hard constraint, the governing input wins.',
      'Use only approved page references from the supplied blueprint when attaching a recommendation to pages.',
      'Knowledge source references are provenance only; do not fabricate or quote source content that is not present in the selected guidance.',
    ],
    operation: `SPECIALIST_${input.specialist}_BRIEF_V3`,
    teamVersion: SPECIALIST_AGENT_TEAM_VERSION,
    roleMandate: ROLE_MANDATES[input.specialist], approvedBlueprint: input.plan,
    pinnedKnowledgePackGuidelines: input.knowledgeGuidelines,
    approvedSearchIntelligence: {
      strategy: input.searchIntelligence.strategy,
      briefs: input.searchIntelligence.briefs,
      evidence: input.searchIntelligence.evidence,
    },
    keywordResearch: input.keywordResearch,
    verifiedBusinessFacts: selectGenerationSafeFacts(input.facts),
    collaboratorBriefs: input.collaboratorBriefs,
  });
}

export function composeSpecialistDirectorPrompt(input: {
  plan: GenerationPlan;
  facts: VerifiedBusinessFacts;
  searchIntelligence: ApprovedSpecialistSearchContext;
  knowledgeGuidelines: readonly SpecialistKnowledgeGuidance[];
  briefs: {
    keywordResearch: KeywordResearchReport;
    seo: SpecialistBrief; ux: SpecialistBrief; conversion: SpecialistBrief;
    copy: SpecialistBrief; design: SpecialistBrief; accessibility: SpecialistBrief;
  };
}) {
  return stableGenerationStringify({
    systemContract: [
      'Act as the project director and critic for a governed specialist website-generation team.',
      'The pinned Knowledge Pack and approved Search Intelligence remain governing inputs during conflict resolution; specialist consensus can never override them.',
      'The Keyword Research specialist is research-only. Use its evidence-grounded patterns to challenge SEO assumptions, but never treat an inferred gap as an observed ranking fact.',
      'Reject or resolve any specialist recommendation that conflicts with a required instruction, deterministic requirement, prohibited behaviour, missing-data requirement, approved search brief, verified business fact, native booking rule, accessibility requirement, template constraint or downstream validator.',
      'Reconcile conflicts between specialists without inventing business facts or search evidence.',
      'Prefer solutions that satisfy user needs, search intent, conversion clarity, brand quality, performance-minded design, and accessibility together.',
      'If two recommendations conflict, state the conflict and a concrete governed resolution for downstream composition and generation.',
      'Return structured JSON only. Do not return page copy or implementation code.',
    ],
    operation: 'SPECIALIST_DIRECTOR_REVIEW_V3', teamVersion: SPECIALIST_AGENT_TEAM_VERSION,
    approvedPageReferences: input.plan.pages.map(page => page.pageReference),
    pinnedKnowledgePackGuidelines: input.knowledgeGuidelines,
    approvedSearchIntelligence: input.searchIntelligence,
    verifiedBusinessFacts: selectGenerationSafeFacts(input.facts),
    specialistBriefs: input.briefs,
  });
}

export async function runSpecialistAgentTeam(input: {
  plan: GenerationPlan;
  facts: VerifiedBusinessFacts;
  searchIntelligence: ApprovedSpecialistSearchContext;
  knowledgeContexts: ReadonlyMap<string, SiteGenerationKnowledgeContext>;
  provider: SiteGenerationProvider;
  maxOutputCharacters: number;
  signal?: AbortSignal;
  updateStatus?: (message: string) => Promise<void>;
}): Promise<SpecialistAgentTeamOutput> {
  const maxOutputCharacters = Math.min(input.maxOutputCharacters, 50_000);
  const knowledgeGuidelines = createSpecialistKnowledgeGuidance({ plan: input.plan, knowledgeContexts: input.knowledgeContexts });

  await input.updateStatus?.('The keyword research specialist is analysing competitor keywords, observed rankings and search evidence.');
  const keywordResearch = await runKeywordResearchAgent({
    plan: input.plan, facts: input.facts, strategy: input.searchIntelligence.strategy,
    briefs: input.searchIntelligence.briefs, evidence: input.searchIntelligence.evidence,
    knowledgeGuidelines, provider: input.provider, maxOutputCharacters: input.maxOutputCharacters,
    signal: input.signal,
  });

  const run = async <T extends SpecialistBrief>(
    specialist: SpecialistAgentName,
    collaboratorBriefs?: Partial<Record<SpecialistAgentName, SpecialistBrief>>,
    keywordResearchInput?: KeywordResearchReport,
  ) => {
    const response = await input.provider.generateStructuredOutput<T>({
      prompt: composeSpecialistAgentPrompt({
        specialist, plan: input.plan, facts: input.facts,
        searchIntelligence: input.searchIntelligence, knowledgeGuidelines,
        keywordResearch: keywordResearchInput, collaboratorBriefs,
      }),
      outputSchema: specialistSchema(specialist) as z.ZodType<T>,
      responseJsonSchema: specialistResponseJsonSchema(specialist),
      maxOutputCharacters, signal: input.signal,
    });
    return response.value;
  };

  await input.updateStatus?.('SEO, UX and accessibility specialists are reviewing approved Search Intelligence and Knowledge Pack guidance.');
  const [seo, ux, accessibility] = await Promise.all([
    run<z.infer<typeof SeoSpecialistBriefSchema>>('SEO', undefined, keywordResearch),
    run<z.infer<typeof UxSpecialistBriefSchema>>('UX'),
    run<z.infer<typeof AccessibilitySpecialistBriefSchema>>('ACCESSIBILITY'),
  ]);

  await input.updateStatus?.('The conversion specialist is reconciling search intent, Knowledge Pack rules and the user journey.');
  const conversion = await run<z.infer<typeof ConversionSpecialistBriefSchema>>('CONVERSION', { SEO: seo, UX: ux, ACCESSIBILITY: accessibility });
  await input.updateStatus?.('The copy specialist is defining messaging guidance inside the approved search and knowledge constraints.');
  const copy = await run<z.infer<typeof CopySpecialistBriefSchema>>('COPY', { SEO: seo, UX: ux, CONVERSION: conversion, ACCESSIBILITY: accessibility });
  await input.updateStatus?.('The design specialist is translating governed UX, conversion, copy and accessibility guidance into visual direction.');
  const design = await run<z.infer<typeof DesignSpecialistBriefSchema>>('DESIGN', { UX: ux, CONVERSION: conversion, COPY: copy, ACCESSIBILITY: accessibility });

  await input.updateStatus?.('The specialist director is resolving conflicts against the pinned Knowledge Pack and Search Intelligence inputs.');
  const directorResponse = await input.provider.generateStructuredOutput({
    prompt: composeSpecialistDirectorPrompt({
      plan: input.plan, facts: input.facts, searchIntelligence: input.searchIntelligence,
      knowledgeGuidelines, briefs: { keywordResearch, seo, ux, conversion, copy, design, accessibility },
    }),
    outputSchema: SpecialistDirectorReviewSchema,
    responseJsonSchema: DIRECTOR_REVIEW_RESPONSE_JSON_SCHEMA,
    maxOutputCharacters, signal: input.signal,
  });

  return SpecialistAgentTeamOutputSchema.parse({
    version: SPECIALIST_AGENT_TEAM_VERSION, keywordResearch, seo, ux, conversion, copy,
    design, accessibility, directorReview: directorResponse.value,
  });
}

function briefForPage(brief: SpecialistBrief, pageReference: string) {
  return { ...brief, recommendations: brief.recommendations.filter(recommendation =>
    recommendation.pageReferences.length === 0 || recommendation.pageReferences.includes(pageReference)) };
}

function keywordResearchForDownstream(report: KeywordResearchReport) {
  return {
    specialist: report.specialist, researchOnly: report.researchOnly, objective: report.objective,
    coverage: report.coverage, limitations: report.limitations, handoffToSeo: report.handoffToSeo,
  };
}

export function attachSpecialistTeamContext(input: {
  prompt: string;
  team: SpecialistAgentTeamOutput;
  scope: 'SITE' | 'PAGE' | 'CONTENT';
  pageReference?: string;
}) {
  const base = JSON.parse(input.prompt) as Record<string, unknown>;
  const compactKeywordResearch = keywordResearchForDownstream(input.team.keywordResearch);
  const team = input.pageReference
    ? {
      version: input.team.version, keywordResearch: compactKeywordResearch,
      seo: briefForPage(input.team.seo, input.pageReference),
      ux: briefForPage(input.team.ux, input.pageReference),
      conversion: briefForPage(input.team.conversion, input.pageReference),
      copy: briefForPage(input.team.copy, input.pageReference),
      design: briefForPage(input.team.design, input.pageReference),
      accessibility: briefForPage(input.team.accessibility, input.pageReference),
      directorReview: input.team.directorReview,
    }
    : { ...input.team, keywordResearch: compactKeywordResearch };

  return stableGenerationStringify({
    ...base,
    specialistCollaboration: {
      scope: input.scope, pageReference: input.pageReference, team,
      synthesisRules: [
        'Use specialist guidance to make judgement calls where governance allows creative discretion.',
        'Keyword Research is evidence gathering for SEO; downstream generators should follow the SEO synthesis and director resolution rather than treating raw research opportunities as page instructions.',
        'Hard platform constraints, pinned Knowledge Pack guidance, verified facts, approved Search Intelligence, template compatibility, component contracts, native booking rules, and validators always override specialist preferences.',
        'Resolve cross-discipline tension according to the director review instead of blindly following one specialist.',
        'Do not copy planning prose verbatim into public content; translate it into the requested structured output.',
      ],
    },
  });
}