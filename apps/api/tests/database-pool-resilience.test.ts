import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveDatabasePoolMax } from '../../../packages/database/src/pool-config.js';

const databaseSource = readFileSync(new URL('../../../packages/database/src/index.ts', import.meta.url), 'utf8');

test('shared PostgreSQL pool tolerates brief Supavisor connection stalls', () => {
  assert.match(databaseSource, /max:\s*resolveDatabasePoolMax\(\)/);
  assert.equal(resolveDatabasePoolMax({ nodeEnvironment: 'production' }), 3);
  assert.equal(resolveDatabasePoolMax({ nodeEnvironment: 'development' }), 10);
  assert.match(databaseSource, /connectionTimeoutMillis:\s*10000/);
  assert.match(databaseSource, /keepAlive:\s*true/);
  assert.match(databaseSource, /keepAliveInitialDelayMillis:\s*10000/);
  assert.doesNotMatch(databaseSource, /connectionTimeoutMillis:\s*2000/);
});
