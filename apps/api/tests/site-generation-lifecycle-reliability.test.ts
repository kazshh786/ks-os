import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generationRetryProjection,
  terminalGenerationRunFailure,
} from '@ks-os/site-generation';

test('stale PENDING run with DEAD_LETTER job becomes FAILED with job details', () => {
  assert.deepEqual(terminalGenerationRunFailure('PENDING', {
    status: 'DEAD_LETTER',
    failureCode: 'UNEXPECTED_HANDLER_FAILURE',
    failureMessage: 'The knowledge lookup failed after the final attempt.',
  }), {
    failureCode: 'UNEXPECTED_HANDLER_FAILURE',
    failureMessage: 'The knowledge lookup failed after the final attempt.',
  });
});

test('stale running generation stage with FAILED job becomes FAILED', () => {
  assert.deepEqual(terminalGenerationRunFailure('GENERATING', {
    status: 'FAILED',
    failureCode: 'PROVIDER_FAILURE',
    failureMessage: 'The provider failed terminally.',
  }), {
    failureCode: 'PROVIDER_FAILURE',
    failureMessage: 'The provider failed terminally.',
  });
});

test('retry preserves the same durable job, generation run and site version', () => {
  assert.deepEqual(generationRetryProjection({
    runReference: '10000000-0000-4000-8000-000000000001',
    versionReference: '10000000-0000-4000-8000-000000000002',
    jobReference: '10000000-0000-4000-8000-000000000003',
    idempotencyKey: 'test',
    sourceDataDigestSha256: 'a'.repeat(64),
    runStatus: 'FAILED',
    jobStatus: 'DEAD_LETTER',
  }), {
    runReference: '10000000-0000-4000-8000-000000000001',
    versionReference: '10000000-0000-4000-8000-000000000002',
    jobReference: '10000000-0000-4000-8000-000000000003',
    idempotencyKey: 'test',
    sourceDataDigestSha256: 'a'.repeat(64),
    runStatus: 'PENDING',
    versionGenerationStatus: 'INCOMPLETE',
    jobStatus: 'PENDING',
  });
});

test('retry rejects a non-terminal active durable job', () => {
  assert.equal(generationRetryProjection({
    runReference: '10000000-0000-4000-8000-000000000001',
    versionReference: '10000000-0000-4000-8000-000000000002',
    jobReference: '10000000-0000-4000-8000-000000000003',
    idempotencyKey: 'test',
    sourceDataDigestSha256: 'a'.repeat(64),
    runStatus: 'FAILED',
    jobStatus: 'PROCESSING',
  }), null);
});

test('completed runs never reconcile backwards', () => {
  for (const status of ['DESIGN_COMPLETE', 'READY_FOR_REVIEW'] as const) {
    assert.equal(terminalGenerationRunFailure(status, {
      status: 'DEAD_LETTER',
      failureCode: 'STALE_JOB_STATE',
    }), null);
  }
});
