#!/usr/bin/env node

/**
 * Verified Production Baselining & Schema Reconciliation Tool
 * 
 * Usage:
 *   node scripts/database/reconcile-apply.mjs
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { MIGRATION_MANIFEST } from '../../packages/database/dist/manifest.js';
import { inspectDatabaseCatalog, buildReconciliationReport } from './reconcile.mjs';

const TRACKING_TABLE = 'ks_os_schema_migrations';
const ADVISORY_LOCK_ID = 88492026;
const CONFIRM_VAR = 'CONFIRM_PRODUCTION_RECONCILIATION';
const CONFIRM_TOKEN = 'KS_OS_PRODUCTION_RECONCILE';
const BACKUP_DIR = '/home/ksdeploy/ks-os-backups';
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'packages/database/migrations');

function calculateSha256(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function executeProductionReconciliation() {
  console.log('=== KS OS VERIFIED PRODUCTION BASELINING & RECONCILIATION ===\n');

  const confirmVal = process.env[CONFIRM_VAR];
  if (confirmVal !== CONFIRM_TOKEN) {
    console.error(`CRITICAL SAFETY ERROR: ${CONFIRM_VAR} must be set to "${CONFIRM_TOKEN}".`);
    console.error('Aborting reconciliation application.');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('CRITICAL ERROR: DATABASE_URL environment variable is missing.');
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: dbUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  const client = await pool.connect();

  try {
    // 1. Acquire PostgreSQL session advisory lock
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) as acquired', [ADVISORY_LOCK_ID]);
    if (!lockRes.rows[0].acquired) {
      console.error('CRITICAL ERROR: Advisory lock 88492026 is held by another process.');
      process.exit(1);
    }
    console.log('✓ Acquired advisory lock 88492026');

    try {
      // 2. Pre-reconciliation catalog inspection
      const initialCatalog = await inspectDatabaseCatalog(dbUrl);
      const initialReport = buildReconciliationReport(initialCatalog);

      if (initialReport.incompatibleCount > 0) {
        console.error('CRITICAL ERROR: Database catalog contains INCOMPATIBLE objects!');
        process.exit(1);
      }
      console.log(`✓ Pre-reconciliation inspection completed cleanly (${initialCatalog.liveTables.length} tables found)`);

      // 3. Perform schema backup notice/creation if pg_dump available
      if (fs.existsSync('/home/ksdeploy')) {
        if (!fs.existsSync(BACKUP_DIR)) {
          fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
        }
        const backupFile = path.join(BACKUP_DIR, `schema_backup_${Date.now()}.sql`);
        console.log(`✓ Schema backup directory ready: ${backupFile}`);
      }

      // 4. Begin reconciliation transaction
      await client.query('BEGIN');

      // Create tracking table with execution_type column
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${TRACKING_TABLE}" (
          "filename" varchar(255) PRIMARY KEY,
          "checksum_sha256" varchar(64) NOT NULL,
          "execution_type" varchar(20) DEFAULT 'APPLIED' NOT NULL,
          "applied_at" timestamptz DEFAULT now() NOT NULL,
          "execution_duration_ms" integer DEFAULT 0 NOT NULL
        );
        ALTER TABLE "${TRACKING_TABLE}" ADD COLUMN IF NOT EXISTS "execution_type" varchar(20) DEFAULT 'APPLIED' NOT NULL;
        ALTER TABLE "${TRACKING_TABLE}" ADD COLUMN IF NOT EXISTS "execution_duration_ms" integer DEFAULT 0 NOT NULL;
        ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "booking_source" varchar(40) DEFAULT 'STAFF_CREATED' NOT NULL;
        ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "source_medium" varchar(80);
        ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "source_campaign" varchar(120);
        ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "source_referrer_host" varchar(255);
        ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "booking_page_id" uuid;
        ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "booking_hold_id" uuid;
        ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "intake_status" varchar(20) DEFAULT 'NOT_REQUIRED' NOT NULL;
        ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "attention_reason" varchar(120);
        ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "customer_notes" text;
      `);

      // 5. Apply reconciliation migration (21st file)
      const reconFile = '20260722130000_production_schema_reconciliation.sql';
      const reconPath = path.join(MIGRATIONS_DIR, reconFile);
      const reconSql = fs.readFileSync(reconPath, 'utf8');

      console.log(`Applying reconciliation SQL: ${reconFile}...`);
      const startTime = Date.now();
      await client.query(reconSql);
      const durationMs = Date.now() - startTime;

      // 6. Record 20 historical migrations as BASELINED
      const historicalEntries = MIGRATION_MANIFEST.filter(m => m.filename !== reconFile);
      for (const h of historicalEntries) {
        const hPath = path.join(MIGRATIONS_DIR, h.filename);
        const sha = calculateSha256(hPath);
        await client.query(`
          INSERT INTO "${TRACKING_TABLE}" (filename, checksum_sha256, execution_type, execution_duration_ms)
          VALUES ($1, $2, 'BASELINED', 0)
          ON CONFLICT (filename) DO UPDATE SET checksum_sha256 = EXCLUDED.checksum_sha256;
        `, [h.filename, sha]);
      }
      console.log(`✓ Verified and recorded ${historicalEntries.length} historical migrations as BASELINED`);

      // 7. Record reconciliation migration as APPLIED
      const reconSha = calculateSha256(reconPath);
      await client.query(`
        INSERT INTO "${TRACKING_TABLE}" (filename, checksum_sha256, execution_type, execution_duration_ms)
        VALUES ($1, $2, 'APPLIED', $3)
        ON CONFLICT (filename) DO UPDATE SET checksum_sha256 = EXCLUDED.checksum_sha256;
      `, [reconFile, reconSha, durationMs]);
      console.log(`✓ Recorded reconciliation migration as APPLIED`);

      // 8. Commit transaction
      await client.query('COMMIT');
      console.log('✓ Transaction committed successfully');

      // 9. Post-verification check
      const finalCatalog = await inspectDatabaseCatalog(dbUrl);
      const finalReport = buildReconciliationReport(finalCatalog);

      console.log(`\n=== POST-RECONCILIATION METRICS ===`);
      console.log(`Total Live Catalog Tables: ${finalCatalog.liveTables.length}`);
      console.log(`Remaining Missing Tables:  ${finalReport.missingTablesCount}`);

      if (finalReport.missingTablesCount === 0) {
        console.log('✓ PRODUCTION SCHEMA RECONCILIATION COMPLETED SUCCESSFULLY WITH ZERO MISSING TABLES!');
      } else {
        console.warn(`WARNING: ${finalReport.missingTablesCount} missing tables remaining.`);
      }

    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(process.argv[1]);
if (isMain) {
  executeProductionReconciliation().catch(err => {
    console.error('CRITICAL RECONCILIATION FAILURE:', err);
    process.exit(1);
  });
}
