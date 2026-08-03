import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL(
  '../../../packages/database/migrations/20260803183500_allow_booking_system_fact_source.sql',
  import.meta.url,
), 'utf8');
const manifest = readFileSync(new URL(
  '../../../packages/database/src/manifest.ts',
  import.meta.url,
), 'utf8');
const bookingSync = readFileSync(new URL(
  '../src/modules/provisioning/booking-fact-sync.service.ts',
  import.meta.url,
), 'utf8');

test('canonical booking facts are accepted without bypassing agency review', () => {
  assert.match(bookingSync, /source: 'BOOKING_SYSTEM'/);
  assert.match(bookingSync, /status: 'AGENCY_REVIEW_REQUIRED'/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS fact_finding_responses_source_check/);
  assert.match(
    migration,
    /source IN \('CLIENT_PROVIDED', 'AGENCY_PROVIDED', 'BOOKING_SYSTEM'\)/,
  );
  assert.match(migration, /NOT VALID/);
  assert.match(migration, /VALIDATE CONSTRAINT fact_finding_responses_source_check/);
  assert.match(
    manifest,
    /20260803183500_allow_booking_system_fact_source\.sql', order: 60/,
  );
});
