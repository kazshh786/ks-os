import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  reconciliation,
  historicalMigration,
  manifest,
  runner,
] = await Promise.all([
  readFile(new URL(
    '../../../packages/database/migrations/20260727120000_reconcile_site_quality_child_scope_trigger.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL(
    '../../../packages/database/migrations/20260727100000_phase_15_8_site_quality_gates.sql',
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
  'site_quality_page_runs',
  'site_quality_checks',
  'site_quality_findings',
  'site_quality_evidence',
  'site_quality_waivers',
  'site_quality_human_reviews',
  'site_quality_remediation_events',
  'site_quality_audit_sessions',
] as const;

const reconciledFunction = reconciliation.match(
  /CREATE OR REPLACE FUNCTION public\.ks_validate_site_quality_child_scope\(\)([\s\S]*?)\$function\$;/,
)?.[0];

test('quality child-scope reconciliation is ordered and runner-transactional', () => {
  assert.match(
    manifest,
    /20260727120000_reconcile_site_quality_child_scope_trigger\.sql[\s\S]*order: 39/,
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
  assert.match(
    reconciliation,
    /SITE_QUALITY_CHILD_SCOPE_REQUIRED_FIELD_MISSING/,
  );
  assert.match(reconciliation, /SITE_QUALITY_CHILD_SCOPE_BINDING_INVALID/);
});

test('every existing child-scope binding has an explicit compatible branch', () => {
  for (const table of boundTables) {
    assert.match(
      historicalMigration,
      new RegExp(
        `BEFORE INSERT OR UPDATE ON ${table}[\\s\\S]*`
          + 'ks_validate_site_quality_child_scope\\(\\)',
      ),
    );
    assert.match(
      reconciliation,
      new RegExp(`WHEN '${table}' THEN`),
    );
  }
  assert.match(reconciliation, /binding_count <> 8/);
  assert.doesNotMatch(
    reconciliation,
    /(?:DROP|CREATE) TRIGGER|ALTER TABLE|DROP FUNCTION/i,
  );
});

test('run, tenant, site, version, and parent-child scope checks remain strict', () => {
  for (const code of [
    'SITE_QUALITY_RUN_NOT_FOUND',
    'SITE_QUALITY_TENANT_SCOPE_INVALID',
    'SITE_QUALITY_SITE_VERSION_SCOPE_INVALID',
    'SITE_QUALITY_PAGE_SCOPE_INVALID',
    'SITE_QUALITY_CHECK_PAGE_RUN_SCOPE_INVALID',
    'SITE_QUALITY_FINDING_CHECK_SCOPE_INVALID',
    'SITE_QUALITY_FINDING_PAGE_SCOPE_INVALID',
    'SITE_QUALITY_FINDING_SECTION_SCOPE_INVALID',
    'SITE_QUALITY_EVIDENCE_CHECK_SCOPE_INVALID',
    'SITE_QUALITY_EVIDENCE_FINDING_SCOPE_INVALID',
    'SITE_QUALITY_EVIDENCE_PAGE_SCOPE_INVALID',
    'SITE_QUALITY_HUMAN_REVIEW_CHECK_SCOPE_INVALID',
    'SITE_QUALITY_REMEDIATION_FINDING_SCOPE_INVALID',
  ]) {
    assert.match(reconciliation, new RegExp(code));
  }
  assert.match(
    reconciliation,
    /child_tenant_id IS DISTINCT FROM run_tenant_id/,
  );
  assert.match(
    reconciliation,
    /site_version_id'\)::uuid[\s\S]*IS DISTINCT FROM run_site_version_id/,
  );
});

test('version digest validation targets only compatible bound tables', () => {
  const digestTables = [
    'site_quality_findings',
    'site_quality_evidence',
    'site_quality_waivers',
    'site_quality_human_reviews',
    'site_quality_audit_sessions',
  ];
  for (const table of digestTables) {
    assert.match(
      reconciliation,
      new RegExp(
        `WHEN '${table}' THEN[\\s\\S]*?content_digest_sha256'[\\s\\S]*?`
          + 'SITE_QUALITY_CONTENT_DIGEST_SCOPE_INVALID',
      ),
    );
  }
  for (const table of [
    'site_quality_page_runs',
    'site_quality_checks',
    'site_quality_remediation_events',
  ]) {
    const branch = reconciliation.match(
      new RegExp(
        `WHEN '${table}' THEN([\\s\\S]*?)(?=\\n    WHEN |\\n    ELSE)`,
      ),
    )?.[1];
    assert.ok(branch, `missing ${table} branch`);
    assert.doesNotMatch(
      branch,
      /row_data ->> 'content_digest_sha256'/,
    );
  }
});

test('append-only protections and least-privilege execution remain intact', () => {
  for (const trigger of [
    'site_quality_evidence_append_only',
    'site_quality_remediation_events_append_only',
    'site_quality_run_comparisons_append_only',
  ]) {
    assert.match(historicalMigration, new RegExp(trigger));
    assert.match(reconciliation, new RegExp(trigger));
  }
  assert.match(
    reconciliation,
    /REVOKE EXECUTE[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.doesNotMatch(reconciliation, /SECURITY DEFINER|GRANT .*anon|GRANT .*authenticated/i);
});
