import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const web = (path: string) => readFileSync(resolve(process.cwd(), `../web/src/${path}`), 'utf8');

test('approved Search Intelligence exposes a governed full-site rebuild action', () => {
  const source = web('features/agency/SearchIntelligencePanel.tsx');
  assert.match(source, /Rebuild website/);
  assert.match(source, /\/generation-runs/);
  assert.match(source, /generationReason: 'BLUEPRINT_REVISION'/);
  assert.match(source, /data\.status === 'APPROVED'/);
  assert.match(source, /blueprint\?\.status === 'APPROVED'/);
  assert.match(source, /existing website version and version history are preserved/i);
  assert.match(source, /idempotentReplay/);
});
