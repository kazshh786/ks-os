import Stripe from 'stripe';

let stripeClient: Stripe | null = null;
let stripeClientSecret: string | null = null;

export type StripeMode = 'test' | 'live';

const STRIPE_MINIMUM_CHARGE_MINOR: Record<'GBP' | 'USD' | 'EUR', number> = {
  GBP: 30,
  USD: 50,
  EUR: 50,
};
const STRIPE_MAXIMUM_CHARGE_MINOR = 99_999_999;

const keyMode = (value: string, kind: 'secret' | 'publishable'): StripeMode | null => {
  const testPrefix = kind === 'secret' ? 'sk_test_' : 'pk_test_';
  const livePrefix = kind === 'secret' ? 'sk_live_' : 'pk_live_';
  if (value.startsWith(testPrefix)) return 'test';
  if (value.startsWith(livePrefix)) return 'live';
  return null;
};

const configurationError = (name: string, message: string) => {
  const error = new Error(message);
  error.name = name;
  return error;
};

const paymentAmountError = (message: string) => {
  const error = configurationError('STRIPE_PAYMENT_AMOUNT_INVALID', message) as Error & { code?: string };
  error.code = 'STRIPE_PAYMENT_AMOUNT_INVALID';
  return error;
};

export function assertStripeCheckoutAmount(amount: number, currency: string): void {
  const normalizedCurrency = currency.trim().toUpperCase();
  const minimum = STRIPE_MINIMUM_CHARGE_MINOR[normalizedCurrency as keyof typeof STRIPE_MINIMUM_CHARGE_MINOR];

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw paymentAmountError('The Stripe payment total must be a positive amount in minor currency units.');
  }
  if (minimum === undefined) {
    throw paymentAmountError(`Stripe payments are not configured for ${normalizedCurrency || 'this currency'}.`);
  }
  if (amount < minimum) {
    throw paymentAmountError(`Stripe requires at least ${minimum} minor units for ${normalizedCurrency} payments.`);
  }
  if (amount > STRIPE_MAXIMUM_CHARGE_MINOR) {
    throw paymentAmountError(`The ${normalizedCurrency} payment exceeds Stripe's maximum supported amount.`);
  }
}

export function getStripePublishableKey(): string | null {
  const configured = process.env.STRIPE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const value = configured?.trim();
  return value || null;
}

export function getStripeConfiguredMode(): StripeMode {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw configurationError('STRIPE_NOT_CONFIGURED', 'STRIPE_SECRET_KEY environment variable is missing.');
  }

  const secretMode = keyMode(secretKey, 'secret');
  if (!secretMode) {
    throw configurationError('STRIPE_NOT_CONFIGURED', 'STRIPE_SECRET_KEY environment variable is invalid.');
  }

  const publishableKey = getStripePublishableKey();
  if (publishableKey) {
    const publishableMode = keyMode(publishableKey, 'publishable');
    if (!publishableMode) {
      throw configurationError('STRIPE_NOT_CONFIGURED', 'STRIPE_PUBLISHABLE_KEY environment variable is invalid.');
    }
    if (publishableMode !== secretMode) {
      throw configurationError(
        'STRIPE_KEY_MODE_MISMATCH',
        'Stripe secret and publishable keys must both be live or both be test keys.',
      );
    }
  }

  return secretMode;
}

export function getStripeClient(): Stripe {
  getStripeConfiguredMode();
  const secretKey = process.env.STRIPE_SECRET_KEY!.trim();
  if (stripeClient && stripeClientSecret === secretKey) return stripeClient;

  stripeClient = new Stripe(secretKey, {
    apiVersion: '2026-06-24.dahlia',
  });
  stripeClientSecret = secretKey;

  return stripeClient;
}

export async function assertStripeConnectedAccountReady(stripeAccountId: string): Promise<Stripe.Account> {
  let account: Stripe.Account | Stripe.DeletedAccount;

  try {
    account = await getStripeClient().accounts.retrieve(stripeAccountId);
  } catch {
    const error = new Error('The connected Stripe account is not available for the active Stripe environment.');
    error.name = 'STRIPE_ACCOUNT_NOT_READY';
    throw error;
  }

  if ('deleted' in account || !account.charges_enabled) {
    const error = new Error('The connected Stripe account is not ready to take payments.');
    error.name = 'STRIPE_ACCOUNT_NOT_READY';
    throw error;
  }

  return account;
}
