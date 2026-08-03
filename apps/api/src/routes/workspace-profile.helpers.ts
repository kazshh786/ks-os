export type BusinessPaymentPolicy = 'NoPayment' | 'PayLater' | 'Deposit' | 'FullPayment' | 'CustomerChoice';

export function paymentPolicyToMode(policy: BusinessPaymentPolicy): string {
  switch (policy) {
    case 'Deposit': return 'deposit';
    case 'FullPayment': return 'full_payment';
    case 'CustomerChoice': return 'customer_choice';
    case 'NoPayment':
    case 'PayLater':
    default:
      return 'pay_later';
  }
}

export function modeToPaymentPolicy(mode: string | null | undefined): BusinessPaymentPolicy {
  switch (mode) {
    case 'deposit': return 'Deposit';
    case 'full_payment': return 'FullPayment';
    case 'customer_choice': return 'CustomerChoice';
    case 'pay_later':
    default:
      return 'PayLater';
  }
}

export function splitBusinessAddress(value: string): { address: string; postcode: string } {
  const normalised = value.trim().replace(/\s+/g, ' ');
  if (!normalised) return { address: '', postcode: '' };

  const postcodeMatch = normalised.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i);
  if (!postcodeMatch) return { address: normalised, postcode: '' };

  const postcode = postcodeMatch[1]
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^(.*?)(\d[A-Z]{2})$/, '$1 $2')
    .trim();
  const address = normalised.slice(0, postcodeMatch.index).replace(/[\s,]+$/, '').trim();
  return { address, postcode };
}
