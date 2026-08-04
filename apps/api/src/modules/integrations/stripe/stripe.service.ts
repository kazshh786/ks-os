import { and, eq } from 'drizzle-orm';
import { bookingPages, getDatabase, tenants } from '@ks-os/database';
import { StripeRepository } from './stripe.repository.js';
import { assertStripeConnectedAccountReady, getStripeClient, getStripeConfiguredMode } from '../../../lib/stripe.js';
import { deriveStripeConnectionStatus } from './stripe.mapper.js';

const connectUrl = (kind: 'return' | 'refresh') => {
  const expectedPath = `/app/settings/payments/${kind}`;
  const configured = kind === 'return'
    ? process.env.STRIPE_CONNECT_RETURN_URL
    : process.env.STRIPE_CONNECT_REFRESH_URL;

  if (configured) {
    try {
      const configuredUrl = new URL(configured);
      if (configuredUrl.pathname === expectedPath) return configuredUrl.toString();
    } catch {
      // Fall through to the known application route below.
    }
  }

  const origin = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
  return new URL(expectedPath, origin).toString();
};

const bookingPaymentOrigin = () => (
  process.env.PUBLIC_APP_ORIGIN
  || process.env.FRONTEND_ORIGIN
  || 'http://localhost:3000'
).replace(/\/$/, '');

