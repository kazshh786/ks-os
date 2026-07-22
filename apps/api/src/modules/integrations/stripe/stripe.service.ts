import { StripeRepository } from './stripe.repository.js';
import { getStripeClient } from '../../../lib/stripe.js';
import { deriveStripeConnectionStatus } from './stripe.mapper.js';

export class StripeService {
  private repo = new StripeRepository();

  async getConnection(tenantId: string) {
    return this.repo.getConnection(tenantId);
  }

  async connectAccount(tenantId: string) {
    let connection = await this.repo.getConnection(tenantId);
    const stripe = getStripeClient();

    if (!connection) {
      let account;
      try {
        account = await stripe.accounts.create({
          type: 'standard',
          country: process.env.STRIPE_DEFAULT_CONNECTED_ACCOUNT_COUNTRY || 'GB',
        });
      } catch (err) {
        throw new Error('STRIPE_ACCOUNT_CREATE_FAILED');
      }

      connection = await this.repo.upsertConnection({
        tenantId,
        stripeAccountId: account.id,
        accountType: 'standard',
        connectionStatus: deriveStripeConnectionStatus(account),
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        currentlyDue: account.requirements?.currently_due || [],
        eventuallyDue: account.requirements?.eventually_due || [],
        pastDue: account.requirements?.past_due || [],
        disabledReason: account.requirements?.disabled_reason || null,
      });
    }

    return connection;
  }

  async createOnboardingLink(tenantId: string) {
    const connection = await this.repo.getConnection(tenantId);
    if (!connection) {
      throw new Error('STRIPE_CONNECTION_NOT_FOUND');
    }

    const stripe = getStripeClient();
    try {
      const accountLink = await stripe.accountLinks.create({
        account: connection.stripeAccountId,
        refresh_url: process.env.STRIPE_CONNECT_REFRESH_URL,
        return_url: process.env.STRIPE_CONNECT_RETURN_URL,
        type: 'account_onboarding',
      });
      return accountLink.url;
    } catch (err) {
      throw new Error('STRIPE_ONBOARDING_LINK_FAILED');
    }
  }

  async syncConnection(tenantId: string) {
    const connection = await this.repo.getConnection(tenantId);
    if (!connection) {
      throw new Error('STRIPE_CONNECTION_NOT_FOUND');
    }

    const stripe = getStripeClient();
    let account;
    try {
      account = await stripe.accounts.retrieve(connection.stripeAccountId);
    } catch (err) {
      throw new Error('STRIPE_ACCOUNT_RETRIEVE_FAILED');
    }

    let updated;
    try {
      updated = await this.repo.upsertConnection({
        tenantId,
        stripeAccountId: account.id,
        accountType: connection.accountType,
        connectionStatus: deriveStripeConnectionStatus(account),
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        currentlyDue: account.requirements?.currently_due || [],
        eventuallyDue: account.requirements?.eventually_due || [],
        pastDue: account.requirements?.past_due || [],
        disabledReason: account.requirements?.disabled_reason || null,
      });
    } catch (err) {
      throw new Error('STRIPE_SYNC_FAILED');
    }

    return updated;
  }

  async createBookingPaymentSession(
    tenantId: string,
    appointmentId: string,
    publicBookingReference: string,
    idempotencyKey: string,
    amount: number,
    currency: string
  ) {
    const connection = await this.repo.getConnection(tenantId);
    if (!connection || connection.connectionStatus !== 'READY' || !connection.chargesEnabled) {
      throw new Error('STRIPE_ACCOUNT_NOT_READY');
    }

    const { getDatabase, tenants } = await import('@ks-os/database');
    const { eq } = await import('drizzle-orm');
    const db = getDatabase();
    const [tenant] = await db.select({ subdomain: tenants.subdomain }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new Error('TENANT_NOT_FOUND');

    const bps = parseInt(process.env.STRIPE_APPLICATION_FEE_BPS || '0', 10);
    const fixed = parseInt(process.env.STRIPE_APPLICATION_FEE_FIXED || '0', 10);
    const application_fee_amount = Math.floor((amount * bps) / 10000) + fixed;

    const stripe = getStripeClient();
    const expiresAt = Math.floor(Date.now() / 1000) + (parseInt(process.env.BOOKING_PAYMENT_HOLD_MINUTES || '30') * 60);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_intent_data: {
        application_fee_amount,
      },
      client_reference_id: publicBookingReference,
      success_url: `http://localhost:3000/book/${tenant.subdomain}/payment/success?session_id={CHECKOUT_SESSION_ID}&reference=${publicBookingReference}`,
      cancel_url: `http://localhost:3000/book/${tenant.subdomain}/payment/cancel?reference=${publicBookingReference}`,
      expires_at: expiresAt,
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: `Booking ${publicBookingReference}`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
    }, { stripeAccount: connection.stripeAccountId });

    const attempt = await this.repo.createPaymentAttempt({
      tenantId,
      appointmentId,
      publicBookingReference,
      stripeAccountId: connection.stripeAccountId,
      stripeCheckoutSessionId: session.id,
      idempotencyKey,
      amount,
      currency: currency.toLowerCase(),
      applicationFeeAmount: application_fee_amount,
      status: 'OPEN',
      expiresAt: new Date(expiresAt * 1000),
    });

    return { attempt, url: session.url };
  }
}
