import Stripe from 'stripe';

export const StripeConnectionStatuses = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  ONBOARDING: 'ONBOARDING',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  READY: 'READY',
  RESTRICTED: 'RESTRICTED',
  DISABLED: 'DISABLED',
} as const;

export type StripeConnectionStatus = typeof StripeConnectionStatuses[keyof typeof StripeConnectionStatuses];

export function deriveStripeConnectionStatus(account: Stripe.Account): string {
  const { details_submitted, charges_enabled, payouts_enabled, requirements } = account;

  const disabledReason = requirements?.disabled_reason;

  if (disabledReason && disabledReason.startsWith('rejected')) {
    return StripeConnectionStatuses.DISABLED;
  }

  if (!details_submitted) {
    return StripeConnectionStatuses.ONBOARDING;
  }

  const currentlyDue = requirements?.currently_due || [];
  const pastDue = requirements?.past_due || [];

  if (currentlyDue.length > 0 || pastDue.length > 0) {
    // If account is fully active but has requirements, we call it restricted, else action required
    if (charges_enabled && payouts_enabled) {
      return StripeConnectionStatuses.RESTRICTED;
    }
    return StripeConnectionStatuses.ACTION_REQUIRED;
  }

  if (!charges_enabled || !payouts_enabled) {
    if (disabledReason) {
       return StripeConnectionStatuses.RESTRICTED;
    }
    return StripeConnectionStatuses.PENDING_VERIFICATION;
  }

  if (disabledReason) {
    return StripeConnectionStatuses.RESTRICTED;
  }

  return StripeConnectionStatuses.READY;
}
