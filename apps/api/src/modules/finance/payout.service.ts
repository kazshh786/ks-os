import { getDatabase, stripePayouts, stripePayoutItems } from '@ks-os/database';
import { eq, and, desc, asc, lte, gte } from 'drizzle-orm';
import type { PayoutListQuery, PayoutListItem, PayoutDetailResponse, PayoutItem } from '@ks-os/contracts';
import { ReconciliationService } from './reconciliation.service.js';

export class PayoutService {
  private reconciliationService = new ReconciliationService();

  async listPayouts(tenantId: string, query: PayoutListQuery): Promise<{ items: PayoutListItem[], nextCursor?: string }> {
    const db = getDatabase();
    
    let conditions = [eq(stripePayouts.tenantId, tenantId)];
    
    if (query.status) {
      conditions.push(eq(stripePayouts.status, query.status.toLowerCase()));
    }
    if (query.from) {
      conditions.push(gte(stripePayouts.createdAtStripe, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(stripePayouts.createdAtStripe, new Date(query.to)));
    }
    
    const limit = query.limit || 25;
    
    // In a real implementation we would handle cursor properly.
    // For this phase, we just do a simple query
    const results = await db.select()
      .from(stripePayouts)
      .where(and(...conditions))
      .orderBy(desc(stripePayouts.createdAtStripe))
      .limit(limit);
      
    const items: PayoutListItem[] = results.map(p => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      status: (p.status.toUpperCase() as any) || 'PENDING',
      arrivalDate: p.arrivalDate ? p.arrivalDate.toISOString() : null,
      createdAt: p.createdAtStripe.toISOString(),
      automatic: p.automatic,
      reconciliationStatus: 'INCOMPLETE', // Simplified for list
      transactionCount: 0 // Simplified for list
    }));

    return { items };
  }

  async getPayoutDetail(tenantId: string, payoutId: string): Promise<PayoutDetailResponse> {
    const db = getDatabase();
    
    const [payout] = await db.select()
      .from(stripePayouts)
      .where(and(eq(stripePayouts.tenantId, tenantId), eq(stripePayouts.id, payoutId)));
      
    if (!payout) {
      throw new Error('PAYOUT_NOT_FOUND');
    }

    const itemsDb = await db.select()
      .from(stripePayoutItems)
      .where(and(eq(stripePayoutItems.tenantId, tenantId), eq(stripePayoutItems.stripePayoutId, payout.stripePayoutId)));

    const items: PayoutItem[] = itemsDb.map(i => ({
      id: i.id,
      sourceType: i.sourceType,
      grossAmount: i.grossAmount,
      stripeFee: i.stripeFee,
      netAmount: i.netAmount,
      currency: i.currency,
      availableOn: i.availableOn ? i.availableOn.toISOString() : null,
      checkoutTransactionId: i.checkoutTransactionId,
      stripeRefundId: i.stripeRefundId,
      stripeDisputeId: i.stripeDisputeId,
      createdAt: i.createdAt.toISOString()
    }));

    const reconciliation = await this.reconciliationService.summarizePayout(tenantId, payout.stripePayoutId, payout.amount);

    return {
      payout: {
        id: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        status: (payout.status.toUpperCase() as any) || 'PENDING',
        arrivalDate: payout.arrivalDate ? payout.arrivalDate.toISOString() : null,
        createdAt: payout.createdAtStripe.toISOString(),
        automatic: payout.automatic,
        reconciliationStatus: reconciliation.status,
        transactionCount: items.length
      },
      reconciliation,
      items,
      failureCode: payout.failureCode,
      failureMessageSafe: payout.failureMessageSafe,
      lastSyncedAt: payout.lastSyncedAt.toISOString()
    };
  }

  async syncPayouts(tenantId: string): Promise<{ success: boolean }> {
    // Manual sync placeholder (no-op for now)
    return { success: true };
  }
}
