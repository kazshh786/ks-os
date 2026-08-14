import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), '../web/src/features/agency/SitePublishingPanel.tsx'),
  'utf8',
);

test('Site Studio shows a live visual build monitor from real generation-run progress', () => {
  assert.match(source, /\/generation-runs/);
  assert.match(source, /window\.setInterval\(\(\) => void refreshGeneration\(\), 2_000\)/);
  assert.match(source, /pageCountPlanned/);
  assert.match(source, /pageCountCompleted/);
  assert.match(source, /sectionCountPlanned/);
  assert.match(source, /sectionCountCompleted/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /aria-label="Website build progress"/);
  assert.match(source, /BUILD_STAGES/);
  assert.match(source, /Preparing/);
  assert.match(source, /Generating/);
  assert.match(source, /Validating/);
});

test('build monitor distinguishes active, failed and preview-ready states', () => {
  assert.match(source, /ACTIVE_BUILD_STATUSES/);
  assert.match(source, /COMPLETE_BUILD_STATUSES/);
  assert.match(source, /Build failed/);
  assert.match(source, /Build complete/);
  assert.match(source, /Preview generated site/);
  assert.match(source, /Use <strong>Retry build<\/strong> in Search Intelligence/);
  assert.match(source, /PREPARING_CONTEXT/);
  assert.match(source, /REPAIRING/);
  assert.match(source, /DESIGN_COMPLETE/);
  assert.match(source, /READY_FOR_REVIEW/);
});
