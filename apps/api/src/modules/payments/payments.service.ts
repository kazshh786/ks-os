import { PaymentsRepository } from './payments.repository.js';
import type { PaymentHistoryQuery, PaymentHistoryItem, PaymentDetailResponse, CreateRefundRequest, CreateRefundResponse, DerivedPaymentState, PaymentSource } from '@ks-os/contracts';
import { getDatabase, stripeRefunds, checkoutTransactions, stripeConnections, users, appointments, clients, services, tenants } from '@ks-os/database';
import { eq, and } from 'drizzle-orm';
import { getStripeClient } from '../../lib/stripe.js';
import { BusinessEventsService, stableEventId } from '../automations/business-events.service.js';
import { EmailService } from '../email/email.service.js';

function mapPaymentSource(method: string, purpose: string): PaymentSource {
  if (method === 'STRIPE_ONLINE' || (method === 'CARD' && purpose === 'booking_payment')) return 'STRIPE_ONLINE';
  if (method === 'CASH') return 'MANUAL_CASH';
  if (method === 'SPLIT') return 'MANUAL_SPLIT';
  return 'EXTERNAL_TERMINAL';
}

function deriveState(status: string, refundedAmount: number, totalAmount: number): DerivedPaymentState {
  if (status === 'REFUNDED') return 'REFUNDED';
  if (status === 'FAILED') return 'FAILED';
  if (status === 'PENDING') return 'PENDING';
  if (status === 'SUCCEEDED' && refundedAmount > 0) return 'PARTIALLY_REFUNDED';
  if (status === 'SUCCEEDED') return 'SUCCEEDED';
  return 'PENDING';
}

export class PaymentsService {
  private businessEvents = new BusinessEventsService();
  private email = new EmailService();
  constructor(private readonly repository = new PaymentsRepository()) {}

