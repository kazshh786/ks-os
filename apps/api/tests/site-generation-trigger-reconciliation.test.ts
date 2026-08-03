import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [reconciliation, historicalMigration, manifest, runner] =
  await Promise.all([
    readFile(new URL(
      '../../../packages/database/migrations/20260803202000_reconcile_site_generation_ownership_trigger.sql',
      import.meta.url,
    ), 'utf8'),
    readFile(new URL(
      '../../../packages/database/migrations/20260725170000_phase_15_6c_structured_ai_generation.sql',
      import.meta.url,
    ), 'utf8'),
    readFile(new URL(
      '../../../packages/database/src/manifest.ts',
      import.meta.url,
    ), 'utf8'),
    readFile(new URL(
      '../../../scripts/database/migrate.mjs',
      import.meta.url,
    ), 'utf8'),
  ]);

const boundTables = [
  'site_generation_page_runs',
  'site_generation_section_runs',
  'site_generation_findings',
  'site_generation_claims',
  'site_generation_contexts',
] as const;

const reconciledFunction = reconciliation.match(
  /CREATE OR REPLACE FUNCTION public\.ks_validate_site_generation_ownership\(\)([\s\S]*?)\$function\$;/,
)?.[0];

test('generation ownership reconciliation is ordered and runner-transactional', () => {
  assert.match(
    manifest,
    /20260803202000_reconcile_site_generation_ownership_trigger\.sql[\s\S]*order: 61/,
  );
  assert.match(runner, /await client\.query\('BEGIN'\)/);
  assert.match(runner, /await client\.query\(sqlContent\)/);
  assert.match(
    runner,
    /INSERT INTO "\$\{TRACKING_TABLE\}"[\s\S]*await client\.query\('COMMIT'\)/,
  );
  assert.match(reconciliation, /SET LOCAL lock_timeout = '5s'/);
  assert.match(reconciliation, /SET LOCAL statement_timeout = '30s'/);
  assert.doesNotMatch(reconciliation, /^(?:BEGIN|COMMIT);/m);
});

test('the polymorphic function never dereferences a physical NEW field', () => {
  assert.ok(reconciledFunction);
  assert.match(reconciledFunction, /row_data := to_jsonb\(NEW\)/);
  assert.deepEqual(
    [...reconciledFunction.matchAll(/NEW\.([A-Za-z_][A-Za-z0-9_]*)/g)],
    [],
  );
  assert.match(reconciliation, /SITE_GENERATION_OWNERSHIP_REQUIRED_FIELD_MISSING/);
  assert.match(reconciliation, /SITE_GENERATION_OWNERSHIP_BINDING_INVALID/);
});

test('every existing ownership binding has one compatible branch', () => {
  for (const table of boundTables) {
    assert.match(
      historicalMigration,
      new RegExp(
        `BEFORE INSERT OR UPDATE ON ${table}[\\s\\S]*`
          + 'ks_validate_site_generation_ownership\\(\\)',
      ),
    );
    assert.match(reconciliation, new RegExp(`'${table}'`));
  }
  assert.match(reconciliation, /binding_count <> 5/);
  assert.doesNotMatch(
    reconciliation,
    /(?:DROP|CREATE) TRIGGER|ALTER TABLE|DROP FUNCTION/i,
  );
});

test('pinned provenance and parent-child ownership checks remain strict', () => {
  for (const check of [
    'child_tenant_id IS DISTINCT FROM expected_tenant_id',
    "(row_data ->> 'site_id')::uuid IS DISTINCT FROM expected_site_id",
    "(row_data ->> 'site_version_id')::uuid",
    'blueprint_page.blueprint_id = expected_blueprint_id',
    'template_layout.template_version_id =',
    "template_layout.status = 'APPROVED'",
    'page_run.generation_run_id = child_generation_run_id',
    'section_run.generation_run_id = child_generation_run_id',
  ]) {
    assert.ok(reconciliation.includes(check), `missing strict check: ${check}`);
  }
});

test('the replacement retains least-privilege execution', () => {
  assert.match(
    reconciliation,
    /REVOKE EXECUTE[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.doesNotMatch(
    reconciliation,
    /SECURITY DEFINER|GRANT .*anon|GRANT .*authenticated/i,
  );
});
