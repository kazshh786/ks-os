import { describe, expect, it } from 'vitest';
import {
  calculateDepositAmount,
  calculateOutstandingBalance,
  DEFAULT_DEPOSIT_PERCENTAGE,
  DEFAULT_FIXED_DEPOSIT_AMOUNT,
  normaliseCommitmentPaymentMode,
  normaliseDepositPercentage,
  normaliseDepositType,
  normaliseFixedDepositAmount,
} from './booking-payment-policy.js';

describe('booking payment experience', () => {
  it('keeps only commitment-first payment modes', () => {
    expect(normaliseCommitmentPaymentMode('FULL')).toBe('FULL');
    expect(normaliseCommitmentPaymentMode('DEPOSIT')).toBe('DEPOSIT');
    expect(normaliseCommitmentPaymentMode('PAY_LATER')).toBe('DEPOSIT');
    expect(normaliseCommitmentPaymentMode('CUSTOMER_CHOICE')).toBe('DEPOSIT');
  });

  it('normalises percentage and fixed deposit settings safely', () => {
    expect(normaliseDepositType('FIXED')).toBe('FIXED');
    expect(normaliseDepositType('unknown')).toBe('PERCENTAGE');
    expect(normaliseDepositPercentage('35')).toBe(35);
    expect(normaliseDepositPercentage(0)).toBe(DEFAULT_DEPOSIT_PERCENTAGE);
    expect(normaliseDepositPercentage(100)).toBe(DEFAULT_DEPOSIT_PERCENTAGE);
    expect(normaliseFixedDepositAmount(1_500)).toBe(1_500);
    expect(normaliseFixedDepositAmount(0)).toBe(DEFAULT_FIXED_DEPOSIT_AMOUNT);
  });

  it('calculates percentage deposits in minor currency units', () => {
    expect(calculateDepositAmount(5_000, { depositType: 'PERCENTAGE', depositPercentage: 20 })).toBe(1_000);
    expect(calculateDepositAmount(4_999, { depositType: 'PERCENTAGE', depositPercentage: 20 })).toBe(1_000);
  });

  it('supports a fixed £10 deposit without charging more than the service total', () => {
    expect(calculateDepositAmount(5_000, { depositType: 'FIXED', depositFixedAmount: 1_000 })).toBe(1_000);
    expect(calculateDepositAmount(750, { depositType: 'FIXED', depositFixedAmount: 1_000 })).toBe(750);
  });

  it('falls back to the safe fixed amount when a stored value is invalid', () => {
    expect(calculateDepositAmount(5_000, { depositType: 'FIXED', depositFixedAmount: 0 })).toBe(DEFAULT_FIXED_DEPOSIT_AMOUNT);
  });

  it('calculates the remaining appointment balance without going negative', () => {
    expect(calculateOutstandingBalance(100, 20)).toBe(80);
    expect(calculateOutstandingBalance(49.99, 10)).toBe(39.99);
    expect(calculateOutstandingBalance(20, 25)).toBe(0);
  });
});
