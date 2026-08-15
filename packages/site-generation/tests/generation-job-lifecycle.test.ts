import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generationRetryProjection,
  isTerminalFailedSiteJobStatus,
  terminalGenerationRunFailure,
} from '../src/lifecycle.js';

test('terminal durable jobs reconcile active generation states with their failure', () => {
  for (const [runStatus, jobStatus] of [
    ['PENDING', 'DEAD_LETTER'],
    ['PREPARING_CONTEXT', 'FAILED'],
    ['GENERATING', 'FAILED'],
    ['VALIDATING', 'DEAD_LETTER'],
    ['REPAIRING', 'FAILED'],
  ] as const) {
    assert.deepEqual(terminalGenerationRunFailure(runStatus, {
      status: jobStatus,
      failureCode: 'UNEXPECTED_HANDLER_FAILURE',
      failureMessage: 'The governed handler failed.',
    }), {
      failureCode: 'UNEXPECTED_HANDLER_FAILURE',
      failureMessage: 'The governed handler failed.',
    });
  }
});

test('terminal reconciliation preserves completed and already terminal generation states', () => {
  for (const runStatus of [
    'DESIGN_COMPLETE',
    'READY_FOR_REVIEW',
    'FAILED',
    'CANCELLED',
    'SUPERSEDED',
  ] as const) {
    assert.equal(terminalGenerationRunFailure(runStatus, {
      status: 'DEAD_LETTER',
      failureCode: 'SHOULD_NOT_REPLACE',
    }), null);
  }
});

test('active jobs never force a generation run to failed', () => {
  for (const status of ['PENDING', 'LEASED', 'PROCESSING', 'RETRY_DELAY', 'COMPLETED']) {
    assert.equal(terminalGenerationRunFailure('PENDING', { status }), null);
    assert.equal(isTerminalFailedSiteJobStatus(status), false);
  }
  assert.equal(isTerminalFailedSiteJobStatus('FAILED'), true);
  assert.equal(isTerminalFailedSiteJobStatus('DEAD_LETTER'), true);
});

test('terminal reconciliation supplies bounded safe fallback failure details', () => {
  const failure = terminalGenerationRunFailure('PENDING', {
    status: 'FAILED',
    failureCode: 'x'.repeat(120),
    failureMessage: 'y'.repeat(520),
  });
  assert.equal(failure?.failureCode.length, 100);
  assert.equal(failure?.failureMessage.length, 500);
  assert.match(
    terminalGenerationRunFailure('GENERATING', { status: 'DEAD_LETTER' })!.failureCode,
    /TERMINAL_JOB_STATE_RECONCILED/,
  );
});

test('manual retry requeues the same durable identity and rejects active jobs', () => {
  const identity = {
    runReference: '10000000-0000-4000-8000-000000000001',
    versionReference: '10000000-0000-4000-8000-000000000002',
    jobReference: '10000000-0000-4000-8000-000000000003',
    idempotencyKey: 'test',
    sourceDataDigestSha256: 'a'.repeat(64),
    runStatus: 'FAILED' as const,
  };
  const retry = generationRetryProjection({ ...identity, jobStatus: 'DEAD_LETTER' });
  assert.equal(retry?.runReference, identity.runReference);
  assert.equal(retry?.versionReference, identity.versionReference);
  assert.equal(retry?.jobReference, identity.jobReference);
  assert.equal(retry?.idempotencyKey, identity.idempotencyKey);
  assert.equal(retry?.sourceDataDigestSha256, identity.sourceDataDigestSha256);
  assert.equal(retry?.jobStatus, 'PENDING');
  assert.equal(generationRetryProjection({ ...identity, jobStatus: 'PROCESSING' }), null);
});
