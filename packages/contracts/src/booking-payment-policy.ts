import { z } from 'zod';

export const DepositTypeSchema = z.enum(['PERCENTAGE', 'FIXED']);
export type DepositType = z.infer<typeof DepositTypeSchema>;

export const DEFAULT_DEPOSIT_PERCENTAGE = 20;
export const DEFAULT_FIXED_DEPOSIT_AMOUNT = 1_000;

export function normaliseDepositType(value: string | null | undefined): DepositType {
  return value === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
}

export function normaliseDepositPercentage(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 99
    ? Math.round(parsed)
    : DEFAULT_DEPOSIT_PERCENTAGE;
}

export function normaliseFixedDepositAmount(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 100_000_000
    ? Math.round(parsed)
    : DEFAULT_FIXED_DEPOSIT_AMOUNT;
}

export function calculateDepositAmount(
  totalMinorUnits: number,
  settings: {
    depositType?: string | null;
    depositPercentage?: number | string | null;
    depositFixedAmount?: number | string | null;
  },
): number {
  const parsedTotal = Number(totalMinorUnits);
  const total = Number.isFinite(parsedTotal) ? Math.max(0, Math.round(parsedTotal)) : 0;
  if (total === 0) return 0;

  if (normaliseDepositType(settings.depositType) === 'FIXED') {
    return Math.min(total, normaliseFixedDepositAmount(settings.depositFixedAmount));
  }

  return Math.min(total, Math.ceil(total * normaliseDepositPercentage(settings.depositPercentage) / 100));
}
