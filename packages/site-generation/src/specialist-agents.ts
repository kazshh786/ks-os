import { PublicReferenceSchema } from '@ks-os/contracts';
import { z } from 'zod';
import type { GenerationPlan, VerifiedBusinessFacts } from './contracts.js';
import { selectGenerationSafeFacts } from './facts.js';
import { stableGenerationStringify } from './normalization.js';
import type { SiteGenerationProvider } from './provider.js';
import type {
  PageSeoBrief,
  SearchIntelligenceStrategyV2,
  SearchResearchEvidence,
} from './search-intelligence.js';

export const SPECIALIST_AGENT_TEAM_VERSION = 'agent-team-1' as const;

export const SpecialistAgentNameSchema = z.enum([
  'SEO',
  'UX',
  'CONVERSION',
  'COPY',
  'DESIGN',
  'ACCESSIBILITY',
]);
export type SpecialistAgentName = z.infer<typeof SpecialistAgentNameSchema>;

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

const SeoSpecialistBriefSchema = SpecialistBriefSchema.extend({
  specialist: z.literal('SEO'),
});
const UxSpecialistBriefSchema = SpecialistBriefSchema.extend({
  specialist: z.literal('UX'),
});
const ConversionSpecialistBriefSchema = SpecialistBriefSchema.extend({
  specialist: z.literal('CONVERSION'),
});
const CopySpecialistBriefSchema = SpecialistBriefSchema.extend({
  specialist: z.literal('COPY'),
});
const DesignSpecialistBriefSchema = SpecialistBriefSchema.extend({
  specialist: z.literal('DESIGN'),
});
const AccessibilitySpecialistBriefSchema = SpecialistBriefSchema.extend({
  specialist: z.literal('ACCESSIBILITY'),
});

export const SpecialistDirectorReviewSchema = z.object({
  verdict: z.enum(['APPROVED', 'REVISE']),
  summary: z.string().trim().min(20).max(1_500),
  conflicts: z.array(z.object({
    specialists: z.array(SpecialistAgentNameSchema).min(2).max(6),
    issue: z.string().trim().min(10).max(1_000),
    resolution: z.string().trim().min(10).max(1_000),
  }).strict()).max(20).default([]),
  crossDisciplinePriorities: z.array(z.string().trim().min(10).max(1_000)).min(2).max(20),
  nonNegotiables: z.array(z.string().trim().min(10).max(1_000)).min(2).max(20),
}).strict();
export type SpecialistDirectorReview = z.infer<typeof SpecialistDirectorReviewSchema>;

export const SpecialistAgentTeamOutputSchema = z.object({
  version: z.literal(SPECIALIST_AGENT_TEAM_VERSION),
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

const ROLE_MANDATES: Record<SpecialistAgentName, readonly string[]> = {
  SEO: [
    'Own organic-search interpretation, information discoverability, metadata direction, and internal-linking priorities.',
    'Use only the approved Search Intelligence strategy, briefs, and evidence. Do not invent keywords, rankings, volumes, competitors, locations, or market facts.',
    'Protect search intent without keyword stuffing or weakening the user journey.',
  ],
  UX: [
    'Own user needs, information hierarchy, task flow, interaction clarity, content sequencing, and mobile journey quality.',
    'Recommend what each page must help the visitor understand or do; do not choose unsupported components or override approved layout constraints.',
    'Reduce cognitive load and ambiguity while preserving meaningful page depth.',
  ],
  CONVERSION: [
    'Own the path from visitor intent to the native KS OS booking action.',
    'Identify trust needs, objections, friction, reassurance, CTA timing, and conversion continuity without creating false urgency or unsupported proof.',
    'The sole primary conversion is native KS OS appointment booking; never propose an external booking destination.',
  ],
  COPY: [
    'Own messaging hierarchy, voice, clarity, persuasion, heading direction, evidence usage, and CTA language.',
    'Do not write final page copy in this planning step. Give guidance that the page generator can execute later.',
    'Never invent claims, testimonials, outcomes, credentials, guarantees, prices, availability, or business history.',
  ],
  DESIGN: [
    'Own visual hierarchy, layout rhythm, typography intent, image treatment, component density, responsive behaviour, and restrained motion.',
    'Treat the approved component registry and layout manifest as the buildable design vocabulary. Do not propose arbitrary UI outside it.',
    'Avoid formulaic sameness; recommend purposeful variation while keeping the brand coherent.',
  ],
  ACCESSIBILITY: [
    'Own accessible interaction, readable content hierarchy, keyboard and focus expectations, motion restraint, semantic clarity, and visual legibility.',
    'Accessibility requirements are hard constraints, not aesthetic preferences.',
    'Flag likely conflicts early so design, copy, and conversion guidance can resolve them before page generation.',
  ],
};

const SPECIALIST_BRIEF_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['specialist', 'objective', 'principles', 'recommendations', 'risks', 'handoffNotes'],
  properties: {
    specialist: { type: 'string', enum: SpecialistAgentNameSchema.options },
    objective: { type: 'string' },
    principles: { type: 'array', items: { type: 'string' } },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['priority', 'instruction', 'rationale', 'pageReferences'],
        properties: {
          priority: { type: 'string', enum: ['MUST', 'SHOULD', 'COULD'] },
          instruction: { type: 'string' },
          rationale: { type: 'string' },
          pageReferences: { type: 'array', items: { type: 'string', format: 'uuid' } },
        },
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
    handoffNotes: { type: 'array', items: { type: 'string' } },
  },
};

const DIRECTOR_REVIEW_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'conflicts', 'crossDisciplinePriorities', 'nonNegotiables'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVED', 'REVISE'] },
    summary: { type: 'string' },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['specialists', 'issue', 'resolution'],
        properties: {
          specialists: { type: 'array', items: { type: 'string', enum: SpecialistAgentNameSchema.options } },
          issue: { type: 'string' },
          resolution: { type: 'string' },
        },
      },
    },
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

