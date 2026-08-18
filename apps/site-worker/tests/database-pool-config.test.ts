import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDatabasePoolMax } from '../../../packages/database/src/pool-config.js';

test('bounds each production database pool for the shared session pool', () => {
  assert.equal(resolveDatabasePoolMax({ nodeEnvironment: 'production' }), 3);
});

test('preserves the development pool default', () => {
  assert.equal(resolveDatabasePoolMax({ nodeEnvironment: 'development' }), 10);
});

test('accepts an explicit positive pool cap', () => {
  assert.equal(resolveDatabasePoolMax({
    configuredMax: '4',
    nodeEnvironment: 'production',
  }), 4);
});

test('rejects invalid pool caps instead of silently exhausting connections', () => {
  for (const configuredMax of ['0', '-1', '1.5', 'many']) {
    assert.throws(
      () => resolveDatabasePoolMax({ configuredMax, nodeEnvironment: 'production' }),
      /DATABASE_POOL_MAX must be a positive integer/,
    );
  }
});
