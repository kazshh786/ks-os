import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../packages/database/migrations/20260727233000_workspace_hard_delete_and_test_reset.sql', import.meta.url),
  'utf8',
);
const routes = readFileSync(new URL('../src/modules/provisioning/provisioning.routes.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/modules/provisioning/workspace-data.service.ts', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../../web/src/features/agency/WorkspaceDataControls.tsx', import.meta.url), 'utf8');
const delivery = readFileSync(new URL('../../web/src/features/agency/AgencyProvisioning.tsx', import.meta.url), 'utf8');

test('test reset clears generated activity while keeping configured workspace data', () => {
  assert.match(migration, /ks_reset_tenant_test_data/);
  assert.match(migration, /appointments/);
  assert.match(migration, /checkout_transactions/);
  assert.match(migration, /client_form_submissions/);
  assert.match(migration, /email_outbox/);
  assert.match(migration, /review_invitations/);
  assert.match(migration, /report_export_jobs/);
  assert.match(migration, /report_schedule_runs/);
  assert.match(migration, /UPDATE site_review_invitations[\s\S]*email_outbox_id = NULL/);
  assert.doesNotMatch(migration, /ks_reset_tenant_test_data[\s\S]*DELETE FROM services/i);
  assert.doesNotMatch(migration, /ks_reset_tenant_test_data[\s\S]*DELETE FROM users/i);
  assert.match(routes, /tenants\/:tenantReference\/test-data-preview/);
  assert.match(routes, /tenants\/:tenantReference\/reset-test-data/);
  assert.match(service, /RESET TEST DATA/);
  assert.match(service, /generatedReports/);
  assert.match(controls, /What stays/);
});

test('hard delete physically removes tenant-owned records without a booking-history blocker', () => {
  assert.match(migration, /ks_hard_delete_tenant_workspace/);
  assert.match(migration, /DISABLE TRIGGER ALL/);
  assert.match(migration, /DELETE FROM tenants WHERE id = p_tenant_id/);
  assert.match(migration, /information_schema\.columns[\s\S]*column_name = 'tenant_id'/);
  assert.match(routes, /tenants\/:tenantReference\/hard-delete-preview/);
  assert.match(routes, /tenants\/:tenantReference\/hard-delete/);
  assert.match(service, /actor\.role !== 'PLATFORM_OWNER'/);
  assert.match(service, /DELETE NOW/);
  assert.match(service, /exists\(select 1 from users where auth_user_id/);
  assert.match(service, /exists\(select 1 from agency_users where auth_user_id/);
  assert.match(service, /auth\.admin\.deleteUser/);
  assert.doesNotMatch(service, /APPOINTMENT_HISTORY_EXISTS/);
});

test('reset and hard delete remove private stored files before database records', () => {
  assert.match(service, /fact_finding_uploads/);
  assert.match(service, /report-exports/);
  assert.match(service, /storage\.from\(bucket\)\.remove\(chunk\)/);
  assert.match(service, /WORKSPACE_STORAGE_DELETE_FAILED/);
  assert.match(service, /No database records were deleted/);
  assert.match(service, /storedFiles/);
  assert.match(service, /private files/);
});

test('destructive dialogs explain impact and show every confirmation requirement', () => {
  assert.match(controls, /Reset test data/);
  assert.match(controls, /Delete workspace/);
  assert.match(controls, /RESET TEST DATA/);
  assert.match(controls, /DELETE NOW/);
  assert.match(controls, /Ready to continue\?/);
  assert.match(controls, /Impact reviewed/);
  assert.match(controls, /Workspace name matches/);
  assert.match(controls, /Confirmation phrase matches/);
  assert.match(controls, /Reason has 20 characters/);
  assert.match(delivery, /WorkspaceDataControls/);
  assert.doesNotMatch(delivery, /Delete unused workspace/);
});
