import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MIGRATION_MANIFEST } from '../../packages/database/src/manifest.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'packages/database/migrations');

describe('Migration Automation & Manifest Integrity', () => {
  it('should have an exact match between disk migration files and manifest entries', () => {
    const diskFiles = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
    const manifestFilenames = MIGRATION_MANIFEST.map(m => m.filename);

    expect(manifestFilenames.length).toBe(diskFiles.length);
    expect(manifestFilenames.sort()).toEqual(diskFiles.sort());
  });

  it('should have strictly sequential order values in manifest', () => {
    MIGRATION_MANIFEST.forEach((entry, idx) => {
      expect(entry.order).toBe(idx + 1);
    });
  });

  it('should place base schema 0000_uneven_richard_fisk first', () => {
    expect(MIGRATION_MANIFEST[0].filename).toBe('0000_uneven_richard_fisk.sql');
  });

  it('should place 0001_amazing_solo before 0001_stripe_booking_payments due to table dependency', () => {
    const idxBaseStripe = MIGRATION_MANIFEST.findIndex(m => m.filename === '0001_amazing_solo.sql');
    const idxStripeFKs = MIGRATION_MANIFEST.findIndex(m => m.filename === '0001_stripe_booking_payments.sql');

    expect(idxBaseStripe).toBeGreaterThan(-1);
    expect(idxStripeFKs).toBeGreaterThan(-1);
    expect(idxBaseStripe).toBeLessThan(idxStripeFKs);
  });

  it('should generate valid SHA-256 checksums for all migration files', () => {
    MIGRATION_MANIFEST.forEach(entry => {
      const filePath = path.join(MIGRATIONS_DIR, entry.filename);
      const content = fs.readFileSync(filePath, 'utf8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      expect(hash).toHaveLength(64);
    });
  });
});
