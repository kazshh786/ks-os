import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKeywordResearchGrounded,
  composeKeywordResearchPrompt,
  createKeywordResearchDataset,
  type KeywordResearchReport,
} from '../src/index.js';

const evidenceA = '10000001-1111-4111-8111-000000000001';
const evidenceB = '10000002-1111-4111-8111-000000000002';
const pageReference = '10000003-1111-4111-8111-000000000003';

function strategy() {
  return {
    searchMarket: {
      countryCode: 'GB', languageCode: 'en', locale: 'en-GB',
      searchEngines: ['GOOGLE'], locations: ['Blackburn'],
    },
    competitorLandscape: [
      {
        name: 'Competitor One', hostname: 'competitor-one.example',
        type: 'SEARCH_COMPETITOR', evidence: {
          statement: 'Observed in approved research.', sourceClassification: 'SEARCH_RESEARCH',
          evidenceReferences: [evidenceA],
        },
      },
      {
        name: 'Competitor Two', hostname: 'competitor-two.example',
        type: 'SEARCH_COMPETITOR', evidence: {
          statement: 'Observed in approved research.', sourceClassification: 'SEARCH_RESEARCH',
          evidenceReferences: [evidenceB],
        },
      },
    ],
    keywordUniverse: [{
      keyword: 'laser hair removal blackburn',
      classes: ['LOCAL', 'COMMERCIAL'],
      intent: 'LOCAL',
      topicClusterKey: 'laser-hair-removal',
      targetPageReference: pageReference,
      metrics: {
        monthlySearchVolume: 720,
        keywordDifficulty: 28,
        sourceClassification: 'SEARCH_RESEARCH',
        evidenceReference: evidenceA,
        measuredAt: '2026-08-18T12:00:00.000Z',
      },
      rationale: {
        statement: 'Approved competitor keyword research confirms the term.',
        sourceClassification: 'SEARCH_RESEARCH',
        evidenceReferences: [evidenceA, evidenceB],
      },
    }],
  } as any;
}

function evidence() {
  return [
    {
      reference: evidenceA,
      providerKey: 'uploaded-semrush',
      query: 'laser hair removal blackburn',
      market: 'GB', locale: 'en-GB', location: 'Blackburn', language: 'en', device: 'DESKTOP',
      capturedAt: '2026-08-18T12:00:00.000Z',
      sourceDigestSha256: 'a'.repeat(64), payloadDigestSha256: 'b'.repeat(64),
      notes: [
        'Observed competitor/domain: competitor-one.example',
        'Average position/rank: 3',
        'Observed URL: https://competitor-one.example/laser-hair-removal',
      ],
    },
    {
      reference: evidenceB,
      providerKey: 'uploaded-ahrefs',
      query: 'laser hair removal blackburn',
      market: 'GB', locale: 'en-GB', location: 'Blackburn', language: 'en', device: 'DESKTOP',
      capturedAt: '2026-08-18T12:00:00.000Z',
      sourceDigestSha256: 'c'.repeat(64), payloadDigestSha256: 'd'.repeat(64),
      notes: [
        'Observed competitor/domain: competitor-two.example',
        'Average position/rank: 6',
        'Observed URL: https://competitor-two.example/treatments/laser',
      ],
    },
  ] as any;
}

function report(): KeywordResearchReport {
  return {
    specialist: 'KEYWORD_RESEARCH',
    researchOnly: true,
    objective: 'Compare observed competitor keyword evidence and hand grounded opportunities to the SEO specialist.',
    methodology: [
      'Compare every approved competitor keyword observation and its associated evidence reference.',
      'Use observed positions and URLs only when the research evidence explicitly records them.',
    ],
    coverage: {
      keywordUniverseCount: 1,
      researchEvidenceCount: 2,
      measuredKeywordCount: 1,
      observedCompetitorCount: 2,
      competitorKeywordObservationCount: 2,
      rankedObservationCount: 2,
    },
    competitorFindings: [{
      competitor: 'competitor-one.example',
      observedKeywords: ['laser hair removal blackburn'],
      evidenceReferences: [evidenceA],
      patternSummary: 'This competitor is directly observed ranking for the researched local commercial term.',
    }],
    keywordOpportunities: [{
      keyword: 'laser hair removal blackburn',
      intent: 'LOCAL',
      classes: ['LOCAL', 'COMMERCIAL'],
      opportunityType: 'COMPETITOR_OVERLAP',
      competitors: ['competitor-one.example', 'competitor-two.example'],
      evidenceReferences: [evidenceA, evidenceB],
      rationale: 'Two observed competitors appear for the same researched local commercial query, making it important for SEO review.',
    }],
    clusters: [],
    limitations: ['The evidence covers two supplied competitors and does not prove complete market-wide competitor coverage.'],
    handoffToSeo: ['SEO should decide page ownership and priority using this evidence plus the approved page briefs and Knowledge Pack rules.'],
  };
}

