import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AuditQuerySchema, CreateConsentRecordSchema, CreatePrivacyRequestSchema, CreateRetentionPolicySchema, capabilitiesForAgencyRole } from '@ks-os/contracts';
import { redactAuditValue } from '../src/modules/agency/agency.service.js';
import { buildApp } from '../src/app.js';

const migration=readFileSync(new URL('../../../packages/database/migrations/20260722220000_phase_14_compliance_operations.sql',import.meta.url),'utf8');

test('audit redaction recursively removes protected values before persistence',()=>{
  const result=redactAuditValue({email:'person@example.test',password:'secret',nested:{accessToken:'token',safe:'ok'},items:[{cardNumber:'4111111111111111'}]});
  assert.equal(result.redacted,true);assert.deepEqual(result.value,{email:'person@example.test',password:'[REDACTED]',nested:{accessToken:'[REDACTED]',safe:'ok'},items:[{cardNumber:'[REDACTED]'}]});
});

test('compliance contracts are strict, bounded, and subject-scoped',()=>{
  assert.equal(AuditQuerySchema.safeParse({limit:101}).success,false);
  assert.equal(CreatePrivacyRequestSchema.safeParse({requestType:'ACCESS'}).success,false);
  assert.equal(CreatePrivacyRequestSchema.safeParse({requestType:'ACCESS',tenantId:crypto.randomUUID(),subjectClientId:crypto.randomUUID()}).success,true);
  assert.equal(CreateConsentRecordSchema.safeParse({clientId:crypto.randomUUID(),consentType:'MARKETING',consentVersion:'v1',wordingSnapshot:'I agree to receive relevant marketing messages.',status:'GRANTED',collectionSource:'BOOKING',evidenceMetadata:{password:'must be redacted'}}).success,true);
  assert.equal(CreateRetentionPolicySchema.safeParse({dataCategory:'transient_logs',retentionDays:0,retentionTrigger:'created_at',expiryAction:'DELETE',legalBasis:'legitimate interests'}).success,false);
});

test('compliance capabilities are restricted to senior agency roles',()=>{
  assert.ok(capabilitiesForAgencyRole('PLATFORM_OWNER').includes('privacy.manage'));
  assert.ok(capabilitiesForAgencyRole('AGENCY_ADMINISTRATOR').includes('audit.export'));
  assert.ok(!capabilitiesForAgencyRole('SUPPORT_ADMINISTRATOR').includes('privacy.manage'));
  assert.ok(!capabilitiesForAgencyRole('FULFILMENT_ADMINISTRATOR').includes('audit.read'));
});

test('compliance storage is browser-inaccessible and legal holds are indexed',()=>{
  for(const table of ['consent_records','privacy_requests','privacy_export_artifacts','legal_holds','retention_policies','retention_policy_versions','retention_runs'])assert.match(migration,new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(migration,/REVOKE ALL ON consent_records,privacy_requests/);assert.match(migration,/legal_holds_active_subject_idx/);assert.match(migration,/retention_runs_queue_idx/);
});

test('unauthenticated callers cannot access compliance routes',async()=>{const app=buildApp();const response=await app.inject({method:'GET',url:'/api/v1/agency/compliance/audit'});assert.equal(response.statusCode,403);assert.match(response.body,/AUTH_CONTEXT_NOT_ALLOWED|AGENCY/);await app.close();});

test('health exposes separate liveness and readiness probes with correlation IDs',async()=>{const app=buildApp();const live=await app.inject({method:'GET',url:'/health/live',headers:{'x-correlation-id':'phase14-test'}});assert.equal(live.statusCode,200);assert.equal(live.headers['x-correlation-id'],'phase14-test');assert.equal(live.headers['cache-control'],'no-store');const ready=await app.inject({method:'GET',url:'/health/ready'});assert.ok([200,503].includes(ready.statusCode));await app.close();});
