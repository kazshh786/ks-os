import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../../packages/database/migrations/20260906120000_universal_sales_foundation.sql', import.meta.url), 'utf8');

test('sales migration is additive, tenant-scoped and stores only hashed quote tokens', () => {
  for (const table of [
    'client_sales_profiles', 'sales_pipelines', 'sales_pipeline_stages', 'sales_opportunities',
    'sales_opportunity_activity', 'sales_quotes', 'sales_quote_items', 'sales_quote_access_tokens',
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));

  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|CONSTRAINT)/i);
  assert.doesNotMatch(migration, /ALTER\s+TABLE\s+clients\s+DROP/i);
  assert.match(migration, /token_hash varchar\(64\) NOT NULL UNIQUE/i);
  assert.doesNotMatch(migration, /\btoken\s+varchar/i);
  assert.match(migration, /sales_pipelines_one_default_per_tenant_idx/i);
});

test('sales business tables carry tenant scope and terminal constraints', () => {
  const tableBodies = migration.split('CREATE TABLE IF NOT EXISTS ').slice(1);
  for (const body of tableBodies) assert.match(body, /tenant_id uuid NOT NULL REFERENCES tenants\(id\) ON DELETE CASCADE/i);
  assert.match(migration, /lifecycle IN \('LEAD','PROSPECT','CUSTOMER','FORMER'\)/);
  assert.match(migration, /category IN \('OPEN','WON','LOST'\)/);
  assert.match(migration, /status IN \('DRAFT','SENT','ACCEPTED','DECLINED','EXPIRED','VOID'\)/);
});
