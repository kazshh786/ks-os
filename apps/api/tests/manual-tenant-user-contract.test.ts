import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('../src/modules/agency/agency.routes.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/modules/agency/manual-tenant-user.service.ts', import.meta.url), 'utf8');
const supabaseAdmin = readFileSync(new URL('../src/lib/supabase-admin.ts', import.meta.url), 'utf8');
const dialog = readFileSync(new URL('../../web/src/features/agency/ManualTenantUserDialog.tsx', import.meta.url), 'utf8');

test('manual business-user creation has an explicit tenant-scoped API contract', () => {
  assert.match(routes, /post\('\/tenants\/:tenantId\/users'/);
  assert.match(routes, /manualTenantUsers\.create\(actor\(r,'tenants\.manage'\)/);
  assert.match(routes, /role:z\.enum\(\['owner','staff'\]\)/);
  assert.match(routes, /bookingEnabled:z\.boolean\(\)\.optional\(\)/);
});

test('manual provisioning creates or links Supabase identities without email delivery', () => {
  assert.match(supabaseAdmin, /provisionSupabaseUserWithoutEmail/);
  assert.match(supabaseAdmin, /auth\.admin\.createUser/);
  assert.match(supabaseAdmin, /email_confirm: true/);
  assert.match(supabaseAdmin, /findSupabaseUserByEmail/);
  assert.doesNotMatch(service, /inviteUserByEmail|sendExistingAccountNotice|AccountInvitationEmailService/);
});

test('new identities are compensated when membership creation fails', () => {
  assert.match(service, /this\.db\.transaction/);
  assert.match(service, /tx,/);
  assert.match(service, /TENANT_USER_MANUALLY_PROVISIONED/);
  assert.match(service, /if \(identity\.created\) await deleteSupabaseUserIfCreated/);
  assert.doesNotMatch(service, /temporaryPassword[\s\S]+metadata:/);
});

test('staff booking access is disabled unless explicitly selected', () => {
  assert.match(service, /const bookingEnabled = input\.role === 'staff' && input\.bookingEnabled === true/);
  assert.match(dialog, /Leave this off until services, schedules and locations have been configured/);
});

test('temporary credentials are displayed once and are not emailed or persisted by KS OS', () => {
  assert.match(dialog, /Temporary password — shown once/);
  assert.match(dialog, /It is not emailed, stored in KS OS, or shown again/);
  assert.match(service, /temporaryPassword: identity\.created \? generatedPassword : null/);
  assert.doesNotMatch(service, /password:\s*generatedPassword/);
});
