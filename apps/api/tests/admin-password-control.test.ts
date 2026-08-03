import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('../src/modules/authentication/authentication.routes.ts', import.meta.url), 'utf8');
const dialog = readFileSync(new URL('../../web/src/features/agency/AdminPasswordDialog.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../../web/src/layouts/AgencyLayout.tsx', import.meta.url), 'utf8');

test('platform operators can set passwords for tenant and agency identities through explicit scoped routes', () => {
  assert.match(routes, /agency\/tenants\/:tenantId\/users\/:userReference\/password/);
  assert.match(routes, /agency\/users\/:userReference\/password/);
  assert.match(routes, /requireAgency\('tenants\.manage'\)/);
  assert.match(routes, /requireAgency\('agency\.users\.manage'\)/);
  assert.match(routes, /agency\.role !== 'PLATFORM_OWNER'/);
});

test('direct password administration has strong validation and explicit confirmation', () => {
  assert.match(routes, /password: z\.string\(\)/);
  assert.match(routes, /\.min\(12\)/);
  assert.match(routes, /\.max\(128\)/);
  assert.match(routes, /identityVerified: z\.literal\(true\)/);
  assert.match(routes, /Password confirmation does not match/);
  assert.match(dialog, /12–128 characters with uppercase, lowercase, number and symbol/);
  assert.match(dialog, /confirmPassword/);
});

test('password changes revoke sessions and are written to append-only access audit without persisting passwords', () => {
  assert.match(routes, /revokeReason: 'AGENCY_PASSWORD_SET'/);
  assert.match(routes, /revokeReason: 'PLATFORM_OWNER_PASSWORD_SET'/);
  assert.match(routes, /action: 'AGENCY_PASSWORD_SET'/);
  assert.match(routes, /action: 'PLATFORM_OWNER_PASSWORD_SET'/);
  assert.match(routes, /reason: input\.reason/);
  assert.doesNotMatch(routes, /metadata:\s*\{[^}]*password/);
  assert.doesNotMatch(routes, /insert\([^)]*\)\.values\([^)]*input\.password/);
});

test('the agency shell exposes password control for managed businesses and the platform owner', () => {
  assert.match(layout, /Agency password control/);
  assert.match(layout, /User password control/);
  assert.match(layout, /session\?\.user\.role === 'PLATFORM_OWNER'/);
  assert.match(layout, /<AdminPasswordDialog/);
  assert.match(dialog, /Choose any user regardless of role or name/);
  assert.match(dialog, /Send recovery email instead/);
});
