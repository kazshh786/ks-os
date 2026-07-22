import { getDatabase, stripeDisputes } from '@ks-os/database';
import { eq, and, desc, gte, lte, ilike } from 'drizzle-orm';
import type { DisputeListQuery, DisputeListItem, DisputeDetailResponse, DisputeState } from '@ks-os/contracts';

export class DisputeService {
  async listDisputes(tenantId: string, query: DisputeListQuery): Promise<{ items: DisputeListItem[], nextCursor?: string }> {
    const db = getDatabase();
    
    let conditions = [eq(stripeDisputes.tenantId, tenantId)];
    
    if (query.status) {
      conditions.push(eq(stripeDisputes.status, query.status.toLowerCase()));
    }
    if (query.reason) {
      conditions.push(ilike(stripeDisputes.reason, `%${query.reason}%`));
    }
    if (query.from) {
      conditions.push(gte(stripeDisputes.createdAtStripe, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(stripeDisputes.createdAtStripe, new Date(query.to)));
    }
    
    const limit = query.limit || 25;
    
    const results = await db.select()
      .from(stripeDisputes)
      .where(and(...conditions))
      .orderBy(desc(stripeDisputes.createdAtStripe))
      .limit(limit);
      
    const items: DisputeListItem[] = results.map(d => ({
      id: d.id,
      bookingReference: null, // Depending on relation we could join with appointments
      appointmentId: d.appointmentId,
      checkoutTransactionId: d.checkoutTransactionId,
      amount: d.amount,
      currency: d.currency,
      reason: d.reason,
      status: (d.status.toUpperCase() as DisputeState) || 'UNDER_REVIEW',
      evidenceDueBy: d.evidenceDueBy ? d.evidenceDueBy.toISOString() : null,
      actionRequired: d.hasEvidenceDue,
      lastSyncedAt: d.lastSyncedAt.toISOString()
    }));

    return { items };
  }

  async getDisputeDetail(tenantId: string, disputeId: string): Promise<DisputeDetailResponse> {
    const db = getDatabase();
    
    const [dispute] = await db.select()
      .from(stripeDisputes)
      .where(and(eq(stripeDisputes.tenantId, tenantId), eq(stripeDisputes.id, disputeId)));
      
    if (!dispute) {
      throw new Error('DISPUTE_NOT_FOUND');
    }

    const item: DisputeDetailResponse = {
      id: dispute.id,
      bookingReference: null,
      appointmentId: dispute.appointmentId,
      checkoutTransactionId: dispute.checkoutTransactionId,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      status: (dispute.status.toUpperCase() as DisputeState) || 'UNDER_REVIEW',
      evidenceDueBy: dispute.evidenceDueBy ? dispute.evidenceDueBy.toISOString() : null,
      actionRequired: dispute.hasEvidenceDue,
      lastSyncedAt: dispute.lastSyncedAt.toISOString(),
      dashboardUrl: null, // we don't store dashboard url directly, can be derived if needed
      timeline: [
        {
          date: dispute.createdAtStripe.toISOString(),
          description: `Dispute created for reason: ${dispute.reason}`
        }
      ],
      payoutImpact: dispute.amount // Simplified
    };

    return item;
  }

  async syncDisputes(tenantId: string): Promise<{ success: boolean }> {
    // Manual sync placeholder
    return { success: true };
  }
}
