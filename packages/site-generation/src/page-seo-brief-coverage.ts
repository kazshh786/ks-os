import type { PageSeoBrief } from './search-intelligence.js';

export const PageSeoBriefEnforcementClass = {
  DETERMINISTICALLY_ENFORCED: 'DETERMINISTICALLY_ENFORCED',
  PROMPT_GUIDANCE_WITH_VALIDATION: 'PROMPT_GUIDANCE_WITH_VALIDATION',
  REVIEW_ONLY: 'REVIEW_ONLY',
  NOT_APPLICABLE_TO_GENERATED_PAGE: 'NOT_APPLICABLE_TO_GENERATED_PAGE',
} as const;

export type PageSeoBriefEnforcementClass = typeof PageSeoBriefEnforcementClass[keyof typeof PageSeoBriefEnforcementClass];

export interface PageSeoBriefFieldCoverage {
  field: keyof PageSeoBrief;
  consumer: string;
  enforcementClass: PageSeoBriefEnforcementClass;
  validation: string;
  rendererImpact: string;
}

type CoverageDefinition = Omit<PageSeoBriefFieldCoverage, 'field'>;
const enforced = PageSeoBriefEnforcementClass.DETERMINISTICALLY_ENFORCED;
const guidance = PageSeoBriefEnforcementClass.PROMPT_GUIDANCE_WITH_VALIDATION;
const review = PageSeoBriefEnforcementClass.REVIEW_ONLY;
const notApplicable = PageSeoBriefEnforcementClass.NOT_APPLICABLE_TO_GENERATED_PAGE;

/**
 * Exhaustive by construction: adding a PageSeoBrief field fails TypeScript until
 * an explicit consumer and enforcement classification are added here.
 */
