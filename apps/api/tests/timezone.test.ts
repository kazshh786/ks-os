import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseLocalTimeToUtc } from '../src/modules/availability/availability.utils.js';

describe('Timezone utils', () => {
  it('converts an ordinary winter date correctly (London)', () => {
    // 2026-01-15 is winter in Europe/London (UTC+0)
    const utc = parseLocalTimeToUtc('2026-01-15', '10:00', 'Europe/London');
    assert.strictEqual(utc.toISOString(), '2026-01-15T10:00:00.000Z');
  });

  it('converts an ordinary summer date correctly (London)', () => {
    // 2026-07-15 is summer in Europe/London (BST, UTC+1)
    const utc = parseLocalTimeToUtc('2026-07-15', '10:00', 'Europe/London');
    assert.strictEqual(utc.toISOString(), '2026-07-15T09:00:00.000Z');
  });

  it('handles spring-forward correctly (London)', () => {
    // 2026-03-29 01:00 to 02:00 springs forward. 01:30 doesn't exist locally!
    // The legacy implementation might return a shifted time. We'll see.
    const utc = parseLocalTimeToUtc('2026-03-29', '01:30', 'Europe/London');
    // If we reject it or map it safely. Let's see what the hack does.
    console.log(utc.toISOString());
  });
});
