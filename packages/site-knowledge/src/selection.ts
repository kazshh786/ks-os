import type {
  KnowledgeConflict,
  KnowledgeDomain,
  KnowledgeImportBundle,
  KnowledgePackStatus,
  KnowledgePriority,
  KnowledgePublicationEffect,
  KnowledgeRule,
  KnowledgeSource,
  KnowledgeValidationType,
  SiteConversionRoleSchema,
  SitePageTypeSchema,
  SiteSectionTypeSchema,
} from './contracts.js';
import type { z } from 'zod';
import { assertKnowledgePackSelectable } from './lifecycle.js';
import { contentDigest, stableStringify } from './normalization.js';

type SitePageType = z.infer<typeof SitePageTypeSchema>;
type SiteSectionType = z.infer<typeof SiteSectionTypeSchema>;
type SiteConversionRole = z.infer<typeof SiteConversionRoleSchema>;

const AUTHORITY_ORDER = {
  PLATFORM: 0,
  OFFICIAL_STANDARD: 1,
  OFFICIAL_DOCUMENTATION: 2,
  EXPERT_APPROVED: 3,
  ADVISORY: 4,
} as const;
const EFFECT_ORDER: Record<KnowledgePublicationEffect, number> = {
  BLOCK: 0,
  WARNING: 1,
  RECOMMENDATION: 2,
};
const PRIORITY_ORDER: Record<KnowledgePriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};
const DOMAIN_ORDER: Record<KnowledgeDomain, number> = {
  ACCESSIBILITY: 0,
  BOOKING: 1,
  PERFORMANCE: 2,
  TECHNICAL_SEO: 3,
  LOCAL_SEO: 4,
  CONTENT_SEO: 5,
  TRUST: 6,
  CONVERSION: 7,
  UX: 8,
  MOBILE: 9,
  COPYWRITING: 10,
};

export interface SelectableKnowledgePack {
  reference: string;
  semanticVersion: string;
  schemaVersion: number;
  status: KnowledgePackStatus;
  bundle: KnowledgeImportBundle;
  conflicts: readonly KnowledgeConflict[];
}

export interface SelectKnowledgeRulesInput {
  pack: SelectableKnowledgePack;
  callerPolicy?: 'ACTIVE_ONLY' | 'APPROVED_OR_ACTIVE';
  taskType?: string;
  pageType?: SitePageType;
  sectionTypes?: readonly SiteSectionType[];
  conversionRole?: SiteConversionRole;
  domains?: readonly KnowledgeDomain[];
  validationTypes?: readonly KnowledgeValidationType[];
  priorities?: readonly KnowledgePriority[];
  availableBusinessDataKeys?: readonly string[];
  includeWarnings?: boolean;
  includeRecommendations?: boolean;
  maxRuleCount?: number;
  maxEstimatedCharacterCount?: number;
}

export interface KnowledgeRuleSelection {
  packReference: string;
  semanticVersion: string;
  schemaVersion: number;
  rules: KnowledgeRule[];
  missingBusinessData: string[];
  omittedRuleCount: number;
  estimatedCharacterCount: number;
  requiredRulesExceededLimit: boolean;
  contentDigest: string;
}

export function compareKnowledgeRules(left: KnowledgeRule, right: KnowledgeRule) {
  return AUTHORITY_ORDER[left.enforcementAuthority]
    - AUTHORITY_ORDER[right.enforcementAuthority]
    || EFFECT_ORDER[left.publicationEffect] - EFFECT_ORDER[right.publicationEffect]
    || PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || DOMAIN_ORDER[left.domain] - DOMAIN_ORDER[right.domain]
    || left.ruleId.localeCompare(right.ruleId);
}

function isRequiredRule(rule: KnowledgeRule) {
  const critical = rule.priority === 'CRITICAL';
  return rule.enforcementAuthority === 'PLATFORM'
    || rule.publicationEffect === 'BLOCK'
    || critical
    || (rule.domain === 'ACCESSIBILITY' && critical)
    || (rule.validationType === 'DATA_REQUIRED' && critical)
    || rule.ruleId.includes('NATIVE_BOOKING')
    || rule.ruleId.includes('NO_FABRICATED')
    || Boolean(rule.prohibitedBehaviour);
}

function ruleCharacterEstimate(rule: KnowledgeRule) {
  return stableStringify({
    ruleId: rule.ruleId,
    principle: rule.principle,
    implementationInstruction: rule.implementationInstruction,
    prohibitedBehaviour: rule.prohibitedBehaviour,
    deterministicTestDescription: rule.deterministicTestDescription,
    aiReviewInstruction: rule.aiReviewInstruction,
    humanReviewInstruction: rule.humanReviewInstruction,
    sourceIds: rule.sourceIds,
  }).length;
}

