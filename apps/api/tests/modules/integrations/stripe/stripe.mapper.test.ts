import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deriveStripeConnectionStatus, StripeConnectionStatuses } from '../../../../src/modules/integrations/stripe/stripe.mapper.js';
import Stripe from 'stripe';

describe('stripe.mapper', () => {
  it('returns DISABLED if disabled_reason starts with rejected', () => {
    const account = {
      details_submitted: true,
      charges_enabled: false,
      payouts_enabled: false,
      requirements: {
        disabled_reason: 'rejected.fraud',
      },
    } as Stripe.Account;
    assert.strictEqual(deriveStripeConnectionStatus(account), StripeConnectionStatuses.DISABLED);
  });

  it('returns ONBOARDING if details_submitted is false', () => {
    const account = {
      details_submitted: false,
      charges_enabled: false,
      payouts_enabled: false,
      requirements: {},
    } as Stripe.Account;
    assert.strictEqual(deriveStripeConnectionStatus(account), StripeConnectionStatuses.ONBOARDING);
  });

  it('returns ACTION_REQUIRED if there are currently_due requirements and not fully active', () => {
    const account = {
      details_submitted: true,
      charges_enabled: false,
      payouts_enabled: true,
      requirements: {
        currently_due: ['external_account'],
      },
    } as Stripe.Account;
    assert.strictEqual(deriveStripeConnectionStatus(account), StripeConnectionStatuses.ACTION_REQUIRED);
  });

  it('returns RESTRICTED if there are currently_due requirements but fully active', () => {
    const account = {
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
      requirements: {
        currently_due: ['some_document'],
      },
    } as Stripe.Account;
    assert.strictEqual(deriveStripeConnectionStatus(account), StripeConnectionStatuses.RESTRICTED);
  });

  it('returns PENDING_VERIFICATION if details submitted, no due requirements, but not enabled', () => {
    const account = {
      details_submitted: true,
      charges_enabled: false,
      payouts_enabled: false,
      requirements: {
        currently_due: [],
        past_due: [],
      },
    } as Stripe.Account;
    assert.strictEqual(deriveStripeConnectionStatus(account), StripeConnectionStatuses.PENDING_VERIFICATION);
  });

  it('returns READY if fully enabled with no issues', () => {
    const account = {
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
      requirements: {
        currently_due: [],
        past_due: [],
      },
    } as Stripe.Account;
    assert.strictEqual(deriveStripeConnectionStatus(account), StripeConnectionStatuses.READY);
  });
});
