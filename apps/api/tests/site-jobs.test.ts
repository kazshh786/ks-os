import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { capabilitiesForAgencyRole } from '@ks-os/contracts';
import { buildApp } from '../src/app.js';

const routeSource = readFileSync(
  new URL('../src/modules/sites/site-job.routes.ts', import.meta.url),
  'utf8',
);
const serviceSource = readFileSync(
  new URL('../src/modules/sites/site-job.service.ts', import.meta.url),
  'utf8',
);
const enqueueSource = readFileSync(
  new URL('../src/modules/sites/site-job-enqueue.service.ts', import.meta.url),
  'utf8',
);

const ID = '11111111-1111-4111-8111-111111111111';

function tenantContextApp() {
  return buildApp({
    beforeRegister(app) {
      app.addHook('onRequest', async request => {
        request.applicationContext = 'TENANT';
        request.auth = {
          authUserId: ID,
          tenantUserId: ID,
          membershipReference: ID,
          email: 'owner@example.test',
          tenantId: ID,
          businessReference: ID,
          tenantName: 'Tenant',
          tenantSubdomain: 'tenant',
          role: 'owner',
          permissions: [],
        };
      });
    },
  });
}

test('tenant users cannot list agency site jobs', async () => {
  const app = tenantContextApp();
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/agency/site-jobs',
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  await app.close();
});

test('tenant users cannot cancel agency site jobs', async () => {
  const app = tenantContextApp();
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/agency/site-jobs/${ID}/cancel`,
    payload: { reason: 'Tenant must not control agency jobs.' },
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /AUTH_CONTEXT_NOT_ALLOWED/);
  await app.close();
});

test('agency route set exposes summaries, attempts, events, cancel and retry', () => {
  for (const route of [
    '/site-jobs',
    '/site-jobs/:jobReference',
    '/site-jobs/:jobReference/attempts',
    '/site-jobs/:jobReference/events',
    '/site-jobs/:jobReference/cancel',
    '/site-jobs/:jobReference/retry',
    '/sites/:siteReference/jobs',
  ]) {
    assert.match(routeSource, new RegExp(route.replace(/[/:]/g, '\\$&')));
  }
});

test('agency roles receive explicit site-job capabilities', () => {
  const capabilities = capabilitiesForAgencyRole('AGENCY_ADMINISTRATOR');
  assert.ok(capabilities.includes('sites.jobs.read'));
  assert.ok(capabilities.includes('sites.jobs.manage'));
  assert.ok(capabilities.includes('sites.jobs.retry'));
  assert.ok(capabilities.includes('sites.jobs.cancel'));
});

test('the agency API has no generic job enqueue endpoint', () => {
  assert.doesNotMatch(routeSource, /app\.post\('\/site-jobs'\s*,/);
});

test('test-only handlers are excluded from production agency reads', () => {
  assert.match(serviceSource, /NOT LIKE 'TEST/);
});

test('agency responses omit raw payload and lease credentials', () => {
  assert.doesNotMatch(serviceSource, /payload:\s*siteJobs\.payloadJson/);
  assert.doesNotMatch(serviceSource, /leaseTokenDigest:\s*siteJobs/);
  assert.doesNotMatch(serviceSource, /idempotencyKey:\s*siteJobs/);
});

test('manual retry and cancellation use the platform audit service', () => {
  assert.match(serviceSource, /SITE_JOB_MANUALLY_RETRIED/);
  assert.match(serviceSource, /SITE_JOB_CANCEL_REQUESTED/);
  assert.match(serviceSource, /this\.audit\.write/);
});

test('manual retry resets aggregate progress before the next attempt', () => {
  assert.match(
    serviceSource,
    /status = 'PENDING',[\s\S]*progress_current = 0,[\s\S]*progress_total = null,[\s\S]*progress_message = null,/,
  );
});

test('job history is returned in deterministic order', () => {
  assert.match(serviceSource, /asc\(siteJobAttempts\.attemptNumber\)/);
  assert.match(
    serviceSource,
    /asc\(siteJobEvents\.occurredAt\), asc\(siteJobEvents\.id\)/,
  );
});

test('server enqueue boundary is closed until a real handler is installed', () => {
  assert.match(enqueueSource, /new Set<SiteJobType>\(\)/);
  assert.match(enqueueSource, /SITE_JOB_HANDLER_NOT_IMPLEMENTED/);
  assert.match(enqueueSource, /deriveSiteJobIdempotencyKey/);
});
