export function calculateGrandTotal(serviceAmountInCents: number, retailAmountInCents: number, tipAmountInCents: number): number {
  return serviceAmountInCents + retailAmountInCents + tipAmountInCents;
}

export function validateSplitAmounts(grandTotalInCents: number, cashInCents?: number, cardInCents?: number): void {
  if (cashInCents === undefined || cardInCents === undefined) {
    const err = new Error('SPLIT payment requires splitAmounts');
    err.name = 'INVALID_PAYMENT_SPLIT';
    throw err;
  }
  if (cashInCents <= 0 || cardInCents <= 0) {
    const err = new Error('SPLIT payment requires cashAmount > 0 and cardAmount > 0');
    err.name = 'INVALID_PAYMENT_SPLIT';
    throw err;
  }
  const splitTotal = cashInCents + cardInCents;
  if (splitTotal !== grandTotalInCents) {
    const err = new Error('Split payment amounts do not match authoritative grand total');
    err.name = 'INVALID_PAYMENT_SPLIT';
    throw err;
  }
}

export function validatePaymentMethod(paymentMethod: 'CASH' | 'CARD' | 'SPLIT', grandTotalInCents: number, splitAmounts?: { cashInCents: number; cardInCents: number }): void {
  if (paymentMethod === 'CASH') {
    if (splitAmounts && (splitAmounts.cardInCents > 0 || splitAmounts.cashInCents !== grandTotalInCents)) {
      const err = new Error('CASH payment requires cashAmount = totalAmount and cardAmount = 0');
      err.name = 'INVALID_PAYMENT_METHOD';
      throw err;
    }
  } else if (paymentMethod === 'CARD') {
    if (splitAmounts && (splitAmounts.cashInCents > 0 || splitAmounts.cardInCents !== grandTotalInCents)) {
      const err = new Error('CARD payment requires cardAmount = totalAmount and cashAmount = 0');
      err.name = 'INVALID_PAYMENT_METHOD';
      throw err;
    }
  } else if (paymentMethod === 'SPLIT') {
    validateSplitAmounts(grandTotalInCents, splitAmounts?.cashInCents, splitAmounts?.cardInCents);
  }
}

export function getFinalSplitAmounts(paymentMethod: 'CASH' | 'CARD' | 'SPLIT', grandTotalInCents: number, splitAmounts?: { cashInCents: number; cardInCents: number }) {
  if (paymentMethod === 'SPLIT' && splitAmounts) {
    return splitAmounts;
  }
  if (paymentMethod === 'CASH') {
    return { cashInCents: grandTotalInCents, cardInCents: 0 };
  }
  return { cashInCents: 0, cardInCents: grandTotalInCents };
}
