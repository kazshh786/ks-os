import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const migrationUrl = new URL(
  '../../../packages/database/migrations/20260812093000_fix_search_intelligence_scope_trigger_generic_rows.sql',
  import.meta.url,
);

test('Search Intelligence scope trigger only uses fields extracted from generic trigger rows', async () => {
  const sql = await readFile(fileURLToPath(migrationUrl), 'utf8');

  assert.doesNotMatch(sql, /NEW\./);
  assert.match(sql, /target_blueprint uuid := NULLIF\(row_json ->> 'blueprint_id', ''\)::uuid/);
  assert.match(sql, /target_blueprint_page uuid := NULLIF\(row_json ->> 'blueprint_page_id', ''\)::uuid/);
  assert.match(sql, /target_blueprint_revision integer := NULLIF\(row_json ->> 'blueprint_revision', ''\)::integer/);
  assert.match(sql, /blueprint\.id = target_blueprint/);
  assert.match(sql, /page\.id = target_blueprint_page/);
  assert.match(sql, /strategy\.id = target_strategy/);
});
