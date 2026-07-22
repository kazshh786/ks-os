import { getDatabase, stripePayouts, stripePayoutItems } from '@ks-os/database';
import { eq, and } from 'drizzle-orm';
import type { ReconciliationSummary, ReconciliationStatus } from '@ks-os/contracts';

export class ReconciliationService {
  async summarizePayout(tenantId: string, stripePayoutId: string, payoutAmount: number): Promise<ReconciliationSummary> {
    const db = getDatabase();
    
    const items = await db.select().from(stripePayoutItems).where(
      and(
        eq(stripePayoutItems.tenantId, tenantId),
        eq(stripePayoutItems.stripePayoutId, stripePayoutId)
      )
    );

    let grossPayments = 0;
    let refunds = 0;
    let disputes = 0;
    let stripeFees = 0;
    let applicationFees = 0; // Note: We don't have application fee directly in items, might be included in stripe_fee or handled elsewhere
    let otherAdjustments = 0;

    for (const item of items) {
      stripeFees += item.stripeFee;
      
      if (item.sourceType === 'charge') {
        if (item.grossAmount > 0) {
          grossPayments += item.grossAmount;
        } else {
          // If a charge item is negative, it might be an adjustment
          otherAdjustments += item.grossAmount;
        }
      } else if (item.sourceType === 'refund') {
        refunds += Math.abs(item.grossAmount); // Keep it positive for the summary
      } else if (item.sourceType === 'dispute') {
        disputes += Math.abs(item.grossAmount);
      } else if (item.sourceType === 'adjustment') {
        otherAdjustments += item.grossAmount;
      } else {
        otherAdjustments += item.grossAmount;
      }
    }

    const calculatedNet = grossPayments - refunds - disputes - stripeFees - applicationFees + otherAdjustments;
    const difference = calculatedNet - payoutAmount;
    
    let status: ReconciliationStatus = 'INCOMPLETE';
    if (items.length > 0) {
      if (difference === 0) {
        status = 'MATCHED';
      } else {
        status = 'MISMATCHED';
      }
    }

    return {
      payoutAmount,
      grossPayments,
      refunds,
      disputes,
      stripeFees,
      applicationFees,
      otherAdjustments,
      calculatedNet,
      difference,
      status
    };
  }
}