function intersects<T>(left: readonly T[], right: readonly T[]) {
  return left.some(value => right.includes(value));
}

export function selectKnowledgeRules(
  input: SelectKnowledgeRulesInput,
): KnowledgeRuleSelection {
  assertKnowledgePackSelectable(
    input.pack.status,
    input.callerPolicy ?? 'ACTIVE_ONLY',
  );
  const unresolvedRuleIds = new Set(
    input.pack.conflicts
      .filter(entry => !entry.resolved)
      .flatMap(entry => entry.ruleIds),
  );
  const availableData = new Set(input.availableBusinessDataKeys ?? []);
  const includeWarnings = input.includeWarnings ?? true;
  const includeRecommendations = input.includeRecommendations ?? true;
  const maxRuleCount = Math.max(1, Math.min(input.maxRuleCount ?? 50, 500));
  const maxCharacters = Math.max(
    500,
    Math.min(input.maxEstimatedCharacterCount ?? 20_000, 200_000),
  );

  const candidates = input.pack.bundle.rules
    .filter(rule => rule.status === 'ACCEPTED')
    .filter(rule => !unresolvedRuleIds.has(rule.ruleId))
    .filter(rule => !input.pageType
      || rule.applicablePageTypes.length === 0
      || rule.applicablePageTypes.includes(input.pageType))
    .filter(rule => !input.sectionTypes?.length
      || rule.applicableSectionTypes.length === 0
      || intersects(rule.applicableSectionTypes, input.sectionTypes))
    .filter(rule => !input.conversionRole
      || rule.conversionRoles.length === 0
      || rule.conversionRoles.includes(input.conversionRole))
    .filter(rule => !input.domains?.length
      || input.domains.includes(rule.domain))
    .filter(rule => !input.validationTypes?.length
      || input.validationTypes.includes(rule.validationType))
    .filter(rule => !input.priorities?.length
      || input.priorities.includes(rule.priority))
    .filter(rule => rule.publicationEffect !== 'WARNING' || includeWarnings)
    .filter(rule =>
      rule.publicationEffect !== 'RECOMMENDATION' || includeRecommendations)
    .sort(compareKnowledgeRules);

  const required = candidates.filter(isRequiredRule);
  const optional = candidates.filter(rule => !isRequiredRule(rule));
  const selected: KnowledgeRule[] = [];
  let characterCount = 0;
  for (const rule of required) {
    selected.push(rule);
    characterCount += ruleCharacterEstimate(rule);
  }
  const requiredRulesExceededLimit = selected.length > maxRuleCount
    || characterCount > maxCharacters;
  for (const rule of optional) {
    const estimate = ruleCharacterEstimate(rule);
    if (selected.length + 1 > maxRuleCount) continue;
    if (characterCount + estimate > maxCharacters) continue;
    selected.push(rule);
    characterCount += estimate;
  }
  selected.sort(compareKnowledgeRules);
  const missingBusinessData = [...new Set(
    selected.flatMap(rule =>
      rule.requiredBusinessData.filter(key => !availableData.has(key))),
  )].sort();
  const resultWithoutDigest = {
    packReference: input.pack.reference,
    semanticVersion: input.pack.semanticVersion,
    schemaVersion: input.pack.schemaVersion,
    rules: selected,
    missingBusinessData,
    omittedRuleCount: candidates.length - selected.length,
    estimatedCharacterCount: characterCount,
    requiredRulesExceededLimit,
  };
  return {
    ...resultWithoutDigest,
    contentDigest: contentDigest(resultWithoutDigest),
  };
}

export interface SiteGenerationKnowledgeContext {
  packReference: string;
  semanticVersion: string;
  schemaVersion: number;
  applicableRuleIds: string[];
  requiredInstructions: string[];
  prohibitedBehaviours: string[];
  missingBusinessDataRequirements: string[];
  deterministicRequirements: string[];
  aiReviewInstructions: string[];
  humanReviewInstructions: string[];
  pagePlaybook: {
    pageType: SitePageType;
    conversionRole: SiteConversionRole;
    sections: Array<{
      sectionType: SiteSectionType;
      requirement: string;
      sectionOrderMin: number;
      sectionOrderMax: number;
      sectionPurpose: string;
      copyInstruction?: string;
      seoInstruction?: string;
      trustInstruction?: string;
      bookingInstruction?: string;
      mobileInstruction?: string;
      accessibilityInstruction?: string;
      allowedPrimaryCtaTypes: string[];
      allowedSecondaryCtaTypes: string[];
    }>;
  } | null;
  sourceReferences: Array<{
    sourceId: string;
    sourceTitle: string;
    author?: string;
    editionOrVersion?: string;
  }>;
  omittedRuleCount: number;
  estimatedCharacterCount: number;
  requiredRulesExceededLimit: boolean;
  contentDigest: string;
}

