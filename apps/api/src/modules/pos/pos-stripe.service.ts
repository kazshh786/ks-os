import { eq } from 'drizzle-orm';
import { getDatabase, stripeConnections, tenants } from '@ks-os/database';
import { getStripeClient } from '../../lib/stripe.js';

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

const maskStripeAccountId = (id: string | null | undefined) => {
  if (!id) return null;
  const clean = id.replace(/^acct_/, '');
  return `acct_••••${clean.slice(-4)}`;
};

export class PosStripeService {
  private readonly db = getDatabase();

  private async requireReadyConnection(tenantId: string) {
    const [connection] = await this.db
      .select()
      .from(stripeConnections)
      .where(eq(stripeConnections.tenantId, tenantId))
      .limit(1);

    if (!connection) {
      throw fail('STRIPE_CONNECTION_NOT_FOUND', 'Stripe is not connected for this business.');
    }
    if (connection.connectionStatus !== 'READY' || !connection.chargesEnabled) {
      throw fail('STRIPE_ACCOUNT_NOT_READY', 'The connected Stripe account is not ready to take payments.');
    }

    return connection;
  }

  async getConnectionSummary(tenantId: string) {
    const [connection] = await this.db
      .select()
      .from(stripeConnections)
      .where(eq(stripeConnections.tenantId, tenantId))
      .limit(1);

    return {
      connected: Boolean(connection),
      ready: Boolean(connection && connection.connectionStatus === 'READY' && connection.chargesEnabled),
      accountIdMasked: maskStripeAccountId(connection?.stripeAccountId),
    };
  }

  async listReaders(tenantId: string) {
    const connection = await this.requireReadyConnection(tenantId);
    const stripe = getStripeClient();
    const readers = await stripe.terminal.readers.list(
      { limit: 100 },
      { stripeAccount: connection.stripeAccountId },
    );

    return readers.data.map((reader) => {
      const deviceType = String(reader.device_type || 'unknown').toLowerCase();
      return {
        id: reader.id,
        label: reader.label || 'Stripe reader',
        status: reader.status || 'unknown',
        deviceType,
        locationId: typeof reader.location === 'string' ? reader.location : null,
        serialNumber: reader.serial_number || null,
        online: reader.status === 'online',
        supportsServerDriven: !MOBILE_READER_TYPES.has(deviceType),
      };
    });
  }

  async startReaderPayment(input: {
    tenantId: string;
    appointmentId: string;
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

    const reader = await stripe.terminal.readers.retrieve(
      input.readerId,
      {},
      { stripeAccount: connection.stripeAccountId },
    );
    if ('deleted' in reader) {
      throw fail('STRIPE_READER_NOT_FOUND', 'The selected Stripe reader is no longer available.');
    }

    const deviceType = String(reader.device_type || 'unknown').toLowerCase();
    if (MOBILE_READER_TYPES.has(deviceType)) {
      throw fail(
        'STRIPE_READER_NOT_SERVER_DRIVEN',
        'This reader is managed from Stripe on the mobile device. Use Tap to Pay or manual terminal confirmation instead.',
      );
    }
    if (reader.status !== 'online') {
      throw fail('STRIPE_READER_OFFLINE', 'The selected Stripe reader is offline.');
    }
    if (reader.action?.status === 'in_progress') {
      throw fail('STRIPE_READER_BUSY', 'The selected Stripe reader is already processing another action.');
    }

    const percentageBps = Number.parseInt(process.env.STRIPE_APPLICATION_FEE_BPS || '0', 10) || 0;
    const fixedFee = Number.parseInt(process.env.STRIPE_APPLICATION_FEE_FIXED || '0', 10) || 0;
    const applicationFeeAmount = Math.max(0, Math.floor((input.amountInCents * percentageBps) / 10000) + fixedFee);

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: input.amountInCents,
        currency: tenant.currency.toLowerCase(),
        payment_method_types: ['card_present'],
        description: `${tenant.name} point of sale`,
        metadata: {
          ks_pos: 'true',
          tenant_id: input.tenantId,
          appointment_id: input.appointmentId,
          pos_idempotency_key: input.idempotencyKey,
        },
        ...(applicationFeeAmount > 0 ? { application_fee_amount: applicationFeeAmount } : {}),
      },
      {
        stripeAccount: connection.stripeAccountId,
        idempotencyKey: `pos-payment-intent:${input.idempotencyKey}`,
      },
    );

    try {
      await stripe.terminal.readers.processPaymentIntent(
        input.readerId,
        {
          payment_intent: paymentIntent.id,
          process_config: {
            enable_customer_cancellation: true,
            skip_tipping: true,
          },
        },
        { stripeAccount: connection.stripeAccountId },
      );
    } catch (error) {
      await stripe.paymentIntents.cancel(
        paymentIntent.id,
        {},
        { stripeAccount: connection.stripeAccountId },
      ).catch(() => undefined);
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

  async getPaymentStatus(tenantId: string, paymentIntentId: string) {
    const connection = await this.requireReadyConnection(tenantId);
    const stripe = getStripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      {},
      { stripeAccount: connection.stripeAccountId },
    );

    if (paymentIntent.metadata?.tenant_id && paymentIntent.metadata.tenant_id !== tenantId) {
      throw fail('STRIPE_PAYMENT_NOT_FOUND', 'Stripe payment was not found for this business.');
    }

    const failureMessage = paymentIntent.last_payment_error?.message || null;
    return {
      paymentIntentId: paymentIntent.id,
      amountInCents: paymentIntent.amount,
      amountReceivedInCents: paymentIntent.amount_received,
      currency: paymentIntent.currency.toUpperCase(),
      status: paymentIntent.status,
      succeeded: paymentIntent.status === 'succeeded',
      failed: paymentIntent.status === 'canceled' || Boolean(paymentIntent.last_payment_error),
      failureMessage,
    };
  }

  async assertPaymentSucceeded(input: {
    tenantId: string;
    appointmentId: string;
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
    const appointmentMatches = !paymentIntent.metadata?.appointment_id || paymentIntent.metadata.appointment_id === input.appointmentId;
    if (!tenantMatches || !appointmentMatches) {
      throw fail('STRIPE_PAYMENT_MISMATCH', 'The Stripe payment does not belong to this sale.');
    }
    if (paymentIntent.status !== 'succeeded') {
      throw fail('STRIPE_PAYMENT_NOT_SUCCEEDED', 'Stripe has not confirmed this payment as successful.');
    }
    if (paymentIntent.amount !== input.expectedAmountInCents || paymentIntent.amount_received < input.expectedAmountInCents) {
      throw fail('STRIPE_PAYMENT_AMOUNT_MISMATCH', 'The Stripe payment amount does not match the POS total.');
    }

    return paymentIntent;
  }
}
