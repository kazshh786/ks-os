import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  reconciliation,
  manifest,
  runner,
  foundation,
  workerFoundation,
] = await Promise.all([
  readFile(new URL(
    '../../../packages/database/migrations/20260727110000_reconcile_site_jobs_status_constraint.sql',
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
  readFile(new URL(
    '../../../packages/database/migrations/20260724090000_phase_15_0_15_2_website_foundation.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL(
    '../../../packages/database/migrations/20260725090000_phase_15_6a_site_worker_foundation.sql',
    import.meta.url,
  ), 'utf8'),
]);

test('status reconciliation is an ordered transactional forward migration', () => {
  assert.match(
    manifest,
    /20260727110000_reconcile_site_jobs_status_constraint\.sql[\s\S]*order: 38/,
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
  assert.match(reconciliation, /to_regclass\('public\.site_jobs'\)/);
});

test('status reconciliation drops only the obsolete duplicate constraint', () => {
  const droppedConstraints = [
    ...reconciliation.matchAll(/DROP CONSTRAINT\s+([a-z0-9_]+)/gi),
  ].map(match => match[1]);
  assert.deepEqual(droppedConstraints, ['site_jobs_status_check']);
  assert.doesNotMatch(
    reconciliation,
    /DROP (?:TABLE|COLUMN|INDEX|TRIGGER|POLICY)|TRUNCATE|DELETE FROM|UPDATE\s+public\.site_jobs|INSERT INTO/i,
  );
  assert.doesNotMatch(
    reconciliation,
    /DROP CONSTRAINT\s+site_jobs_status_valid/i,
  );
});

test('status reconciliation requires the validated canonical LEASED lifecycle', () => {
  assert.match(reconciliation, /site_jobs_status_valid/);
  assert.match(reconciliation, /constraint_row\.convalidated/);
  assert.match(reconciliation, /must permit LEASED/);
  assert.match(reconciliation, /was not preserved with LEASED support/);
  assert.match(
    foundation,
    /CHECK \(status IN \('PENDING','PROCESSING','DELAYED','COMPLETED','FAILED','CANCELLED'\)\)/,
  );
  assert.match(
    workerFoundation,
    /ADD CONSTRAINT site_jobs_status_valid CHECK\(status IN \([\s\S]*'LEASED'/,
  );
});
