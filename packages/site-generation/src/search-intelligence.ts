import { PublicReferenceSchema, SiteCanonicalPathSchema, SitePageTypeSchema } from '@ks-os/contracts';
import { z } from 'zod';
import { generationDigest } from './normalization.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const KeySchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const ShortTextSchema = z.string().trim().min(1).max(240);
const NoteSchema = z.string().trim().min(1).max(2_000);

export const SearchIntentSchema = z.enum([
  'INFORMATIONAL',
  'NAVIGATIONAL',
  'COMMERCIAL_INVESTIGATION',
  'TRANSACTIONAL',
  'LOCAL',
]);
export type SearchIntent = z.infer<typeof SearchIntentSchema>;

export const SearchKeywordClassSchema = z.enum([
  'SEED',
  'SHORT_TAIL',
  'MID_TAIL',
  'LONG_TAIL',
  'QUESTION',
  'LOCAL',
  'BRAND',
  'COMPETITOR',
  'COMMERCIAL',
  'TRANSACTIONAL',
  'ENTITY',
  'SEMANTIC_SUPPORTING',
]);
export type SearchKeywordClass = z.infer<typeof SearchKeywordClassSchema>;

export const SearchSourceClassificationSchema = z.enum([
  'VERIFIED_BUSINESS_FACT',
  'SEARCH_RESEARCH',
  'AI_INFERENCE',
  'AGENCY_DECISION',
]);
export type SearchSourceClassification = z.infer<typeof SearchSourceClassificationSchema>;

export const SearchCompetitorTypeSchema = z.enum([
  'BUSINESS_COMPETITOR',
  'SEARCH_COMPETITOR',
  'LOCAL_COMPETITOR',
  'CONTENT_COMPETITOR',
]);
export const SearchDeviceSchema = z.enum(['DESKTOP', 'MOBILE']);
export const SearchStrategyStatusSchema = z.enum(['DRAFT', 'APPROVED', 'SUPERSEDED', 'REJECTED']);
export const PageSeoBriefStatusSchema = z.enum(['DRAFT', 'APPROVED', 'SUPERSEDED']);
export const PageIndexationSchema = z.enum(['INDEX', 'NOINDEX']);
export const SearchFunnelStageSchema = z.enum(['AWARENESS', 'CONSIDERATION', 'DECISION', 'RETENTION']);
export const YmylRiskSchema = z.enum(['NONE', 'LOW', 'MODERATE', 'HIGH']);
export const StructuredDataTypeV2Schema = z.enum([
  'WEB_SITE', 'ORGANIZATION', 'PERSON', 'LOCAL_BUSINESS', 'SERVICE', 'WEB_PAGE',
  'ARTICLE', 'BLOG_POSTING', 'FAQ_PAGE', 'BREADCRUMB_LIST', 'VIDEO_OBJECT', 'IMAGE_OBJECT',
]);

export const ClassifiedStatementSchema = z.object({
  statement: NoteSchema,
  sourceClassification: SearchSourceClassificationSchema,
  evidenceReferences: z.array(PublicReferenceSchema).max(50).default([]),
  confidence: z.number().min(0).max(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.sourceClassification === 'SEARCH_RESEARCH' && value.evidenceReferences.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Search-research statements require at least one evidence reference.',
      path: ['evidenceReferences'],
    });
  }
});

export const SearchResearchEvidenceSchema = z.object({
  reference: PublicReferenceSchema,
  providerKey: z.string().trim().min(1).max(80),
  query: ShortTextSchema,
  market: z.string().trim().min(2).max(80),
  locale: z.string().trim().min(2).max(35),
  location: z.string().trim().min(1).max(160),
  language: z.string().trim().min(2).max(35),
  device: SearchDeviceSchema,
  capturedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  sourceUrl: z.string().url().max(2_000).optional(),
  sourceDigestSha256: Sha256Schema,
  payloadDigestSha256: Sha256Schema,
  notes: z.array(NoteSchema).max(100).default([]),
}).strict();
export type SearchResearchEvidence = z.infer<typeof SearchResearchEvidenceSchema>;

export const SerpAnalysisSchema = z.object({
  reference: PublicReferenceSchema,
  evidenceReference: PublicReferenceSchema,
  query: ShortTextSchema,
  location: z.string().trim().min(1).max(160),
  language: z.string().trim().min(2).max(35),
  device: SearchDeviceSchema,
  capturedAt: z.string().datetime(),
  organicResultTypes: z.array(ShortTextSchema).max(50),
  localPackPresent: z.boolean(),
  aiOverviewObserved: z.boolean(),
  featuredSnippetObserved: z.boolean(),
  peopleAlsoAskObserved: z.boolean(),
  videoResultsObserved: z.boolean(),
  imageResultsObserved: z.boolean(),
  shoppingResultsObserved: z.boolean(),
  discussionResultsObserved: z.boolean(),
  dominantContentFormats: z.array(ShortTextSchema).max(50),
  dominantIntent: SearchIntentSchema,
  commonEntities: z.array(ShortTextSchema).max(100),
  commonSubtopics: z.array(ShortTextSchema).max(100),
  contentDepthPatterns: z.array(NoteSchema).max(100),
  authorityPatterns: z.array(NoteSchema).max(100),
}).strict();
export type SerpAnalysis = z.infer<typeof SerpAnalysisSchema>;