function verifiedBookingOrigin(page?: { customDomain: string | null; customDomainStatus: string } | null) {
  if (page?.customDomainStatus !== 'VERIFIED' || !page.customDomain) return null;
  try {
    const url = new URL(`https://${page.customDomain}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export class StripeService {
  private repo = new StripeRepository();

  private accountIsMissingFromActivePlatform(error: unknown) {
    const stripeError = error as { type?: string; code?: string; statusCode?: number };
    return ['StripeInvalidRequestError', 'StripePermissionError'].includes(stripeError?.type || '') && (
      stripeError.statusCode === 403
      || stripeError.statusCode === 404
      || stripeError.code === 'account_invalid'
      || stripeError.code === 'resource_missing'
    );
  }

  private async createConnectedAccount(tenantId: string, livemode: boolean) {
    const db = getDatabase();
    const [tenant] = await db
      .select({
        name: tenants.name,
        legalBusinessName: tenants.legalBusinessName,
        primaryContactEmail: tenants.primaryContactEmail,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) throw new Error('TENANT_NOT_FOUND');

    let account;
    try {
      account = await getStripeClient().accounts.create({
        type: 'standard',
        country: process.env.STRIPE_DEFAULT_CONNECTED_ACCOUNT_COUNTRY || 'GB',
        email: tenant.primaryContactEmail || undefined,
        business_profile: {
          name: tenant.legalBusinessName || tenant.name,
        },
        metadata: {
          ks_os_tenant_id: tenantId,
        },
      });
    } catch {
      throw new Error('STRIPE_ACCOUNT_CREATE_FAILED');
    }

    return this.repo.upsertConnection({
      tenantId,
      stripeAccountId: account.id,
      livemode,
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

  async assertBookingPaymentsReady(tenantId: string) {
    const connection = await this.repo.getConnection(tenantId);
    if (!connection || connection.connectionStatus !== 'READY' || !connection.chargesEnabled) {
      throw new Error('STRIPE_ACCOUNT_NOT_READY');
    }

    let livemode: boolean;
    try {
      livemode = getStripeConfiguredMode() === 'live';
    } catch (error) {
      const code = error instanceof Error && error.name.startsWith('STRIPE_')
        ? error.name
        : 'STRIPE_NOT_CONFIGURED';
      throw new Error(code);
    }
    if (connection.livemode !== null && connection.livemode !== livemode) {
      throw new Error('STRIPE_ACCOUNT_NOT_READY');
    }

    try {
      await assertStripeConnectedAccountReady(connection.stripeAccountId);
    } catch (error) {
      if (error instanceof Error && error.name === 'STRIPE_ACCOUNT_NOT_READY') {
        throw new Error('STRIPE_ACCOUNT_NOT_READY');
      }
      throw error;
    }
    return connection;
  }

  private async createAccountLink(stripeAccountId: string) {
    const stripe = getStripeClient();
    try {
      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: connectUrl('refresh'),
        return_url: connectUrl('return'),
        type: 'account_onboarding',
      });
      return accountLink.url;
    } catch {
      throw new Error('STRIPE_ONBOARDING_LINK_FAILED');
    }
  }

  async getConnection(tenantId: string) {
    return this.repo.getConnection(tenantId);
  }

  async getFreshConnection(tenantId: string) {
    const connection = await this.repo.getConnection(tenantId);
    if (!connection) return null;

    try {
      return await this.syncConnection(tenantId);
    } catch {
      // A transient Stripe failure should not make the settings page appear as
      // disconnected. Return the most recently verified database snapshot.
      return connection;
    }
  }

  async connectAccount(tenantId: string) {
    let connection = await this.repo.getConnection(tenantId);
    const stripe = getStripeClient();
    const livemode = getStripeConfiguredMode() === 'live';

    if (!connection || (connection.livemode !== null && connection.livemode !== livemode)) {
      connection = await this.createConnectedAccount(tenantId, livemode);
    } else {
      try {
        const account = await stripe.accounts.retrieve(connection.stripeAccountId);
        if ('deleted' in account) {
          connection = await this.createConnectedAccount(tenantId, livemode);
        } else {
          connection = await this.repo.upsertConnection({
            tenantId,
            stripeAccountId: account.id,
            livemode,
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
        }
      } catch (error) {
        if (!this.accountIsMissingFromActivePlatform(error)) {
          throw new Error('STRIPE_ACCOUNT_RETRIEVE_FAILED');
        }
        connection = await this.createConnectedAccount(tenantId, livemode);
      }
    }

    return connection;
  }

  async createOnboardingLink(tenantId: string) {
    const connection = await this.connectAccount(tenantId);
    return this.createAccountLink(connection.stripeAccountId);
  }

  async startOnboarding(tenantId: string) {
    const connection = await this.connectAccount(tenantId);
    const url = await this.createAccountLink(connection.stripeAccountId);
    return { connection, url };
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
    } catch {
      throw new Error('STRIPE_ACCOUNT_RETRIEVE_FAILED');
    }

    if ('deleted' in account) {
      throw new Error('STRIPE_ACCOUNT_RETRIEVE_FAILED');
    }

    try {
      return await this.repo.upsertConnection({
        tenantId,
        stripeAccountId: account.id,
        livemode: getStripeConfiguredMode() === 'live',
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
    } catch {
      throw new Error('STRIPE_SYNC_FAILED');
    }
  }

  async createBookingPaymentSession(
    tenantId: string,
    appointmentId: string,
    publicBookingReference: string,
    idempotencyKey: string,
    amount: number,
    currency: string,
  ) {
    const connection = await this.assertBookingPaymentsReady(tenantId);

    const db = getDatabase();
    const [[tenant], [page]] = await Promise.all([
      db.select({ subdomain: tenants.subdomain }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
      db.select({ customDomain: bookingPages.customDomain, customDomainStatus: bookingPages.customDomainStatus })
        .from(bookingPages)
        .where(and(eq(bookingPages.tenantId, tenantId), eq(bookingPages.enabled, true), eq(bookingPages.published, true)))
        .limit(1),
    ]);
    if (!tenant) throw new Error('TENANT_NOT_FOUND');

    const bps = parseInt(process.env.STRIPE_APPLICATION_FEE_BPS || '0', 10);
    const fixed = parseInt(process.env.STRIPE_APPLICATION_FEE_FIXED || '0', 10);
    const application_fee_amount = Math.floor((amount * bps) / 10000) + fixed;

    const stripe = getStripeClient();
    const expiresAt = Math.floor(Date.now() / 1000) + (parseInt(process.env.BOOKING_PAYMENT_HOLD_MINUTES || '30') * 60);
    const customOrigin = verifiedBookingOrigin(page);
    const origin = customOrigin || bookingPaymentOrigin();
    const bookingPath = customOrigin ? '/book' : `/book/${tenant.subdomain}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_intent_data: {
        application_fee_amount,
      },
      client_reference_id: publicBookingReference,
      success_url: `${origin}${bookingPath}/payment/success?session_id={CHECKOUT_SESSION_ID}&reference=${publicBookingReference}`,
      cancel_url: `${origin}${bookingPath}/payment/cancel?reference=${publicBookingReference}`,
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