export const PAGE_SEO_BRIEF_FIELD_COVERAGE = {
  schemaVersion: { consumer: 'contract parser', enforcementClass: enforced, validation: 'must equal schema version 2', rendererImpact: 'selects the governed V2 pipeline' },
  reference: { consumer: 'brief persistence and generation pin', enforcementClass: enforced, validation: 'UUID identity is immutable after approval', rendererImpact: 'none; provenance only' },
  strategyReference: { consumer: 'generation preflight', enforcementClass: enforced, validation: 'must match the approved strategy reference', rendererImpact: 'none; provenance only' },
  strategyVersion: { consumer: 'generation preflight', enforcementClass: enforced, validation: 'must match the approved strategy version', rendererImpact: 'none; provenance only' },
  briefVersion: { consumer: 'brief persistence', enforcementClass: enforced, validation: 'positive version is digest-bound and immutable', rendererImpact: 'none; provenance only' },
  blueprintPageReference: { consumer: 'blueprint-page binding', enforcementClass: enforced, validation: 'must match the exact planned blueprint page', rendererImpact: 'selects the published page' },
  pageReference: { consumer: 'generation and snapshot binding', enforcementClass: enforced, validation: 'must equal the generated page reference', rendererImpact: 'stable public page identity' },
  pageType: { consumer: 'generation and renderer selection', enforcementClass: enforced, validation: 'must equal the planned and generated page type', rendererImpact: 'controls renderer and schema semantics' },
  status: { consumer: 'generation preflight', enforcementClass: enforced, validation: 'must be APPROVED before V2 generation', rendererImpact: 'blocks unapproved output' },
  indexation: { consumer: 'metadata generation', enforcementClass: enforced, validation: 'generated seo.index must match INDEX/NOINDEX', rendererImpact: 'robots metadata and sitemap inclusion' },
  canonicalPath: { consumer: 'metadata generation and snapshot compiler', enforcementClass: enforced, validation: 'generated canonical path must match exactly', rendererImpact: 'canonical URL and public route' },
  searchIntent: { consumer: 'generation prompt and plan validator', enforcementClass: guidance, validation: 'must agree with primarySearchIntent and the page ownership plan', rendererImpact: 'informs visible answer structure' },
  audienceSegmentKeys: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'must reference governed audience segments at strategy review', rendererImpact: 'informs copy and conversion framing' },
  primarySearchIntent: { consumer: 'generation prompt and collision validator', enforcementClass: guidance, validation: 'must equal searchIntent and have one owning page', rendererImpact: 'informs page structure' },
  secondarySearchIntents: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'bounded supporting intents are schema validated', rendererImpact: 'informs supporting sections' },
  primaryTopic: { consumer: 'generation prompt and ownership validator', enforcementClass: guidance, validation: 'intent/topic collisions are blocking', rendererImpact: 'informs content subject' },
  secondaryTopics: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'bounded semantic topics are schema validated', rendererImpact: 'informs supporting content' },
  primaryKeyword: { consumer: 'generation prompt and cannibalisation validator', enforcementClass: guidance, validation: 'one owning page; no exact-match title requirement', rendererImpact: 'natural topic guidance only' },
  secondaryKeywords: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'bounded natural-language guidance', rendererImpact: 'none directly' },
  longTailKeywords: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'bounded natural-language guidance', rendererImpact: 'none directly' },
  questionKeywords: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'bounded question guidance', rendererImpact: 'informs answer and FAQ structures' },
  localModifiers: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'bounded local guidance; no fabricated location pages', rendererImpact: 'informs visible local context' },
  topicClusterKey: { consumer: 'topic ownership and generation prompt', enforcementClass: guidance, validation: 'persisted as the page topic owner', rendererImpact: 'drives internal context' },
  targetEntities: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'bounded entity guidance', rendererImpact: 'informs visible entity relationships' },
  entitiesToCover: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'bounded entity guidance', rendererImpact: 'informs visible entity coverage' },
  questionsToAnswer: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'bounded question guidance', rendererImpact: 'informs answer blocks' },
  funnelStage: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'controlled funnel enum', rendererImpact: 'informs CTA depth' },
  audienceJobs: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'at least one audience job is required', rendererImpact: 'informs page usefulness' },
  recommendedTitle: { consumer: 'metadata generator', enforcementClass: enforced, validation: 'generated seo.title must match exactly', rendererImpact: 'HTML title and SERP preview' },
  recommendedMetaDescription: { consumer: 'metadata generator', enforcementClass: enforced, validation: 'generated seo.description must match exactly', rendererImpact: 'meta description and SERP preview' },
  recommendedH1: { consumer: 'page generator', enforcementClass: enforced, validation: 'the rendered primary heading must match exactly', rendererImpact: 'visible H1' },
  recommendedH2Topics: { consumer: 'generation prompt and human review', enforcementClass: guidance, validation: 'bounded heading-topic guidance; natural wording remains reviewable', rendererImpact: 'visible section hierarchy' },
  urlRecommendation: { consumer: 'brief validator', enforcementClass: enforced, validation: 'must equal canonicalPath', rendererImpact: 'canonical public route' },
  indexationPolicy: { consumer: 'strategy reviewer', enforcementClass: review, validation: 'human-readable rationale accompanies enforced indexation', rendererImpact: 'none beyond indexation' },
  canonicalPolicy: { consumer: 'strategy reviewer', enforcementClass: review, validation: 'human-readable rationale accompanies enforced canonicalPath', rendererImpact: 'none beyond canonical URL' },
  contentFormat: { consumer: 'page generator and format validator', enforcementClass: enforced, validation: 'page type and required visible structures must be compatible', rendererImpact: 'controls semantic section requirements' },
  minimumContentDepthWords: { consumer: 'generation validator', enforcementClass: enforced, validation: 'governed visible content word count must meet the minimum', rendererImpact: 'ensures substantive rendered content' },
  contentDepthGuidance: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'paired with deterministic minimum depth', rendererImpact: 'informs useful content depth' },
  recommendedHeadings: { consumer: 'generation prompt and review', enforcementClass: guidance, validation: 'bounded heading guidance', rendererImpact: 'informs visible heading hierarchy' },
  faqOpportunities: { consumer: 'generation prompt and FAQ eligibility validator', enforcementClass: guidance, validation: 'FAQ schema planning requires visible FAQ opportunities', rendererImpact: 'informs visible FAQs' },
  competitorGapNotes: { consumer: 'agency strategy review', enforcementClass: review, validation: 'source-classified notes are immutable after approval', rendererImpact: 'never copied directly into markup' },
  snippetTarget: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'controlled answer-format guidance', rendererImpact: 'informs answer structure' },
  richResultEligibility: { consumer: 'strategy/brief validator and snapshot compiler', enforcementClass: enforced, validation: 'must be a subset of schemaTypes', rendererImpact: 'bounds conditional JSON-LD eligibility' },
  internalLinks: { consumer: 'page generator', enforcementClass: enforced, validation: 'generated targets and anchors must match exactly', rendererImpact: 'visible internal links' },
  internalLinksIn: { consumer: 'site graph validator', enforcementClass: notApplicable, validation: 'validated at whole-site graph scope, not generated by this page', rendererImpact: 'incoming links render on source pages' },
  internalLinksOut: { consumer: 'brief validator and page generator', enforcementClass: enforced, validation: 'must equal internalLinks exactly', rendererImpact: 'visible internal links' },
  schemaTypes: { consumer: 'structured-data generator and snapshot compiler', enforcementClass: enforced, validation: 'must equal the strategy page rule; generated inputs cannot exceed it', rendererImpact: 'authoritative conditional JSON-LD allowlist' },
  imageRequirements: { consumer: 'generation prompt and asset review', enforcementClass: guidance, validation: 'bounded informative/decorative/LCP guidance', rendererImpact: 'informs image selection and quality gates' },
  mediaRequirements: { consumer: 'generation prompt and asset review', enforcementClass: guidance, validation: 'bounded media guidance', rendererImpact: 'informs visible media selection' },
  featuredSnippetOpportunity: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'controlled answer-format guidance', rendererImpact: 'informs visible answer structure' },
  aiAnswerOpportunity: { consumer: 'generation prompt', enforcementClass: guidance, validation: 'controlled question and answer-format guidance', rendererImpact: 'informs visible answer structure; no special markup' },
  authorship: { consumer: 'generation validator and snapshot compiler', enforcementClass: enforced, validation: 'required author must bind a verified canonical staff reference', rendererImpact: 'visible byline and eligible Person/Article data' },
  reviewer: { consumer: 'generation validator and snapshot compiler', enforcementClass: enforced, validation: 'required reviewer must bind a distinct verified canonical staff reference', rendererImpact: 'visible review byline and eligible Person/Article data' },
  evidenceRequirements: { consumer: 'generation prompt and claim validator', enforcementClass: enforced, validation: 'claims on evidence-governed pages must be GROUNDED with fact keys', rendererImpact: 'prevents unsupported visible claims' },
  requiredEvidence: { consumer: 'generation prompt and claim validator', enforcementClass: enforced, validation: 'claims on evidence-governed pages must be GROUNDED with fact keys', rendererImpact: 'prevents unsupported visible claims' },
  originalEvidenceRequirements: { consumer: 'generation prompt and human review', enforcementClass: guidance, validation: 'requirements remain source-classified and reviewable', rendererImpact: 'informs first-hand evidence content' },
  authoritySignals: { consumer: 'generation prompt and human review', enforcementClass: guidance, validation: 'source-classified authority evidence only', rendererImpact: 'informs visible trust content' },
  freshnessDays: { consumer: 'content-governance review', enforcementClass: review, validation: 'positive bounded review interval', rendererImpact: 'none until refresh monitoring' },
  contentRisk: { consumer: 'brief and generation validators', enforcementClass: enforced, validation: 'high-risk YMYL requires author, reviewer, and evidence', rendererImpact: 'blocks unsafe content' },
  provenance: { consumer: 'digest and generation preflight', enforcementClass: enforced, validation: 'must pin exact strategy and output digests', rendererImpact: 'none; integrity boundary' },
  approvedAt: { consumer: 'approval gate', enforcementClass: enforced, validation: 'required only for APPROVED briefs', rendererImpact: 'blocks unapproved content' },
  approvedByAgencyUserReference: { consumer: 'approval gate', enforcementClass: enforced, validation: 'required only for APPROVED briefs', rendererImpact: 'blocks unapproved content' },
} satisfies Record<keyof PageSeoBrief, CoverageDefinition>;

export const PAGE_SEO_BRIEF_GOVERNED_FIELD_REPORT: readonly PageSeoBriefFieldCoverage[] =
  Object.entries(PAGE_SEO_BRIEF_FIELD_COVERAGE).map(([field, coverage]) => ({
    field: field as keyof PageSeoBrief,
    ...coverage,
  }));

export function pageSeoBriefCoverageSummary() {
  const count = (enforcementClass: PageSeoBriefEnforcementClass) =>
    PAGE_SEO_BRIEF_GOVERNED_FIELD_REPORT.filter(item => item.enforcementClass === enforcementClass).length;
  return {
    total: PAGE_SEO_BRIEF_GOVERNED_FIELD_REPORT.length,
    enforced: count(enforced),
    guidance: count(guidance),
    reviewOnly: count(review),
    notApplicableToGeneratedPage: count(notApplicable),
    ignored: 0,
  } as const;
}