  async enqueuePaymentEmail(tx: any, tenantId: string, transactionId: string, templateKey: 'payment-confirmed' | 'refund-updated', idempotencyKey: string, extra: Record<string, unknown> = {}) {
    const [row] = await tx.select({
      transactionId: checkoutTransactions.id,
      appointmentId: checkoutTransactions.appointmentId,
      amount: checkoutTransactions.totalAmount,
      currency: tenants.currency,
      tenantName: tenants.name,
      senderDisplayName: tenants.senderDisplayName,
      tenantPrimaryColor: tenants.primaryColor,
      replyToEmail: tenants.replyToEmail,
      paymentConfirmationEnabled: tenants.paymentConfirmationEnabled,
      clientEmail: clients.email,
      clientName: clients.name,
      appointmentClientName: appointments.clientName,
      serviceName: services.name,
    }).from(checkoutTransactions)
      .leftJoin(appointments, and(eq(appointments.id, checkoutTransactions.appointmentId), eq(appointments.tenantId, checkoutTransactions.tenantId)))
      .leftJoin(clients, and(eq(clients.id, appointments.clientId), eq(clients.tenantId, checkoutTransactions.tenantId)))
      .leftJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, checkoutTransactions.tenantId)))
      .leftJoin(tenants, eq(tenants.id, checkoutTransactions.tenantId))
      .where(and(eq(checkoutTransactions.id, transactionId), eq(checkoutTransactions.tenantId, tenantId)))
      .limit(1);
    if (!row?.clientEmail || !row.paymentConfirmationEnabled) return { queued: false as const, reason: 'NO_RECIPIENT' as const };
    return this.email.enqueueEmail({
      tenantId,
      recipientEmail: row.clientEmail,
      recipientName: row.clientName || row.appointmentClientName || undefined,
      replyToEmail: row.replyToEmail || undefined,
      templateKey,
      templateDataJson: {
        tenantName: row.senderDisplayName || row.tenantName,
        tenantPrimaryColor: row.tenantPrimaryColor,
        clientName: row.clientName || row.appointmentClientName || 'there',
        serviceName: row.serviceName,
        amount: (row.amount / 100).toFixed(2),
        currency: row.currency || 'GBP',
        ...extra,
      },
      idempotencyKey,
      relatedEntityType: row.appointmentId ? 'appointment' : 'payment',
      relatedEntityId: row.appointmentId || row.transactionId,
    }, tx);
  }

  async getPaymentHistory(tenantId: string, query: PaymentHistoryQuery): Promise<PaymentHistoryItem[]> {
    const rawData = await this.repository.getPaymentHistory(tenantId, query);
    
    return rawData.map((row: any) => ({
      transactionId: row.transactionId,
      appointmentId: row.appointmentId,
      bookingReference: row.bookingReference,
      clientDisplayName: row.clientDisplayName,
      serviceName: row.serviceName,
      amount: row.amount,
      currency: row.currency || 'GBP',
      paymentSource: mapPaymentSource(row.paymentMethod, row.purpose),
      paymentMethod: row.paymentMethod,
      paymentStatus: deriveState(row.paymentStatus, row.refundedAmount, row.amount),
      refundedAmount: row.refundedAmount,
      refundableAmount: row.refundableAmount,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getPaymentDetail(tenantId: string, transactionId: string): Promise<PaymentDetailResponse | null> {
    const data: any = await this.repository.getPaymentDetail(tenantId, transactionId);
    if (!data) return null;

    return {
      transactionId: data.transactionId,
      appointmentId: data.appointmentId,
      bookingReference: data.bookingReference,
      clientDisplayName: data.clientDisplayName,
      serviceName: data.serviceName,
      amount: data.amount,
      currency: data.currency || 'GBP',
      paymentSource: mapPaymentSource(data.paymentMethod, data.purpose),
      paymentMethod: data.paymentMethod,
      paymentStatus: deriveState(data.paymentStatus, data.refundedAmount, data.amount),
      refundedAmount: data.refundedAmount,
      refundableAmount: data.refundableAmount,
      providerVerificationState: 'NOT_APPLICABLE',
      stripeStatus: data.paymentStatus,
      refundHistory: data.refundsList.map((r: any) => ({
        id: r.id,
        amount: r.amount,
        currency: r.currency,
        reason: r.reason,
        status: r.status,
        refundSource: r.refundSource,
        requestedByUserName: null,
        createdAt: r.createdAt.toISOString()
      })),
      createdAt: data.createdAt.toISOString()
    };
  }

  async createRefund(tenantId: string, transactionId: string, authUserId: string, req: CreateRefundRequest): Promise<CreateRefundResponse> {
    const db = getDatabase();
    
    return await db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(and(eq(users.id, authUserId), eq(users.tenantId, tenantId))).limit(1);
      if (!user || user.role !== 'owner') throw new Error('Unauthorized: Only owner can issue refunds');

      const lockedTx = await this.repository.lockTransactionForRefund(tx, tenantId, transactionId);
      if (!lockedTx) throw new Error('Transaction not found');

      if (lockedTx.purpose !== 'booking_payment') throw new Error('Cannot refund non-booking payments');
      if (lockedTx.payment_status !== 'SUCCEEDED' && lockedTx.payment_status !== 'PARTIALLY_REFUNDED') throw new Error('Transaction is not eligible for refund');
      if (!lockedTx.stripe_payment_intent_id) throw new Error('Missing Stripe Payment Intent');

      const existingRefunds = await tx.select().from(stripeRefunds).where(and(
        eq(stripeRefunds.checkoutTransactionId, transactionId),
        eq(stripeRefunds.tenantId, tenantId)
      ));

      const pendingOrSuccessSum = existingRefunds
        .filter((r) => ['CREATING', 'PENDING', 'SUCCEEDED'].includes(r.status))
        .reduce((sum, r) => sum + r.amount, 0);
      
      const refundedAmount = existingRefunds
        .filter((r) => r.status === 'SUCCEEDED')
        .reduce((sum, r) => sum + r.amount, 0);

      const refundableAmount = lockedTx.total_amount - pendingOrSuccessSum;
      const refundAmount = req.amount || refundableAmount;

      if (refundAmount <= 0 || refundAmount > refundableAmount) {
        throw new Error('Invalid refund amount');
      }

      const [connection] = await tx.select().from(stripeConnections).where(eq(stripeConnections.tenantId, tenantId)).limit(1);
      if (!connection) throw new Error('Stripe connection not found');

      const [newRefund] = await tx.insert(stripeRefunds).values({
        tenantId,
        checkoutTransactionId: transactionId,
        appointmentId: lockedTx.appointment_id,
        stripeAccountId: connection.stripeAccountId,
        stripePaymentIntentId: lockedTx.stripe_payment_intent_id,
        idempotencyKey: req.idempotencyKey,
        amount: refundAmount,
        currency: 'GBP',
        reason: req.reason,
        internalNote: req.internalNote,
        status: 'CREATING',
        requestedByUserId: authUserId,
      }).returning();

      let finalStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED' = 'PENDING';
      let failureCode = null;
      let stripeRefundId = null;

      try {
        const stripeClient = getStripeClient();
        const stripeRes = await stripeClient.refunds.create({
          payment_intent: lockedTx.stripe_payment_intent_id,
          amount: refundAmount,
          reason: req.reason as any,
          refund_application_fee: true,
        }, {
          stripeAccount: connection.stripeAccountId,
          idempotencyKey: req.idempotencyKey,
        });

        stripeRefundId = stripeRes.id;
        finalStatus = stripeRes.status === 'succeeded' ? 'SUCCEEDED' : 'PENDING';
      } catch (err: any) {
        finalStatus = 'FAILED';
        failureCode = err.message;
      }

      await tx.update(stripeRefunds).set({
        status: finalStatus,
        stripeRefundId,
        failureCode,
        updatedAt: new Date(),
        completedAt: finalStatus !== 'PENDING' ? new Date() : null,
      }).where(eq(stripeRefunds.id, newRefund.id));

      if (finalStatus === 'SUCCEEDED') {
        const isFullyRefunded = (refundedAmount + refundAmount) >= lockedTx.total_amount;
        if (isFullyRefunded) {
          await tx.update(checkoutTransactions).set({
            paymentStatus: 'REFUNDED'
          }).where(eq(checkoutTransactions.id, transactionId));
        }
        await this.businessEvents.emit({id:stableEventId('REFUND_SUCCEEDED',newRefund.id,stripeRefundId||'succeeded'),tenantId,type:'REFUND_SUCCEEDED',occurredAt:new Date().toISOString(),sourceType:'appointment',sourceId:lockedTx.appointment_id,payload:{refundId:newRefund.id,appointmentId:lockedTx.appointment_id,status:'SUCCEEDED'}},tx);
        await this.enqueuePaymentEmail(tx, tenantId, transactionId, 'refund-updated', `refund-updated:${newRefund.id}:SUCCEEDED`, { status: 'SUCCEEDED', refundAmount: (refundAmount / 100).toFixed(2) });
      }

      return {
        id: newRefund.id,
        status: finalStatus as any,
        refundedAmount: finalStatus === 'SUCCEEDED' ? refundedAmount + refundAmount : refundedAmount,
        refundableAmount: refundableAmount - refundAmount,
      };
    });
  }
}
