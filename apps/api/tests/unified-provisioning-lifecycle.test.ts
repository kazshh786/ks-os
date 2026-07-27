import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync(new URL('../src/modules/provisioning/provisioning.routes.ts', import.meta.url), 'utf8');
const delivery = readFileSync(new URL('../src/modules/provisioning/delivery-context.service.ts', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../src/modules/provisioning/tenant-lifecycle.service.ts', import.meta.url), 'utf8');
const web = readFileSync(new URL('../../web/src/features/agency/AgencyProvisioning.tsx', import.meta.url), 'utf8');

test('client delivery resolves server-owned plan, brief, template, draft, run and readiness', () => {
  assert.match(routes, /tenants\/:tenantReference\/delivery-context/);
  assert.match(delivery, /tenantPlanAssignments/);
  assert.match(delivery, /productionBriefs/);
  assert.match(delivery, /templateVersions/);
  assert.match(delivery, /provisioning\.readiness/);
  assert.doesNotMatch(web, /Locked production brief reference|Active plan version reference|Approved template version reference/);
});

test('unified delivery makes booking precede the website and exposes both outcomes together', () => {
  assert.match(web, /Provision booking system and website/);
  assert.match(web, /Booking system/);
  assert.match(web, /Website draft/);
  assert.match(web, /Test booking journey/);
  assert.match(web, /Open Site Studio/);
  assert.match(web, /Combined readiness/);
});

test('user removal is a guarded lifecycle action rather than destructive history deletion', () => {
  assert.match(routes, /users\/:userReference\/removal-preview/);
  assert.match(routes, /users\/:userReference\/remove/);
  assert.match(lifecycle, /FUTURE_APPOINTMENTS_ASSIGNED/);
  assert.match(lifecycle, /LAST_OWNER_PROTECTION/);
  assert.match(lifecycle, /accountStatus: 'DEACTIVATED'/);
  assert.match(lifecycle, /historicalAppointmentsRetained/);
  assert.doesNotMatch(lifecycle, /delete\(users\)/);
});

test('unused workspace deletion is platform-owner-only, confirmed and retains an audit tombstone', () => {
  assert.match(routes, /tenants\/:tenantReference\/deletion-preview/);
  assert.match(routes, /tenants\/:tenantReference\/delete-unused/);
  assert.match(lifecycle, /actor\.role !== 'PLATFORM_OWNER'/);
  assert.match(lifecycle, /confirmationName\.trim\(\) !== tenant\.name/);
  assert.match(lifecycle, /WORKSPACE_WAS_LAUNCHED/);
  assert.match(lifecycle, /PAYMENT_HISTORY_EXISTS/);
  assert.match(lifecycle, /lifecycleStatus: 'DELETED'/);
  assert.match(lifecycle, /auditTombstoneRetained: true/);
  assert.doesNotMatch(lifecycle, /delete\(tenants\)/);
});

test('workspace lifecycle UI clearly separates offboarding from unused-workspace removal', () => {
  assert.match(web, /Offboard real client/);
  assert.match(web, /Delete unused workspace/);
  assert.match(web, /non-identifying audit tombstone/);
  assert.match(web, /Type[\s\S]*exactly/);
});
