import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [generationSource, jobSource, workerRepositorySource] = await Promise.all([
  readFile(new URL('../src/modules/sites/site-generation.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/modules/sites/site-job.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../site-worker/src/postgres-repository.ts', import.meta.url), 'utf8'),
]);

test('generation reads reconcile terminal job drift before returning status', () => {
  assert.match(
    generationSource,
    /async list\(siteReference: string\) \{[\s\S]*await this\.reconcileTerminalGenerationRuns\(siteReference/,
  );
  assert.match(generationSource, /terminalGenerationRunFailure/);
  assert.match(generationSource, /failureCode: failure\.failureCode/);
  assert.match(generationSource, /failureMessage: failure\.failureMessage/);
  assert.match(generationSource, /generationStatus: 'FAILED'/);
});

test('stale active generation runs reconcile before retrying the same durable job and version', () => {
  const retry = generationSource.match(
    /async retry\(actor:[\s\S]*?return \{ reference: runReference, status: 'PENDING' as const \};\n  \}/,
  )?.[0] ?? '';
  assert.match(retry, /reconcileTerminalGenerationRuns/);
  assert.match(retry, /this\.jobOperations\.retry/);
  assert.match(retry, /const versionId = run\.versionId;[\s\S]*versionId,/);
  assert.match(retry, /reusedDurableJob: true/);
  assert.doesNotMatch(retry, /insert\(siteVersions\)|insert\(siteGenerationRuns\)|insert\(siteJobs\)/);
});

test('retry rejects active jobs and atomically resets job, run and version lifecycle', () => {
  assert.match(jobSource, /if \(!\['FAILED', 'DEAD_LETTER'\]\.includes\(job\.status\)\)/);
  assert.match(generationSource, /!\['FAILED', 'DEAD_LETTER'\]\.includes\(run\.jobStatus \|\| ''\)/);
  assert.match(jobSource, /afterRequeue\?\.\(transaction/);
  assert.match(generationSource, /status: 'PENDING'/);
  assert.match(generationSource, /generationStatus: 'INCOMPLETE'/);
});

test('worker failure persistence is the authoritative future terminal transition boundary', () => {
  assert.match(workerRepositorySource, /reconcileTerminalGenerationRun\(transaction, job\.id\)/);
  assert.match(workerRepositorySource, /terminalGenerationRunFailure/);
  assert.match(workerRepositorySource, /SITE_GENERATION_STATE_RECONCILED/);
  assert.match(workerRepositorySource, /source_component[\s\S]*'site-worker'/);
});
