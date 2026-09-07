import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIGRATION_MANIFEST } from '@ks-os/database';

const migration = readFileSync(new URL('../../../packages/database/migrations/20260906180000_universal_work_foundation.sql', import.meta.url), 'utf8');

test('work migration creates tenant-scoped execution and activity tables', () => {
  for (const table of ['work_items', 'work_item_activity', 'work_task_links']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.doesNotMatch(migration, /ALTER\s+TABLE\s+(clients|sales_opportunities|sales_quotes)\s+DROP/i);
  assert.match(migration, /work_type IN \('JOB','PROJECT','DELIVERY','CASE','ORDER'\)/);
  assert.match(migration, /status IN \('DRAFT','READY','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED'\)/);
  assert.match(migration, /work_items_tenant_source_opportunity_unique/);
});

test('work migration extends only the canonical task source constraint for work links', () => {
  assert.match(migration, /ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_type_check/);
  assert.match(migration, /source_type IN \('MANUAL','OPERATIONS_ISSUE','APPOINTMENT','CLIENT','FORM_ASSIGNMENT','PAYMENT','REFUND','AUTOMATION','PRODUCT','WORK_ITEM'\)/);
  assert.doesNotMatch(migration, /DROP\s+COLUMN/i);
});

test('work migration is manifest order 81 after Sales', () => {
  const entry = MIGRATION_MANIFEST.find(item => item.filename === '20260906180000_universal_work_foundation.sql');
  assert.equal(entry?.order, 81);
  assert.equal(MIGRATION_MANIFEST.find(item => item.order === 80)?.filename, '20260906120000_universal_sales_foundation.sql');
});

test('every new work table carries direct tenant scope', () => {
  for (const body of migration.split('CREATE TABLE IF NOT EXISTS ').slice(1)) {
    assert.match(body, /tenant_id uuid NOT NULL REFERENCES tenants\(id\) ON DELETE CASCADE/i);
  }
});
