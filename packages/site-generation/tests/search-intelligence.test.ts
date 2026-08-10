import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DisabledSearchResearchProvider,
  FakeSearchResearchProvider,
  KeywordMetricsSchema,
  PageSeoBriefSchema,
  SearchIntelligenceStrategyV2Schema,
  SearchIntentSchema,
  SearchKeywordClassSchema,
  assertApprovedPageSeoBriefUnchanged,
  pageSeoBriefDigest,
  searchStrategyDigest,
  validateSearchIntelligencePlan,
  type PageSeoBrief,
  type SearchIntelligenceStrategyV2,
  type SearchResearchEvidence,
} from '../src/index.js';

const ids = Array.from({ length: 30 }, (_, index) =>
  `${String(index + 1).padStart(8, '0')}-1111-4111-8111-${String(index + 1).padStart(12, '0')}`);
const now = '2026-08-10T12:00:00.000Z';
const digest = 'a'.repeat(64);
const statement = (text: string) => ({
  statement: text,
  sourceClassification: 'AGENCY_DECISION' as const,
  evidenceReferences: [],
});
const provenance = {
  providerKey: 'vertex-gemini', modelKey: 'gemini-3.6-flash', inputDigestSha256: digest,
  researchDigestSha256: digest, outputDigestSha256: digest, generatedAt: now,
  generatedByAgencyUserReference: ids[9]!, researchEvidenceReferences: [ids[10]!],
};

