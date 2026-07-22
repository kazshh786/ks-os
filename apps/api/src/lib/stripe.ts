import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is missing.');
  }

  stripeClient = new Stripe(secretKey, {
    apiVersion: '2026-06-24.dahlia',
  });

  return stripeClient;
}
