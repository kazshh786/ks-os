import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync(new URL('../src/modules/provisioning/provisioning.routes.ts', import.meta.url), 'utf8');
const delivery = readFileSync(new URL('../src/modules/provisioning/delivery-context.service.ts', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../src/modules/provisioning/tenant-lifecycle.service.ts', import.meta.url), 'utf8');
const workspaceData = readFileSync(new URL('../src/modules/provisioning/workspace-data.service.ts', import.meta.url), 'utf8');
const web = readFileSync(new URL('../../web/src/features/agency/AgencyProvisioning.tsx', import.meta.url), 'utf8');
const launchResolver = readFileSync(new URL('../../web/src/features/agency/AgencyLaunchTenantResolver.tsx', import.meta.url), 'utf8');
const launchJourney = readFileSync(new URL('../../web/src/features/agency/AgencyClientExperienceV3.tsx', import.meta.url), 'utf8');
const launch = readFileSync(new URL('../../web/src/features/agency/AgencyLaunchCommandCenter.tsx', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../../web/src/features/agency/WorkspaceDataControls.tsx', import.meta.url), 'utf8');

test('client delivery resolves server-owned plan, brief, template, draft, run and readiness', () => {
  assert.match(routes, /tenants\/:tenantReference\/delivery-context/);
  assert.match(delivery, /tenantPlanAssignments/);
  assert.match(delivery, /productionBriefs/);
  assert.match(delivery, /templateVersions/);
  assert.match(delivery, /provisioning\.readiness/);
  assert.doesNotMatch(web, /Locked production brief reference|Active plan version reference|Approved template version reference/);
});

test('governed delivery presents the draft-first Agency Launch command centre', () => {
  assert.match(web, /AgencyLaunchTenantResolver/);
  assert.match(launchResolver, /AgencyLaunchJourneyV3/);
  assert.match(launchJourney, /AgencyLaunchCommandCenter/);
  assert.match(launchJourney, /Advanced controls/);
  assert.match(launch, /Agency Launch V3/);
  assert.match(launch, /Search Intelligence/);
  assert.match(launch, /Complete governed research/);
  assert.match(launch, /Approve exact revision/);
  assert.match(launch, /Website build/);
  assert.match(launch, /Complete draft/);
  assert.match(launch, /Specialist refinement/);
  assert.match(launch, /Validation/);
  assert.match(launch, /generationMode === 'ai-composition'/);
  assert.match(launch, /Start fresh website build/);
  assert.match(launch, /Auto-refreshing/);
  assert.match(launch, /failureMessage/);
  assert.match(launch, /Human review and quality/);
  assert.match(launch, /Domain and launch/);
});

test('user removal is a guarded lifecycle action rather than destructive history deletion', () => {
  assert.match(routes, /users\/:userReference\/removal-preview/);
  assert.match(routes, /users\/:userReference\/remove/);
  assert.match(lifecycle, /FUTURE_APPOINTMENTS_ASSIGNED/);
  assert.match(lifecycle, /LAST_OWNER_PROTECTION/);
  assert.match(lifecycle, /accountStatus: 'DEACTIVATED'/);
  assert.doesNotMatch(lifecycle, /delete\(users\)/);
});

test('platform owner can reset test data or permanently delete any workspace', () => {
  assert.match(routes, /tenants\/:tenantReference\/test-data-preview/);
  assert.match(routes, /tenants\/:tenantReference\/reset-test-data/);
  assert.match(routes, /tenants\/:tenantReference\/hard-delete-preview/);
  assert.match(routes, /tenants\/:tenantReference\/hard-delete/);
  assert.match(workspaceData, /actor\.role !== 'PLATFORM_OWNER'/);
  assert.match(workspaceData, /RESET TEST DATA/);
  assert.match(workspaceData, /DELETE NOW/);
  assert.match(workspaceData, /ks_hard_delete_tenant_workspace/);
  assert.doesNotMatch(workspaceData, /WORKSPACE_WAS_LAUNCHED|APPOINTMENT_HISTORY_EXISTS|PAYMENT_HISTORY_EXISTS/);
});

test('workspace controls clearly separate pausing, offboarding, reset and hard delete', () => {
  assert.match(controls, /Pause workspace/);
  assert.match(controls, /Start offboarding/);
  assert.match(controls, /Reset test data/);
  assert.match(controls, /Delete workspace/);
  assert.match(controls, /What stays/);
  assert.match(controls, /This cannot be undone/);
  assert.match(controls, /Type <strong[\s\S]*exactly/);
  assert.match(web, /WorkspaceDataControls/);
  assert.doesNotMatch(web, /Delete unused workspace/);
});