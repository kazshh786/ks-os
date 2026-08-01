export type CommitmentPaymentMode = 'DEPOSIT' | 'FULL';

export const DEFAULT_DEPOSIT_PERCENTAGE = 20;

export function normaliseCommitmentPaymentMode(value: string | null | undefined): CommitmentPaymentMode {
  return value === 'FULL' ? 'FULL' : 'DEPOSIT';
}

export function normaliseDepositPercentage(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 99
    ? Math.round(parsed)
    : DEFAULT_DEPOSIT_PERCENTAGE;
}

export function calculateOutstandingBalance(total: number, dueNow: number): number {
  return Math.max(0, Math.round((total - dueNow) * 100) / 100);
}