export function composeSpecialistAgentPrompt(input: {
  specialist: SpecialistAgentName;
  plan: GenerationPlan;
  facts: VerifiedBusinessFacts;
  searchIntelligence: ApprovedSpecialistSearchContext;
  collaboratorBriefs?: Partial<Record<SpecialistAgentName, SpecialistBrief>>;
}) {
  return stableGenerationStringify({
    systemContract: [
      `Act only as the ${input.specialist} specialist in a governed website-generation team.`,
      'Return structured planning guidance only. Do not return final page copy, HTML, CSS, JavaScript, framework code, URLs, or embeds.',
      'Verified facts, approved Search Intelligence, blueprint identity, template constraints, component compatibility, native booking rules, accessibility rules, and downstream validators remain authoritative.',
      'Specialist recommendations are expert guidance inside those hard constraints; never weaken or bypass governance.',
      'Use only approved page references from the supplied blueprint when attaching a recommendation to pages.',
    ],
    operation: `SPECIALIST_${input.specialist}_BRIEF_V1`,
    teamVersion: SPECIALIST_AGENT_TEAM_VERSION,
    roleMandate: ROLE_MANDATES[input.specialist],
    approvedBlueprint: input.plan,
    approvedSearchIntelligence: {
      strategy: input.searchIntelligence.strategy,
      briefs: input.searchIntelligence.briefs,
      evidence: input.searchIntelligence.evidence,
    },
    verifiedBusinessFacts: selectGenerationSafeFacts(input.facts),
    collaboratorBriefs: input.collaboratorBriefs,
  });
}

export function composeSpecialistDirectorPrompt(input: {
  plan: GenerationPlan;
  briefs: {
    seo: SpecialistBrief;
    ux: SpecialistBrief;
    conversion: SpecialistBrief;
    copy: SpecialistBrief;
    design: SpecialistBrief;
    accessibility: SpecialistBrief;
  };
}) {
  return stableGenerationStringify({
    systemContract: [
      'Act as the project director and critic for a governed specialist website-generation team.',
      'Reconcile conflicts between specialists without inventing business facts or overriding platform governance.',
      'Prefer solutions that satisfy user needs, search intent, conversion clarity, brand quality, and accessibility together.',
      'If two recommendations conflict, state the conflict and a concrete resolution for downstream composition and generation.',
      'Return structured JSON only. Do not return page copy or implementation code.',
    ],
    operation: 'SPECIALIST_DIRECTOR_REVIEW_V1',
    teamVersion: SPECIALIST_AGENT_TEAM_VERSION,
    approvedPageReferences: input.plan.pages.map(page => page.pageReference),
    specialistBriefs: input.briefs,
  });
}

