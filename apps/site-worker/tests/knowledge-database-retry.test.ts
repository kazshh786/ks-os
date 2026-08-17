import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SiteJobExecutionError,
  databaseErrorDiagnostics,
  isRetryableDatabaseError,
} from '@ks-os/site-jobs';
import { retryCoherentKnowledgeRead } from '../src/generation-knowledge.js';

function wrappedDatabaseError(cause: unknown) {
  return Object.assign(new Error('Failed query: select ...'), { cause });
}

test('nested network and PostgreSQL connection errors are classified as transient', () => {
  assert.equal(isRetryableDatabaseError(
    wrappedDatabaseError(Object.assign(new Error('Connection terminated unexpectedly'), {
      code: 'ECONNRESET',
    })),
  ), true);
  assert.equal(isRetryableDatabaseError(
    wrappedDatabaseError(Object.assign(new Error('connection failure'), { code: '08006' })),
  ), true);
  assert.equal(isRetryableDatabaseError(
    wrappedDatabaseError(Object.assign(new Error('admin shutdown'), { code: '57P01' })),
  ), true);
});

test('schema and SQL programming errors are not classified as transient', () => {
  assert.equal(isRetryableDatabaseError(
    wrappedDatabaseError(Object.assign(new Error('undefined table'), { code: '42P01' })),
  ), false);
  assert.equal(isRetryableDatabaseError(
    wrappedDatabaseError(Object.assign(new Error('syntax error'), { code: '42601' })),
  ), false);
});

test('knowledge loading retries the whole read after one transient failure', async () => {
  let calls = 0;
  const delays: number[] = [];
  const value = await retryCoherentKnowledgeRead(async () => {
    calls += 1;
    if (calls === 1) {
      throw wrappedDatabaseError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    }
    return 'complete-bundle';
  }, {
    maximumAttempts: 3,
    sleep: async delay => { delays.push(delay); },
    random: () => 0,
  });

  assert.equal(value, 'complete-bundle');
  assert.equal(calls, 2);
  assert.deepEqual(delays, [100]);
});

test('knowledge loading does not retry permanent database errors', async () => {
  let calls = 0;
  await assert.rejects(
    () => retryCoherentKnowledgeRead(async () => {
      calls += 1;
      throw wrappedDatabaseError(Object.assign(new Error('undefined table'), { code: '42P01' }));
    }, {
      maximumAttempts: 3,
      sleep: async () => undefined,
    }),
    /Failed query/,
  );
  assert.equal(calls, 1);
});

test('exhausted transient knowledge reads become a safe retryable site-job failure', async () => {
  const root = Object.assign(new Error('Connection terminated unexpectedly'), {
    code: '08006',
    password: 'must-never-be-logged',
  });
  await assert.rejects(
    () => retryCoherentKnowledgeRead(async () => {
      throw wrappedDatabaseError(root);
    }, {
      maximumAttempts: 3,
      sleep: async () => undefined,
      random: () => 0,
    }),
    (error: unknown) => {
      assert.equal(error instanceof SiteJobExecutionError, true);
      const failure = error as SiteJobExecutionError & { cause?: unknown };
      assert.equal(failure.code, 'RETRYABLE_DATABASE_CONTENTION');
      assert.match(failure.message, /temporary database connection problem/i);
      assert.equal(isRetryableDatabaseError(failure), true);
      const diagnostics = databaseErrorDiagnostics(failure);
      assert.equal(diagnostics.transient, true);
      assert.equal(diagnostics.sqlState, '08006');
      assert.doesNotMatch(JSON.stringify(diagnostics), /must-never-be-logged/);
      return true;
    },
  );
});
