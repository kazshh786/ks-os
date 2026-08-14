import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../../../packages/database/migrations/20260811190000_agency_launch_v2.sql');
const factFindingBaseline = read(
  '../../../packages/database/migrations/20260726130000_phase_15_7b_unified_provisioning_site_studio.sql',
);

test('migration 73 retires V1 and activates V2 using the existing template lifecycle', () => {
  const allowedStatusSource = factFindingBaseline.match(
    /CREATE TABLE IF NOT EXISTS fact_finding_templates \([\s\S]*?CHECK \(status IN \(([^)]+)\)\)/,
  )?.[1];
  assert.ok(allowedStatusSource, 'fact_finding_templates status constraint must be present');

  const allowedStatuses = new Set(
    [...allowedStatusSource.matchAll(/'([A-Z_]+)'/g)].map(match => match[1]),
  );
  assert.deepEqual([...allowedStatuses], ['DRAFT', 'ACTIVE', 'RETIRED']);

  const lifecycleStart = migration.indexOf('UPDATE public.fact_finding_templates');
  const lifecycleEnd = migration.indexOf('INSERT INTO public.fact_finding_template_sections', lifecycleStart);
  assert.ok(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart);
  const lifecycleSql = migration.slice(lifecycleStart, lifecycleEnd);

  const namedStatusValues = [...lifecycleSql.matchAll(/\bstatus\s*=\s*'([A-Z_]+)'/g)]
    .map(match => match[1]);
  const insertedStatus = lifecycleSql.match(
    /business_categories_json, plan_keys_json, status,[\s\S]*?business_categories_json, plan_keys_json, '([A-Z_]+)'/,
  )?.[1];
  assert.ok(insertedStatus, 'V2 template insert status must be explicit');

  for (const status of [...namedStatusValues, insertedStatus]) {
    assert.ok(allowedStatuses.has(status), `migration 73 uses invalid fact_finding_templates status ${status}`);
  }
  assert.doesNotMatch(lifecycleSql, /'SUPERSEDED'/);

  assert.match(
    lifecycleSql,
    /UPDATE public\.fact_finding_templates\s+SET\s+status = 'RETIRED',\s+retired_at = COALESCE\(retired_at, now\(\)\),\s+updated_at = now\(\)\s+WHERE template_key = 'KS_OS_CLIENT_ONBOARDING'\s+AND status = 'ACTIVE';/,
  );
  assert.match(
    migration,
    /SELECT id INTO source_template_id[\s\S]*?template_key = 'KS_OS_CLIENT_ONBOARDING' AND version = 1/,
  );
  assert.match(
    lifecycleSql,
    /template_key, 2, 'KS OS governed client discovery'[\s\S]*?business_categories_json, plan_keys_json, 'ACTIVE'/,
  );
  assert.match(lifecycleSql, /ON CONFLICT \(template_key, version\) DO UPDATE SET[\s\S]*?status = 'ACTIVE'/);
});

test('migration 73 seed values remain compatible with constraints established by migrations 1-72', () => {
  const questionTypeSource = factFindingBaseline.match(
    /question_type varchar\(40\) NOT NULL CHECK \(question_type IN \(([\s\S]*?)\)\),/,
  )?.[1];
  assert.ok(questionTypeSource, 'fact-finding question-type constraint must be present');
  const allowedQuestionTypes = new Set(
    [...questionTypeSource.matchAll(/'([A-Z_]+)'/g)].map(match => match[1]),
  );

  const seedStart = migration.indexOf("('a3000000-0000-4000-8000-000000000041'");
  const seedEnd = migration.indexOf('ON CONFLICT (template_id, question_key) DO NOTHING;', seedStart);
  assert.ok(seedStart >= 0 && seedEnd > seedStart);
  const seededQuestions = migration.slice(seedStart, seedEnd);
  const questionTypes = [...seededQuestions.matchAll(/,'([A-Z_]+)',(?:NULL|'[^']*'),(?:true|false),(?:true|false)/g)]
    .map(match => match[1]);

  assert.equal(questionTypes.length, 16);
  for (const questionType of questionTypes) {
    assert.ok(allowedQuestionTypes.has(questionType), `migration 73 uses invalid question type ${questionType}`);
  }

  assert.match(factFindingBaseline, /'CLIENT_CONFIRMED'[\s\S]*?'AGENCY_APPROVED'/);
  assert.doesNotMatch(
    migration,
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b|\bVACUUM\b|\bREINDEX\s+CONCURRENTLY\b/i,
  );
});

test('migration 73 is runner-transactional and remains manifest order 73', () => {
  const runner = read('../../../scripts/database/migrate.mjs');
  const manifest = read('../../../packages/database/src/manifest.ts');
  const begin = runner.indexOf("await client.query('BEGIN')");
  const execute = runner.indexOf('await client.query(sqlContent)', begin);
  const record = runner.indexOf('INSERT INTO "${TRACKING_TABLE}"', execute);
  const commit = runner.indexOf("await client.query('COMMIT')", execute);
  const rollback = runner.indexOf("await client.query('ROLLBACK')", commit);

  assert.ok(begin >= 0 && execute > begin && record > execute && commit > record && rollback > commit);
  assert.doesNotMatch(migration, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/gim);
  assert.match(
    manifest,
    /filename: '20260811190000_agency_launch_v2\.sql', order: 73,/,
  );
});
