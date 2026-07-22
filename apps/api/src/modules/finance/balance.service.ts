import { getStripeClient } from '../../lib/stripe.js';
import { getDatabase, stripeConnections } from '@ks-os/database';
import { eq } from 'drizzle-orm';
import type { StripeBalance } from '@ks-os/contracts';

const balanceCache = new Map<string, { data: StripeBalance; expiresAt: number }>();

export class BalanceService {
  async getBalance(tenantId: string): Promise<StripeBalance> {
    const now = Date.now();
    const cached = balanceCache.get(tenantId);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const db = getDatabase();
    const [connection] = await db.select().from(stripeConnections).where(eq(stripeConnections.tenantId, tenantId));
    if (!connection || !connection.stripeAccountId) {
      throw new Error('STRIPE_NOT_CONFIGURED');
    }

    const stripe = getStripeClient();
    const stripeBalance = await stripe.balance.retrieve({}, { stripeAccount: connection.stripeAccountId });

    const available = stripeBalance.available.map(b => ({ currency: b.currency, amount: b.amount }));
    const pending = stripeBalance.pending.map(b => ({ currency: b.currency, amount: b.amount }));
    const lastSyncedAt = new Date().toISOString();

    const data: StripeBalance = { available, pending, lastSyncedAt };
    balanceCache.set(tenantId, { data, expiresAt: now + 60000 }); // 60s cache

    return data;
  }

  async syncBalance(tenantId: string): Promise<StripeBalance> {
    balanceCache.delete(tenantId);
    return this.getBalance(tenantId);
  }
}
