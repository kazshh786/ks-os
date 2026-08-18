import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const web = (path: string) => readFileSync(resolve(process.cwd(), `../web/src/${path}`), 'utf8');

test('approved Search Intelligence exposes a governed full-site rebuild action', () => {
  const source = web('features/agency/SearchIntelligencePanel.tsx');
  const rebuildHandler = source.slice(source.indexOf('const rebuildWebsite'), source.indexOf('if (loading)'));
  assert.match(source, /Rebuild website/);
  assert.match(source, /Confirm rebuild/);
  assert.match(source, /setRebuildConfirmationOpen\(true\)/);
  assert.doesNotMatch(rebuildHandler, /window\.confirm/);
  assert.match(source, /\/generation-runs/);
  assert.match(source, /generationReason: 'BLUEPRINT_REVISION'/);
  assert.match(source, /data\.status === 'APPROVED'/);
  assert.match(source, /blueprint\?\.status === 'APPROVED'/);
  assert.match(source, /existing website version and version history are preserved/i);
  assert.match(source, /idempotentReplay/);
});

test('failed website generation can be retried from the Search Intelligence workspace', () => {
  const source = web('features/agency/SearchIntelligencePanel.tsx');
  const retryHandler = source.slice(source.indexOf('const retryWebsiteBuild'), source.indexOf('const rebuildWebsite'));
  assert.match(source, /Latest website build failed/);
  assert.match(source, /Retry build/);
  assert.match(source, /Confirm retry/);
  assert.match(source, /setRetryConfirmationOpen\(true\)/);
  assert.doesNotMatch(retryHandler, /window\.confirm/);
  assert.match(source, /latestGeneration\.status !== 'FAILED'/);
  assert.match(source, /generation\.idempotentReplay && generation\.status === 'FAILED'/);
  assert.match(source, /generation-runs\/\$\{latestGeneration\.reference\}\/retry/);
  assert.match(source, /generation-runs\/\$\{generation\.reference\}\/retry/);
  assert.match(source, /re-queued using the same governed inputs/i);
});
