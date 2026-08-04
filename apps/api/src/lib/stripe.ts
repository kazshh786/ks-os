import Stripe from 'stripe';

let stripeClient: Stripe | null = null;
let stripeClientSecret: string | null = null;

export type StripeMode = 'test' | 'live';

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