export const KeywordMetricsSchema = z.object({
  monthlySearchVolume: z.number().int().nonnegative().optional(),
  keywordDifficulty: z.number().min(0).max(100).optional(),
  costPerClick: z.number().nonnegative().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  sourceClassification: z.literal('SEARCH_RESEARCH'),
  evidenceReference: PublicReferenceSchema,
  measuredAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.monthlySearchVolume === undefined
    && value.keywordDifficulty === undefined
    && value.costPerClick === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one researched metric is required.' });
  }
  if (value.costPerClick !== undefined && !value.currency) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'CPC requires a currency.', path: ['currency'] });
  }
});

export const SearchKeywordSchema = z.object({
  keyword: z.string().trim().min(1).max(240),
  classes: z.array(SearchKeywordClassSchema).min(1).max(13),
  intent: SearchIntentSchema,
  topicClusterKey: KeySchema,
  targetPageReference: PublicReferenceSchema.optional(),
  metrics: KeywordMetricsSchema.optional(),
  rationale: ClassifiedStatementSchema,
}).strict();

export const AuthorityProfileSchema = z.object({
  experienceEvidence: z.array(ClassifiedStatementSchema).max(100).default([]),
  expertiseEvidence: z.array(ClassifiedStatementSchema).max(100).default([]),
  authoritativenessEvidence: z.array(ClassifiedStatementSchema).max(100).default([]),
  trustEvidence: z.array(ClassifiedStatementSchema).max(100).default([]),
  readinessDimensions: z.object({
    identityCompleteness: z.array(ClassifiedStatementSchema).max(50).default([]),
    expertEvidence: z.array(ClassifiedStatementSchema).max(50).default([]),
    originalEvidence: z.array(ClassifiedStatementSchema).max(50).default([]),
    citationQuality: z.array(ClassifiedStatementSchema).max(50).default([]),
    entityCompleteness: z.array(ClassifiedStatementSchema).max(50).default([]),
    localFactConsistency: z.array(ClassifiedStatementSchema).max(50).default([]),
    contentOwnership: z.array(ClassifiedStatementSchema).max(50).default([]),
    trustContactInformation: z.array(ClassifiedStatementSchema).max(50).default([]),
    technicalTrust: z.array(ClassifiedStatementSchema).max(50).default([]),
    externalAuthorityEvidence: z.array(ClassifiedStatementSchema).max(50).default([]),
  }).strict(),
}).strict();
export type AuthorityProfile = z.infer<typeof AuthorityProfileSchema>;

export const ContentOpportunitySchema = z.object({
  reference: PublicReferenceSchema,
  targetPageReference: PublicReferenceSchema.optional(),
  topic: ShortTextSchema,
  dominantIntent: SearchIntentSchema,
  supportingIntents: z.array(SearchIntentSchema).max(4).default([]),
  audienceSegmentKeys: z.array(KeySchema).min(1).max(50),
  gapEvidence: z.array(ClassifiedStatementSchema).min(1).max(100),
  uniqueContribution: ClassifiedStatementSchema,
  originalEvidenceRequirements: z.array(ShortTextSchema).max(100).default([]),
  definitiveContentOpportunity: z.boolean(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
}).strict().superRefine((value, context) => {
  if (value.supportingIntents.includes(value.dominantIntent)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Supporting intents must not repeat the dominant intent.',
      path: ['supportingIntents'],
    });
  }
});
export type ContentOpportunity = z.infer<typeof ContentOpportunitySchema>;

export const OffSiteAuthorityPlanSchema = z.object({
  opportunities: z.array(z.object({
    type: z.enum([
      'BUSINESS_DIRECTORY', 'INDUSTRY_DIRECTORY', 'PROFESSIONAL_BODY', 'SUPPLIER',
      'LOCAL_ORGANISATION', 'PR', 'PARTNERSHIP', 'EDITORIAL_COVERAGE',
      'ORIGINAL_RESEARCH', 'USEFUL_RESOURCE',
    ]),
    rationale: ClassifiedStatementSchema,
    status: z.enum(['PLANNED', 'VERIFIED_EARNED', 'REJECTED']),
    evidenceReferences: z.array(PublicReferenceSchema).max(100).default([]),
  }).strict()).max(500).default([]),
  prohibitLinkSpam: z.literal(true),
  prohibitPrivateBlogNetworks: z.literal(true),
  prohibitPaidLinkSchemes: z.literal(true),
}).strict();
export type OffSiteAuthorityPlan = z.infer<typeof OffSiteAuthorityPlanSchema>;

const PageReferenceLinkSchema = z.object({
  sourcePageReference: PublicReferenceSchema,
  targetPageReference: PublicReferenceSchema,
  anchorText: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(5).max(500),
}).strict();

