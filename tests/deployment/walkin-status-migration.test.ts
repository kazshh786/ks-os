import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { MIGRATION_MANIFEST } from '../../packages/database/src/manifest.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'packages/database/migrations');
const TARGET_MIGRATION_FILE = '20260730182500_expand_appointment_status_constraint.sql';
const operationalStatuses = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_SERVICE',
  'AWAITING_PAYMENT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'BLOCKED',
] as const;

describe('walk-in appointment status migration', () => {
  it('is registered after the current production migration set', () => {
    const entry = MIGRATION_MANIFEST[MIGRATION_MANIFEST.length - 1];
    expect(entry.filename).toBe(TARGET_MIGRATION_FILE);
    expect(entry.order).toBe(51);
  });

  it('declares every appointment lifecycle status used by the application', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, TARGET_MIGRATION_FILE), 'utf8');
    for (const status of operationalStatuses) expect(sql).toContain(`'${status}'`);
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS appointments_status_check');
    expect(sql).toContain('VALIDATE CONSTRAINT appointments_status_check');
  });

  describe('database reconciliation', () => {
    let pool: pg.Pool | undefined;
    let client: pg.PoolClient | undefined;
    const databaseUrl = process.env.DATABASE_URL;

    beforeAll(async () => {
      if (!databaseUrl) return;
      pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
      client = await pool.connect();
    });

    afterAll(async () => {
      client?.release();
      await pool?.end();
    });

    it('upgrades the legacy constraint and permits checked-in walk-ins', async () => {
      if (!client) return;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, TARGET_MIGRATION_FILE), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(`
          CREATE TEMP TABLE appointments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            status text NOT NULL,
            CONSTRAINT appointments_status_check CHECK (
              status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'BLOCKED')
            )
          );
        `);

        await client.query(sql);
        await client.query(sql);

        for (const status of operationalStatuses) {
          await client.query('INSERT INTO appointments (status) VALUES ($1)', [status]);
        }

        const count = await client.query('SELECT count(*)::int AS total FROM appointments');
        expect(count.rows[0].total).toBe(operationalStatuses.length);

        const constraint = await client.query(`
          SELECT pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conrelid = 'appointments'::regclass
            AND conname = 'appointments_status_check'
        `);
        expect(constraint.rows[0].definition).toContain('CHECKED_IN');
        expect(constraint.rows[0].definition).toContain('IN_SERVICE');
        expect(constraint.rows[0].definition).toContain('AWAITING_PAYMENT');
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});