export interface PrepareSiteGenerationKnowledgeContextInput
  extends Omit<SelectKnowledgeRulesInput, 'pageType' | 'sectionTypes' | 'conversionRole'> {
  pageType: SitePageType;
  plannedSections: readonly SiteSectionType[];
  conversionRole: SiteConversionRole;
}

function safeSourceReference(source: KnowledgeSource) {
  return {
    sourceId: source.sourceId,
    sourceTitle: source.sourceTitle,
    author: source.author,
    editionOrVersion: source.editionOrVersion,
  };
}

export function prepareSiteGenerationKnowledgeContext(
  input: PrepareSiteGenerationKnowledgeContextInput,
): SiteGenerationKnowledgeContext {
  const selection = selectKnowledgeRules({
    ...input,
    pageType: input.pageType,
    sectionTypes: input.plannedSections,
    conversionRole: input.conversionRole,
  });
  const sourceIds = new Set(selection.rules.flatMap(rule => rule.sourceIds));
  const sources = input.pack.bundle.sources
    .filter(source => sourceIds.has(source.sourceId))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    .map(safeSourceReference);
  const playbook = input.pack.bundle.pagePlaybooks.find(page =>
    page.pageType === input.pageType
    && page.conversionRole === input.conversionRole);
  const safePagePlaybook = playbook
    ? {
      pageType: playbook.pageType,
      conversionRole: playbook.conversionRole,
      sections: playbook.sections
        .filter(section => input.plannedSections.includes(section.sectionType))
        .map(section => ({
          sectionType: section.sectionType,
          requirement: section.requirement,
          sectionOrderMin: section.sectionOrderMin,
          sectionOrderMax: section.sectionOrderMax,
          sectionPurpose: section.sectionPurpose,
          copyInstruction: section.copyInstruction,
          seoInstruction: section.seoInstruction,
          trustInstruction: section.trustInstruction,
          bookingInstruction: section.bookingInstruction,
          mobileInstruction: section.mobileInstruction,
          accessibilityInstruction: section.accessibilityInstruction,
          allowedPrimaryCtaTypes: section.allowedPrimaryCtaTypes,
          allowedSecondaryCtaTypes: section.allowedSecondaryCtaTypes,
        })),
    }
    : null;
  const contextWithoutDigest = {
    packReference: selection.packReference,
    semanticVersion: selection.semanticVersion,
    schemaVersion: selection.schemaVersion,
    applicableRuleIds: selection.rules.map(rule => rule.ruleId),
    requiredInstructions: selection.rules.map(
      rule => rule.implementationInstruction,
    ),
    prohibitedBehaviours: selection.rules
      .map(rule => rule.prohibitedBehaviour)
      .filter((value): value is string => Boolean(value)),
    missingBusinessDataRequirements: selection.missingBusinessData,
    deterministicRequirements: selection.rules
      .filter(rule => rule.validationType === 'DETERMINISTIC'
        || rule.validationType === 'MIXED')
      .map(rule =>
        rule.deterministicTestDescription ?? rule.implementationInstruction),
    aiReviewInstructions: selection.rules
      .filter(rule => rule.validationType === 'AI_REVIEW'
        || rule.validationType === 'MIXED')
      .map(rule => rule.aiReviewInstruction)
      .filter((value): value is string => Boolean(value)),
    humanReviewInstructions: selection.rules
      .filter(rule => rule.validationType === 'HUMAN_REVIEW'
        || rule.validationType === 'MIXED'
        || rule.supportType === 'INFERRED')
      .map(rule => rule.humanReviewInstruction)
      .filter((value): value is string => Boolean(value)),
    pagePlaybook: safePagePlaybook,
    sourceReferences: sources,
    omittedRuleCount: selection.omittedRuleCount,
    estimatedCharacterCount: selection.estimatedCharacterCount,
    requiredRulesExceededLimit: selection.requiredRulesExceededLimit,
  };
  return {
    ...contextWithoutDigest,
    contentDigest: contentDigest(contextWithoutDigest),
  };
}
