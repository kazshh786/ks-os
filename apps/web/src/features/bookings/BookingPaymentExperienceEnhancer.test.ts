import { describe, expect, it } from 'vitest';
import {
  calculateOutstandingBalance,
  DEFAULT_DEPOSIT_PERCENTAGE,
  normaliseCommitmentPaymentMode,
  normaliseDepositPercentage,
} from './BookingPaymentExperienceEnhancer.js';

describe('booking payment experience', () => {
  it('keeps only commitment-first payment modes', () => {
    expect(normaliseCommitmentPaymentMode('FULL')).toBe('FULL');
    expect(normaliseCommitmentPaymentMode('DEPOSIT')).toBe('DEPOSIT');
    expect(normaliseCommitmentPaymentMode('PAY_LATER')).toBe('DEPOSIT');
    expect(normaliseCommitmentPaymentMode('CUSTOMER_CHOICE')).toBe('DEPOSIT');
    expect(normaliseCommitmentPaymentMode('NONE')).toBe('DEPOSIT');
  });

  it('uses a safe deposit percentage that leaves a balance due later', () => {
    expect(normaliseDepositPercentage(20)).toBe(20);
    expect(normaliseDepositPercentage('35')).toBe(35);
    expect(normaliseDepositPercentage(0)).toBe(DEFAULT_DEPOSIT_PERCENTAGE);
    expect(normaliseDepositPercentage(100)).toBe(DEFAULT_DEPOSIT_PERCENTAGE);
    expect(normaliseDepositPercentage('not-a-number')).toBe(DEFAULT_DEPOSIT_PERCENTAGE);
  });

  it('calculates the remaining appointment balance without going negative', () => {
    expect(calculateOutstandingBalance(100, 20)).toBe(80);
    expect(calculateOutstandingBalance(49.99, 10)).toBe(39.99);
    expect(calculateOutstandingBalance(20, 25)).toBe(0);
  });
});
