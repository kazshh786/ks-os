import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const apiSource = readFileSync(
  new URL('../../api/src/modules/provisioning/fact-finding.service.ts', import.meta.url),
  'utf8',
);
const workerSource = readFileSync(
  new URL('../src/postgres-provisioning-executor.ts', import.meta.url),
  'utf8',
);

test('provisioning verifies fact-set digests in the brief builder order', () => {
  assert.match(
    apiSource,
    /from\(factFindingResponses\)[\s\S]*?orderBy\(asc\(factFindingResponses\.createdAt\)\)/,
  );
  assert.match(
    workerSource,
    /snapshotFacts[\s\S]*?from\(productionBriefFacts\)[\s\S]*?sourceResponses[\s\S]*?from\(factFindingResponses\)[\s\S]*?orderBy\(asc\(factFindingResponses\.createdAt\)\)/,
  );
  assert.match(
    workerSource,
    /factsByResponseId[\s\S]*?sourceResponses\.flatMap/,
  );
  assert.match(
    workerSource,
    /factSetComplete[\s\S]*?!factSetComplete/,
  );
});
