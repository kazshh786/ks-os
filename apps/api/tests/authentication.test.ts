import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AccountInvitationStatusSchema, AccountInvitationTypeSchema, ApplicationContextSchema,
  PasswordResetRequestSchema, SelectWorkspaceRequestSchema, WorkspaceSessionSchema,
} from '@ks-os/contracts';

const migration = readFileSync(new URL('../../../packages/database/migrations/20260720235900_phase_12_0_unified_authentication.sql', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../src/plugins/auth.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/modules/authentication/authentication.routes.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/modules/authentication/authentication.service.ts', import.meta.url), 'utf8');
const invitations = readFileSync(new URL('../src/modules/authentication/account-invitation.service.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/lib/supabase-admin.ts', import.meta.url), 'utf8');
const browserClient = readFileSync(new URL('../../../apps/web/src/api/client.ts', import.meta.url), 'utf8');
const authPages = readFileSync(new URL('../../../apps/web/src/auth/AuthPages.tsx', import.meta.url), 'utf8');
const workspaceContext = readFileSync(new URL('../../../apps/web/src/context/WorkspaceContext.tsx', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../../../scripts/seed-auth-development.ts', import.meta.url), 'utf8');

test('application contexts are closed and explicit', () => {
  assert.deepEqual(ApplicationContextSchema.options, ['AGENCY','TENANT','CUSTOMER']);
  assert.equal(ApplicationContextSchema.safeParse('STAFF').success, false);
  assert.match(auth, /x-ks-application-context/);
  assert.match(auth, /requireContext\('AGENCY'\)/);
});

test('tenant memberships separate identity from every operational membership key', () => {
  assert.match(migration, /ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id uuid/);
  assert.match(migration, /users_tenant_auth_user_unique ON users \(tenant_id, auth_user_id\)/);
  assert.doesNotMatch(migration, /UNIQUE\s*\(auth_user_id\)/i);
  assert.match(migration, /ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid/);
});

test('workspace selection accepts only an opaque business reference', () => {
  const reference = crypto.randomUUID();
  assert.deepEqual(SelectWorkspaceRequestSchema.parse({ businessReference: reference }), { businessReference: reference });
  assert.throws(() => SelectWorkspaceRequestSchema.parse({ businessReference: reference, tenantId: crypto.randomUUID() }));
  assert.match(service, /eq\(tenants\.businessReference, businessReference\)/);
  assert.match(service, /eq\(users\.authUserId, identity\.authUserId\)/);
});

test('workspace responses do not expose internal database or Supabase identity IDs', () => {
  const parsed = WorkspaceSessionSchema.parse({ context:'TENANT', authenticated:true, selectionRequired:false, user:{email:'owner@example.test',displayName:'Owner',role:'owner',permissions:{}}, business:{businessReference:crypto.randomUUID(),name:'Salon',slug:'salon',primaryColor:'#000000',secondaryColor:'#ffffff',accentColor:'#10b981'}, memberships:[] });
  assert.equal('tenantId' in parsed, false);
  assert.equal('authUserId' in parsed.user, false);
});

test('central invitations keep access intent but no raw auth token', () => {
  assert.deepEqual(AccountInvitationTypeSchema.options, ['AGENCY','TENANT_OWNER','TENANT_STAFF']);
  assert.deepEqual(AccountInvitationStatusSchema.options, ['PENDING','ACCEPTED','EXPIRED','CANCELLED','SUPERSEDED']);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS account_invitations/);
  assert.doesNotMatch(migration, /invite_token|raw_token|hashed_token/i);
});

test('Supabase administration is server-only and non-persistent', () => {
  assert.match(admin, /SUPABASE_SECRET_KEY/);
  assert.match(admin, /SUPABASE_SECRET_KEY \|\| process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(admin, /autoRefreshToken: false, persistSession: false, detectSessionInUrl: false/);
  assert.doesNotMatch(browserClient, /SERVICE_ROLE|service.role/i);
  assert.doesNotMatch(browserClient, /SUPABASE_SECRET_KEY/);
});

test('existing Supabase users use the same local invitation flow without duplicate identity creation', () => {
  assert.match(admin, /findUserByEmail/);
  assert.match(admin, /delivery: 'EXISTING_ACCOUNT'/);
  assert.match(invitations, /sendExistingAccountNotice/);
  assert.match(invitations, /INVITATION_EMAIL_MISMATCH/);
});

test('new invitees must create a password before access activation', () => {
  assert.match(invitations, /provisioningMode: provisioning\.delivery/);
  assert.match(authPages, /requiresPasswordSetup/);
  assert.match(authPages, /supabase\.auth\.updateUser\(\{ password \}\)/);
});

test('invitation acceptance is expiry-aware, idempotent and context-bound', () => {
  for (const code of ['INVITATION_NOT_FOUND','INVITATION_EXPIRED','INVITATION_ALREADY_ACCEPTED','INVITATION_CANCELLED','INVITATION_EMAIL_MISMATCH']) assert.match(invitations, new RegExp(code));
  assert.match(invitations, /for\('update'\)/);
  assert.match(invitations, /expectedContext === 'AGENCY'/);
  assert.match(invitations, /email_confirmed_at/);
});

test('application sessions are context-scoped and centrally revocable', () => {
  assert.match(migration, /UNIQUE \(auth_session_id, application_context\)/);
  assert.match(migration, /selected_tenant_user_id uuid REFERENCES users/);
  assert.match(service, /SELF_SERVICE_REVOCATION/);
  assert.match(service, /securityVersion[\s\S]+\+ 1/);
  assert.match(migration, /sessions_valid_after timestamptz/);
  assert.match(auth, /issuedAt <= .*sessionsValidAfter/);
  assert.match(service, /sessionsValidAfter: now/);
});

test('membership suspension invalidates only the affected workspace selection', () => {
  const team = readFileSync(new URL('../src/modules/team/team.service.ts', import.meta.url), 'utf8');
  assert.match(team, /selectedTenantUserId, member\.id/);
  assert.match(team, /selectedTenantUserId: null/);
  assert.match(team, /sessionsValidAfter: now/);
  assert.doesNotMatch(team, /eq\(applicationSessions\.authUserId, member\.authUserId/);
});

test('agency MFA uses Supabase TOTP with AAL2 enforcement and verified recovery', () => {
  const agencyService = readFileSync(new URL('../src/modules/agency/agency.service.ts', import.meta.url), 'utf8');
  assert.match(authPages + readFileSync(new URL('../../../apps/web/src/features/agency/AgencyAuth.tsx', import.meta.url), 'utf8'), /mfa\.challengeAndVerify/);
  assert.match(auth, /claims\.aal === 'aal2'/);
  assert.match(agencyService, /auth\.admin\.mfa\.deleteFactor/);
  assert.match(agencyService, /MFA_RECOVERY_SELF_SERVICE_BLOCKED/);
  assert.match(auth, /AGENCY_MFA_VERIFIED/);
});

test('password reset is neutral, rate limited and globally revokes old application sessions', () => {
  assert.equal(PasswordResetRequestSchema.safeParse({ email:'person@example.test', context:'TENANT' }).success, true);
  assert.match(routes, /max: 5, timeWindow: '15 minutes'/);
  assert.match(routes, /If an account is eligible/);
  assert.match(authPages, /logout-all/);
  assert.match(authPages, /signOut\(\{ scope: 'global' \}\)/);
});

test('browser storage is not the workspace source of truth', () => {
  assert.doesNotMatch(workspaceContext, /localStorage|sessionStorage/);
  assert.match(workspaceContext, /Workspace switching is deliberately performed by \/select-business/);
  assert.match(browserClient, /X-KS-Application-Context/);
});

test('identity tables are unavailable to Supabase browser roles and audit is append-only', () => {
  for (const table of ['account_invitations','application_sessions','account_access_audit_events','users']) assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(migration, /REVOKE ALL ON account_invitations, application_sessions, account_access_audit_events FROM anon, authenticated/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON account_access_audit_events/);
});

test('development accounts use the Auth Admin API and expected addresses', () => {
  assert.match(seed, /createDevelopmentAuthUser/);
  for (const email of ['kasim@kasimshah.com','agency.support@ksos.local','owner@salon-a.ksos.local','multi-tenant-user@ksos.local','customer@ksos.local']) assert.match(seed, new RegExp(email.replace('.', '\\.')));
  assert.doesNotMatch(seed, /insert\s+into\s+auth\.users/i);
  assert.match(seed, /disabled in production/);
});
