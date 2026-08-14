export {
  calculateDepositAmount,
  DEFAULT_DEPOSIT_PERCENTAGE,
  DEFAULT_FIXED_DEPOSIT_AMOUNT,
  normaliseDepositPercentage,
  normaliseDepositType,
  normaliseFixedDepositAmount,
} from '@ks-os/contracts';

export type CommitmentPaymentMode = 'DEPOSIT' | 'FULL';

export function normaliseCommitmentPaymentMode(value: string | null | undefined): CommitmentPaymentMode {
  return value === 'FULL' ? 'FULL' : 'DEPOSIT';
}

export function calculateOutstandingBalance(total: number, dueNow: number): number {
  return Math.max(0, Math.round((total - dueNow) * 100) / 100);
}
