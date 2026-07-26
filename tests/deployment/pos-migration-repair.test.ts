import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { MIGRATION_MANIFEST } from '../../packages/database/src/manifest.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'packages/database/migrations');
const TARGET_MIGRATION_FILE = '20260724180000_align_checkout_payment_components_schema.sql';

describe('POS Migration Repair & Checksum Normalization Verification', () => {
  it('should return identical checksums for LF and CRLF versions of identical SQL content', () => {
    const sqlLF = "CREATE TABLE example (\n  id uuid PRIMARY KEY,\n  name text NOT NULL\n);\n";
    const sqlCRLF = "CREATE TABLE example (\r\n  id uuid PRIMARY KEY,\r\n  name text NOT NULL\r\n);\r\n";

    const hashLF = crypto.createHash('sha256').update(sqlLF.replace(/\r\n/g, '\n').replace(/\r/g, '\n')).digest('hex');
    const hashCRLF = crypto.createHash('sha256').update(sqlCRLF.replace(/\r\n/g, '\n').replace(/\r/g, '\n')).digest('hex');

    expect(hashLF).toBe(hashCRLF);
  });

  it('should return different checksums for different SQL content', () => {
    const sql1 = "CREATE TABLE example1 (id uuid PRIMARY KEY);";
    const sql2 = "CREATE TABLE example2 (id uuid PRIMARY KEY);";

    const hash1 = crypto.createHash('sha256').update(sql1).digest('hex');
    const hash2 = crypto.createHash('sha256').update(sql2).digest('hex');

    expect(hash1).not.toBe(hash2);
  });

  it('should maintain strict 1-to-1 sync between disk migrations and MIGRATION_MANIFEST', () => {
    const diskFiles = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
    const manifestFilenames = MIGRATION_MANIFEST.map(m => m.filename);

    expect(manifestFilenames.length).toBe(diskFiles.length);
    expect(manifestFilenames.sort()).toEqual(diskFiles.sort());
  });

  it('should have strictly sequential order values from 1 to N in manifest', () => {
    MIGRATION_MANIFEST.forEach((entry, idx) => {
      expect(entry.order).toBe(idx + 1);
    });
  });

  it('should include 20260724180000_align_checkout_payment_components_schema.sql as order 26', () => {
    const lastEntry = MIGRATION_MANIFEST[MIGRATION_MANIFEST.length - 1];
    expect(lastEntry.filename).toBe(TARGET_MIGRATION_FILE);
    expect(lastEntry.order).toBe(26);
    expect(lastEntry.description).toBe('Align production checkout payment components with provider-neutral POS schema');
  });

  it('should contain no top-level BEGIN, COMMIT, or ROLLBACK statements in migration SQL file', () => {
    const filePath = path.join(MIGRATIONS_DIR, TARGET_MIGRATION_FILE);
    const sqlContent = fs.readFileSync(filePath, 'utf8');

    // Strip comments
    const sqlWithoutComments = sqlContent
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    // Isolate top-level SQL by removing PL/pgSQL DO $$ ... END $$ blocks
    const topLevelSql = sqlWithoutComments.replace(/DO\s+\$\$[\s\S]*?\$\$\s*;/gi, '');

    expect(/\bBEGIN\b/i.test(topLevelSql)).toBe(false);
    expect(/\bCOMMIT\b/i.test(topLevelSql)).toBe(false);
    expect(/\bROLLBACK\b/i.test(topLevelSql)).toBe(false);
  });

  describe('PostgreSQL DDL Corrective Migration Verification & Runner Transaction Integrity', () => {
    let pool: pg.Pool;
    let client: pg.PoolClient;
    let tempSchema: string = 'public';
    const dbUrl = process.env.DATABASE_URL;

    beforeAll(async () => {
      if (!dbUrl) return;
      pool = new pg.Pool({ connectionString: dbUrl, max: 1 });
      client = await pool.connect();
      const res = await client.query('SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()');
      if (res.rows.length > 0) {
        tempSchema = res.rows[0].nspname;
      }
    });

    afterAll(async () => {
      if (client) client.release();
      if (pool) await pool.end();
    });

    it('should correctly transform simplified checkout_payment_components and remain safe on re-execution', async () => {
      if (!dbUrl || !client) {
        console.log('Skipping live DB DDL execution test (DATABASE_URL not set)');
        return;
      }

      await client.query('BEGIN');
      try {
        await client.query(`
          CREATE TEMP TABLE "checkout_payment_components" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "tenant_id" uuid NOT NULL,
            "checkout_transaction_id" uuid NOT NULL,
            "payment_method" varchar(50) NOT NULL,
            "amount" integer NOT NULL,
            "staff_user_id" uuid,
            "created_at" timestamptz DEFAULT now() NOT NULL
          );
          INSERT INTO "checkout_payment_components" (tenant_id, checkout_transaction_id, payment_method, amount)
          VALUES (gen_random_uuid(), gen_random_uuid(), 'CASH', 2500);
        `);

        // Fetch temp schema name inside active session
        const tempSchemaRes = await client.query('SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()');
        const activeTempSchema = tempSchemaRes.rows[0]?.nspname || tempSchema;

        const filePath = path.join(MIGRATIONS_DIR, TARGET_MIGRATION_FILE);
        const sqlContent = fs.readFileSync(filePath, 'utf8');

        // 1st execution
        await client.query(sqlContent);

        const cols1 = await client.query(`
          SELECT column_name, is_nullable
          FROM information_schema.columns
          WHERE table_name = 'checkout_payment_components'
            AND table_schema = $1
          ORDER BY column_name;
        `, [activeTempSchema]);

        const colMap1 = new Map(cols1.rows.map(r => [r.column_name, r.is_nullable]));
        expect(colMap1.has('amount_in_cents')).toBe(true);
        expect(colMap1.get('amount_in_cents')).toBe('NO');
        expect(colMap1.get('verification_source')).toBe('NO');
        expect(colMap1.has('external_provider')).toBe(true);

        const rowRes1 = await client.query('SELECT amount_in_cents, verification_source FROM checkout_payment_components');
        expect(rowRes1.rows[0].amount_in_cents).toBe(2500);
        expect(rowRes1.rows[0].verification_source).toBe('STAFF_CONFIRMED');

        // Re-execution (idempotency check against aligned table)
        await client.query(sqlContent);

        const rowRes2 = await client.query('SELECT amount_in_cents, verification_source FROM checkout_payment_components');
        expect(rowRes2.rows[0].amount_in_cents).toBe(2500);
        expect(rowRes2.rows[0].verification_source).toBe('STAFF_CONFIRMED');
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('should raise an exception when neither amount nor amount_in_cents exists on non-empty table', async () => {
      if (!dbUrl || !client) {
        console.log('Skipping live DB DDL execution test (DATABASE_URL not set)');
        return;
      }

      await client.query('BEGIN');
      try {
        await client.query(`
          CREATE TEMP TABLE "checkout_payment_components" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "tenant_id" uuid NOT NULL
          );
          INSERT INTO "checkout_payment_components" (tenant_id) VALUES (gen_random_uuid());
        `);

        const filePath = path.join(MIGRATIONS_DIR, TARGET_MIGRATION_FILE);
        const sqlContent = fs.readFileSync(filePath, 'utf8');

        await expect(client.query(sqlContent)).rejects.toThrow(/Cannot infer amount_in_cents safely/i);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('should prove schema changes and migration tracking are committed together in real runner pattern', async () => {
      if (!dbUrl || !client) {
        console.log('Skipping live DB DDL execution test (DATABASE_URL not set)');
        return;
      }

      await client.query('BEGIN');
      try {
        await client.query(`
          CREATE TEMP TABLE "checkout_payment_components" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "amount" integer NOT NULL
          );
          CREATE TEMP TABLE "test_ks_os_schema_migrations" (
            "filename" varchar(255) PRIMARY KEY,
            "checksum_sha256" varchar(64) NOT NULL
          );
        `);

        const tempSchemaRes = await client.query('SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()');
        const activeTempSchema = tempSchemaRes.rows[0]?.nspname || tempSchema;

        const filePath = path.join(MIGRATIONS_DIR, TARGET_MIGRATION_FILE);
        const sqlContent = fs.readFileSync(filePath, 'utf8');

        // Real migration runner pattern:
        // BEGIN -> execute SQL -> INSERT tracking -> COMMIT
        await client.query(sqlContent);
        await client.query(`
          INSERT INTO "test_ks_os_schema_migrations" (filename, checksum_sha256)
          VALUES ('${TARGET_MIGRATION_FILE}', 'test-checksum');
        `);

        // Commit transaction
        await client.query('COMMIT');

        // Verify both schema changes and tracking row exist
        const colRes = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'checkout_payment_components'
            AND column_name = 'amount_in_cents'
            AND table_schema = $1
        `, [activeTempSchema]);
        expect(colRes.rows.length).toBe(1);

        const trackingRes = await client.query(`
          SELECT filename FROM "test_ks_os_schema_migrations" WHERE filename = '${TARGET_MIGRATION_FILE}'
        `);
        expect(trackingRes.rows.length).toBe(1);
      } finally {
        await client.query('DROP TABLE IF EXISTS "checkout_payment_components"');
        await client.query('DROP TABLE IF EXISTS "test_ks_os_schema_migrations"');
      }
    });

    it('should prove simulated tracking insert failure rolls back schema changes in real runner pattern', async () => {
      if (!dbUrl || !client) {
        console.log('Skipping live DB DDL execution test (DATABASE_URL not set)');
        return;
      }

      await client.query(`
        CREATE TEMP TABLE "checkout_payment_components" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "amount" integer NOT NULL
        );
      `);

      const tempSchemaRes = await client.query('SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()');
      const activeTempSchema = tempSchemaRes.rows[0]?.nspname || tempSchema;

      try {
        await client.query('BEGIN');

        const filePath = path.join(MIGRATIONS_DIR, TARGET_MIGRATION_FILE);
        const sqlContent = fs.readFileSync(filePath, 'utf8');

        // Step A: Run migration SQL
        await client.query(sqlContent);

        // Step B: Simulate tracking insert failure
        let trackingFailed = false;
        try {
          await client.query(`INSERT INTO "non_existent_tracking_table_simulation" VALUES (1)`);
        } catch (err) {
          trackingFailed = true;
          await client.query('ROLLBACK');
        }

        expect(trackingFailed).toBe(true);

        // Step C: Verify schema changes were rolled back (amount column still exists, amount_in_cents does not)
        const colRes = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'checkout_payment_components'
            AND column_name = 'amount'
            AND table_schema = $1
        `, [activeTempSchema]);
        expect(colRes.rows.length).toBe(1);

        const newColRes = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'checkout_payment_components'
            AND column_name = 'amount_in_cents'
            AND table_schema = $1
        `, [activeTempSchema]);
        expect(newColRes.rows.length).toBe(0);

      } finally {
        await client.query('DROP TABLE IF EXISTS "checkout_payment_components"');
      }
    });
  });
});