const StrategyProvenanceSchema = z.object({
  providerKey: z.string().trim().min(1).max(80),
  modelKey: z.string().trim().min(1).max(160),
  inputDigestSha256: Sha256Schema,
  researchDigestSha256: Sha256Schema,
  outputDigestSha256: Sha256Schema,
  generatedAt: z.string().datetime(),
  generatedByAgencyUserReference: PublicReferenceSchema,
  researchEvidenceReferences: z.array(PublicReferenceSchema).max(1_000).default([]),
}).strict();

const BriefProvenanceSchema = StrategyProvenanceSchema.extend({
  strategyReference: PublicReferenceSchema,
  strategyVersion: z.number().int().positive(),
  strategyDigestSha256: Sha256Schema,
}).strict();

export const SearchIntelligenceStrategyV2Schema = z.object({
  schemaVersion: z.literal(2),
  reference: PublicReferenceSchema,
  siteReference: PublicReferenceSchema,
  blueprintReference: PublicReferenceSchema,
  blueprintRevision: z.number().int().positive(),
  strategyVersion: z.number().int().positive(),
  status: SearchStrategyStatusSchema,
  targetAudience: z.object({
    segments: z.array(z.object({
      key: KeySchema,
      name: ShortTextSchema,
      needs: z.array(ClassifiedStatementSchema).min(1).max(50),
      objections: z.array(ClassifiedStatementSchema).max(50).default([]),
    }).strict()).min(1).max(50),
  }).strict(),
  searchMarket: z.object({
    countryCode: z.string().length(2).toUpperCase(),
    languageCode: z.string().min(2).max(8).toLowerCase(),
    locale: z.string().min(2).max(35),
    searchEngines: z.array(z.enum(['GOOGLE', 'BING', 'OTHER'])).min(1).max(3),
    locations: z.array(ShortTextSchema).max(100).default([]),
  }).strict(),
  serpAnalyses: z.array(SerpAnalysisSchema).max(1_000).default([]),
  competitorLandscape: z.array(z.object({
    name: ShortTextSchema,
    type: SearchCompetitorTypeSchema,
    hostname: z.string().trim().toLowerCase().max(255).optional(),
    evidence: ClassifiedStatementSchema,
    strengths: z.array(ClassifiedStatementSchema).max(50).default([]),
    gaps: z.array(ClassifiedStatementSchema).max(50).default([]),
    topicsCovered: z.array(ClassifiedStatementSchema).max(100).default([]),
    pageTypesObserved: z.array(ClassifiedStatementSchema).max(100).default([]),
    serviceCoverage: z.array(ClassifiedStatementSchema).max(100).default([]),
    contentDepthPatterns: z.array(ClassifiedStatementSchema).max(100).default([]),
    searchIntents: z.array(ClassifiedStatementSchema).max(100).default([]),
    schemaUsage: z.array(ClassifiedStatementSchema).max(100).default([]),
    localCoverage: z.array(ClassifiedStatementSchema).max(100).default([]),
    informationArchitecture: z.array(ClassifiedStatementSchema).max(100).default([]),
    authoritySignals: z.array(ClassifiedStatementSchema).max(100).default([]),
    mediaUsage: z.array(ClassifiedStatementSchema).max(100).default([]),
    internalLinkPatterns: z.array(ClassifiedStatementSchema).max(100).default([]),
    serpPresence: z.array(ClassifiedStatementSchema).max(100).default([]),
  }).strict()).max(200),
  keywordUniverse: z.array(SearchKeywordSchema).min(1).max(5_000),
  searchIntentClusters: z.array(z.object({
    key: KeySchema,
    intent: SearchIntentSchema,
    keywords: z.array(z.string().trim().min(1).max(240)).min(1).max(500),
    audienceSegmentKeys: z.array(KeySchema).max(50).default([]),
  }).strict()).min(1).max(500),
  topicClusters: z.array(z.object({
    key: KeySchema,
    name: ShortTextSchema,
    pillarPageReference: PublicReferenceSchema,
    supportingPageReferences: z.array(PublicReferenceSchema).max(200).default([]),
    primaryIntent: SearchIntentSchema,
  }).strict()).min(1).max(500),
  entityStrategy: z.object({
    primaryEntity: ClassifiedStatementSchema,
    supportingEntities: z.array(ClassifiedStatementSchema).max(500).default([]),
    disambiguationNotes: z.array(ClassifiedStatementSchema).max(100).default([]),
  }).strict(),
  authorityStrategy: z.object({
    ymylRisk: YmylRiskSchema,
    requiredAuthorCredentials: z.array(ShortTextSchema).max(50).default([]),
    requiredReviewerCredentials: z.array(ShortTextSchema).max(50).default([]),
    citationPolicy: NoteSchema,
    evidenceFreshnessDays: z.number().int().positive().max(3_650),
  }).strict(),
  authorityProfile: AuthorityProfileSchema,
  offSiteAuthorityPlan: OffSiteAuthorityPlanSchema,
  localSearchStrategy: z.object({
    enabled: z.boolean(),
    locationPageReferences: z.array(PublicReferenceSchema).max(500).default([]),
    napConsistencyRequired: z.boolean(),
    localTopics: z.array(ShortTextSchema).max(500).default([]),
  }).strict(),
  aiAnswerStrategy: z.object({
    answerTargets: z.array(z.object({
      question: ShortTextSchema,
      targetPageReference: PublicReferenceSchema,
      answerFormat: z.enum(['PARAGRAPH', 'LIST', 'STEPS', 'TABLE', 'DEFINITION']),
      evidenceRequired: z.boolean(),
    }).strict()).max(1_000),
  }).strict(),
  brandSearchStrategy: z.object({
    brandedQueries: z.array(z.string().trim().min(1).max(240)).min(1).max(200),
    targetPageReferences: z.array(PublicReferenceSchema).min(1).max(100),
    entityConsistencyRequired: z.literal(true),
    contactAndServiceOwnershipRequired: z.literal(true),
    reviewClaimsRequireVerifiedEvidence: z.literal(true),
  }).strict(),
  contentOpportunities: z.array(ContentOpportunitySchema).min(1).max(1_000),
  pageOpportunityMap: z.array(z.object({
    pageReference: PublicReferenceSchema,
    pageType: SitePageTypeSchema,
    opportunity: ShortTextSchema,
    primaryIntent: SearchIntentSchema,
    topicClusterKey: KeySchema,
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  }).strict()).min(1).max(1_000),
  siteTopicGraph: z.object({
    nodes: z.array(z.object({ key: KeySchema, pageReference: PublicReferenceSchema }).strict()).min(1).max(1_000),
    edges: z.array(z.object({ from: KeySchema, to: KeySchema, relationship: ShortTextSchema }).strict()).max(5_000),
  }).strict(),
  internalLinkStrategy: z.object({
    links: z.array(PageReferenceLinkSchema).max(5_000),
    maximumClicksFromHome: z.number().int().min(1).max(10),
  }).strict(),
  structuredDataStrategy: z.object({
    globalTypes: z.array(StructuredDataTypeV2Schema).max(20),
    pageRules: z.array(z.object({
      pageReference: PublicReferenceSchema,
      types: z.array(StructuredDataTypeV2Schema).max(20),
      eligibilityNotes: z.array(ClassifiedStatementSchema).max(50).default([]),
    }).strict()).max(1_000),
    prohibitSelfServingReviews: z.literal(true),
  }).strict(),
  technicalSeoStrategy: z.object({
    canonicalPolicy: NoteSchema,
    indexationPolicy: NoteSchema,
    redirectPolicy: NoteSchema,
    hreflangEnabled: z.boolean(),
    sitemapLastModifiedRequired: z.literal(true),
  }).strict(),
  mediaSeoStrategy: z.object({
    descriptiveAltTextRequired: z.literal(true),
    decorativeAltMustBeEmpty: z.literal(true),
    imageContextRequired: z.boolean(),
    videoTranscriptsRequired: z.boolean(),
  }).strict(),
  performanceSeoStrategy: z.object({
    lcpMillisecondsMaximum: z.number().int().positive().max(2_500),
    inpMillisecondsMaximum: z.number().int().positive().max(200),
    clsMaximum: z.number().nonnegative().max(0.1),
    measurementModes: z.array(z.enum(['LAB', 'FIELD'])).min(1).max(2),
    lcpAssetMustNotLazyLoad: z.literal(true),
  }).strict(),
  contentGovernance: z.object({
    approvalRequired: z.literal(true),
    factClassesAllowed: z.array(SearchSourceClassificationSchema).min(1).max(4),
    contentFreshnessDays: z.number().int().positive().max(3_650),
    materialRevisionRequiresReapproval: z.literal(true),
  }).strict(),
  provenance: StrategyProvenanceSchema,
  approvedAt: z.string().datetime().optional(),
  approvedByAgencyUserReference: PublicReferenceSchema.optional(),
}).strict().superRefine((value, context) => {
  const approvedFields = Number(Boolean(value.approvedAt)) + Number(Boolean(value.approvedByAgencyUserReference));
  if ((value.status === 'APPROVED' && approvedFields !== 2)
    || (value.status !== 'APPROVED' && approvedFields !== 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Approval metadata must be complete and is only valid for an approved strategy.',
      path: ['approvedAt'],
    });
  }
});
export type SearchIntelligenceStrategyV2 = z.infer<typeof SearchIntelligenceStrategyV2Schema>;

