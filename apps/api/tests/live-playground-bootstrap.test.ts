import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bootstrapPath = new URL('../../../scripts/bootstrap-live-website-playground.ts', import.meta.url);
const knowledgePath = new URL('../../../scripts/activate-live-playground-knowledge-pack.ts', import.meta.url);
const provisioningExecutorPath = new URL('../../site-worker/src/postgres-provisioning-executor.ts', import.meta.url);
const provisioningServicePath = new URL('../src/modules/provisioning/provisioning.service.ts', import.meta.url);
const generationServicePath = new URL('../src/modules/sites/site-generation.service.ts', import.meta.url);
const terminalMigrationPath = new URL(
  '../../../packages/database/migrations/20260803213000_allow_terminal_generation_after_knowledge_supersession.sql',
  import.meta.url,
);
const [bootstrap, knowledge, provisioningExecutor, provisioningService, generationService, terminalMigration] = await Promise.all([
  readFile(bootstrapPath, 'utf8'),
  readFile(knowledgePath, 'utf8'),
  readFile(provisioningExecutorPath, 'utf8'),
  readFile(provisioningServicePath, 'utf8'),
  readFile(generationServicePath, 'utf8'),
  readFile(terminalMigrationPath, 'utf8'),
]);

test('live playground fixture is pinned to the exact Leeds acceptance data', () => {
  for (const value of [
    '18 Market Lane, Leeds, UK',
    'LS1 4AB',
    'Maya Bennett',
    'Lead Skin Therapist',
    'Sara Khan',
    'Brow and Beauty Specialist',
    'Signature Glow Facial',
    'Deep Renewal Facial',
    'Brow Shape and Tint',
    'Luxury Gel Manicure',
    'Skin Consultation',
  ]) assert.match(bootstrap, new RegExp(value));
  for (const [duration, price] of [[60, 6500], [75, 8500], [30, 3200], [50, 4200], [30, 2500]]) {
    assert.match(bootstrap, new RegExp(`durationMinutes: ${duration}, priceMinor: ${price}`));
  }
});

test('live playground reconciliation uses audited services and a complete Growth-sized page plan', () => {
  for (const operation of [
    'agency.changePlan',
    'bookingSetup.updateService',
    'bookingSetup.setServiceActive',
    'bookingSetup.saveLocation',
    'manualUsers.updateProfile',
    'agency.setTenantUserStatus',
    'generation.reconcileTerminalJobState',
  ]) assert.match(bootstrap, new RegExp(operation.replace('.', '\\.')));
  assert.match(bootstrap, /REQUIRED_MARKETING_PAGE_LIMIT = 15/);
  for (const pageType of [
    'HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'ABOUT', 'TEAM_HUB', 'LOCATION_DETAIL',
    'CONTACT', 'FAQ', 'POLICIES', 'NEW_CLIENT_GUIDE', 'BOOKING',
  ]) assert.match(bootstrap, new RegExp(`'${pageType}'`));
});

test('knowledge activation adds every missing governed page playbook and remains validation-gated', () => {
  for (const mapping of [
    "'SERVICE_HUB', 'SERVICE_CONVERSION', 'SERVICE_GRID'",
    "'ABOUT', 'TRUST_BUILDING', 'INTRODUCTION'",
    "'TEAM_HUB', 'TRUST_BUILDING', 'TEAM'",
    "'CONTACT', 'TRUST_BUILDING', 'CONTACT'",
    "'NEW_CLIENT_GUIDE', 'OBJECTION_HANDLING', 'RICH_TEXT'",
  ]) assert.match(knowledge, new RegExp(mapping.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(knowledge, /validateKnowledgePack\(bundle\)/);
  assert.match(knowledge, /service\.approve/);
  assert.match(knowledge, /service\.activate/);
  assert.match(knowledge, /activeCount\('PUBLIC_SITE'\) !== 1/);
});

test('provisioning reuses a real active staff identity before creating an invalid placeholder', () => {
  assert.match(provisioningExecutor, /lower\(trim\(\$\{users\.name\}\)\) = lower\(trim\(\$\{name\}\)\)/);
  assert.match(provisioningExecutor, /case when \$\{users\.emailNormalized\} like '%@invalid\.ks-os\.local' then 1 else 0 end/);
});

test('controlled recovery reuses only a draft site and reconciles only a terminal linked job', () => {
  assert.match(provisioningService, /eq\(sites\.status, 'DRAFT'\)/);
  assert.match(provisioningService, /reusedDraftSite: Boolean\(reusableDraftSite\)/);
  assert.match(generationService, /actor\.role !== 'PLATFORM_OWNER'/);
  assert.match(generationService, /\['FAILED', 'DEAD_LETTER'\]\.includes\(run\.jobStatus\)/);
  assert.match(generationService, /SITE_GENERATION_STATE_RECONCILED/);
  assert.match(generationService, /status: 'PARTIALLY_FAILED'/);
  assert.match(terminalMigration, /TG_OP = 'INSERT' AND pinned_pack_status <> 'ACTIVE'/);
  assert.match(terminalMigration, /NEW\.status NOT IN \('FAILED', 'CANCELLED'\)/);
  assert.match(terminalMigration, /pinned provenance is immutable/);
  assert.doesNotMatch(terminalMigration, /DROP|TRUNCATE|DELETE FROM/i);
});
