import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Fastify from 'fastify';
import { EvidenceBudget } from '../src/modules/errors/evidence-budget.js';
import { errorCauseChain, deriveErrorOrigin, PlatformErrorLogService } from '../src/modules/errors/platform-error-log.service.js';
import { diagnoseSiteJob } from '../src/modules/sites/site-job-diagnostics.js';
import registerErrorHandler from '../src/plugins/error-handler.js';

test('evidence timeout caps outstanding work and permits recovery after completion', async () => {
  const budget = new EvidenceBudget(1, 5);
  let release!: () => void;
  assert.equal(await budget.run(() => new Promise<void>(resolve => { release = resolve; })), 'timeout');
  assert.equal(await budget.run(async () => { throw Error('must not run'); }), 'saturated');
  release();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await budget.run(async () => undefined), 'saved');
  assert.equal(await budget.run(async () => { throw Error('database down'); }), 'failed');
});

test('cause evidence handles cycles and redacts private values', () => {
  const inner = new Error('token=secret-value customer@example.com');
  const outer = new Error('wrapper', { cause: inner });
  Object.assign(inner, { cause: outer });
  const causes = errorCauseChain(outer);
  assert.equal(causes.length, 1);
  assert.doesNotMatch(JSON.stringify(causes), /secret-value|customer@example/);
  assert.equal(deriveErrorOrigin('Error\n    at dep (C:\\repo\\node_modules\\dep\\index.js:1:1)\n    at run (C:\\repo\\apps\\api\\src\\run.ts:10:2)').file, 'apps/api/src/run.ts');
});

test('workflow diagnosis uses lease evidence and never treats completion as publication', () => {
  const job = { status: 'PROCESSING', updatedAt: '2026-09-06T00:00:00Z', availableAt: '2026-09-06T00:00:00Z',
    leaseExpiresAt: '2026-09-06T00:01:00Z', heartbeatAt: null, attemptCount: 1, maxAttempts: 3, failureCode: null };
  const diagnosis = diagnoseSiteJob(job, new Date('2026-09-06T00:02:00Z'));
  assert.equal(diagnosis.leaseExpired, true);
  assert.ok(diagnosis.allowedTransitions.includes('COMPLETED'));
  assert.match(diagnoseSiteJob({ ...job, status: 'COMPLETED' }).reason, /separate step/);
  assert.equal(diagnoseSiteJob({ ...job, status: 'NEW_UNKNOWN_STATE' }).actualState, 'UNKNOWN');
  assert.equal(diagnoseSiteJob({ ...job, status: 'PENDING' }, new Date('2026-09-06T00:02:00Z')).overdue, true);
});

test('central handler gives read-safe advice and preserves both references', async () => {
  const app = Fastify();
  app.decorateRequest('correlationId', 'flow-test');
  registerErrorHandler(app);
  app.get('/broken', async () => { throw Error('token=secret-value'); });
  app.post('/broken', async () => { throw Error('token=secret-value'); });
  const read = (await app.inject('/broken')).json();
  const write = (await app.inject({ method: 'POST', url: '/broken' })).json();
  assert.equal(read.error.details.retryable, true);
  assert.equal(write.error.details.retryable, false);
  assert.equal(write.error.details.recovery, 'reconcile');
  assert.equal(write.error.details.correlationId, 'flow-test');
  assert.ok(write.error.details.requestId);
  assert.doesNotMatch(JSON.stringify(write), /secret-value/);
  await app.close();
});

test('workflow diagnostics enforce capability before database reads', () => {
  const routes = readFileSync(new URL('../src/modules/sites/site-job.routes.ts', import.meta.url), 'utf8');
  assert.match(routes, /site-jobs\/:jobReference\/diagnostics[\s\S]*actor\(request, 'sites\.jobs\.read'\)[\s\S]*service\.get\(jobReference\)/);
});

test('direct failure responses are captured once without inventing a source stack', async context => {
  const captured: Array<{ name: string; stack?: string }> = [];
  context.mock.method(PlatformErrorLogService.prototype, 'capture', async (_request: unknown, error: Error) => { captured.push(error); });
  const app = Fastify();
  registerErrorHandler(app);
  app.get('/direct', async (_request, reply) => reply.code(503).send({ error: { code: 'DEPENDENCY_DOWN', message: 'Unavailable' } }));
  app.get('/throw', async () => { throw new Error('Unavailable'); });
  assert.equal((await app.inject('/direct')).statusCode, 503);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].name, 'HandledResponseError');
  assert.equal(captured[0].stack, undefined);
  await app.inject('/throw');
  assert.equal(captured.length, 2);
  await app.close();
});
