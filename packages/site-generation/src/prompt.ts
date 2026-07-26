import type { SiteGenerationKnowledgeContext } from '@ks-os/site-knowledge';
import type {
  BlueprintGenerationPageSchema,
  TemplateGenerationConstraint,
  VerifiedBusinessFacts,
} from './contracts.js';
import type { z } from 'zod';
import { selectGenerationSafeFacts } from './facts.js';
import { generationDigest, stableGenerationStringify } from './normalization.js';

type BlueprintPage = z.infer<typeof BlueprintGenerationPageSchema>;

export interface ComposeGenerationContextInput {
  page: BlueprintPage;
  template: TemplateGenerationConstraint;
  facts: VerifiedBusinessFacts;
  knowledge: SiteGenerationKnowledgeContext;
  outputSchemaDescription: Record<string, unknown>;
  repair?: {
    attempt: number;
    findings: readonly { code: string; message: string }[];
  };
}

const SYSTEM_CONTRACT = [
  'Generate structured KS OS public-site content only.',
  'The sole primary conversion is native KS OS appointment booking.',
  'Return only JSON matching the supplied schema; no Markdown fences.',
  'Never return HTML, CSS, JavaScript, executable code, imports, embeds, or external booking URLs.',
  'Never invent services, prices, staff, locations, credentials, reviews, availability, guarantees, outcomes, or awards.',
  'Mark missing facts for agency review.',
].join(' ');

export function composeGenerationPrompt(input: ComposeGenerationContextInput) {
  const context = {
    systemGenerationContract: SYSTEM_CONTRACT,
    platformRules: {
      ruleIds: input.knowledge.applicableRuleIds,
      requiredInstructions: input.knowledge.requiredInstructions,
      prohibitedBehaviours: input.knowledge.prohibitedBehaviours,
      deterministicRequirements: input.knowledge.deterministicRequirements,
    },
    pageSchema: input.outputSchemaDescription,
    templateLayoutConstraints: input.template,
    approvedBlueprintPage: input.page,
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
    repair: input.repair,
  };
  const prompt = stableGenerationStringify(context);
  return {
    prompt,
    digestSha256: generationDigest(context),
    inputCharacterEstimate: prompt.length,
  };
}
