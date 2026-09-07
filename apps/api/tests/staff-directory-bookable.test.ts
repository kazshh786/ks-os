import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const staffRouteSource = await readFile(
  new URL('../src/routes/staff.ts', import.meta.url),
  'utf8',
);

test('staff directory excludes inactive and booking-disabled memberships', () => {
  assert.match(staffRouteSource, /eq\(users\.accountStatus,\s*'ACTIVE'\)/);
  assert.match(staffRouteSource, /eq\(users\.bookingEnabled,\s*true\)/);
});

test('staff directory remains scoped to tenant owners and staff', () => {
  assert.match(staffRouteSource, /eq\(users\.tenantId,\s*request\.auth!\.tenantId\)/);
  assert.match(staffRouteSource, /inArray\(users\.role,\s*\['owner',\s*'staff'\]\)/);
});