export const PageSeoBriefSchema = z.object({
  schemaVersion: z.literal(2),
  reference: PublicReferenceSchema,
  strategyReference: PublicReferenceSchema,
  strategyVersion: z.number().int().positive(),
  briefVersion: z.number().int().positive(),
  blueprintPageReference: PublicReferenceSchema,
  pageReference: PublicReferenceSchema,
  pageType: SitePageTypeSchema,
  status: PageSeoBriefStatusSchema,
  indexation: PageIndexationSchema,
  canonicalPath: SiteCanonicalPathSchema,
  searchIntent: SearchIntentSchema,
  audienceSegmentKeys: z.array(KeySchema).min(1).max(50),
  primarySearchIntent: SearchIntentSchema,
  secondarySearchIntents: z.array(SearchIntentSchema).max(4).default([]),
  primaryTopic: ShortTextSchema,
  secondaryTopics: z.array(ShortTextSchema).max(100).default([]),
  primaryKeyword: z.string().trim().min(1).max(240),
  secondaryKeywords: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
  longTailKeywords: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
  questionKeywords: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
  localModifiers: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  topicClusterKey: KeySchema,
  targetEntities: z.array(ShortTextSchema).max(100).default([]),
  entitiesToCover: z.array(ShortTextSchema).max(100).default([]),
  questionsToAnswer: z.array(ShortTextSchema).max(100).default([]),
  funnelStage: SearchFunnelStageSchema,
  audienceJobs: z.array(ShortTextSchema).min(1).max(50),
  recommendedTitle: z.string().trim().min(1).max(70),
  recommendedMetaDescription: z.string().trim().min(1).max(170),
  recommendedH1: ShortTextSchema,
  recommendedH2Topics: z.array(ShortTextSchema).min(1).max(100),
  urlRecommendation: SiteCanonicalPathSchema,
  indexationPolicy: NoteSchema,
  canonicalPolicy: NoteSchema,
  contentFormat: z.enum(['LANDING_PAGE', 'GUIDE', 'HOW_TO', 'ARTICLE', 'FAQ', 'TUTORIAL', 'DEFINITION', 'TROUBLESHOOTING', 'COMPARISON', 'CASE_STUDY']),
  minimumContentDepthWords: z.number().int().nonnegative().max(25_000),
  contentDepthGuidance: NoteSchema,
  recommendedHeadings: z.array(ShortTextSchema).min(1).max(100),
  faqOpportunities: z.array(ShortTextSchema).max(100).default([]),
  competitorGapNotes: z.array(ClassifiedStatementSchema).max(100).default([]),
  snippetTarget: z.enum(['NONE', 'PARAGRAPH', 'LIST', 'STEPS', 'TABLE', 'DEFINITION']),
  richResultEligibility: z.array(StructuredDataTypeV2Schema).max(20).default([]),
  internalLinks: z.array(z.object({
    targetPageReference: PublicReferenceSchema,
    anchorText: z.string().trim().min(1).max(120),
    purpose: z.string().trim().min(5).max(500),
  }).strict()).max(200),
  internalLinksIn: z.array(z.object({
    sourcePageReference: PublicReferenceSchema,
    anchorText: z.string().trim().min(1).max(120),
    purpose: z.string().trim().min(5).max(500),
  }).strict()).max(200).default([]),
  internalLinksOut: z.array(z.object({
    targetPageReference: PublicReferenceSchema,
    anchorText: z.string().trim().min(1).max(120),
    purpose: z.string().trim().min(5).max(500),
  }).strict()).max(200),
  schemaTypes: z.array(StructuredDataTypeV2Schema).max(20),
  imageRequirements: z.array(z.object({
    purpose: ShortTextSchema,
    descriptiveAltTextGuidance: ShortTextSchema,
    decorative: z.boolean(),
    mayBeLcp: z.boolean(),
  }).strict()).max(100),
  mediaRequirements: z.array(z.object({
    purpose: ShortTextSchema,
    descriptiveAltTextGuidance: ShortTextSchema,
    decorative: z.boolean(),
    mayBeLcp: z.boolean(),
  }).strict()).max(100),
  featuredSnippetOpportunity: z.enum(['NONE', 'PARAGRAPH', 'LIST', 'STEPS', 'TABLE', 'DEFINITION']),
  aiAnswerOpportunity: z.object({
    enabled: z.boolean(),
    question: ShortTextSchema.optional(),
    answerFormat: z.enum(['PARAGRAPH', 'LIST', 'STEPS', 'TABLE', 'DEFINITION']).optional(),
  }).strict(),
  authorship: z.object({ required: z.boolean(), credentials: z.array(ShortTextSchema).max(50) }).strict(),
  reviewer: z.object({ required: z.boolean(), credentials: z.array(ShortTextSchema).max(50) }).strict(),
  evidenceRequirements: z.array(ShortTextSchema).max(100).default([]),
  requiredEvidence: z.array(ShortTextSchema).max(100).default([]),
  originalEvidenceRequirements: z.array(ShortTextSchema).max(100).default([]),
  authoritySignals: z.array(ClassifiedStatementSchema).max(100).default([]),
  freshnessDays: z.number().int().positive().max(3_650),
  contentRisk: z.object({ ymyl: YmylRiskSchema, notes: z.array(ShortTextSchema).max(50).default([]) }).strict(),
  provenance: BriefProvenanceSchema,
  approvedAt: z.string().datetime().optional(),
  approvedByAgencyUserReference: PublicReferenceSchema.optional(),
}).strict().superRefine((value, context) => {
  const approvedFields = Number(Boolean(value.approvedAt)) + Number(Boolean(value.approvedByAgencyUserReference));
  if ((value.status === 'APPROVED' && approvedFields !== 2)
    || (value.status !== 'APPROVED' && approvedFields !== 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Brief approval metadata is invalid.', path: ['approvedAt'] });
  }
  if (value.contentRisk.ymyl === 'HIGH') {
    if (!value.authorship.required || !value.reviewer.required || value.evidenceRequirements.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'High-risk YMYL briefs require authorship, review and evidence.',
        path: ['contentRisk'],
      });
    }
  }
  if (value.schemaTypes.includes('FAQ_PAGE') && value.faqOpportunities.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'FAQ schema requires planned FAQ content.', path: ['schemaTypes'] });
  }
  if (value.primarySearchIntent !== value.searchIntent) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Primary search intent must match the governed search-intent field.', path: ['primarySearchIntent'] });
  }
  if (value.urlRecommendation !== value.canonicalPath) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'The URL recommendation must match the governed canonical path.', path: ['urlRecommendation'] });
  }
  if (JSON.stringify(value.internalLinksOut) !== JSON.stringify(value.internalLinks)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Outbound link recommendations must match the governed internal-link plan.', path: ['internalLinksOut'] });
  }
});
export type PageSeoBrief = z.infer<typeof PageSeoBriefSchema>;

