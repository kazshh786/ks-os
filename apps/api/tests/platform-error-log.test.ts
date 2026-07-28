import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  deriveErrorOrigin,
  redactErrorText,
  shouldPersistError,
} from '../src/modules/errors/platform-error-log.service.js';

test('error evidence redacts credentials, contact details and payment-like values', () => {
  const input = [
    'postgresql://admin:secret@example.test:5432/ks_os',
    'Authorization: Bearer abc.def.ghi',
    'customer@example.com',
    '4242 4242 4242 4242',
    'service_role=super-secret-value',
    'https://example.test/path?token=private',
  ].join(' ');

  const redacted = redactErrorText(input);
  assert.doesNotMatch(redacted, /admin:secret|abc\.def\.ghi|customer@example\.com|4242 4242|super-secret-value|token=private/i);
  assert.match(redacted, /REDACTED_CONNECTION/);
  assert.match(redacted, /Authorization=\[REDACTED\]/i);
  assert.match(redacted, /REDACTED_EMAIL/);
  assert.match(redacted, /REDACTED_PAYMENT_NUMBER/);
});

test('error origin identifies the first application frame', () => {
  const origin = deriveErrorOrigin([
    'Error: failed',
    '    at internalHandler (node:internal/process/task_queues:95:5)',
    '    at createBooking (/srv/ks-os/apps/api/src/modules/bookings/booking.service.ts:214:17)',
    '    at node_modules/example/index.js:10:2',
  ].join('\n'));

  assert.equal(origin.file, 'apps/api/src/modules/bookings/booking.service.ts');
  assert.equal(origin.functionName, 'createBooking');
  assert.equal(origin.line, 214);
  assert.equal(origin.column, 17);
});

test('persistence policy captures server failures and authenticated user failures', () => {
  const anonymous = { auth: undefined, agencyAuth: undefined } as any;
  const tenantUser = { auth: { tenantId: 'tenant-id' }, agencyAuth: undefined } as any;

  assert.equal(shouldPersistError(anonymous, 404), false);
  assert.equal(shouldPersistError(anonymous, 409), true);
  assert.equal(shouldPersistError(anonymous, 500), true);
  assert.equal(shouldPersistError(tenantUser, 400), true);
});

test('platform error log remains append-only, private and centrally captured', () => {
  const migration = readFileSync(new URL('../../../packages/database/migrations/20260728010000_platform_error_log.sql', import.meta.url), 'utf8');
  const handler = readFileSync(new URL('../src/plugins/error-handler.ts', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../src/modules/errors/platform-error-log.routes.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../web/src/features/agency/AgencyErrorLogPage.tsx', import.meta.url), 'utf8');

  assert.match(migration, /platform_error_events_append_only/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.platform_error_events FROM anon, authenticated/);
  assert.match(migration, /REVOKE UPDATE, DELETE ON TABLE public\.platform_error_events FROM service_role/);
  assert.match(handler, /errorLog\.capture/);
  assert.match(routes, /requireAgency\('support\.read'\)/);
  assert.match(page, /Values are never stored here/);
});
