import assert from 'node:assert/strict';
import test from 'node:test';
import { summariseAvailability } from '../src/modules/sites/live-site-availability-producer.service.js';
import { runAutomaticImpactProcessing } from '../src/modules/sites/live-site-intelligence.service.js';

test('availability producer emits a bounded next-available summary without slot counts', () => {
  const summary = summariseAvailability({
    now: new Date('2026-08-11T09:00:00.000Z'),
    timezone: 'Europe/London',
    firstAvailableAt: new Date('2026-08-12T13:30:00.000Z'),
  });
  assert.equal(summary.state, 'NEXT_AVAILABLE');
  assert.equal(summary.nextAvailableAt?.toISOString(), '2026-08-12T13:30:00.000Z');
  assert.match(summary.publicMessage, /Next online appointment/);
  assert.doesNotMatch(summary.publicMessage, /slots?|\b\d+\s+left\b/i);
  assert.equal(summary.expiresAt.getTime() - summary.computedAt.getTime(), 300_000);
});

test('availability producer describes only its bounded horizon when no slot is found', () => {
  const summary = summariseAvailability({
    now: new Date('2026-08-11T09:00:00.000Z'),
    timezone: 'Europe/London',
    horizonDays: 7,
  });
  assert.equal(summary.state, 'UNAVAILABLE');
  assert.equal(summary.nextAvailableAt, null);
  assert.equal(summary.publicMessage, 'No online appointments are available in the next 7 days');
});

test('automatic impact processing reaches each pending site, stays bounded and preserves the review boundary', async () => {
  const processedSites: string[] = [];
  const result = await runAutomaticImpactProcessing({
    siteReferences: ['site-a', 'site-a', 'site-without-publication', 'site-b'],
    limit: 3,
    processSite: async (siteReference, remaining) => {
      processedSites.push(siteReference);
      if (siteReference === 'site-without-publication') {
        throw Object.assign(new Error('No published snapshot'), {
          code: 'PUBLISHED_SNAPSHOT_REQUIRED',
        });
      }
      const processedCount = Math.min(2, remaining);
      return { processedCount, proposalCount: siteReference === 'site-b' ? 1 : 0 };
    },
  });
  assert.deepEqual(processedSites, ['site-a', 'site-without-publication', 'site-b']);
  assert.deepEqual(result, {
    sitesScanned: 3,
    processedCount: 3,
    proposalCount: 1,
    skippedWithoutPublishedSnapshot: 1,
  });
});