export interface SearchIntelligenceFinding {
  code: string;
  blocking: boolean;
  message: string;
  pageReference?: string;
}

export function searchStrategyDigest(strategy: SearchIntelligenceStrategyV2): string {
  const { approvedAt: _approvedAt, approvedByAgencyUserReference: _approvedBy, status: _status, provenance, ...content } = strategy;
  const { outputDigestSha256: _outputDigest, ...sourceProvenance } = provenance;
  return generationDigest({ ...content, provenance: sourceProvenance });
}

export function pageSeoBriefDigest(brief: PageSeoBrief): string {
  const { approvedAt: _approvedAt, approvedByAgencyUserReference: _approvedBy, status: _status, provenance, ...content } = brief;
  const { outputDigestSha256: _outputDigest, ...sourceProvenance } = provenance;
  return generationDigest({ ...content, provenance: sourceProvenance });
}

export function assertApprovedPageSeoBriefUnchanged(input: {
  current: PageSeoBrief;
  replacement: PageSeoBrief;
}): void {
  if (input.current.status !== 'APPROVED') return;
  if (pageSeoBriefDigest(input.current) !== pageSeoBriefDigest(input.replacement)) {
    throw new Error('APPROVED_PAGE_SEO_BRIEF_IMMUTABLE');
  }
}

