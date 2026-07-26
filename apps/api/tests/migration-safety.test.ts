import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeMigrationTarget } from '../../../scripts/database/migration-safety.mjs';

const base = {
  apply: true,
  explicitDevelopmentOptIn: true,
  nodeEnvironment: 'development',
  remoteDevelopmentOptIn: false,
  allowedProjectRef: undefined,
};

test('migration safety rejects production and staging environments', () => {
  for (const environment of ['production', 'staging']) {
    assert.throws(() => assertSafeMigrationTarget({
      ...base,
      appEnvironment: environment,
      databaseUrl: 'postgresql://postgres:local@localhost:5432/postgres',
    }), /Refusing migration apply/);
  }
});

test('migration safety accepts an explicitly designated local development database', () => {
  assert.doesNotThrow(() => assertSafeMigrationTarget({
    ...base,
    appEnvironment: 'development',
    databaseUrl: 'postgresql://postgres:local@127.0.0.1:5432/ks_os_development',
  }));
});

test('migration safety accepts only the matching encrypted remote development project', () => {
  const projectRef = 'abcdefghijklmnopqrst';
  const remote = {
    ...base,
    appEnvironment: 'development',
    remoteDevelopmentOptIn: true,
    allowedProjectRef: projectRef,
    databaseUrl: `postgresql://operator.${projectRef}:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  };
  assert.doesNotThrow(() => assertSafeMigrationTarget(remote));
  assert.throws(() => assertSafeMigrationTarget({
    ...remote,
    allowedProjectRef: 'aaaaaaaaaaaaaaaaaaaa',
  }), /explicitly designated encrypted development project/);
});
