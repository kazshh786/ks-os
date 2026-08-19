import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SPECIALIST_AGENT_TEAM_VERSION,
  SpecialistAgentTeamOutputSchema,
  attachSpecialistTeamContext,
  composeSpecialistAgentPrompt,
  composeSpecialistDirectorPrompt,
  createSpecialistKnowledgeGuidance,
  type SpecialistAgentName,
  type SpecialistAgentTeamOutput,
  type SpecialistBrief,
} from '../src/index.js';

const pageA = '00000001-1111-4111-8111-000000000001';
const pageB = '00000002-1111-4111-8111-000000000002';
const blueprintA = '00000003-1111-4111-8111-000000000003';
const siteReference = '00000004-1111-4111-8111-000000000004';
const blueprintReference = '00000005-1111-4111-8111-000000000005';
const templateReference = '00000006-1111-4111-8111-000000000006';
const knowledgePackReference = '00000007-1111-4111-8111-000000000007';
const layoutReference = '00000008-1111-4111-8111-000000000008';
const businessReference = '00000009-1111-4111-8111-000000000009';

function brief(specialist: SpecialistAgentName): SpecialistBrief {
  return {
    specialist,
    objective: `${specialist} specialist objective for the governed website generation team.`,
    principles: [
      `${specialist} principle one remains inside the approved platform constraints.`,
      `${specialist} principle two supports a useful and coherent customer journey.`,
    ],
    recommendations: [
      {
        priority: 'MUST',
        instruction: `${specialist} global recommendation applies across the approved website.`,
        rationale: 'This recommendation improves the whole-site strategy without changing approved facts.',
        pageReferences: [],
      },
      {
        priority: 'SHOULD',
        instruction: `${specialist} page A recommendation applies only to the first approved page.`,
        rationale: 'This recommendation is intentionally scoped to the first approved page.',
        pageReferences: [pageA],
      },
      {
        priority: 'COULD',
        instruction: `${specialist} page B recommendation applies only to the second approved page.`,
        rationale: 'This recommendation is intentionally scoped to the second approved page.',
        pageReferences: [pageB],
      },
    ],
    risks: [`${specialist} risk should remain visible to downstream composition.`],
    handoffNotes: [`${specialist} handoff note should guide the next specialist without becoming public copy.`],
  };
}

function team(): SpecialistAgentTeamOutput {
  return {
    version: SPECIALIST_AGENT_TEAM_VERSION,
    seo: brief('SEO') as SpecialistAgentTeamOutput['seo'],
    ux: brief('UX') as SpecialistAgentTeamOutput['ux'],
    conversion: brief('CONVERSION') as SpecialistAgentTeamOutput['conversion'],
    copy: brief('COPY') as SpecialistAgentTeamOutput['copy'],
    design: brief('DESIGN') as SpecialistAgentTeamOutput['design'],
    accessibility: brief('ACCESSIBILITY') as SpecialistAgentTeamOutput['accessibility'],
    directorReview: {
      verdict: 'APPROVED',
      summary: 'The specialist recommendations are aligned enough to proceed into governed composition.',
      conflicts: [],
      crossDisciplinePriorities: [
        'Preserve a clear customer journey while satisfying approved search intent.',
        'Keep conversion, copy, design, and accessibility decisions mutually compatible.',
      ],
      nonNegotiables: [
        'Verified business facts and approved Search Intelligence remain authoritative.',
        'Knowledge Pack, template, component, booking, and accessibility governance cannot be overridden.',
      ],
    },
  };
}

function plan() {
  return {
    siteReference,
    blueprintReference,
    blueprintRevision: 1,
    templateVersionReference: templateReference,
    knowledgePackReference,
    knowledgePackSemanticVersion: '3.2.1',
    pages: [{
      blueprintPageReference: blueprintA,
      pageReference: pageA,
      title: 'Home',
      slug: 'home',
      pageType: 'HOME',
      conversionRole: 'PRIMARY_LANDING',
      layoutReference,
      plannedSectionTypes: ['HEADER', 'HERO', 'FINAL_CTA', 'FOOTER'],
    }],
  } as any;
}

function facts() {
  return {
    businessReference,
    business: [],
    services: [],
    locations: [],
    staff: [],
    policies: [],
    brand: [],
    assetReferences: [],
    approvedAssets: [],
  } as any;
}

function searchIntelligence() {
  return {
    strategy: {
      market: 'GB',
      locale: 'en-GB',
      primaryIntent: 'Book a verified local service',
    },
    briefs: [{
      pageReference: pageA,
      blueprintPageReference: blueprintA,
      primaryQuery: 'verified local service',
    }],
    evidence: [{
      query: 'verified local service',
      market: 'GB',
    }],
  } as any;
}

function knowledgeContext(overrides: Record<string, unknown> = {}) {
  return {
    packReference: knowledgePackReference,
    semanticVersion: '3.2.1',
    schemaVersion: 4,
    applicableRuleIds: ['UX_CLEAR_PRIMARY_ACTION', 'ACCESSIBILITY_VISIBLE_FOCUS'],
    requiredInstructions: [
      'Keep the primary task clear throughout the customer journey.',
      'Provide a visible keyboard focus indicator for interactive controls.',
    ],
    prohibitedBehaviours: ['Do not create an external booking destination.'],
    missingBusinessDataRequirements: ['business.testimonial_evidence'],
    deterministicRequirements: ['The primary booking action must use KS_OS_BOOKING.'],
    aiReviewInstructions: ['Review the final hierarchy for task clarity.'],
    humanReviewInstructions: ['Confirm any unsupported trust evidence before publication.'],
    pagePlaybook: {
      pageType: 'HOME',
      conversionRole: 'PRIMARY_LANDING',
      sections: [],
    },
    sourceReferences: [{ sourceId: 'wcag', sourceTitle: 'Accessibility standard' }],
    omittedRuleCount: 0,
    estimatedCharacterCount: 800,
    requiredRulesExceededLimit: false,
    contentDigest: 'knowledge-context-digest',
    ...overrides,
  } as any;
}

