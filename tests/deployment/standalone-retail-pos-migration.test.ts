import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { MIGRATION_MANIFEST } from '../../packages/database/src/manifest.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'packages/database/migrations');
const TARGET_MIGRATION_FILE = '20260730210500_standalone_retail_pos.sql';

describe('standalone retail POS migration', () => {
  it('is the next registered production migration', () => {
    const entry = MIGRATION_MANIFEST[MIGRATION_MANIFEST.length - 1];
    expect(entry.filename).toBe(TARGET_MIGRATION_FILE);
    expect(entry.order).toBe(52);
  });

  it('declares nullable appointments and tenant-scoped idempotency', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, TARGET_MIGRATION_FILE), 'utf8');
    expect(sql).toContain('ALTER COLUMN appointment_id DROP NOT NULL');
    expect(sql).toContain('idempotency_key');
    expect(sql).toContain('checkout_transactions_tenant_idempotency_unique');
    expect(sql).toContain('ON DELETE SET NULL');
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

    it('permits product-only transactions and remains idempotent', async () => {
      if (!client) return;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, TARGET_MIGRATION_FILE), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL search_path TO pg_temp, public');
        await client.query(`
          CREATE TEMP TABLE appointments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid()
          );
          CREATE TEMP TABLE checkout_transactions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
            total_amount integer NOT NULL,
            payment_status text NOT NULL,
            payment_method text NOT NULL,
            purchased_products jsonb NOT NULL DEFAULT '[]'::jsonb,
            stripe_payment_intent_id varchar(255),
            purpose text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
          );
        `);

        await client.query(sql);
        await client.query(sql);

        const tenantId = '11111111-1111-4111-8111-111111111111';
        await client.query(`
          INSERT INTO checkout_transactions (
            tenant_id,
            appointment_id,
            total_amount,
            payment_status,
            payment_method,
            purpose,
            idempotency_key
          ) VALUES ($1, NULL, 2500, 'SUCCEEDED', 'STRIPE_TERMINAL', 'point_of_sale', 'retail-sale-1')
        `, [tenantId]);

        const row = await client.query(`
          SELECT appointment_id, idempotency_key
          FROM checkout_transactions
          WHERE tenant_id = $1
        `, [tenantId]);
        expect(row.rows[0].appointment_id).toBeNull();
        expect(row.rows[0].idempotency_key).toBe('retail-sale-1');

        await expect(client.query(`
          INSERT INTO checkout_transactions (
            tenant_id,
            appointment_id,
            total_amount,
            payment_status,
            payment_method,
            purpose,
            idempotency_key
          ) VALUES ($1, NULL, 2500, 'SUCCEEDED', 'STRIPE_TERMINAL', 'point_of_sale', 'retail-sale-1')
        `, [tenantId])).rejects.toMatchObject({ code: '23505' });
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});
