import type { SiteGenerationKnowledgeContext } from '@ks-os/site-knowledge';
import type {
  AssetCoveragePlan,
  BlueprintGenerationPageSchema,
  GeneratedPage,
  PageCompositionPlan,
  SiteCompositionStrategy,
  TemplateGenerationConstraint,
  VerifiedBusinessFacts,
} from './contracts.js';
import type { z } from 'zod';
import { selectGenerationSafeFacts } from './facts.js';
import { generationDigest, stableGenerationStringify } from './normalization.js';
import { componentPromptMetadata } from './composition.js';
import { getSiteComponent } from '@ks-os/site-components';
import type { PageSeoBrief, SearchIntelligenceStrategyV2 } from './search-intelligence.js';

type BlueprintPage = z.infer<typeof BlueprintGenerationPageSchema>;
export type SiteGenerationPhase = 'INITIAL_DRAFT' | 'SPECIALIST_REFINEMENT';

export interface ComposeGenerationContextInput {
  page: BlueprintPage;
  template: TemplateGenerationConstraint;
  facts: VerifiedBusinessFacts;
  knowledge: SiteGenerationKnowledgeContext;
  outputSchemaDescription: Record<string, unknown>;
  siteStrategy?: SiteCompositionStrategy;
  pageCompositionPlan?: PageCompositionPlan;
  assetCoveragePlan?: AssetCoveragePlan;
  lockedComponentSequence?: readonly { sectionType: string; componentKey?: string }[];
  approvedSearchStrategy?: SearchIntelligenceStrategyV2;
  pageSeoBrief?: PageSeoBrief;
  generationPhase?: SiteGenerationPhase;
  existingDraftPage?: GeneratedPage;
  repair?: {
    attempt: number;
    findings: readonly { code: string; message: string }[];
  };
}

const SYSTEM_CONTRACT = [
  'Create the best complete KS OS website draft you can from the supplied governed context now.',
  'Treat SEO, UX, conversion, accessibility, responsive clarity, trust and persuasive copy as baseline quality requirements of the first draft rather than prerequisites that can block creation.',
  'Missing non-critical business data must not stop draft generation: omit unsupported public claims, use only safe known facts, and mark genuine gaps for agency review.',
  'The sole primary conversion is native KS OS appointment booking.',
  'Return only JSON matching the supplied schema; no Markdown fences.',
  'Never return HTML, CSS, JavaScript, executable code, imports, embeds, or external booking URLs.',
  'Never invent services, prices, staff, locations, credentials, reviews, availability, guarantees, outcomes, awards, business history, or search evidence.',
].join(' ');

const REFINEMENT_CONTRACT = [
  'This is a refinement pass over an already valid generated draft.',
  'Improve clarity, usefulness, search quality, persuasion, accessibility and visual/content rhythm using the supplied specialist review.',
  'Preserve every server-controlled page identity field, section count, section order, semantic section type and allow-listed componentKey from the existing draft and composition plan.',
  'Do not introduce new unsupported facts, claims, URLs, services, staff, locations, prices, credentials, reviews, results or awards.',
  'A refinement should make the existing draft better, not redesign the governed architecture.',
].join(' ');

export function composeGenerationPrompt(input: ComposeGenerationContextInput) {
  const generationPhase = input.generationPhase ?? 'INITIAL_DRAFT';
  const selectedComponentContracts = input.pageCompositionPlan?.selectedComponents
    .map(selection => getSiteComponent(selection.componentKey))
    .filter(component => component !== null)
    .map(componentPromptMetadata) ?? [];
  const context = {
    systemGenerationContract: SYSTEM_CONTRACT,
    generationTask: generationPhase === 'SPECIALIST_REFINEMENT'
      ? REFINEMENT_CONTRACT
      : 'Generate a complete, coherent, useful public page in this pass. Do not defer ordinary copy, SEO, UX, conversion or accessibility work to another system.',
    generationPhase,
    existingDraftPage: generationPhase === 'SPECIALIST_REFINEMENT'
      ? input.existingDraftPage
      : undefined,
    platformRules: {
      ruleIds: input.knowledge.applicableRuleIds,
      requiredInstructions: input.knowledge.requiredInstructions,
      prohibitedBehaviours: input.knowledge.prohibitedBehaviours,
      deterministicRequirements: input.knowledge.deterministicRequirements,
    },
    pageSchema: input.outputSchemaDescription,
    templateLayoutConstraints: input.template,
    approvedBlueprintPage: input.page,
    approvedSearchStrategy: input.approvedSearchStrategy,
    immutablePageSeoBrief: input.pageSeoBrief,
    siteCompositionStrategy: input.siteStrategy,
    pageCompositionPlan: input.pageCompositionPlan,
    selectedComponentContracts,
    pageAssetAssignments: input.assetCoveragePlan?.assignments
      .filter(assignment => assignment.pageReference === input.page.pageReference),
    lockedComponentSequence: input.lockedComponentSequence,
    verifiedBusinessFacts: selectGenerationSafeFacts(input.facts),
    pageAndSectionPlaybooks: input.knowledge.pagePlaybook,
    applicableExpertRuleIds: input.knowledge.applicableRuleIds,
    nativeBookingRequirements: {
      actionType: 'KS_OS_BOOKING',
      bookingDestinationIsResolvedByServer: true,
      providerMustNotReturnDestinationUrl: true,
    },
    requiredOutputContract: input.outputSchemaDescription,
    prohibitedClaimsAndBehaviours: input.knowledge.prohibitedBehaviours,
    missingBusinessDataRequirements: input.knowledge.missingBusinessDataRequirements,
    componentOutputRule: 'Every generated section must preserve its planned semantic type and exact allow-listed componentKey. Preview placeholders remain findings and never become asset references.',
    repair: input.repair,
  };
  const prompt = stableGenerationStringify(context);
  return {
    prompt,
    digestSha256: generationDigest(context),
    inputCharacterEstimate: prompt.length,
  };
}