test('specialist team schema binds each brief to the correct specialist role', () => {
  const valid = team();
  assert.equal(SpecialistAgentTeamOutputSchema.safeParse(valid).success, true);

  const invalid = {
    ...valid,
    seo: { ...valid.seo, specialist: 'DESIGN' },
  };
  assert.equal(SpecialistAgentTeamOutputSchema.safeParse(invalid).success, false);
});

test('page specialist context keeps global and page-specific advice but drops other-page advice', () => {
  const prompt = attachSpecialistTeamContext({
    prompt: JSON.stringify({ operation: 'PAGE_COMPOSITION_PLAN_V2', approved: true }),
    team: team(),
    scope: 'PAGE',
    pageReference: pageA,
  });
  const parsed = JSON.parse(prompt) as {
    operation: string;
    specialistCollaboration: {
      scope: string;
      team: SpecialistAgentTeamOutput;
      synthesisRules: string[];
    };
  };

  assert.equal(parsed.operation, 'PAGE_COMPOSITION_PLAN_V2');
  assert.equal(parsed.specialistCollaboration.scope, 'PAGE');
  assert.equal(parsed.specialistCollaboration.team.seo.recommendations.length, 2);
  assert.ok(parsed.specialistCollaboration.team.seo.recommendations.some(item => item.pageReferences.length === 0));
  assert.ok(parsed.specialistCollaboration.team.seo.recommendations.some(item => item.pageReferences.includes(pageA)));
  assert.equal(parsed.specialistCollaboration.team.seo.recommendations.some(item => item.pageReferences.includes(pageB)), false);
  assert.ok(parsed.specialistCollaboration.synthesisRules.some(rule => rule.includes('pinned Knowledge Pack guidance')));
});

test('every specialist prompt receives the pinned Knowledge Pack rules and approved Search Intelligence', () => {
  const knowledgeGuidelines = createSpecialistKnowledgeGuidance({
    plan: plan(),
    knowledgeContexts: new Map([[pageA, knowledgeContext()]]),
  });

  for (const specialist of ['SEO', 'UX', 'CONVERSION', 'COPY', 'DESIGN', 'ACCESSIBILITY'] as const) {
    const prompt = composeSpecialistAgentPrompt({
      specialist,
      plan: plan(),
      facts: facts(),
      searchIntelligence: searchIntelligence(),
      knowledgeGuidelines,
    });
    const parsed = JSON.parse(prompt) as any;
    assert.equal(parsed.teamVersion, SPECIALIST_AGENT_TEAM_VERSION);
    assert.equal(parsed.pinnedKnowledgePackGuidelines[0].knowledgePack.reference, knowledgePackReference);
    assert.equal(parsed.pinnedKnowledgePackGuidelines[0].knowledgePack.semanticVersion, '3.2.1');
    assert.deepEqual(parsed.pinnedKnowledgePackGuidelines[0].applicableRuleIds, [
      'UX_CLEAR_PRIMARY_ACTION',
      'ACCESSIBILITY_VISIBLE_FOCUS',
    ]);
    assert.equal(parsed.pinnedKnowledgePackGuidelines[0].prohibitedBehaviours[0], 'Do not create an external booking destination.');
    assert.equal(parsed.approvedSearchIntelligence.strategy.primaryIntent, 'Book a verified local service');
    assert.equal(parsed.approvedSearchIntelligence.briefs[0].pageReference, pageA);
    assert.ok(parsed.systemContract.some((rule: string) => rule.includes('governing inputs')));
  }
});

test('the specialist director is governed by the same Knowledge Pack, Search Intelligence and verified facts', () => {
  const knowledgeGuidelines = createSpecialistKnowledgeGuidance({
    plan: plan(),
    knowledgeContexts: new Map([[pageA, knowledgeContext()]]),
  });
  const prompt = composeSpecialistDirectorPrompt({
    plan: plan(),
    facts: facts(),
    searchIntelligence: searchIntelligence(),
    knowledgeGuidelines,
    briefs: {
      seo: brief('SEO'),
      ux: brief('UX'),
      conversion: brief('CONVERSION'),
      copy: brief('COPY'),
      design: brief('DESIGN'),
      accessibility: brief('ACCESSIBILITY'),
    },
  });
  const parsed = JSON.parse(prompt) as any;
  assert.equal(parsed.pinnedKnowledgePackGuidelines[0].knowledgePack.contentDigest, 'knowledge-context-digest');
  assert.equal(parsed.approvedSearchIntelligence.strategy.market, 'GB');
  assert.ok(parsed.systemContract.some((rule: string) => rule.includes('specialist consensus can never override')));
});

test('specialist knowledge input rejects a context from the wrong pinned pack or version', () => {
  assert.throws(() => createSpecialistKnowledgeGuidance({
    plan: plan(),
    knowledgeContexts: new Map([[pageA, knowledgeContext({ semanticVersion: '9.9.9' })]]),
  }), /SPECIALIST_KNOWLEDGE_CONTEXT_PROVENANCE_MISMATCH/);
});