export async function runSpecialistAgentTeam(input: {
  plan: GenerationPlan;
  facts: VerifiedBusinessFacts;
  searchIntelligence: ApprovedSpecialistSearchContext;
  provider: SiteGenerationProvider;
  maxOutputCharacters: number;
  signal?: AbortSignal;
  updateStatus?: (message: string) => Promise<void>;
}): Promise<SpecialistAgentTeamOutput> {
  const maxOutputCharacters = Math.min(input.maxOutputCharacters, 50_000);

  const run = async <T extends SpecialistBrief>(
    specialist: SpecialistAgentName,
    collaboratorBriefs?: Partial<Record<SpecialistAgentName, SpecialistBrief>>,
  ) => {
    const response = await input.provider.generateStructuredOutput<T>({
      prompt: composeSpecialistAgentPrompt({
        specialist,
        plan: input.plan,
        facts: input.facts,
        searchIntelligence: input.searchIntelligence,
        collaboratorBriefs,
      }),
      outputSchema: specialistSchema(specialist) as z.ZodType<T>,
      responseJsonSchema: specialistResponseJsonSchema(specialist),
      maxOutputCharacters,
      signal: input.signal,
    });
    return response.value;
  };

  await input.updateStatus?.('SEO, UX and accessibility specialists are reviewing the approved inputs.');
  const [seo, ux, accessibility] = await Promise.all([
    run<z.infer<typeof SeoSpecialistBriefSchema>>('SEO'),
    run<z.infer<typeof UxSpecialistBriefSchema>>('UX'),
    run<z.infer<typeof AccessibilitySpecialistBriefSchema>>('ACCESSIBILITY'),
  ]);

  await input.updateStatus?.('The conversion specialist is reconciling search intent and the user journey.');
  const conversion = await run<z.infer<typeof ConversionSpecialistBriefSchema>>('CONVERSION', {
    SEO: seo,
    UX: ux,
    ACCESSIBILITY: accessibility,
  });

  await input.updateStatus?.('The copy specialist is defining messaging guidance from the agreed journey.');
  const copy = await run<z.infer<typeof CopySpecialistBriefSchema>>('COPY', {
    SEO: seo,
    UX: ux,
    CONVERSION: conversion,
    ACCESSIBILITY: accessibility,
  });

  await input.updateStatus?.('The design specialist is translating the strategy into governed visual direction.');
  const design = await run<z.infer<typeof DesignSpecialistBriefSchema>>('DESIGN', {
    UX: ux,
    CONVERSION: conversion,
    COPY: copy,
    ACCESSIBILITY: accessibility,
  });

  await input.updateStatus?.('The specialist director is resolving cross-discipline conflicts before composition.');
  const directorResponse = await input.provider.generateStructuredOutput({
    prompt: composeSpecialistDirectorPrompt({
      plan: input.plan,
      briefs: { seo, ux, conversion, copy, design, accessibility },
    }),
    outputSchema: SpecialistDirectorReviewSchema,
    responseJsonSchema: DIRECTOR_REVIEW_RESPONSE_JSON_SCHEMA,
    maxOutputCharacters,
    signal: input.signal,
  });

  return SpecialistAgentTeamOutputSchema.parse({
    version: SPECIALIST_AGENT_TEAM_VERSION,
    seo,
    ux,
    conversion,
    copy,
    design,
    accessibility,
    directorReview: directorResponse.value,
  });
}

function briefForPage(brief: SpecialistBrief, pageReference: string) {
  return {
    ...brief,
    recommendations: brief.recommendations.filter(recommendation =>
      recommendation.pageReferences.length === 0
      || recommendation.pageReferences.includes(pageReference)),
  };
}

export function attachSpecialistTeamContext(input: {
  prompt: string;
  team: SpecialistAgentTeamOutput;
  scope: 'SITE' | 'PAGE' | 'CONTENT';
  pageReference?: string;
}) {
  const base = JSON.parse(input.prompt) as Record<string, unknown>;
  const team = input.pageReference
    ? {
      version: input.team.version,
      seo: briefForPage(input.team.seo, input.pageReference),
      ux: briefForPage(input.team.ux, input.pageReference),
      conversion: briefForPage(input.team.conversion, input.pageReference),
      copy: briefForPage(input.team.copy, input.pageReference),
      design: briefForPage(input.team.design, input.pageReference),
      accessibility: briefForPage(input.team.accessibility, input.pageReference),
      directorReview: input.team.directorReview,
    }
    : input.team;

  return stableGenerationStringify({
    ...base,
    specialistCollaboration: {
      scope: input.scope,
      pageReference: input.pageReference,
      team,
      synthesisRules: [
        'Use specialist guidance to make judgement calls where governance allows creative discretion.',
        'Hard platform constraints, verified facts, approved Search Intelligence, template compatibility, component contracts, native booking rules, and validators always override specialist preferences.',
        'Resolve cross-discipline tension according to the director review instead of blindly following one specialist.',
        'Do not copy planning prose verbatim into public content; translate it into the requested structured output.',
      ],
    },
  });
}
