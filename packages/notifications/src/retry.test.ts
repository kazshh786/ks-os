import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateOutboxBackoffDelay,
  decideOutboxRetry,
  DEFAULT_OUTBOX_RETRY_POLICY,
} from './retry.js';

test('calculateOutboxBackoffDelay applies exponential backoff', () => {
  // Use deterministic randomValue = 0.5 (jitter becomes 0)
  const delay1 = calculateOutboxBackoffDelay(1, DEFAULT_OUTBOX_RETRY_POLICY, 0.5);
  const delay2 = calculateOutboxBackoffDelay(2, DEFAULT_OUTBOX_RETRY_POLICY, 0.5);
  const delay3 = calculateOutboxBackoffDelay(3, DEFAULT_OUTBOX_RETRY_POLICY, 0.5);
  const delay4 = calculateOutboxBackoffDelay(4, DEFAULT_OUTBOX_RETRY_POLICY, 0.5);

  assert.equal(delay1, 5_000);   // 5s
  assert.equal(delay2, 10_000);  // 10s
  assert.equal(delay3, 20_000);  // 20s
  assert.equal(delay4, 40_000);  // 40s
});

test('calculateOutboxBackoffDelay keeps jitter within configured bounds', () => {
  const minJitter = calculateOutboxBackoffDelay(1, DEFAULT_OUTBOX_RETRY_POLICY, 0.0);
  const maxJitter = calculateOutboxBackoffDelay(1, DEFAULT_OUTBOX_RETRY_POLICY, 1.0);

  // Base is 5000. 10% jitter ratio -> range [4500, 5500]
  assert.equal(minJitter, 4_500);
  assert.equal(maxJitter, 5_500);
});

test('decideOutboxRetry handles terminal failure and max attempts', () => {
  const terminal = decideOutboxRetry({ attemptNumber: 1, isTerminalFailure: true });
  assert.equal(terminal.retry, false);
  assert.equal(terminal.deadLetter, true);

  const exhausted = decideOutboxRetry({ attemptNumber: 5, isTerminalFailure: false });
  assert.equal(exhausted.retry, false);
  assert.equal(exhausted.deadLetter, true);

  const retryable = decideOutboxRetry({ attemptNumber: 2, isTerminalFailure: false, randomValue: 0.5 });
  assert.equal(retryable.retry, true);
  assert.equal(retryable.deadLetter, false);
  assert.equal(retryable.delayMs, 10_000);
});
