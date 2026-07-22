import { describe, it, expect } from 'vitest';
import { buildReconciliationReport, EXPECTED_MISSING_TABLES } from '../../scripts/database/reconcile.mjs';

describe('Phase 2 & 3 Schema Reconciliation Tests', () => {
  it('should accurately classify missing tables without false positive "public" table', () => {
    const mockLiveTables = [
      'tenants',
      'users',
      'appointments',
      'clients'
    ];

    const report = buildReconciliationReport({ liveTables: mockLiveTables });

    expect(report.incompatibleCount).toBe(0);
    expect(report.missingTablesCount).toBe(13);

    // Verify "public" table false positive check
    const publicTableEntry = report.tableAnalysis.find((t: any) => t.table === 'public');
    expect(publicTableEntry).toBeUndefined();
  });

  it('should detect when all expected missing tables are matched', () => {
    const mockLiveTables = [...EXPECTED_MISSING_TABLES];
    const report = buildReconciliationReport({ liveTables: mockLiveTables });

    expect(report.missingTablesCount).toBe(0);
    expect(report.matchedTablesCount).toBe(13);
  });

  it('should flag a table named "public" as INCOMPATIBLE', () => {
    const mockLiveTables = ['public'];
    const report = buildReconciliationReport({ liveTables: mockLiveTables });

    expect(report.incompatibleCount).toBe(1);
    const item = report.tableAnalysis.find((t: any) => t.table === 'public');
    expect(item.classification).toBe('INCOMPATIBLE');
  });
});
