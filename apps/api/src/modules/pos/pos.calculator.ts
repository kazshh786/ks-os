import type { PaymentMethod, PaymentComponentInput, SplitPaymentAmounts } from '@ks-os/contracts';

export function calculateGrandTotal(serviceAmountInCents: number, retailAmountInCents: number, tipAmountInCents: number): number {
  return serviceAmountInCents + retailAmountInCents + tipAmountInCents;
}

export function validatePaymentComponents(grandTotalInCents: number, components: PaymentComponentInput[]): void {
  if (!components || components.length === 0) {
    if (grandTotalInCents > 0) {
       const err = new Error('Payment components are required when total > 0');
       err.name = 'INVALID_PAYMENT_COMPONENTS';
       throw err;
    }
    return;
  }
  
  let componentTotal = 0;
  for (const comp of components) {
    if (comp.amountInCents <= 0) {
      const err = new Error('Payment component amount must be positive');
      err.name = 'INVALID_PAYMENT_COMPONENT_AMOUNT';
      throw err;
    }
    
    // Prevent submitting integrated methods
    if (comp.method as any === 'STRIPE_ONLINE' || comp.method as any === 'STRIPE_TERMINAL') {
       const err = new Error('Cannot submit integrated payment methods via POS');
       err.name = 'INVALID_PAYMENT_COMPONENT_METHOD';
       throw err;
    }
    
    if (comp.method === 'EXTERNAL_CARD' && !comp.externalProvider) {
      const err = new Error('EXTERNAL_CARD requires an external provider');
      err.name = 'MISSING_EXTERNAL_PROVIDER';
      throw err;
    }
    
    if (comp.externalProvider === 'OTHER' && !comp.externalProviderName) {
      const err = new Error('Custom provider name is required when externalProvider is OTHER');
      err.name = 'MISSING_PROVIDER_NAME';
      throw err;
    }
    
    if (comp.method === 'OTHER' && !comp.methodDescription) {
      const err = new Error('methodDescription is required when method is OTHER');
      err.name = 'MISSING_METHOD_DESCRIPTION';
      throw err;
    }
    
    componentTotal += comp.amountInCents;
  }
  
  if (componentTotal !== grandTotalInCents) {
    const err = new Error('Sum of payment components must exactly equal the grand total');
    err.name = 'INVALID_PAYMENT_TOTAL';
    throw err;
  }
}

export function normalizePaymentMethod(method: PaymentMethod): PaymentMethod {
  if (method === 'CARD') return 'EXTERNAL_CARD';
  return method;
}

export function getFinalPaymentComponents(
  paymentMethod: PaymentMethod, 
  grandTotalInCents: number, 
  components?: PaymentComponentInput[],
  legacySplitAmounts?: SplitPaymentAmounts
): PaymentComponentInput[] {
  const method = normalizePaymentMethod(paymentMethod);
  
  // Reject integrated methods
  if (method === 'STRIPE_ONLINE' || method === 'STRIPE_TERMINAL') {
    const err = new Error('Cannot submit integrated payment methods via POS');
    err.name = 'INVALID_PAYMENT_METHOD';
    throw err;
  }

  if (components && components.length > 0) {
    return components;
  }

  if (method === 'SPLIT' && legacySplitAmounts) {
    const comps: PaymentComponentInput[] = [];
    if (legacySplitAmounts.cashInCents > 0) {
      comps.push({ method: 'CASH', amountInCents: legacySplitAmounts.cashInCents });
    }
    if (legacySplitAmounts.cardInCents > 0) {
      comps.push({ method: 'EXTERNAL_CARD', amountInCents: legacySplitAmounts.cardInCents, externalProvider: 'OTHER', externalProviderName: 'Legacy POS' });
    }
    return comps;
  }
  
  // Single payment method
  if (method === 'CASH' || method === 'BANK_TRANSFER' || method === 'EXTERNAL_CARD' || method === 'OTHER') {
     const comp: PaymentComponentInput = {
       method: method,
       amountInCents: grandTotalInCents
     };
     if (method === 'EXTERNAL_CARD') {
       comp.externalProvider = 'OTHER';
       comp.externalProviderName = 'Legacy POS';
     }
     if (method === 'OTHER') {
       comp.methodDescription = 'Legacy POS OTHER';
     }
     return [comp];
  }
  
  return [];
}

export function validatePaymentMethod(
  paymentMethod: PaymentMethod, 
  grandTotalInCents: number, 
  components?: PaymentComponentInput[],
  legacySplitAmounts?: SplitPaymentAmounts
): void {
  const finalComponents = getFinalPaymentComponents(paymentMethod, grandTotalInCents, components, legacySplitAmounts);
  validatePaymentComponents(grandTotalInCents, finalComponents);
}

