import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const migrationUrl = new URL(
  '../../../packages/database/migrations/20260812090000_fix_search_intelligence_scope_trigger.sql',
  import.meta.url,
);

test('Search Intelligence scope trigger is safe for strategy rows and preserves child ownership validation', async () => {
  const sql = await readFile(fileURLToPath(migrationUrl), 'utf8');

  assert.match(sql, /target_strategy uuid := NULLIF\(row_json ->> 'strategy_id', ''\)::uuid/);
  assert.match(sql, /JOIN site_search_strategies strategy ON strategy\.id = target_strategy/);
  assert.doesNotMatch(sql, /NEW\.strategy_id/);
  assert.match(sql, /TG_TABLE_NAME = 'site_search_strategies'/);
  assert.match(sql, /SEARCH_STRATEGY_BLUEPRINT_SCOPE_INVALID/);
  assert.match(sql, /SEARCH_INTELLIGENCE_STRATEGY_SCOPE_INVALID/);
  assert.match(sql, /PAGE_SEO_BRIEF_BLUEPRINT_SCOPE_INVALID/);
});
