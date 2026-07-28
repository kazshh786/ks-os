import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('agency assisted intake is a first-class path and never requires an email invitation', () => {
  const page = read('../../web/src/features/agency/AgencyFactFinding.tsx');
  const routes = read('../src/modules/provisioning/fact-finding.routes.ts');
  const service = read('../src/modules/provisioning/manual-fact-finding.service.ts');

  assert.match(page, /Complete together now/);
  assert.match(page, /No email or client login is required/);
  assert.match(page, /agencyFetch\('\/tenants'\)/);
  assert.doesNotMatch(page, /Tenant public reference|Questionnaire reference|Production brief reference/);
  assert.doesNotMatch(page, /prompt\(/);

  assert.match(routes, /manual-form/);
  assert.match(routes, /manual-responses/);
  assert.match(routes, /submit-manually/);
  assert.match(service, /source: 'AGENCY_PROVIDED'/);
  assert.match(service, /status: 'AGENCY_REVIEW_REQUIRED'/);
  assert.match(service, /FACT_FINDING_AGENCY_SUBMITTED/);
});

test('client and agency journeys share the existing intake-form renderer', () => {
  const shared = read('../../web/src/features/fact-finding/FactFindingForm.tsx');
  const client = read('../../web/src/features/fact-finding/ClientFactFindingPage.tsx');
  const agency = read('../../web/src/features/agency/AgencyFactFinding.tsx');
  const renderer = read('../../web/src/features/forms/FormRenderer.tsx');

  assert.match(shared, /FormRenderer/);
  assert.match(shared, /AddressEditor/);
  assert.match(shared, /MoneyEditor/);
  assert.match(shared, /HoursEditor/);
  assert.match(shared, /ListEditor/);
  assert.match(client, /<FactFindingForm/);
  assert.match(agency, /<FactFindingForm/);
  assert.match(renderer, /option\.value \|\| option\.id/);
});

test('assisted uploads remain private and byte verified', () => {
  const routes = read('../src/modules/provisioning/fact-finding.routes.ts');
  const uploads = read('../src/modules/provisioning/manual-fact-finding-upload.service.ts');
  const page = read('../../web/src/features/agency/AgencyFactFinding.tsx');

  assert.match(routes, /manual-uploads/);
  assert.match(uploads, /createSignedUploadUrl/);
  assert.match(uploads, /createHash\('sha256'\)/);
  assert.match(uploads, /uploadedFileMatchesMime/);
  assert.match(uploads, /uploadStatus: 'QUARANTINED'/);
  assert.match(uploads, /participantId: null/);
  assert.match(page, /publicUsePermission: false/);
  assert.match(page, /aiUsePermission: false/);
});

test('recommended onboarding form covers booking, website and provisioning facts', () => {
  const migration = read('../../../packages/database/migrations/20260728030000_default_client_onboarding_fact_find.sql');
  const manifest = read('../../../packages/database/src/manifest.ts');

  assert.match(migration, /KS_OS_CLIENT_ONBOARDING/);
  assert.match(migration, /BUSINESS\.LEGAL_NAME/);
  assert.match(migration, /LOCATION\.OPENING_HOURS/);
  assert.match(migration, /SERVICE\.DURATION/);
  assert.match(migration, /SERVICE\.PRICE/);
  assert.match(migration, /STAFF\.AVAILABILITY/);
  assert.match(migration, /BOOKING\.CANCELLATION_POLICY/);
  assert.match(migration, /BRAND\.VISUAL_DIRECTION/);
  assert.match(migration, /ASSET\.LOGO/);
  assert.match(manifest, /20260728030000_default_client_onboarding_fact_find\.sql/);
});