function strategy(overrides: Partial<SearchIntelligenceStrategyV2> = {}) {
  return SearchIntelligenceStrategyV2Schema.parse({
    schemaVersion: 2,
    reference: ids[0]!, siteReference: ids[1]!, blueprintReference: ids[2]!, blueprintRevision: 2,
    strategyVersion: 1, status: 'APPROVED',
    targetAudience: { segments: [{ key: 'new-clients', name: 'New clients', needs: [statement('Understand the service before booking.')], objections: [] }] },
    searchMarket: { countryCode: 'GB', languageCode: 'en', locale: 'en-GB', searchEngines: ['GOOGLE'], locations: ['London'] },
    serpAnalyses: [{
      reference: ids[13]!, evidenceReference: ids[10]!, query: 'example service', location: 'London', language: 'en-GB', device: 'DESKTOP', capturedAt: now,
      organicResultTypes: ['Service landing pages'], localPackPresent: true, aiOverviewObserved: false,
      featuredSnippetObserved: false, peopleAlsoAskObserved: true, videoResultsObserved: false,
      imageResultsObserved: false, shoppingResultsObserved: false, discussionResultsObserved: false,
      dominantContentFormats: ['Service landing page'], dominantIntent: 'COMMERCIAL_INVESTIGATION',
      commonEntities: ['Example Limited'], commonSubtopics: ['Booking'], contentDepthPatterns: ['Detailed service explanations'],
      authorityPatterns: ['Named business and clear contact details'],
    }],
    competitorLandscape: [{ name: 'Example competitor', type: 'BUSINESS_COMPETITOR', evidence: statement('Chosen by the agency for comparison.'), strengths: [], gaps: [] }],
    keywordUniverse: [{
      keyword: 'example service', classes: ['SEED', 'COMMERCIAL'], intent: 'COMMERCIAL_INVESTIGATION',
      topicClusterKey: 'services', targetPageReference: ids[4]!, rationale: statement('Maps to the principal service page.'),
    }],
    searchIntentClusters: [{ key: 'service-research', intent: 'COMMERCIAL_INVESTIGATION', keywords: ['example service'], audienceSegmentKeys: ['new-clients'] }],
    topicClusters: [{ key: 'services', name: 'Services', pillarPageReference: ids[4]!, supportingPageReferences: [ids[5]!], primaryIntent: 'COMMERCIAL_INVESTIGATION' }],
    entityStrategy: { primaryEntity: statement('Example Limited'), supportingEntities: [], disambiguationNotes: [] },
    authorityStrategy: { ymylRisk: 'LOW', requiredAuthorCredentials: [], requiredReviewerCredentials: [], citationPolicy: 'Cite claims that are not verified business facts.', evidenceFreshnessDays: 90 },
    authorityProfile: {
      experienceEvidence: [statement('The business can contribute verified first-hand service experience.')],
      expertiseEvidence: [], authoritativenessEvidence: [], trustEvidence: [statement('Canonical contact information is available.')],
      readinessDimensions: {},
    },
    offSiteAuthorityPlan: {
      opportunities: [], prohibitLinkSpam: true, prohibitPrivateBlogNetworks: true, prohibitPaidLinkSchemes: true,
    },
    localSearchStrategy: { enabled: true, locationPageReferences: [], napConsistencyRequired: true, localTopics: ['London'] },
    aiAnswerStrategy: { answerTargets: [{ question: 'What is the example service?', targetPageReference: ids[4]!, answerFormat: 'DEFINITION', evidenceRequired: true }] },
    brandSearchStrategy: { brandedQueries: ['Example Limited', 'Example Limited services'], targetPageReferences: [ids[4]!], entityConsistencyRequired: true, contactAndServiceOwnershipRequired: true, reviewClaimsRequireVerifiedEvidence: true },
    contentOpportunities: [{
      reference: ids[14]!, targetPageReference: ids[5]!, topic: 'Choosing the example service', dominantIntent: 'COMMERCIAL_INVESTIGATION',
      supportingIntents: ['INFORMATIONAL'], audienceSegmentKeys: ['new-clients'],
      gapEvidence: [statement('The audience needs a clearer evidence-backed service explanation.')],
      uniqueContribution: statement('The business can add verified first-hand process detail.'),
      originalEvidenceRequirements: ['Verified practitioner process notes'], definitiveContentOpportunity: true, priority: 'HIGH',
    }],
    pageOpportunityMap: [
      { pageReference: ids[4]!, pageType: 'HOME', opportunity: 'Own brand and service discovery.', primaryIntent: 'NAVIGATIONAL', topicClusterKey: 'services', priority: 'HIGH' },
      { pageReference: ids[5]!, pageType: 'SERVICE_DETAIL', opportunity: 'Explain the principal service.', primaryIntent: 'COMMERCIAL_INVESTIGATION', topicClusterKey: 'services', priority: 'HIGH' },
    ],
    siteTopicGraph: { nodes: [{ key: 'home', pageReference: ids[4]! }, { key: 'service', pageReference: ids[5]! }], edges: [{ from: 'home', to: 'service', relationship: 'commercial path' }] },
    internalLinkStrategy: { links: [{ sourcePageReference: ids[4]!, targetPageReference: ids[5]!, anchorText: 'Example service', purpose: 'Move visitors to detailed service information.' }], maximumClicksFromHome: 3 },
    structuredDataStrategy: { globalTypes: ['WEB_SITE', 'ORGANIZATION'], pageRules: [], prohibitSelfServingReviews: true },
    technicalSeoStrategy: { canonicalPolicy: 'Use one self-referencing canonical per indexable page.', indexationPolicy: 'Index only approved canonical pages.', redirectPolicy: 'Use permanent redirects for superseded paths.', hreflangEnabled: false, sitemapLastModifiedRequired: true },
    mediaSeoStrategy: { descriptiveAltTextRequired: true, decorativeAltMustBeEmpty: true, imageContextRequired: true, videoTranscriptsRequired: true },
    performanceSeoStrategy: { lcpMillisecondsMaximum: 2500, inpMillisecondsMaximum: 200, clsMaximum: 0.1, measurementModes: ['LAB', 'FIELD'], lcpAssetMustNotLazyLoad: true },
    contentGovernance: { approvalRequired: true, factClassesAllowed: ['VERIFIED_BUSINESS_FACT', 'SEARCH_RESEARCH', 'AI_INFERENCE', 'AGENCY_DECISION'], contentFreshnessDays: 180, materialRevisionRequiresReapproval: true },
    provenance,
    approvedAt: now, approvedByAgencyUserReference: ids[9]!,
    ...overrides,
  });
}

