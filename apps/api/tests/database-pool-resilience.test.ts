import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const databaseSource = readFileSync(new URL('../../../packages/database/src/index.ts', import.meta.url), 'utf8');

test('shared PostgreSQL pool tolerates brief Supavisor connection stalls', () => {
  assert.match(databaseSource, /max:\s*10/);
  assert.match(databaseSource, /connectionTimeoutMillis:\s*10000/);
  assert.match(databaseSource, /keepAlive:\s*true/);
  assert.match(databaseSource, /keepAliveInitialDelayMillis:\s*10000/);
  assert.doesNotMatch(databaseSource, /connectionTimeoutMillis:\s*2000/);
});
