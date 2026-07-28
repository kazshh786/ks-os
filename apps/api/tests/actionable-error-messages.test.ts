import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicErrorMessage } from '../src/plugins/error-handler.js';

const messageFor = (method: string, statusCode = 500) => publicErrorMessage({
  method,
  statusCode,
  requestId: 'req-test-123',
});

test('server failures explain the failed action and recovery step', () => {
  assert.match(messageFor('GET'), /load this information/i);
  assert.match(messageFor('GET'), /refresh the page/i);

  assert.match(messageFor('PATCH'), /save your changes/i);
  assert.match(messageFor('PATCH'), /try again/i);

  assert.match(messageFor('DELETE'), /delete this item/i);
  assert.match(messageFor('DELETE'), /still exists/i);

  assert.match(messageFor('POST'), /complete this action/i);
  assert.match(messageFor('POST'), /check the page/i);
});

test('temporary service failures give time-based recovery guidance', () => {
  const message = messageFor('GET', 503);
  assert.match(message, /temporarily unavailable/i);
  assert.match(message, /few minutes/i);
});

test('server failure messages include a support reference without exposing internals', () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const message = messageFor(method);
    assert.match(message, /Reference: req-test-123\./);
    assert.doesNotMatch(message, /unexpected|internal error|database|stack/i);
  }
});

test('common client failures explain the next step', () => {
  assert.match(messageFor('GET', 401), /Sign in again\./);
  assert.match(messageFor('GET', 403), /workspace owner/i);
  assert.match(messageFor('GET', 404), /Check the link/i);
  assert.match(messageFor('GET', 409), /Refresh the page/i);
  assert.match(messageFor('GET', 429), /Wait a moment/i);
});