function brief(input: { reference: string; blueprintPageReference: string; pageReference: string; pageType: 'HOME' | 'SERVICE_DETAIL'; canonicalPath: string; primaryKeyword: string; targetPageReference: string }) {
  const governedAnchorText = input.pageType === 'HOME' ? 'Explore the example service' : 'Return to Example Limited';
  return PageSeoBriefSchema.parse({
    schemaVersion: 2, reference: input.reference, strategyReference: ids[0]!, strategyVersion: 1, briefVersion: 1,
    blueprintPageReference: input.blueprintPageReference, pageReference: input.pageReference, pageType: input.pageType,
    status: 'APPROVED', indexation: 'INDEX', canonicalPath: input.canonicalPath, searchIntent: 'COMMERCIAL_INVESTIGATION',
    audienceSegmentKeys: ['new-clients'], primarySearchIntent: 'COMMERCIAL_INVESTIGATION', secondarySearchIntents: [],
    primaryTopic: input.primaryKeyword, secondaryTopics: [], primaryKeyword: input.primaryKeyword, secondaryKeywords: [],
    longTailKeywords: [], questionKeywords: [], localModifiers: ['London'], topicClusterKey: 'services',
    targetEntities: ['Example Limited'], entitiesToCover: ['Example Limited'], questionsToAnswer: ['What does this service include?'],
    funnelStage: 'CONSIDERATION', audienceJobs: ['Understand the service'],
    recommendedTitle: `${input.primaryKeyword} | Example`, recommendedMetaDescription: `Understand ${input.primaryKeyword} and the practical next step for booking with Example.`,
    recommendedH1: `${input.primaryKeyword} heading`, recommendedH2Topics: ['What the service includes'],
    urlRecommendation: input.canonicalPath, indexationPolicy: 'Index this approved canonical page.',
    canonicalPolicy: 'Use the exact self-referencing canonical path.', contentFormat: 'LANDING_PAGE', minimumContentDepthWords: 500,
    contentDepthGuidance: 'Answer the visitor’s decision questions with specific, evidence-backed detail.',
    recommendedHeadings: [`${input.primaryKeyword} heading`], faqOpportunities: [], competitorGapNotes: [], snippetTarget: 'PARAGRAPH', richResultEligibility: [],
    internalLinks: [{ targetPageReference: input.targetPageReference, anchorText: governedAnchorText, purpose: 'Continue the planned visitor and topic journey.' }],
    internalLinksIn: [], internalLinksOut: [{ targetPageReference: input.targetPageReference, anchorText: governedAnchorText, purpose: 'Continue the planned visitor and topic journey.' }],
    schemaTypes: ['WEB_PAGE', 'BREADCRUMB_LIST'], imageRequirements: [], mediaRequirements: [],
    featuredSnippetOpportunity: 'PARAGRAPH', aiAnswerOpportunity: { enabled: true, question: 'What does this service include?', answerFormat: 'PARAGRAPH' },
    authorship: { required: false, credentials: [] }, reviewer: { required: false, credentials: [] },
    evidenceRequirements: [], requiredEvidence: [], authoritySignals: [], freshnessDays: 180, contentRisk: { ymyl: 'LOW', notes: [] },
    provenance: { ...provenance, strategyReference: ids[0]!, strategyVersion: 1, strategyDigestSha256: digest },
    approvedAt: now, approvedByAgencyUserReference: ids[9]!,
  });
}

function validPlan() {
  const briefs = [
    brief({ reference: ids[11]!, blueprintPageReference: ids[6]!, pageReference: ids[4]!, pageType: 'HOME', canonicalPath: '/', primaryKeyword: 'example business', targetPageReference: ids[5]! }),
    brief({ reference: ids[12]!, blueprintPageReference: ids[7]!, pageReference: ids[5]!, pageType: 'SERVICE_DETAIL', canonicalPath: '/example-service', primaryKeyword: 'example service', targetPageReference: ids[4]! }),
  ];
  const plannedPages = [
    { blueprintPageReference: ids[6]!, pageReference: ids[4]!, pageType: 'HOME' },
    { blueprintPageReference: ids[7]!, pageReference: ids[5]!, pageType: 'SERVICE_DETAIL' },
  ];
  return { strategy: strategy(), briefs, plannedPages };
}

test('exposes the governed intent and keyword taxonomies', () => {
  assert.deepEqual(SearchIntentSchema.options, ['INFORMATIONAL', 'NAVIGATIONAL', 'COMMERCIAL_INVESTIGATION', 'TRANSACTIONAL', 'LOCAL']);
  assert.equal(SearchKeywordClassSchema.options.length, 12);
  assert.ok(SearchKeywordClassSchema.options.includes('SEMANTIC_SUPPORTING'));
});

test('keeps unknown keyword metrics absent and rejects metrics without measured values', () => {
  assert.equal(strategy().keywordUniverse[0]!.metrics, undefined);
  assert.equal(KeywordMetricsSchema.safeParse({ sourceClassification: 'SEARCH_RESEARCH', evidenceReference: ids[10]!, measuredAt: now }).success, false);
  assert.equal(KeywordMetricsSchema.safeParse({ monthlySearchVolume: 100, sourceClassification: 'AI_INFERENCE', evidenceReference: ids[10]!, measuredAt: now }).success, false);
});

test('requires evidence references for search-research statements', () => {
  const parsed = SearchIntelligenceStrategyV2Schema.safeParse({
    ...strategy(),
    competitorLandscape: [{ name: 'Research result', type: 'SEARCH', evidence: { statement: 'Ranks for a term.', sourceClassification: 'SEARCH_RESEARCH', evidenceReferences: [] }, strengths: [], gaps: [] }],
  });
  assert.equal(parsed.success, false);
});

