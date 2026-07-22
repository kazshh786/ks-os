import { getDatabase, checkoutTransactions, appointments, services, clients, stripeRefunds, tenants } from '@ks-os/database';
import { eq, and, sql, desc } from 'drizzle-orm';
import type { PaymentHistoryQuery } from '@ks-os/contracts';

export class PaymentsRepository {
  async getPaymentHistory(tenantId: string, query: PaymentHistoryQuery) {
    const db = getDatabase();

    const refundsSq = db.select({
      txId: stripeRefunds.checkoutTransactionId,
      refundedAmount: sql<number>`COALESCE(SUM(CASE WHEN ${stripeRefunds.status} = 'SUCCEEDED' THEN ${stripeRefunds.amount} ELSE 0 END), 0)`.mapWith(Number).as('refunded_amount'),
      pendingOrSuccess: sql<number>`COALESCE(SUM(CASE WHEN ${stripeRefunds.status} IN ('CREATING', 'PENDING', 'SUCCEEDED') THEN ${stripeRefunds.amount} ELSE 0 END), 0)`.mapWith(Number).as('pending_or_success_amount'),
    })
    .from(stripeRefunds)
    .where(eq(stripeRefunds.tenantId, tenantId))
    .groupBy(stripeRefunds.checkoutTransactionId)
    .as('refunds_sq');

    const result = await db.select({
      transactionId: checkoutTransactions.id,
      appointmentId: checkoutTransactions.appointmentId,
      bookingReference: appointments.publicReference,
      clientDisplayName: sql<string>`COALESCE(${clients.name}, ${appointments.clientName})`,
      serviceName: services.name,
      amount: checkoutTransactions.totalAmount,
      currency: tenants.currency,
      paymentMethod: checkoutTransactions.paymentMethod,
      purpose: checkoutTransactions.purpose,
      paymentStatus: checkoutTransactions.paymentStatus,
      stripePaymentIntentId: checkoutTransactions.stripePaymentIntentId,
      refundedAmount: sql<number>`COALESCE(${refundsSq.refundedAmount}, 0)`.mapWith(Number),
      refundableAmount: sql<number>`${checkoutTransactions.totalAmount} - COALESCE(${refundsSq.pendingOrSuccess}, 0)`.mapWith(Number),
      createdAt: checkoutTransactions.createdAt,
    })
    .from(checkoutTransactions)
    .leftJoin(appointments, eq(checkoutTransactions.appointmentId, appointments.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .leftJoin(tenants, eq(checkoutTransactions.tenantId, tenants.id))
    .leftJoin(refundsSq, eq(checkoutTransactions.id, refundsSq.txId))
    .where(eq(checkoutTransactions.tenantId, tenantId))
    .orderBy(desc(checkoutTransactions.createdAt))
    .limit(query.limit || 50);

    return result;
  }

  async getPaymentDetail(tenantId: string, transactionId: string) {
    const db = getDatabase();

    const refundsSq = db.select({
      txId: stripeRefunds.checkoutTransactionId,
      refundedAmount: sql<number>`COALESCE(SUM(CASE WHEN ${stripeRefunds.status} = 'SUCCEEDED' THEN ${stripeRefunds.amount} ELSE 0 END), 0)`.mapWith(Number).as('refunded_amount'),
      pendingOrSuccess: sql<number>`COALESCE(SUM(CASE WHEN ${stripeRefunds.status} IN ('CREATING', 'PENDING', 'SUCCEEDED') THEN ${stripeRefunds.amount} ELSE 0 END), 0)`.mapWith(Number).as('pending_or_success_amount'),
    })
    .from(stripeRefunds)
    .where(eq(stripeRefunds.tenantId, tenantId))
    .groupBy(stripeRefunds.checkoutTransactionId)
    .as('refunds_sq');

    const [tx] = await db.select({
      transactionId: checkoutTransactions.id,
      appointmentId: checkoutTransactions.appointmentId,
      bookingReference: appointments.publicReference,
      clientDisplayName: sql<string>`COALESCE(${clients.name}, ${appointments.clientName})`,
      serviceName: services.name,
      amount: checkoutTransactions.totalAmount,
      currency: tenants.currency,
      paymentMethod: checkoutTransactions.paymentMethod,
      purpose: checkoutTransactions.purpose,
      paymentStatus: checkoutTransactions.paymentStatus,
      stripePaymentIntentId: checkoutTransactions.stripePaymentIntentId,
      refundedAmount: sql<number>`COALESCE(${refundsSq.refundedAmount}, 0)`.mapWith(Number),
      refundableAmount: sql<number>`${checkoutTransactions.totalAmount} - COALESCE(${refundsSq.pendingOrSuccess}, 0)`.mapWith(Number),
      createdAt: checkoutTransactions.createdAt,
    })
    .from(checkoutTransactions)
    .leftJoin(appointments, eq(checkoutTransactions.appointmentId, appointments.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .leftJoin(tenants, eq(checkoutTransactions.tenantId, tenants.id))
    .leftJoin(refundsSq, eq(checkoutTransactions.id, refundsSq.txId))
    .where(and(
      eq(checkoutTransactions.tenantId, tenantId),
      eq(checkoutTransactions.id, transactionId)
    ))
    .limit(1);

    if (!tx) return null;

    const refundsList = await db.select()
      .from(stripeRefunds)
      .where(and(
        eq(stripeRefunds.tenantId, tenantId),
        eq(stripeRefunds.checkoutTransactionId, transactionId)
      ))
      .orderBy(desc(stripeRefunds.createdAt));

    return { ...tx, refundsList };
  }

  async lockTransactionForRefund(dbTx: any, tenantId: string, transactionId: string) {
    const result = await dbTx.execute(sql`
      SELECT * FROM checkout_transactions
      WHERE id = ${transactionId}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `);
    return result.rows[0];
  }
}
