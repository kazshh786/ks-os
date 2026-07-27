import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const splitLayout = readFileSync(new URL('../../web/src/auth/AuthSplitLayout.tsx', import.meta.url), 'utf8');
const tenantLogin = readFileSync(new URL('../../web/src/pages/Login.tsx', import.meta.url), 'utf8');
const agencyLogin = readFileSync(new URL('../../web/src/features/agency/AgencyLoginPage.tsx', import.meta.url), 'utf8');
const agencyAuth = readFileSync(new URL('../../web/src/features/agency/AgencyAuth.tsx', import.meta.url), 'utf8');
const passwordDialog = readFileSync(new URL('../../web/src/features/agency/AdminPasswordDialog.tsx', import.meta.url), 'utf8');

test('B2B sign-in uses a responsive side-split shell that collapses cleanly on mobile', () => {
  assert.match(splitLayout, /lg:grid-cols/);
  assert.match(splitLayout, /hidden min-h-screen[\s\S]*lg:flex/);
  assert.match(splitLayout, /prefers-reduced-motion: reduce/);
  assert.match(splitLayout, /role="tablist"/);
  assert.match(splitLayout, /Secure authentication with centrally revocable sessions/);
});

test('business and agency sign-in use direct utility copy and familiar actions', () => {
  assert.match(tenantLogin, /Sign in to your business workspace/);
  assert.match(tenantLogin, /'Sign in'/);
  assert.match(tenantLogin, /Forgot password\?/);
  assert.match(agencyLogin, /Sign in to the agency portal/);
  assert.match(agencyLogin, /'Sign in'/);
  assert.match(agencyLogin, /Forgot password\?/);
  assert.match(agencyAuth, /export \{ AgencyLoginPage \} from '\.\/AgencyLoginPage\.js'/);
  assert.doesNotMatch(tenantLogin + agencyLogin, /onPaste=/);
});

test('authentication failures provide a recovery path instead of system-only language', () => {
  assert.match(tenantLogin, /Try again or reset your password/);
  assert.match(agencyLogin, /Try again or reset your password/);
  assert.doesNotMatch(tenantLogin + agencyLogin, /Invalid credentials|User does not exist/);
});

test('admin password control makes every enablement rule visible', () => {
  assert.match(passwordDialog, /Password change requirements/);
  assert.match(passwordDialog, /12–128 characters/);
  assert.match(passwordDialog, /At least one lowercase letter/);
  assert.match(passwordDialog, /At least one uppercase letter/);
  assert.match(passwordDialog, /At least one number/);
  assert.match(passwordDialog, /At least one symbol/);
  assert.match(passwordDialog, /Both password fields match/);
  assert.match(passwordDialog, /Administrative reason is at least 20 characters/);
  assert.match(passwordDialog, /The action button becomes available when every item above is complete/);
  assert.match(passwordDialog, /disabled=\{!formReady\}/);
});
