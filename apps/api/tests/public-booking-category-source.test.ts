import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sourcePath = new URL('../src/modules/bookings/booking-page.service.ts', import.meta.url);

describe('public booking catalogue service categories', () => {
  it('selects and exposes the existing service category value', async () => {
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toMatch(/category:\s*sql<string \| null>`category`/);
    expect(source).toMatch(/services:\s*serviceRows\.map\(row => \(\{ \.\.\.row,/);
  });
});
