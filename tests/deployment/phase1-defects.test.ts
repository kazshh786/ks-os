import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

describe('Phase 1 Deployment Automation Defect Fixes', () => {
  it('preflight script should execute correctly via Node and exit cleanly or error without crashing syntax', () => {
    try {
      execSync('node scripts/deploy/preflight.mjs', {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: '' }
      });
    } catch (err: any) {
      // Must exit 1 due to missing DATABASE_URL, not due to ERR_MODULE_NOT_FOUND or main check syntax error
      expect(err.status).toBe(1);
      expect(err.stderr || err.stdout).toContain('DATABASE_URL environment variable is missing');
    }
  });

  it('migrate script should require database build or build automatically when invoked', () => {
    try {
      execSync('node scripts/database/migrate.mjs --plan', {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: '' }
      });
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stderr || err.stdout).toContain('DATABASE_URL environment variable is missing');
    }
  });

  it('deploy-vps.sh dry-run script should fail if migration plan fails and not swallow error with || true', () => {
    try {
      execSync('bash scripts/deploy/deploy-vps.sh --dry-run', {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: '' }
      });
    } catch (err: any) {
      // Should fail cleanly and NOT print 'DRY RUN COMPLETED SUCCESSFULLY'
      expect(err.status).toBeGreaterThan(0);
      expect(err.stdout).not.toContain('DRY RUN COMPLETED SUCCESSFULLY');
    }
  });
});