export function validateSearchIntelligencePlan(input: {
  strategy: SearchIntelligenceStrategyV2;
  briefs: readonly PageSeoBrief[];
  plannedPages: ReadonlyArray<{ blueprintPageReference: string; pageReference: string; pageType: string }>;
}): SearchIntelligenceFinding[] {
  const findings: SearchIntelligenceFinding[] = [];
  const pageByReference = new Map(input.plannedPages.map(page => [page.pageReference, page]));
  const planned = new Set(pageByReference.keys());
  const briefByPage = new Map<string, PageSeoBrief>();

  if (input.strategy.status !== 'APPROVED') {
    findings.push({ code: 'SEARCH_STRATEGY_NOT_APPROVED', blocking: true, message: 'V2 generation requires an approved search strategy.' });
  }
  for (const brief of input.briefs) {
    if (briefByPage.has(brief.pageReference)) {
      findings.push({ code: 'DUPLICATE_PAGE_SEO_BRIEF', blocking: true, message: 'A page has more than one SEO brief.', pageReference: brief.pageReference });
    }
    briefByPage.set(brief.pageReference, brief);
    const page = pageByReference.get(brief.pageReference);
    if (!page || page.blueprintPageReference !== brief.blueprintPageReference || page.pageType !== brief.pageType) {
      findings.push({ code: 'PAGE_SEO_BRIEF_BINDING_MISMATCH', blocking: true, message: 'The SEO brief does not match its stable blueprint page identity.', pageReference: brief.pageReference });
    }
    if (brief.strategyReference !== input.strategy.reference || brief.strategyVersion !== input.strategy.strategyVersion) {
      findings.push({ code: 'PAGE_SEO_BRIEF_STRATEGY_MISMATCH', blocking: true, message: 'The SEO brief is not pinned to this strategy version.', pageReference: brief.pageReference });
    }
    if (brief.provenance.strategyReference !== input.strategy.reference
      || brief.provenance.strategyVersion !== input.strategy.strategyVersion
      || brief.provenance.strategyDigestSha256 !== input.strategy.provenance.outputDigestSha256) {
      findings.push({ code: 'PAGE_SEO_BRIEF_STRATEGY_DIGEST_MISMATCH', blocking: true, message: 'The SEO brief provenance is not pinned to the exact strategy digest.', pageReference: brief.pageReference });
    }
    if (brief.status !== 'APPROVED') {
      findings.push({ code: 'PAGE_SEO_BRIEF_NOT_APPROVED', blocking: true, message: 'Every planned V2 page requires an approved SEO brief.', pageReference: brief.pageReference });
    }
  }
  for (const page of input.plannedPages) {
    if (!briefByPage.has(page.pageReference)) {
      findings.push({ code: 'PAGE_SEO_BRIEF_MISSING', blocking: true, message: 'The planned page has no SEO brief.', pageReference: page.pageReference });
    }
  }

  const primaryOwners = new Map<string, string>();
  const canonicalOwners = new Map<string, string>();
  const titleTargets = new Map<string, string>();
  const descriptionOwners = new Map<string, string>();
  const intentTopicOwners = new Map<string, string>();
  const anchorTargets = new Map<string, string>();
  for (const brief of input.briefs) {
    const keyword = brief.primaryKeyword.trim().toLocaleLowerCase();
    const existingKeywordOwner = primaryOwners.get(keyword);
    if (existingKeywordOwner && existingKeywordOwner !== brief.pageReference) {
      findings.push({ code: 'KEYWORD_CANNIBALISATION', blocking: true, message: `Primary keyword is already owned by page ${existingKeywordOwner}.`, pageReference: brief.pageReference });
    } else primaryOwners.set(keyword, brief.pageReference);

    const existingCanonicalOwner = canonicalOwners.get(brief.canonicalPath);
    if (existingCanonicalOwner && existingCanonicalOwner !== brief.pageReference) {
      findings.push({ code: 'DUPLICATE_CANONICAL_PATH', blocking: true, message: `Canonical path is already owned by page ${existingCanonicalOwner}.`, pageReference: brief.pageReference });
    } else canonicalOwners.set(brief.canonicalPath, brief.pageReference);

    const titleTarget = brief.recommendedTitle.trim().toLocaleLowerCase();
    const existingTitleOwner = titleTargets.get(titleTarget);
    if (existingTitleOwner && existingTitleOwner !== brief.pageReference) {
      findings.push({ code: 'DUPLICATE_TITLE_TARGET', blocking: true, message: `The leading title target is already used by page ${existingTitleOwner}.`, pageReference: brief.pageReference });
    } else titleTargets.set(titleTarget, brief.pageReference);

    const descriptionTarget = brief.recommendedMetaDescription.trim().toLocaleLowerCase();
    const existingDescriptionOwner = descriptionOwners.get(descriptionTarget);
    if (existingDescriptionOwner && existingDescriptionOwner !== brief.pageReference) {
      findings.push({ code: 'DUPLICATE_META_DESCRIPTION', blocking: true, message: `The recommended meta description is already used by page ${existingDescriptionOwner}.`, pageReference: brief.pageReference });
    } else descriptionOwners.set(descriptionTarget, brief.pageReference);

    const intentTopic = `${brief.primarySearchIntent}:${brief.primaryTopic.trim().toLocaleLowerCase()}`;
    const existingIntentTopicOwner = intentTopicOwners.get(intentTopic);
    if (existingIntentTopicOwner && existingIntentTopicOwner !== brief.pageReference) {
      findings.push({ code: 'SEARCH_INTENT_COLLISION', blocking: true, message: `The same primary intent and topic are already owned by page ${existingIntentTopicOwner}.`, pageReference: brief.pageReference });
      findings.push({ code: 'DUPLICATE_TOPIC_TARGET', blocking: true, message: `The primary topic is already targeted by page ${existingIntentTopicOwner}.`, pageReference: brief.pageReference });
    } else intentTopicOwners.set(intentTopic, brief.pageReference);

    for (const link of brief.internalLinks) {
      if (!planned.has(link.targetPageReference)) {
        findings.push({ code: 'INTERNAL_LINK_TARGET_NOT_PLANNED', blocking: true, message: 'An internal link points outside the approved page plan.', pageReference: brief.pageReference });
      }
      if (link.targetPageReference === brief.pageReference) {
        findings.push({ code: 'INTERNAL_LINK_SELF_REFERENCE', blocking: true, message: 'A page cannot be its own internal-link target.', pageReference: brief.pageReference });
      }
      const anchor = link.anchorText.trim().toLocaleLowerCase();
      const existingAnchorTarget = anchorTargets.get(anchor);
      if (existingAnchorTarget && existingAnchorTarget !== link.targetPageReference) {
        findings.push({ code: 'CANNIBALISING_ANCHOR_TARGET', blocking: true, message: 'The same governed anchor text points to competing page targets.', pageReference: brief.pageReference });
      } else anchorTargets.set(anchor, link.targetPageReference);
    }
    if (brief.richResultEligibility.includes('FAQ_PAGE') && !brief.schemaTypes.includes('FAQ_PAGE')) {
      findings.push({ code: 'RICH_RESULT_SCHEMA_MISSING', blocking: true, message: 'An eligible rich result must be represented in the page schema plan.', pageReference: brief.pageReference });
    }
  }

  const incoming = new Set(input.briefs.flatMap(brief => brief.internalLinks.map(link => link.targetPageReference)));
  const home = input.plannedPages.find(page => page.pageType === 'HOME')?.pageReference;
  for (const page of input.plannedPages) {
    if (page.pageReference !== home && !incoming.has(page.pageReference)) {
      findings.push({ code: 'ORPHAN_PAGE', blocking: true, message: 'The planned page has no approved incoming internal link.', pageReference: page.pageReference });
    }
  }

  if (home) {
    const edges = new Map(input.briefs.map(brief => [
      brief.pageReference,
      brief.internalLinks.map(link => link.targetPageReference),
    ]));
    const depth = new Map<string, number>([[home, 0]]);
    const queue = [home];
    while (queue.length) {
      const source = queue.shift()!;
      const sourceDepth = depth.get(source)!;
      for (const target of edges.get(source) ?? []) {
        if (!depth.has(target)) {
          depth.set(target, sourceDepth + 1);
          queue.push(target);
        }
      }
    }
    for (const page of input.plannedPages) {
      const pageDepth = depth.get(page.pageReference);
      if (pageDepth !== undefined
        && pageDepth > input.strategy.internalLinkStrategy.maximumClicksFromHome) {
        findings.push({ code: 'EXCESSIVE_LINK_DEPTH', blocking: true, message: `The page requires ${pageDepth} clicks from Home, exceeding the approved maximum.`, pageReference: page.pageReference });
      }
    }
  }

  const validEvidence = new Set(input.strategy.provenance.researchEvidenceReferences);
  for (const analysis of input.strategy.serpAnalyses) {
    if (!validEvidence.has(analysis.evidenceReference)) {
      findings.push({ code: 'SERP_ANALYSIS_EVIDENCE_MISSING', blocking: true, message: `SERP analysis for “${analysis.query}” is not pinned to strategy research provenance.` });
    }
  }
  for (const pageReference of input.strategy.brandSearchStrategy.targetPageReferences) {
    if (!planned.has(pageReference)) {
      findings.push({ code: 'BRAND_SEARCH_TARGET_NOT_PLANNED', blocking: true, message: 'The brand search strategy targets a page outside the approved plan.', pageReference });
    }
  }
  for (const keyword of input.strategy.keywordUniverse) {
    if (keyword.metrics && !validEvidence.has(keyword.metrics.evidenceReference)) {
      findings.push({ code: 'KEYWORD_METRIC_EVIDENCE_MISSING', blocking: true, message: `Researched metrics for “${keyword.keyword}” are not in strategy provenance.` });
    }
  }
  return findings;
}