test('validates an exact, approved page/brief plan', () => {
  assert.deepEqual(validateSearchIntelligencePlan(validPlan()), []);
});

test('blocks missing briefs, cannibalization, invalid links and orphan pages', () => {
  const plan = validPlan();
  const duplicate = PageSeoBriefSchema.parse({
    ...plan.briefs[1]!,
    primaryKeyword: plan.briefs[0]!.primaryKeyword,
    internalLinks: [{ targetPageReference: ids[20]!, anchorText: 'Bad target', purpose: 'This target is outside the approved plan.' }],
    internalLinksOut: [{ targetPageReference: ids[20]!, anchorText: 'Bad target', purpose: 'This target is outside the approved plan.' }],
  });
  const homeWithoutServiceLink = PageSeoBriefSchema.parse({
    ...plan.briefs[0]!,
    internalLinks: [{ targetPageReference: ids[20]!, anchorText: 'Bad target', purpose: 'This target is outside the approved plan.' }],
    internalLinksOut: [{ targetPageReference: ids[20]!, anchorText: 'Bad target', purpose: 'This target is outside the approved plan.' }],
  });
  const findings = validateSearchIntelligencePlan({ ...plan, briefs: [homeWithoutServiceLink, duplicate] });
  const codes = findings.map(finding => finding.code);
  assert.ok(codes.includes('KEYWORD_CANNIBALISATION'));
  assert.ok(codes.includes('INTERNAL_LINK_TARGET_NOT_PLANNED'));
  assert.ok(codes.includes('ORPHAN_PAGE'));
  assert.ok(validateSearchIntelligencePlan({ ...plan, briefs: plan.briefs.slice(0, 1) }).some(finding => finding.code === 'PAGE_SEO_BRIEF_MISSING'));
});

test('approved briefs are immutable while approval metadata is digest-neutral', () => {
  const current = validPlan().briefs[0]!;
  const metadataOnly = PageSeoBriefSchema.parse({ ...current, approvedAt: '2026-08-10T13:00:00.000Z' });
  assert.equal(pageSeoBriefDigest(current), pageSeoBriefDigest(metadataOnly));
  assert.doesNotThrow(() => assertApprovedPageSeoBriefUnchanged({ current, replacement: metadataOnly }));
  const changed = PageSeoBriefSchema.parse({ ...current, primaryKeyword: 'a different target' });
  assert.throws(() => assertApprovedPageSeoBriefUnchanged({ current, replacement: changed }), /APPROVED_PAGE_SEO_BRIEF_IMMUTABLE/);
});

test('strategy digest is stable across approval metadata changes', () => {
  assert.equal(searchStrategyDigest(strategy()), searchStrategyDigest(strategy({ approvedAt: '2026-08-10T14:00:00.000Z' })));
});

test('high-risk YMYL and FAQ schema require governance inputs', () => {
  const base = validPlan().briefs[0]!;
  assert.equal(PageSeoBriefSchema.safeParse({ ...base, contentRisk: { ymyl: 'HIGH', notes: [] } }).success, false);
  assert.equal(PageSeoBriefSchema.safeParse({ ...base, schemaTypes: [...base.schemaTypes, 'FAQ_PAGE'], faqOpportunities: [] }).success, false);
});

test('disabled and fake providers cannot accidentally perform live research', async () => {
  await assert.rejects(() => new DisabledSearchResearchProvider().research({ query: 'term', market: 'GB', locale: 'en-GB', location: 'London', language: 'en-GB', device: 'DESKTOP', capturedAt: now }), /SEARCH_RESEARCH_DISABLED/);
  const evidence: SearchResearchEvidence = {
    reference: ids[10]!, providerKey: 'fixture', query: 'term', market: 'GB', locale: 'en-GB',
    location: 'London', language: 'en-GB', device: 'DESKTOP', capturedAt: now,
    sourceDigestSha256: digest, payloadDigestSha256: digest, notes: [],
  };
  const result = { evidence: [evidence], serpAnalyses: [strategy().serpAnalyses[0]!] };
  const provider = new FakeSearchResearchProvider(new Map([['GB:en-GB:London:en-GB:DESKTOP:term', result]]));
  const request = { market: 'GB', locale: 'en-GB', location: 'London', language: 'en-GB', device: 'DESKTOP' as const, capturedAt: now };
  assert.deepEqual(await provider.research({ ...request, query: 'term' }), result);
  assert.deepEqual(await provider.research({ ...request, query: 'missing' }), { evidence: [], serpAnalyses: [] });
});