test('keyword research dataset preserves multiple competitor observations for the same keyword', () => {
  const dataset = createKeywordResearchDataset({ strategy: strategy(), evidence: evidence() });
  assert.equal(dataset.observations.length, 2);
  assert.deepEqual(dataset.observations.map(item => item.competitor), [
    'competitor-one.example',
    'competitor-two.example',
  ]);
  assert.deepEqual(dataset.observations.map(item => item.observedPosition), [3, 6]);
  assert.equal(dataset.coverage.observedCompetitorCount, 2);
  assert.equal(dataset.coverage.rankedObservationCount, 2);
  assert.equal(dataset.coverage.measuredKeywordCount, 1);
});

test('keyword research report accepts only approved keywords, competitors and evidence', () => {
  assert.doesNotThrow(() => assertKeywordResearchGrounded({
    report: report(), strategy: strategy(), evidence: evidence(),
  }));

  const inventedKeyword = {
    ...report(),
    keywordOpportunities: [{
      ...report().keywordOpportunities[0]!,
      keyword: 'invented competitor keyword',
    }],
  };
  assert.throws(() => assertKeywordResearchGrounded({
    report: inventedKeyword, strategy: strategy(), evidence: evidence(),
  }), /KEYWORD_RESEARCH_UNGROUNDED_KEYWORD/);
});

test('keyword research prompt is explicitly research-only and bounded by supplied evidence', () => {
  const prompt = composeKeywordResearchPrompt({
    plan: {
      siteReference: '10000004-1111-4111-8111-000000000004',
      blueprintReference: '10000005-1111-4111-8111-000000000005',
      blueprintRevision: 1,
      templateVersionReference: '10000006-1111-4111-8111-000000000006',
      knowledgePackReference: '10000007-1111-4111-8111-000000000007',
      knowledgePackSemanticVersion: '3.2.1',
      pages: [],
    } as any,
    facts: {
      businessReference: '10000008-1111-4111-8111-000000000008',
      business: [], services: [], locations: [], staff: [], policies: [], brand: [],
      assetReferences: [], approvedAssets: [],
    } as any,
    strategy: strategy(),
    briefs: [],
    evidence: evidence(),
    knowledgeGuidelines: [{
      pageReference,
      pageType: 'SERVICE',
      conversionRole: 'SERVICE_CONVERSION',
      knowledgePack: {
        reference: '10000007-1111-4111-8111-000000000007', semanticVersion: '3.2.1',
        schemaVersion: 4, contentDigest: 'knowledge-digest',
      },
      applicableRuleIds: ['CONTENT_SEO_NO_KEYWORD_STUFFING'],
      requiredInstructions: ['Use researched terms naturally and only when they match the page intent.'],
      prohibitedBehaviours: ['Do not fabricate search rankings or metrics.'],
      missingBusinessDataRequirements: [], deterministicRequirements: [], aiReviewInstructions: [],
      humanReviewInstructions: [], pagePlaybook: null, sourceReferences: [], omittedRuleCount: 0,
      requiredRulesExceededLimit: false,
    }],
  });
  const parsed = JSON.parse(prompt) as any;
  assert.equal(parsed.operation, 'KEYWORD_COMPETITOR_RESEARCH_V1');
  assert.equal(parsed.keywordResearchDataset.observations.length, 2);
  assert.ok(parsed.systemContract.some((rule: string) => rule.includes('scope is the supplied evidence')));
  assert.ok(parsed.systemContract.some((rule: string) => rule.includes('Never infer that a competitor ranks')));
  assert.equal(parsed.researchStandard.includes('Semrush/Ahrefs-style'), true);
});