export function assertSearchIntelligenceReady(input: Parameters<typeof validateSearchIntelligencePlan>[0]): void {
  const blocking = validateSearchIntelligencePlan(input).filter(finding => finding.blocking);
  if (blocking.length) {
    throw new Error(`SEARCH_INTELLIGENCE_NOT_READY:${blocking.map(finding => finding.code).join(',')}`);
  }
}

export function validateGeneratedPageAgainstSeoBrief(input: {
  brief: PageSeoBrief;
  page: {
    pageReference: string;
    pageType: string;
    title: string;
    seo: { title: string; canonicalPath: string; index: boolean };
    internalLinks: ReadonlyArray<{ targetPageReference: string }>;
    sections: ReadonlyArray<{ type: string }>;
    structuredDataInputs: ReadonlyArray<{ type: string }>;
  };
}): SearchIntelligenceFinding[] {
  const findings: SearchIntelligenceFinding[] = [];
  const { brief, page } = input;
  const add = (code: string, message: string) => findings.push({
    code, blocking: true, message, pageReference: page.pageReference,
  });
  if (brief.pageReference !== page.pageReference || brief.pageType !== page.pageType) {
    add('GENERATED_PAGE_SEO_BRIEF_BINDING_MISMATCH', 'Generated content changed the approved SEO brief identity.');
  }
  if (page.seo.canonicalPath !== brief.canonicalPath) {
    add('GENERATED_CANONICAL_PATH_CHANGED', 'Generated metadata changed the approved canonical path.');
  }
  if (page.seo.index !== (brief.indexation === 'INDEX')) {
    add('GENERATED_INDEXATION_CHANGED', 'Generated metadata changed the approved indexation decision.');
  }
  const target = brief.primaryKeyword.toLocaleLowerCase();
  if (!`${page.title} ${page.seo.title}`.toLocaleLowerCase().includes(target)) {
    add('PRIMARY_TOPIC_TARGET_MISSING', 'The generated title and SEO title omit the approved primary topic target.');
  }
  const allowedTargets = new Set(brief.internalLinks.map(link => link.targetPageReference));
  if (page.internalLinks.some(link => !allowedTargets.has(link.targetPageReference))) {
    add('GENERATED_INTERNAL_LINK_PLAN_CHANGED', 'Generated content links outside the approved page-level internal-link plan.');
  }
  const hasFaqContent = page.sections.some(section => section.type === 'FAQ');
  const hasFaqSchema = page.structuredDataInputs.some(item => item.type === 'FAQ');
  if (hasFaqSchema && (!hasFaqContent || !brief.schemaTypes.includes('FAQ_PAGE'))) {
    add('FAQ_SCHEMA_INELIGIBLE', 'FAQ structured data requires visible FAQ content and explicit brief eligibility.');
  }
  return findings;
}
