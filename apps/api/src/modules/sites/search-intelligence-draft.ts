import { randomUUID } from 'node:crypto';
import {
  PageSeoBriefSchema,
  SearchIntelligenceStrategyV2Schema,
  generationDigest,
  pageSeoBriefDigest,
  searchStrategyDigest,
  type PageSeoBrief,
  type SearchIntelligenceStrategyV2,
} from '@ks-os/site-generation';

interface BlueprintPage {
  reference: string;
  pageType: string;
  title: string;
  proposedSlug: string;
  sortOrder: number;
}

const zeroDigest = '0'.repeat(64);
const statement = (value: string) => ({
  statement: value,
  sourceClassification: 'AGENCY_DECISION' as const,
  evidenceReferences: [],
});

function intentFor(pageType: string) {
  if (pageType === 'HOME') return 'NAVIGATIONAL' as const;
  if (['BOOKING', 'CONTACT'].includes(pageType)) return 'TRANSACTIONAL' as const;
  if (pageType.startsWith('LOCATION')) return 'LOCAL' as const;
  if (pageType.startsWith('SERVICE')) return 'COMMERCIAL_INVESTIGATION' as const;
  return 'INFORMATIONAL' as const;
}

function formatFor(pageType: string) {
  if (pageType.includes('GUIDE')) return 'GUIDE' as const;
  if (pageType === 'FAQ' || pageType === 'FAQ_RESOURCE') return 'FAQ' as const;
  if (pageType === 'HOW_TO') return 'HOW_TO' as const;
  if (pageType === 'ARTICLE' || pageType === 'BLOG_POST') return 'ARTICLE' as const;
  if (pageType === 'TUTORIAL') return 'TUTORIAL' as const;
  if (pageType === 'DEFINITION') return 'DEFINITION' as const;
  if (pageType === 'TROUBLESHOOTING') return 'TROUBLESHOOTING' as const;
  if (pageType === 'COMPARISON') return 'COMPARISON' as const;
  if (pageType === 'CASE_STUDY') return 'CASE_STUDY' as const;
  return 'LANDING_PAGE' as const;
}

function canonicalPath(page: BlueprintPage) {
  if (page.pageType === 'HOME') return '/';
  const value = page.proposedSlug.trim();
  return value.startsWith('/') ? value : `/${value}`;
}

function bounded(value: string, maximum: number) {
  return value.trim().slice(0, maximum).trim();
}

/**
 * Produces an honest blueprint-context draft. It deliberately contains no
 * invented search metrics or SERP observations. Human research and approval
 * remain separate, visible gates.
 */
