import { getDatabase, stripeConnections, stripePaymentAttempts } from '@ks-os/database';
import { eq, and, desc } from 'drizzle-orm';

export class StripeRepository {
  async getConnection(tenantId: string) {
    const db = getDatabase();
    const result = await db.select().from(stripeConnections).where(eq(stripeConnections.tenantId, tenantId));
    return result[0] || null;
  }

  async upsertConnection(data: typeof stripeConnections.$inferInsert) {
    const db = getDatabase();
    const result = await db.insert(stripeConnections)
      .values({ ...data, lastSyncedAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: stripeConnections.tenantId,
        set: {
          stripeAccountId: data.stripeAccountId,
          livemode: data.livemode,
          accountType: data.accountType,
          connectionStatus: data.connectionStatus,
          detailsSubmitted: data.detailsSubmitted,
          chargesEnabled: data.chargesEnabled,
          payoutsEnabled: data.payoutsEnabled,
          currentlyDue: data.currentlyDue,
          eventuallyDue: data.eventuallyDue,
          pastDue: data.pastDue,
          disabledReason: data.disabledReason,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        }
      })
      .returning();
    return result[0];
  }

  async createPaymentAttempt(data: typeof stripePaymentAttempts.$inferInsert) {
    const db = getDatabase();
    const result = await db.insert(stripePaymentAttempts)
      .values({ ...data, updatedAt: new Date() })
      .returning();
    return result[0];
  }

  async getLatestPaymentAttemptByReference(tenantId: string, reference: string) {
    const db = getDatabase();
    const result = await db.select()
      .from(stripePaymentAttempts)
      .where(and(eq(stripePaymentAttempts.tenantId, tenantId), eq(stripePaymentAttempts.publicBookingReference, reference)))
      .orderBy(desc(stripePaymentAttempts.createdAt))
      .limit(1);
    return result[0] || null;
  }
}
