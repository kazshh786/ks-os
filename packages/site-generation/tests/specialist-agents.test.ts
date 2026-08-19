import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SPECIALIST_AGENT_TEAM_VERSION,
  SpecialistAgentTeamOutputSchema,
  attachSpecialistTeamContext,
  type SpecialistAgentName,
  type SpecialistAgentTeamOutput,
  type SpecialistBrief,
} from '../src/index.js';

const pageA = '00000001-1111-4111-8111-000000000001';
const pageB = '00000002-1111-4111-8111-000000000002';

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
        'Template, component, booking, and accessibility governance cannot be overridden.',
      ],
    },
  };
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
  assert.ok(parsed.specialistCollaboration.synthesisRules.some(rule => rule.includes('Hard platform constraints')));
});
