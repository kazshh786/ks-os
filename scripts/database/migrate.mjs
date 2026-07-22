#!/usr/bin/env node

/**
 * Production-Grade Node.js Migration Runner for KS OS
 *
 * Usage:
 *   node scripts/database/migrate.mjs --status
 *   node scripts/database/migrate.mjs --plan
 *   node scripts/database/migrate.mjs --apply
 *   node scripts/database/migrate.mjs --apply --allow-non-prod-apply
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import fileUrl from 'url';
import pg from 'pg';
import { MIGRATION_MANIFEST } from '../../packages/database/dist/manifest.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'packages/database/migrations');
const TRACKING_TABLE = 'ks_os_schema_migrations';
const ADVISORY_LOCK_ID = 88492026; // Unique advisory lock integer for KS OS

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    status: args.includes('--status'),
    plan: args.includes('--plan'),
    apply: args.includes('--apply'),
    allowNonProdApply: args.includes('--allow-non-prod-apply'),
  };

  // Default to --plan when no action is supplied
  if (!flags.status && !flags.plan && !flags.apply) {
    flags.plan = true;
  }

  return flags;
}

function calculateSha256(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function runMigrations(options = {}) {
  const flags = { ...parseArgs(), ...options };
  const nodeEnv = process.env.NODE_ENV || 'development';
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is missing.');
    process.exit(1);
  }

  if (flags.apply && nodeEnv !== 'production' && !flags.allowNonProdApply) {
    console.error(`ERROR: Refusing to run --apply mode when NODE_ENV is "${nodeEnv}". Supply --allow-non-prod-apply to override in non-production environments.`);
    process.exit(1);
  }

  // Verify disk files match manifest
  const diskFiles = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  const manifestFilenames = MIGRATION_MANIFEST.map(m => m.filename);

  const missingFromDisk = manifestFilenames.filter(f => !diskFiles.includes(f));
  const unmanifestedOnDisk = diskFiles.filter(f => !manifestFilenames.includes(f));

  if (missingFromDisk.length > 0 || unmanifestedOnDisk.length > 0) {
    console.error('ERROR: Migration manifest mismatch detected!');
    if (missingFromDisk.length > 0) console.error('  Manifest files missing on disk:', missingFromDisk);
    if (unmanifestedOnDisk.length > 0) console.error('  Disk files missing from manifest:', unmanifestedOnDisk);
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  let client;
  try {
    client = await pool.connect();

    // Set lock timeout & statement timeout for safety
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '60s'");

    // Acquire PostgreSQL session advisory lock
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) as acquired', [ADVISORY_LOCK_ID]);
    if (!lockRes.rows[0].acquired) {
      console.error('ERROR: Could not acquire PostgreSQL migration advisory lock. Another migration runner is active.');
      process.exit(1);
    }

    try {
      // Ensure tracking table exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${TRACKING_TABLE}" (
          "filename" varchar(255) PRIMARY KEY,
          "checksum_sha256" varchar(64) NOT NULL,
          "applied_at" timestamptz DEFAULT now() NOT NULL,
          "execution_duration_ms" integer NOT NULL
        );
      `);

      // Fetch applied migrations
      const appliedRes = await client.query(`SELECT filename, checksum_sha256, applied_at FROM "${TRACKING_TABLE}" ORDER BY applied_at ASC`);
      const appliedMap = new Map(appliedRes.rows.map(r => [r.filename, r]));

      const migrationStatusList = [];
      let integrityFailure = false;

      for (const entry of MIGRATION_MANIFEST) {
        const filePath = path.join(MIGRATIONS_DIR, entry.filename);
        const currentChecksum = calculateSha256(filePath);
        const appliedInfo = appliedMap.get(entry.filename);

        if (appliedInfo) {
          if (appliedInfo.checksum_sha256 !== currentChecksum) {
            console.error(`CRITICAL SECURITY FAILURE: Applied migration "${entry.filename}" has been modified!`);
            console.error(`  Expected SHA256: ${appliedInfo.checksum_sha256}`);
            console.error(`  Current  SHA256: ${currentChecksum}`);
            integrityFailure = true;
          }
          migrationStatusList.push({
            ...entry,
            checksum: currentChecksum,
            status: 'APPLIED',
            appliedAt: appliedInfo.applied_at,
          });
        } else {
          migrationStatusList.push({
            ...entry,
            checksum: currentChecksum,
            status: 'PENDING',
            appliedAt: null,
          });
        }
      }

      if (integrityFailure) {
        console.error('Migration runner aborted due to modified applied migrations.');
        process.exit(1);
      }

      const pendingList = migrationStatusList.filter(m => m.status === 'PENDING');
      const appliedList = migrationStatusList.filter(m => m.status === 'APPLIED');

      if (flags.status) {
        console.log('=== KS OS MIGRATION STATUS ===');
        console.log(`Total Manifest Migrations: ${MIGRATION_MANIFEST.length}`);
        console.log(`Applied Migrations:        ${appliedList.length}`);
        console.log(`Pending Migrations:        ${pendingList.length}\n`);

        for (const m of migrationStatusList) {
          const badge = m.status === 'APPLIED' ? '[APPLIED]' : '[PENDING]';
          console.log(`${m.order.toString().padStart(2, '0')}. ${badge} ${m.filename}`);
        }
        return { status: 'OK', migrationStatusList };
      }

      if (flags.plan) {
        console.log('=== KS OS MIGRATION PLAN ===');
        console.log(`Pending migrations to be applied (${pendingList.length}):`);
        if (pendingList.length === 0) {
          console.log('  Database schema is up to date. No pending migrations.');
        } else {
          for (const m of pendingList) {
            console.log(`  - [ORDER ${m.order}] ${m.filename} (${m.description})`);
          }
        }
        return { status: 'OK', pendingList };
      }

      if (flags.apply) {
        console.log('=== EXECUTING MIGRATIONS (--apply) ===');
        if (pendingList.length === 0) {
          console.log('No pending migrations to apply.');
          return { status: 'OK', appliedCount: 0 };
        }

        for (const m of pendingList) {
          console.log(`Applying migration ${m.order}/${MIGRATION_MANIFEST.length}: ${m.filename}...`);
          const filePath = path.join(MIGRATIONS_DIR, m.filename);
          const sqlContent = fs.readFileSync(filePath, 'utf8');

          const startTime = Date.now();
          await client.query('BEGIN');

          try {
            await client.query(sqlContent);
            const durationMs = Date.now() - startTime;

            await client.query(
              `INSERT INTO "${TRACKING_TABLE}" (filename, checksum_sha256, execution_duration_ms) VALUES ($1, $2, $3)`,
              [m.filename, m.checksum, durationMs]
            );

            await client.query('COMMIT');
            console.log(`  ✓ Successfully applied ${m.filename} in ${durationMs}ms`);
          } catch (err) {
            await client.query('ROLLBACK');
            console.error(`  ✗ FAILED applying migration ${m.filename}! Transaction rolled back.`);
            console.error(`    Error details: ${err.message}`);
            process.exit(1);
          }
        }

        console.log('✓ All pending migrations applied successfully.');
        return { status: 'OK', appliedCount: pendingList.length };
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
    }
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// Execute CLI directly if run as main script
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileUrl.fileURLToPath(import.meta.url));
if (isMain) {
  runMigrations().catch(err => {
    console.error('Unhandled migration runner error:', err);
    process.exit(1);
  });
}