export function buildBlueprintSearchIntelligenceDraft(input: {
  siteReference: string;
  blueprintReference: string;
  blueprintRevision: number;
  strategyVersion: number;
  generatedByAgencyUserReference: string;
  pages: readonly BlueprintPage[];
  generatedAt?: string;
}) {
  const pages = [...input.pages].sort((left, right) =>
    left.sortOrder - right.sortOrder || left.reference.localeCompare(right.reference));
  if (!pages.length) throw new Error('SEARCH_INTELLIGENCE_BLUEPRINT_PAGES_REQUIRED');
  const generatedAt = input.generatedAt || new Date().toISOString();
  const strategyReference = randomUUID();
  const pageReferenceByBlueprint = new Map(pages.map(page => [page.reference, randomUUID()]));
  const home = pages.find(page => page.pageType === 'HOME') || pages[0]!;
  const homePageReference = pageReferenceByBlueprint.get(home.reference)!;
  const clusterKey = (index: number) => `page-${index + 1}`;
  const keywordFor = (page: BlueprintPage, index: number) =>
    bounded(`${page.title} ${page.pageType.toLowerCase().replaceAll('_', ' ')} ${index + 1}`, 240);
  const links = pages.flatMap(page => {
    const source = pageReferenceByBlueprint.get(page.reference)!;
    const targets = page.reference === home.reference
      ? pages.filter(target => target.reference !== home.reference)
      : [home];
    return targets.map(target => ({
      sourcePageReference: source,
      targetPageReference: pageReferenceByBlueprint.get(target.reference)!,
      anchorText: bounded(target.pageType === 'HOME' ? 'Return home' : `Explore ${target.title}`, 120),
      purpose: 'Connect the approved page architecture through a governed visitor journey.',
    }));
  });
  const inputDigestSha256 = generationDigest({
    siteReference: input.siteReference,
    blueprintReference: input.blueprintReference,
    blueprintRevision: input.blueprintRevision,
    pages,
  });
  const researchDigestSha256 = generationDigest({
    source: 'BLUEPRINT_CONTEXT_ONLY',
    evidence: [],
    note: 'No external search metrics or SERP observations were asserted.',
  });
  const provenance = {
    providerKey: 'ks-os-governed-draft',
    modelKey: 'blueprint-context-v1',
    inputDigestSha256,
    researchDigestSha256,
    outputDigestSha256: zeroDigest,
    generatedAt,
    generatedByAgencyUserReference: input.generatedByAgencyUserReference,
    researchEvidenceReferences: [],
  };
  const strategyDraft = SearchIntelligenceStrategyV2Schema.parse({
    schemaVersion: 2,
    reference: strategyReference,
    siteReference: input.siteReference,
    blueprintReference: input.blueprintReference,
    blueprintRevision: input.blueprintRevision,
    strategyVersion: input.strategyVersion,
    status: 'DRAFT',
    targetAudience: {
      segments: [{
        key: 'prospective-customers',
        name: 'Prospective customers',
        needs: [statement('Understand the verified offer and the appropriate next action.')],
        objections: [],
      }],
    },
    searchMarket: {
      countryCode: 'GB',
      languageCode: 'en',
      locale: 'en-GB',
      searchEngines: ['GOOGLE'],
      locations: [],
    },
    serpAnalyses: [],
    competitorLandscape: [],
    keywordUniverse: pages.map((page, index) => ({
      keyword: keywordFor(page, index),
      classes: [page.pageType === 'HOME' ? 'BRAND' : page.pageType === 'BOOKING' ? 'TRANSACTIONAL' : 'SEED'],
      intent: intentFor(page.pageType),
      topicClusterKey: clusterKey(index),
      targetPageReference: pageReferenceByBlueprint.get(page.reference),
      rationale: statement('Initial draft ownership follows the exact approved blueprint page and requires human search review.'),
    })),
    searchIntentClusters: pages.map((page, index) => ({
      key: clusterKey(index),
      intent: intentFor(page.pageType),
      keywords: [keywordFor(page, index)],
      audienceSegmentKeys: ['prospective-customers'],
    })),
    topicClusters: pages.map((page, index) => ({
      key: clusterKey(index),
      name: page.title,
      pillarPageReference: pageReferenceByBlueprint.get(page.reference),
      supportingPageReferences: [],
      primaryIntent: intentFor(page.pageType),
    })),
    entityStrategy: {
      primaryEntity: statement('Use only the agency-verified canonical business identity.'),
      supportingEntities: [],
      disambiguationNotes: [],
    },
    authorityStrategy: {
      ymylRisk: 'LOW',
      requiredAuthorCredentials: [],
      requiredReviewerCredentials: [],
      citationPolicy: 'Substantive claims require verified business facts or reviewed evidence.',
      evidenceFreshnessDays: 90,
    },
    authorityProfile: {
      experienceEvidence: [],
      expertiseEvidence: [],
      authoritativenessEvidence: [],
      trustEvidence: [],
      readinessDimensions: {},
    },
    offSiteAuthorityPlan: {
      opportunities: [],
      prohibitLinkSpam: true,
      prohibitPrivateBlogNetworks: true,
      prohibitPaidLinkSchemes: true,
    },
    localSearchStrategy: {
      enabled: pages.some(page => page.pageType.startsWith('LOCATION')),
      locationPageReferences: pages.filter(page => page.pageType.startsWith('LOCATION')).map(page => pageReferenceByBlueprint.get(page.reference)),
      napConsistencyRequired: true,
      localTopics: [],
    },
    aiAnswerStrategy: {
      answerTargets: pages.map(page => ({
        question: bounded(`What should a visitor know about ${page.title}?`, 240),
        targetPageReference: pageReferenceByBlueprint.get(page.reference),
        answerFormat: 'PARAGRAPH',
        evidenceRequired: true,
      })),
    },
    brandSearchStrategy: {
      brandedQueries: ['the verified business'],
      targetPageReferences: [homePageReference],
      entityConsistencyRequired: true,
      contactAndServiceOwnershipRequired: true,
      reviewClaimsRequireVerifiedEvidence: true,
    },
    contentOpportunities: pages.map(page => ({
      reference: randomUUID(),
      targetPageReference: pageReferenceByBlueprint.get(page.reference),
      topic: page.title,
      dominantIntent: intentFor(page.pageType),
      supportingIntents: [],
      audienceSegmentKeys: ['prospective-customers'],
      gapEvidence: [statement('The approved blueprint reserves this page for a distinct visitor need.')],
      uniqueContribution: statement('Use verified first-party detail supplied and approved through KS OS.'),
      originalEvidenceRequirements: ['Agency-reviewed business facts appropriate to this page'],
      definitiveContentOpportunity: true,
      priority: page.pageType === 'HOME' ? 'HIGH' : 'MEDIUM',
    })),
    pageOpportunityMap: pages.map((page, index) => ({
      pageReference: pageReferenceByBlueprint.get(page.reference),
      pageType: page.pageType,
      opportunity: bounded(`Serve the approved ${page.title} visitor need without competing with another page.`, 240),
      primaryIntent: intentFor(page.pageType),
      topicClusterKey: clusterKey(index),
      priority: page.pageType === 'HOME' ? 'HIGH' : 'MEDIUM',
    })),
    siteTopicGraph: {
      nodes: pages.map((page, index) => ({ key: clusterKey(index), pageReference: pageReferenceByBlueprint.get(page.reference) })),
      edges: links.map(link => ({
        from: clusterKey(pages.findIndex(page => pageReferenceByBlueprint.get(page.reference) === link.sourcePageReference)),
        to: clusterKey(pages.findIndex(page => pageReferenceByBlueprint.get(page.reference) === link.targetPageReference)),
        relationship: 'governed internal link',
      })),
    },
    internalLinkStrategy: { links, maximumClicksFromHome: 3 },
    structuredDataStrategy: {
      globalTypes: ['WEB_SITE', 'ORGANIZATION'],
      pageRules: pages.map(page => ({
        pageReference: pageReferenceByBlueprint.get(page.reference),
        types: ['WEB_PAGE', 'BREADCRUMB_LIST'],
        eligibilityNotes: [statement('Conditional business schema requires verified facts at generation time.')],
      })),
      prohibitSelfServingReviews: true,
    },
    technicalSeoStrategy: {
      canonicalPolicy: 'Use the exact self-referencing canonical path in each approved page brief.',
      indexationPolicy: 'Index only approved canonical pages and preserve noindex review previews.',
      redirectPolicy: 'Use permanent redirects when an approved canonical path is superseded.',
      hreflangEnabled: false,
      sitemapLastModifiedRequired: true,
    },
    mediaSeoStrategy: {
      descriptiveAltTextRequired: true,
      decorativeAltMustBeEmpty: true,
      imageContextRequired: true,
      videoTranscriptsRequired: true,
    },
    performanceSeoStrategy: {
      lcpMillisecondsMaximum: 2500,
      inpMillisecondsMaximum: 200,
      clsMaximum: 0.1,
      measurementModes: ['LAB', 'FIELD'],
      lcpAssetMustNotLazyLoad: true,
    },
    contentGovernance: {
      approvalRequired: true,
      factClassesAllowed: ['VERIFIED_BUSINESS_FACT', 'SEARCH_RESEARCH', 'AI_INFERENCE', 'AGENCY_DECISION'],
      contentFreshnessDays: 180,
      materialRevisionRequiresReapproval: true,
    },
    provenance,
  });
  const strategy = SearchIntelligenceStrategyV2Schema.parse({
    ...strategyDraft,
    provenance: { ...strategyDraft.provenance, outputDigestSha256: searchStrategyDigest(strategyDraft) },
  });
  const briefs: PageSeoBrief[] = pages.map((page, index) => {
    const pageReference = pageReferenceByBlueprint.get(page.reference)!;
    const outbound = links.filter(link => link.sourcePageReference === pageReference)
      .map(({ sourcePageReference: _source, ...link }) => link);
    const inbound = links.filter(link => link.targetPageReference === pageReference)
      .map(link => ({ sourcePageReference: link.sourcePageReference, anchorText: link.anchorText, purpose: link.purpose }));
    const primaryKeyword = keywordFor(page, index);
    const path = canonicalPath(page);
    const meta = bounded(`Explore ${page.title} through accurate, agency-reviewed information and a clear next step.`, 170);
    const briefDraft = PageSeoBriefSchema.parse({
      schemaVersion: 2,
      reference: randomUUID(),
      strategyReference,
      strategyVersion: input.strategyVersion,
      briefVersion: 1,
      blueprintPageReference: page.reference,
      pageReference,
      pageType: page.pageType,
      status: 'DRAFT',
      indexation: 'INDEX',
      canonicalPath: path,
      searchIntent: intentFor(page.pageType),
      audienceSegmentKeys: ['prospective-customers'],
      primarySearchIntent: intentFor(page.pageType),
      secondarySearchIntents: [],
      primaryTopic: page.title,
      secondaryTopics: [],
      primaryKeyword,
      secondaryKeywords: [],
      longTailKeywords: [],
      questionKeywords: [bounded(`What should I know about ${page.title}?`, 240)],
      localModifiers: [],
      topicClusterKey: clusterKey(index),
      targetEntities: [],
      entitiesToCover: [],
      questionsToAnswer: [bounded(`What should a visitor know about ${page.title}?`, 240)],
      funnelStage: page.pageType === 'BOOKING' ? 'DECISION' : 'CONSIDERATION',
      audienceJobs: [bounded(`Understand ${page.title} and choose the appropriate next step.`, 240)],
      recommendedTitle: bounded(`${page.title} | Official information`, 70),
      recommendedMetaDescription: meta,
      recommendedH1: page.title,
      recommendedH2Topics: [bounded(`What to know about ${page.title}`, 240)],
      urlRecommendation: path,
      indexationPolicy: 'Index this page only after the exact version passes human review and publication gates.',
      canonicalPolicy: 'Use the exact self-referencing canonical path.',
      contentFormat: formatFor(page.pageType),
      minimumContentDepthWords: page.pageType === 'HOME' ? 350 : 500,
      contentDepthGuidance: 'Answer the visitor need with specific, verified first-party detail and no fabricated claims.',
      recommendedHeadings: [bounded(`What to know about ${page.title}`, 240)],
      faqOpportunities: [],
      competitorGapNotes: [],
      snippetTarget: 'PARAGRAPH',
      richResultEligibility: [],
      internalLinks: outbound,
      internalLinksIn: inbound,
      internalLinksOut: outbound,
      schemaTypes: ['WEB_PAGE', 'BREADCRUMB_LIST'],
      imageRequirements: [],
      mediaRequirements: [],
      featuredSnippetOpportunity: 'PARAGRAPH',
      aiAnswerOpportunity: {
        enabled: true,
        question: bounded(`What should a visitor know about ${page.title}?`, 240),
        answerFormat: 'PARAGRAPH',
      },
      authorship: { required: false, credentials: [] },
      reviewer: { required: false, credentials: [] },
      evidenceRequirements: [],
      requiredEvidence: [],
      originalEvidenceRequirements: [],
      authoritySignals: [],
      freshnessDays: 180,
      contentRisk: { ymyl: 'LOW', notes: [] },
      provenance: {
        ...provenance,
        strategyReference,
        strategyVersion: input.strategyVersion,
        strategyDigestSha256: strategy.provenance.outputDigestSha256,
      },
    });
    return PageSeoBriefSchema.parse({
      ...briefDraft,
      provenance: { ...briefDraft.provenance, outputDigestSha256: pageSeoBriefDigest(briefDraft) },
    });
  });
  return { strategy, briefs, evidence: [] };
}
