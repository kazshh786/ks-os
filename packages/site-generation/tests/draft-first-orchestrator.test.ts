import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  SITE_GENERATOR_VERSION,
  parseSiteGenerationConfig,
} from '../src/index.js';

const orchestrator = await readFile(
  new URL('../src/draft-first-orchestrator.ts', import.meta.url),
  'utf8',
);
const prompt = await readFile(
  new URL('../src/prompt.ts', import.meta.url),
  'utf8',
);

test('enabled AI generation provenance defaults to the current generator contract', () => {
  const config = parseSiteGenerationConfig({
    SITE_AI_GENERATION_ENABLED: 'true',
    SITE_AI_PROVIDER: 'gemini',
    SITE_AI_MODEL: 'test-model',
    SITE_AI_API_KEY: 'test-only',
  });
  assert.equal(config.generatorVersion, SITE_GENERATOR_VERSION);
  assert.equal(config.generatorVersion, '2.0.0');
});

test('the master generation pass is the first creative AI work and precedes specialist refinement', () => {
  const draftIndex = orchestrator.indexOf('Generating complete draft page');
  const refinementIndex = orchestrator.indexOf('Complete draft created. Specialist team is reviewing it for refinement.');
  assert.ok(draftIndex >= 0);
  assert.ok(refinementIndex > draftIndex);
  assert.match(orchestrator, /Structure is deterministic\. The first creative provider call is the actual website draft\./);
  assert.doesNotMatch(orchestrator, /composeSiteStrategyPrompt|composePageCompositionPrompt|SITE_STRATEGY_RESPONSE_JSON_SCHEMA/);
  assert.doesNotMatch(orchestrator, /SEARCH_INTELLIGENCE_NOT_READY/);
});

test('specialist and page refinement failures preserve the complete draft', () => {
  assert.match(orchestrator, /SPECIALIST_REFINEMENT_SKIPPED/);
  assert.match(orchestrator, /PAGE_REFINEMENT_SKIPPED/);
  assert.match(orchestrator, /The complete draft was preserved/);
  assert.match(orchestrator, /The original valid draft page was preserved/);
});

test('the master prompt treats quality disciplines as first-draft responsibilities', () => {
  assert.match(prompt, /SEO, UX, conversion, accessibility/);
  assert.match(prompt, /Missing non-critical business data must not stop draft generation/);
  assert.match(prompt, /Generate a complete, coherent, useful public page in this pass/);
  assert.match(prompt, /SPECIALIST_REFINEMENT/);
});
