import { eq } from 'drizzle-orm';
import { getDatabase, stripeConnections, tenants } from '@ks-os/database';
import { assertStripeCheckoutAmount, assertStripeConnectedAccountReady, getStripeClient } from '../../lib/stripe.js';

const fail = (name: string, message: string) => {
  const error = new Error(message);
  error.name = name;
  return error;
};

const MOBILE_READER_TYPES = new Set([
  'bbpos_wisepad3',
  'stripe_m2',
  'chipper_2x',
  'chipper_1x',
  'tap_to_pay',
]);

export class RetailPosStripeService {
  private readonly db = getDatabase();

  private async requireReadyConnection(tenantId: string) {
    const [connection] = await this.db
      .select()
      .from(stripeConnections)
      .where(eq(stripeConnections.tenantId, tenantId))
      .limit(1);

    if (!connection) throw fail('STRIPE_CONNECTION_NOT_FOUND', 'Stripe is not connected for this business.');
    if (connection.connectionStatus !== 'READY' || !connection.chargesEnabled) {
      throw fail('STRIPE_ACCOUNT_NOT_READY', 'The connected Stripe account is not ready to take payments.');
    }
    await assertStripeConnectedAccountReady(connection.stripeAccountId);
    return connection;
  }

  async startReaderPayment(input: {
    tenantId: string;
    readerId: string;
    amountInCents: number;
    idempotencyKey: string;
  }) {
    const connection = await this.requireReadyConnection(input.tenantId);
    const stripe = getStripeClient();
    const [tenant] = await this.db
      .select({ currency: tenants.currency, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1);

    if (!tenant) throw fail('TENANT_NOT_FOUND', 'Business account was not found.');
    if (input.amountInCents <= 0) throw fail('INVALID_PAYMENT_TOTAL', 'The payment total must be greater than zero.');
    assertStripeCheckoutAmount(input.amountInCents, tenant.currency);

    const reader = await stripe.terminal.readers.retrieve(
      input.readerId,
      {},
      { stripeAccount: connection.stripeAccountId },
    );
    if ('deleted' in reader) throw fail('STRIPE_READER_NOT_FOUND', 'The selected Stripe reader is no longer available.');

    const deviceType = String(reader.device_type || 'unknown').toLowerCase();
    if (MOBILE_READER_TYPES.has(deviceType)) {
      throw fail('STRIPE_READER_NOT_SERVER_DRIVEN', 'This reader is managed from Stripe on the mobile device. Use Tap to Pay or manual terminal confirmation instead.');
    }
    if (reader.status !== 'online') throw fail('STRIPE_READER_OFFLINE', 'The selected Stripe reader is offline.');
    if (reader.action?.status === 'in_progress') throw fail('STRIPE_READER_BUSY', 'The selected Stripe reader is already processing another action.');

    const percentageBps = Number.parseInt(process.env.STRIPE_APPLICATION_FEE_BPS || '0', 10) || 0;
    const fixedFee = Number.parseInt(process.env.STRIPE_APPLICATION_FEE_FIXED || '0', 10) || 0;
    const applicationFeeAmount = Math.min(input.amountInCents, Math.max(0, Math.floor((input.amountInCents * percentageBps) / 10000) + fixedFee));

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: input.amountInCents,
        currency: tenant.currency.toLowerCase(),
        payment_method_types: ['card_present'],
        description: `${tenant.name} retail point of sale`,
        metadata: {
          ks_pos: 'true',
          ks_retail_sale: 'true',
          tenant_id: input.tenantId,
          retail_sale_idempotency_key: input.idempotencyKey,
        },
        ...(applicationFeeAmount > 0 ? { application_fee_amount: applicationFeeAmount } : {}),
      },
      {
        stripeAccount: connection.stripeAccountId,
        idempotencyKey: `retail-pos-payment-intent:${input.idempotencyKey}`,
      },
    );

    try {
      await stripe.terminal.readers.processPaymentIntent(
        input.readerId,
        {
          payment_intent: paymentIntent.id,
          process_config: { enable_customer_cancellation: true, skip_tipping: true },
        },
        { stripeAccount: connection.stripeAccountId },
      );
    } catch (error) {
      await stripe.paymentIntents.cancel(paymentIntent.id, {}, { stripeAccount: connection.stripeAccountId }).catch(() => undefined);
      throw error;
    }

    return {
      paymentIntentId: paymentIntent.id,
      readerId: input.readerId,
      amountInCents: paymentIntent.amount,
      currency: paymentIntent.currency.toUpperCase(),
      status: paymentIntent.status,
    };
  }

  async assertPaymentSucceeded(input: {
    tenantId: string;
    idempotencyKey: string;
    paymentIntentId: string;
    expectedAmountInCents: number;
  }) {
    const connection = await this.requireReadyConnection(input.tenantId);
    const stripe = getStripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(
      input.paymentIntentId,
      {},
      { stripeAccount: connection.stripeAccountId },
    );

    const tenantMatches = !paymentIntent.metadata?.tenant_id || paymentIntent.metadata.tenant_id === input.tenantId;
    const saleMatches = !paymentIntent.metadata?.retail_sale_idempotency_key
      || paymentIntent.metadata.retail_sale_idempotency_key === input.idempotencyKey;
    if (!tenantMatches || !saleMatches) throw fail('STRIPE_PAYMENT_MISMATCH', 'The Stripe payment does not belong to this retail sale.');
    if (paymentIntent.status !== 'succeeded') throw fail('STRIPE_PAYMENT_NOT_SUCCEEDED', 'Stripe has not confirmed this payment as successful.');
    if (paymentIntent.amount !== input.expectedAmountInCents || paymentIntent.amount_received < input.expectedAmountInCents) {
      throw fail('STRIPE_PAYMENT_AMOUNT_MISMATCH', 'The Stripe payment amount does not match the POS total.');
    }
    return paymentIntent;
  }
}
