#!/usr/bin/env node

/**
 * Preflight Check Tool for KS OS Production Deployment
 *
 * Verifies environment readiness without performing schema modifications.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { MIGRATION_MANIFEST } from '../../packages/database/dist/manifest.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'packages/database/migrations');
const TRACKING_TABLE = 'ks_os_schema_migrations';
const ADVISORY_LOCK_ID = 88492026;

function runCmd(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (err) {
    return null;
  }
}

function calculateSha256(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function runPreflight() {
  console.log('=== RUNNING KS OS DEPLOYMENT PREFLIGHT CHECKS ===\n');
  let passed = true;

  // 1. Node.js version check (>=24 <25)
  const nodeVersion = process.version;
  const majorNode = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);
  if (majorNode === 24) {
    console.log(`✓ Node.js version: ${nodeVersion} (meets >=24 <25)`);
  } else {
    console.error(`✗ Node.js version: ${nodeVersion} (REQUIRED: >=24 <25)`);
    passed = false;
  }

  // 2. pnpm version check (11.13.1)
  const pnpmVersion = runCmd('pnpm --version');
  if (pnpmVersion === '11.13.1') {
    console.log(`✓ pnpm version: ${pnpmVersion} (exact match)`);
  } else {
    console.error(`✗ pnpm version: ${pnpmVersion || 'not found'} (REQUIRED: 11.13.1)`);
    passed = false;
  }

  // 3. Git branch and clean working tree
  const branch = runCmd('git rev-parse --abbrev-ref HEAD');
  const commit = runCmd('git rev-parse HEAD');
  const status = runCmd('git status --porcelain');

  console.log(`✓ Git branch: ${branch || 'unknown'}`);
  console.log(`✓ Git commit: ${commit || 'unknown'}`);

  if (!status) {
    console.log('✓ Git working tree is clean');
  } else {
    console.error('✗ Git working tree contains uncommitted changes or untracked files');
    passed = false;
  }

  // 4. Staged .env check
  const stagedFiles = runCmd('git diff --cached --name-only') || '';
  if (stagedFiles.includes('.env')) {
    console.error('✗ CRITICAL SECURITY ALERT: .env file is staged in Git!');
    passed = false;
  } else {
    console.log('✓ No .env files staged in Git');
  }

  // 5. Environment variables check
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    console.log('✓ DATABASE_URL environment variable is set');
  } else {
    console.error('✗ DATABASE_URL environment variable is missing');
    passed = false;
  }

  // 6. Database connectivity & migration lock checks
  if (dbUrl) {
    const pool = new pg.Pool({
      connectionString: dbUrl,
      max: 1,
      connectionTimeoutMillis: 3000,
    });

    let client;
    try {
      client = await pool.connect();
      const verRes = await client.query('SELECT version()');
      console.log(`✓ Database connected. PostgreSQL version: ${verRes.rows[0].version.split(',')[0]}`);

      // Lock test
      const lockRes = await client.query('SELECT pg_try_advisory_lock($1) as acquired', [ADVISORY_LOCK_ID]);
      if (lockRes.rows[0].acquired) {
        console.log('✓ Migration advisory lock (88492026) is available');
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
      } else {
        console.error('✗ Migration advisory lock is currently HELD by another session');
        passed = false;
      }

      // Check manifest vs disk
      const diskFiles = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
      const manifestFilenames = MIGRATION_MANIFEST.map(m => m.filename);
      const missingFromDisk = manifestFilenames.filter(f => !diskFiles.includes(f));
      const unmanifestedOnDisk = diskFiles.filter(f => !manifestFilenames.includes(f));

      if (missingFromDisk.length === 0 && unmanifestedOnDisk.length === 0) {
        console.log('✓ Migration manifest matches disk migration files');
      } else {
        console.error('✗ Migration manifest discrepancy detected');
        passed = false;
      }

      // Check tracking table & modified checksums
      const tableExistsRes = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = '${TRACKING_TABLE}'
        );
      `);

      if (tableExistsRes.rows[0].exists) {
        const appliedRes = await client.query(`SELECT filename, checksum_sha256 FROM "${TRACKING_TABLE}"`);
        const appliedMap = new Map(appliedRes.rows.map(r => [r.filename, r.checksum_sha256]));

        let checksumErrors = 0;
        for (const entry of MIGRATION_MANIFEST) {
          const filePath = path.join(MIGRATIONS_DIR, entry.filename);
          const currentSha = calculateSha256(filePath);
          const appliedSha = appliedMap.get(entry.filename);

          if (appliedSha && appliedSha !== currentSha) {
            console.error(`✗ Modified applied migration: ${entry.filename}`);
            checksumErrors++;
          }
        }

        if (checksumErrors === 0) {
          console.log(`✓ All ${appliedMap.size} applied migrations match current disk checksums`);
        } else {
          passed = false;
        }

        const pendingCount = MIGRATION_MANIFEST.length - appliedMap.size;
        console.log(`✓ Migration status: ${appliedMap.size} applied, ${pendingCount} pending`);
      } else {
        console.log(`✓ Tracking table "${TRACKING_TABLE}" will be initialized on first run`);
      }

    } catch (dbErr) {
      console.error(`✗ Database connection error: ${dbErr.message}`);
      passed = false;
    } finally {
      if (client) client.release();
      await pool.end();
    }
  }

  console.log('\n----------------------------------------');
  if (passed) {
    console.log('✓ PREFLIGHT CHECKS PASSED SUCCESSFULLY');
    return { status: 'PASSED' };
  } else {
    console.error('✗ PREFLIGHT CHECKS FAILED');
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(process.argv[1]);
if (isMain) {
  runPreflight().catch(err => {
    console.error('Unhandled preflight error:', err);
    process.exit(1);
  });
}
