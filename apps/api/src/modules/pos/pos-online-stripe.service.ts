import { eq } from 'drizzle-orm';
import { getDatabase, stripeConnections, tenants } from '@ks-os/database';
import Stripe from 'stripe';
import { getStripeClient } from '../../lib/stripe.js';

// PR #80 introduced this bounded presentation choice in the POS service but
// referenced a contract export that does not exist. Keep the type local because
// it is an implementation detail of Stripe Checkout, not a public API payload.
type PosOnlinePaymentPresentation = 'EMBEDDED' | 'HOSTED';

const fail = (name: string, message: string) => {
  const error = new Error(message);
  error.name = name;
  return error;
};

type OnlineSaleContext =
  | { kind: 'APPOINTMENT'; appointmentId: string; idempotencyKey: string }
  | { kind: 'RETAIL'; idempotencyKey: string };

export class PosOnlineStripeService {
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
    return connection;
  }

  private applicationFeeAmount(amountInCents: number) {
    const percentageBps = Number.parseInt(process.env.STRIPE_APPLICATION_FEE_BPS || '0', 10) || 0;
    const fixedFee = Number.parseInt(process.env.STRIPE_APPLICATION_FEE_FIXED || '0', 10) || 0;
    return Math.max(0, Math.floor((amountInCents * percentageBps) / 10_000) + fixedFee);
  }

  async createSession(input: {
    tenantId: string;
    amountInCents: number;
    presentation: PosOnlinePaymentPresentation;
    context: OnlineSaleContext;
  }) {
    const connection = await this.requireReadyConnection(input.tenantId);
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      throw fail('STRIPE_PUBLISHABLE_KEY_MISSING', 'Online POS payments are not configured yet.');
    }
    if (input.amountInCents <= 0) throw fail('INVALID_PAYMENT_TOTAL', 'The payment total must be greater than zero.');

    const [tenant] = await this.db
      .select({ name: tenants.name, currency: tenants.currency })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1);
    if (!tenant) throw fail('TENANT_NOT_FOUND', 'Business account was not found.');

    const stripe = getStripeClient();
    const origin = process.env.FRONTEND_ORIGIN || process.env.PUBLIC_APP_ORIGIN || 'http://localhost:3000';
    const applicationFeeAmount = this.applicationFeeAmount(input.amountInCents);
    const metadata: Record<string, string> = {
      ks_pos: 'true',
      ks_pos_online: 'true',
      sale_kind: input.context.kind,
      tenant_id: input.tenantId,
      pos_idempotency_key: input.context.idempotencyKey,
    };
    if (input.context.kind === 'APPOINTMENT') metadata.appointment_id = input.context.appointmentId;
    else metadata.retail_sale_idempotency_key = input.context.idempotencyKey;

    const paymentIntentData = {
      metadata,
      ...(applicationFeeAmount > 0 ? { application_fee_amount: applicationFeeAmount } : {}),
    } as NonNullable<Stripe.Checkout.SessionCreateParams['payment_intent_data']>;

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      client_reference_id: input.context.kind === 'APPOINTMENT'
        ? input.context.appointmentId
        : input.context.idempotencyKey,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: tenant.currency.toLowerCase(),
          unit_amount: input.amountInCents,
          product_data: {
            name: input.context.kind === 'APPOINTMENT'
              ? `${tenant.name} appointment payment`
              : `${tenant.name} retail payment`,
            description: 'Secure point-of-sale payment created by KS OS',
          },
        },
      }],
      metadata,
      payment_intent_data: paymentIntentData,
      expires_at: Math.floor(Date.now() / 1000) + (31 * 60),
      submit_type: 'pay',
    };

    if (input.presentation === 'EMBEDDED') {
      // This Stripe API version supports embedded Checkout at runtime, while the
      // pinned SDK's generated UiMode type has not yet added the value.
      const compatibleParams = params as unknown as Record<string, unknown>;
      compatibleParams.ui_mode = 'embedded';
      compatibleParams.redirect_on_completion = 'never';
    } else {
      params.success_url = `${origin}/pos-payment-complete?session_id={CHECKOUT_SESSION_ID}`;
      params.cancel_url = `${origin}/pos-payment-complete?cancelled=1`;
    }

    const session = await stripe.checkout.sessions.create(params, {
      stripeAccount: connection.stripeAccountId,
      idempotencyKey: `pos-online-session:${input.context.idempotencyKey}:${input.presentation}`,
    });

    if (input.presentation === 'EMBEDDED' && !session.client_secret) {
      throw fail('STRIPE_ONLINE_SESSION_INVALID', 'Stripe did not return an embedded checkout secret.');
    }
    if (input.presentation === 'HOSTED' && !session.url) {
      throw fail('STRIPE_ONLINE_SESSION_INVALID', 'Stripe did not return a hosted checkout link.');
    }

    return {
      sessionId: session.id,
      presentation: input.presentation,
      clientSecret: session.client_secret || null,
      checkoutUrl: session.url || null,
      publishableKey,
      stripeAccountId: connection.stripeAccountId,
      amountInCents: session.amount_total || input.amountInCents,
      currency: (session.currency || tenant.currency).toUpperCase(),
      expiresAt: new Date(session.expires_at * 1_000).toISOString(),
    };
  }

  async getSessionStatus(tenantId: string, sessionId: string) {
    const connection = await this.requireReadyConnection(tenantId);
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ['payment_intent'] },
      { stripeAccount: connection.stripeAccountId },
    );

    if (session.metadata?.tenant_id && session.metadata.tenant_id !== tenantId) {
      throw fail('STRIPE_ONLINE_SESSION_NOT_FOUND', 'Stripe checkout session was not found for this business.');
    }

    const paymentIntent = session.payment_intent && typeof session.payment_intent !== 'string'
      ? session.payment_intent
      : null;
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : paymentIntent?.id || null;
    const succeeded = session.payment_status === 'paid' && paymentIntent?.status === 'succeeded';
    const failed = session.status === 'expired'
      || paymentIntent?.status === 'canceled'
      || Boolean(paymentIntent?.last_payment_error);

    return {
      sessionId: session.id,
      status: session.status || 'open',
      paymentStatus: session.payment_status,
      paymentIntentId,
      amountInCents: session.amount_total || 0,
      currency: (session.currency || 'gbp').toUpperCase(),
      succeeded,
      failed,
      expired: session.status === 'expired',
      failureMessage: paymentIntent?.last_payment_error?.message || null,
    };
  }
}