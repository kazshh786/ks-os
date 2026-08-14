import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL(
  '../../database/migrations/20260811120000_live_site_intelligence_v1.sql',
  import.meta.url,
), 'utf8');

const functionStart = migration.indexOf('CREATE OR REPLACE FUNCTION ks_emit_site_operational_change()');
const functionEnd = migration.indexOf('\n$$;', functionStart);
const triggerFunction = migration.slice(functionStart, functionEnd);

test('a genuine location insert emits LOCATION_ADDED', () => {
  assert.match(migration, /CREATE TRIGGER locations_live_site_change AFTER INSERT OR UPDATE ON locations/);
  assert.match(
    triggerFunction,
    /TG_TABLE_NAME = 'locations'[\s\S]*?TG_OP = 'INSERT'[\s\S]*?target_kind := 'LOCATION_ADDED'/,
  );
});

test('operating-hours delete emits OPENING_HOURS_CHANGED from OLD scope', () => {
  assert.match(
    migration,
    /CREATE TRIGGER site_location_operating_hours_change AFTER INSERT OR UPDATE OR DELETE ON site_location_operating_hours/,
  );
  assert.match(
    triggerFunction,
    /TG_OP = 'DELETE' THEN source_row := OLD;[\s\S]*?TG_TABLE_NAME = 'site_location_operating_hours'[\s\S]*?target_kind := 'OPENING_HOURS_CHANGED'[\s\S]*?source_row\.location_id/,
  );
});

test('temporary-closure changes and removals emit location operational events', () => {
  assert.match(
    migration,
    /CREATE TRIGGER site_location_closures_change AFTER INSERT OR UPDATE OR DELETE ON site_location_closures/,
  );
  assert.match(
    triggerFunction,
    /TG_TABLE_NAME = 'site_location_closures'[\s\S]*?TG_OP = 'DELETE' THEN 'OPENING_HOURS_CHANGED' ELSE 'LOCATION_TEMPORARILY_CLOSED'/,
  );
  assert.match(triggerFunction, /TG_OP = 'DELETE' THEN ARRAY\['temporary_closure_removed'\]/);
});
