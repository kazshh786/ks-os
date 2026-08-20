import { getStripeClient, getStripeConfiguredMode } from '../../../lib/stripe.js';
import { getDatabase, stripeWebhookEvents, stripeConnections, stripePaymentAttempts, appointments, checkoutTransactions, stripeRefunds, stripePayouts, stripePayoutItems, stripeDisputes } from '@ks-os/database';
import { and, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { deriveStripeConnectionStatus } from '../../integrations/stripe/stripe.mapper.js';
import * as crypto from 'node:crypto';
import { BusinessEventsService } from '../../automations/business-events.service.js';
import { PaymentsService } from '../../payments/payments.service.js';
import { BookingService } from '../../bookings/booking.service.js';

export class StripeWebhookService {
  private businessEvents = new BusinessEventsService();
  private payments = new PaymentsService();

  async handleConnectWebhook(rawBody: string | Buffer, signature: string) {
    return this.handleWebhook(
      rawBody,
      signature,
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET,
    );
  }

  async handlePaymentsWebhook(rawBody: string | Buffer, signature: string) {
    return this.handleWebhook(
      rawBody,
      signature,
      process.env.STRIPE_PAYMENTS_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET,
    );
  }

  private async handleWebhook(rawBody: string | Buffer, signature: string, webhookSecret?: string) {
    const stripe = getStripeClient();

    if (!webhookSecret) {
      throw new Error('STRIPE_NOT_CONFIGURED');
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      throw new Error('STRIPE_WEBHOOK_SIGNATURE_INVALID');
    }

    const configuredMode = getStripeConfiguredMode();
    if (typeof event.livemode === 'boolean' && event.livemode !== (configuredMode === 'live')) {
      return { status: 'ignored_mode' };
    }

    const db = getDatabase();

    // Check idempotency
    const existing = await db.select().from(stripeWebhookEvents).where(eq(stripeWebhookEvents.stripeEventId, event.id));
    if (existing.length > 0 && existing[0].processingStatus === 'PROCESSED') {
      return { status: 'already_processed' };
    }

    await db.insert(stripeWebhookEvents).values({
      stripeEventId: event.id,
      eventType: event.type,
      stripeAccountId: event.account,
      processingStatus: 'PENDING',
    }).onConflictDoNothing();

    try {
      if (event.type === 'account.updated') {
        const account = event.data.object as Stripe.Account;

        const connections = await db.select().from(stripeConnections).where(eq(stripeConnections.stripeAccountId, account.id));
        if (connections.length > 0) {
          const tenantId = connections[0].tenantId;

          await db.update(stripeConnections).set({
            livemode: event.livemode,
            connectionStatus: deriveStripeConnectionStatus(account),
            detailsSubmitted: account.details_submitted,
            chargesEnabled: account.charges_enabled,
            payoutsEnabled: account.payouts_enabled,
            currentlyDue: account.requirements?.currently_due || [],
            eventuallyDue: account.requirements?.eventually_due || [],
            pastDue: account.requirements?.past_due || [],
            disabledReason: account.requirements?.disabled_reason || null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(stripeConnections.tenantId, tenantId));
        }
      } else if (event.type === 'account.application.deauthorized') {
        const stripeAccountId = event.account;
        if (stripeAccountId) {
          await db.update(stripeConnections).set({
            connectionStatus: 'DISABLED',
            detailsSubmitted: false,
            chargesEnabled: false,
            payoutsEnabled: false,
            disabledReason: 'application_deauthorized',
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(stripeConnections.stripeAccountId, stripeAccountId));
        }
      } else if (
        event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded' ||
        event.type === 'checkout.session.async_payment_failed' ||
        event.type === 'checkout.session.expired' ||
        event.type === 'payment_intent.succeeded' ||
        event.type === 'payment_intent.payment_failed'
      ) {
        const stripeAccountId = event.account;
        if (!stripeAccountId) {
          throw new Error('STRIPE_ACCOUNT_ID_MISSING');
        }

        const object = event.data.object as any;
        const objectId = object.id;

        await db.transaction(async (tx) => {
          let attemptQuery;
          if (objectId.startsWith('cs_')) {
            attemptQuery = await tx.select().from(stripePaymentAttempts).where(eq(stripePaymentAttempts.stripeCheckoutSessionId, objectId));
          } else if (objectId.startsWith('pi_')) {
            attemptQuery = await tx.select().from(stripePaymentAttempts).where(eq(stripePaymentAttempts.stripePaymentIntentId, objectId));
          } else {
            return;
          }

          if (attemptQuery.length === 0) {
            return;
          }

          const attempt = attemptQuery[0];

          if (attempt.stripeAccountId !== stripeAccountId) {
            throw new Error('STRIPE_ACCOUNT_MISMATCH');
          }

          if (['SUCCEEDED', 'CANCELLED', 'EXPIRED'].includes(attempt.status)) {
            return;
          }

          if (
            event.type === 'checkout.session.expired' ||
            event.type === 'checkout.session.async_payment_failed' ||
            event.type === 'payment_intent.payment_failed'
          ) {
            await tx.update(stripePaymentAttempts)
              .set({ status: event.type === 'checkout.session.expired' ? 'EXPIRED' : 'FAILED', updatedAt: new Date() })
              .where(eq(stripePaymentAttempts.id, attempt.id));

            if (event.type === 'checkout.session.expired') {
              const appointmentQuery = await tx.select().from(appointments).where(eq(appointments.id, attempt.appointmentId));
              if (appointmentQuery.length > 0 && appointmentQuery[0].status === 'PENDING') {
                await tx.update(appointments)
                  .set({ status: 'CANCELLED', updatedAt: new Date() })
                  .where(eq(appointments.id, attempt.appointmentId));
              }
            }
          } else if (
            (event.type === 'checkout.session.completed' && object.payment_status === 'paid') ||
            event.type === 'checkout.session.async_payment_succeeded' ||
            event.type === 'payment_intent.succeeded'
          ) {
            const paymentIntentId = object.payment_intent || (objectId.startsWith('pi_') ? objectId : undefined);

            const [currentAppointment] = await tx.select({ status: appointments.status })
              .from(appointments)
              .where(and(eq(appointments.id, attempt.appointmentId), eq(appointments.tenantId, attempt.tenantId)))
              .for('update')
              .limit(1);
            if (!currentAppointment || currentAppointment.status !== 'PENDING') {
              // A cancelled/expired hold is terminal. A late provider event must
              // never resurrect the appointment or create a completed booking.
              await tx.update(stripePaymentAttempts).set({ status: 'CANCELLED', updatedAt: new Date() })
                .where(eq(stripePaymentAttempts.id, attempt.id));
              return;
            }

            await tx.update(stripePaymentAttempts)
              .set({
                status: 'SUCCEEDED',
                stripePaymentIntentId: typeof paymentIntentId === 'string' ? paymentIntentId : undefined,
                completedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(stripePaymentAttempts.id, attempt.id));

            await tx.update(appointments)
              .set({ status: 'CONFIRMED', paymentStatus: 'SUCCEEDED', updatedAt: new Date() })
              .where(eq(appointments.id, attempt.appointmentId));

            const [transaction] = await tx.insert(checkoutTransactions).values({
              tenantId: attempt.tenantId,
              appointmentId: attempt.appointmentId,
              purpose: 'booking_payment',
              paymentStatus: 'SUCCEEDED',
              totalAmount: attempt.amount,
              paymentMethod: 'CARD',
              stripePaymentIntentId: typeof paymentIntentId === 'string' ? paymentIntentId : undefined,
            }).returning({ id: checkoutTransactions.id });
            if (transaction?.id) await this.payments.enqueuePaymentEmail(tx, attempt.tenantId, transaction.id, 'payment-confirmed', `payment-confirmed:${event.id}`);
            try {
              await new BookingService().notifyPublicBookingConfirmed(attempt.tenantId, attempt.appointmentId, `stripe:${event.id}`, tx);
            } catch {
              // Payment confirmation is authoritative and notification delivery
              // must never roll back a paid booking.
            }
            await this.businessEvents.emit({id:`PAYMENT_SUCCEEDED:${event.id}`,tenantId:attempt.tenantId,type:'PAYMENT_SUCCEEDED',occurredAt:new Date(event.created*1000).toISOString(),sourceType:'appointment',sourceId:attempt.appointmentId,payload:{appointmentId:attempt.appointmentId,paymentStatus:'SUCCEEDED'}},tx);
            await this.businessEvents.emit({id:`BOOKING_CONFIRMED:${event.id}`,tenantId:attempt.tenantId,type:'BOOKING_CONFIRMED',occurredAt:new Date(event.created*1000).toISOString(),sourceType:'appointment',sourceId:attempt.appointmentId,payload:{appointmentId:attempt.appointmentId,status:'CONFIRMED',paymentStatus:'SUCCEEDED'}},tx);
          }
        });
      } else if (
        event.type === 'refund.created' ||
        event.type === 'refund.updated' ||
        event.type === 'refund.failed'
      ) {
        const stripeAccountId = event.account;
        if (!stripeAccountId) {
          throw new Error('STRIPE_ACCOUNT_ID_MISSING');
        }

        const refund = event.data.object as Stripe.Refund;
        const stripeRefundId = refund.id;
        const stripePaymentIntentId = typeof refund.payment_intent === 'string' 
          ? refund.payment_intent 
          : (refund.payment_intent && (refund.payment_intent as any).id) || undefined;

        await db.transaction(async (tx) => {
          const refundQuery = await tx.select().from(stripeRefunds).where(eq(stripeRefunds.stripeRefundId, stripeRefundId));

          let checkoutTransactionId: string | undefined;
          let appointmentId: string | null = null;

          if (refundQuery.length === 0) {
            if (!stripePaymentIntentId) {
              return;
            }
            const txQuery = await tx.select().from(checkoutTransactions).where(eq(checkoutTransactions.stripePaymentIntentId, stripePaymentIntentId));
            if (txQuery.length === 0) {
              return;
            }
            const transaction = txQuery[0];
            checkoutTransactionId = transaction.id;
            appointmentId = transaction.appointmentId;

            const refundStatus = refund.status === 'succeeded' ? 'SUCCEEDED' : refund.status === 'failed' ? 'FAILED' : 'PENDING';

            const [insertedRefund] = await tx.insert(stripeRefunds).values({
              tenantId: transaction.tenantId,
              checkoutTransactionId: transaction.id,
              appointmentId: transaction.appointmentId,
              stripeAccountId: stripeAccountId,
              stripePaymentIntentId: stripePaymentIntentId,
              stripeRefundId: stripeRefundId,
              idempotencyKey: crypto.randomUUID(),
              amount: refund.amount,
              currency: refund.currency,
              reason: refund.reason || 'unknown',
              status: refundStatus,
              failureCode: refund.failure_reason,
              refundSource: 'STRIPE_DASHBOARD',
              createdAt: new Date(),
              updatedAt: new Date(),
              completedAt: refundStatus === 'SUCCEEDED' ? new Date() : null,
            }).returning({ id: stripeRefunds.id, status: stripeRefunds.status, checkoutTransactionId: stripeRefunds.checkoutTransactionId });
            if (insertedRefund?.status === 'SUCCEEDED') await this.payments.enqueuePaymentEmail(tx, transaction.tenantId, transaction.id, 'refund-updated', `refund-updated:${stripeRefundId}:SUCCEEDED`, { status: 'SUCCEEDED', refundAmount: (refund.amount / 100).toFixed(2) });
          } else {
            const existingRefund = refundQuery[0];
            checkoutTransactionId = existingRefund.checkoutTransactionId;
            appointmentId = existingRefund.appointmentId;

            const newStatus = refund.status === 'succeeded' ? 'SUCCEEDED' : refund.status === 'failed' ? 'FAILED' : 'PENDING';
            if (existingRefund.status === newStatus) {
              return;
            }

            await tx.update(stripeRefunds).set({
              status: newStatus,
              failureCode: refund.failure_reason,
              updatedAt: new Date(),
              completedAt: newStatus === 'SUCCEEDED' ? new Date() : existingRefund.completedAt,
            }).where(eq(stripeRefunds.id, existingRefund.id));
            if (newStatus === 'SUCCEEDED') await this.payments.enqueuePaymentEmail(tx, existingRefund.tenantId, existingRefund.checkoutTransactionId, 'refund-updated', `refund-updated:${stripeRefundId}:SUCCEEDED`, { status: 'SUCCEEDED', refundAmount: (refund.amount / 100).toFixed(2) });
          }

          if (!checkoutTransactionId) return;

          const allRefunds = await tx.select().from(stripeRefunds).where(eq(stripeRefunds.checkoutTransactionId, checkoutTransactionId));
          const sumSuccessful = allRefunds
            .filter(r => r.status === 'SUCCEEDED')
            .reduce((sum, r) => sum + r.amount, 0);

          const txQuery = await tx.select().from(checkoutTransactions).where(eq(checkoutTransactions.id, checkoutTransactionId));
          if (txQuery.length > 0) {
            const transaction = txQuery[0];
            if (sumSuccessful >= transaction.totalAmount) {
              await tx.update(checkoutTransactions).set({
                paymentStatus: 'REFUNDED',
              }).where(eq(checkoutTransactions.id, transaction.id));

              if (appointmentId) {
                await tx.update(appointments).set({
                  paymentStatus: 'REFUNDED',
                  updatedAt: new Date(),
                }).where(eq(appointments.id, appointmentId));
              }
            }
          }
        });
      } else if (
        event.type === 'payout.created' ||
        event.type === 'payout.updated' ||
        event.type === 'payout.paid' ||
        event.type === 'payout.failed'
      ) {
        const stripeAccountId = event.account;
        if (!stripeAccountId) throw new Error('STRIPE_ACCOUNT_ID_MISSING');

        const payout = event.data.object as Stripe.Payout;
        const stripePayoutId = payout.id;

        const connections = await db.select().from(stripeConnections).where(eq(stripeConnections.stripeAccountId, stripeAccountId));
        if (connections.length > 0) {
          const tenantId = connections[0].tenantId;

          const arrivalDate = new Date(payout.arrival_date * 1000);
          const createdAtStripe = new Date(payout.created * 1000);

          await db.insert(stripePayouts).values({
            tenantId,
            stripeAccountId,
            stripePayoutId,
            amount: payout.amount,
            currency: payout.currency,
            status: payout.status,
            arrivalDate,
            method: payout.method,
            type: payout.type,
            automatic: payout.automatic,
            description: payout.description,
            statementDescriptor: payout.statement_descriptor,
            failureCode: payout.failure_code,
            failureMessageSafe: payout.failure_message,
            createdAtStripe,
            paidAt: payout.status === 'paid' ? new Date() : null,
            failedAt: payout.status === 'failed' ? new Date() : null,
          }).onConflictDoUpdate({
            target: [stripePayouts.stripeAccountId, stripePayouts.stripePayoutId],
            set: {
              status: payout.status,
              arrivalDate,
              method: payout.method,
              type: payout.type,
              automatic: payout.automatic,
              description: payout.description,
              statementDescriptor: payout.statement_descriptor,
              failureCode: payout.failure_code,
              failureMessageSafe: payout.failure_message,
              updatedAt: new Date(),
              paidAt: payout.status === 'paid' ? new Date() : undefined,
              failedAt: payout.status === 'failed' ? new Date() : undefined,
              lastSyncedAt: new Date(),
            }
          });

          if (event.type === 'payout.paid') {
            const balanceTransactions = stripe.balanceTransactions.list({
              payout: stripePayoutId,
              limit: 100
            }, { stripeAccount: stripeAccountId });

            for await (const txn of balanceTransactions) {
              let checkoutTransactionId: string | null = null;
              let stripeRefundId: string | null = null;
              let stripeDisputeId: string | null = null;

              const sourceId = typeof txn.source === 'string' ? txn.source : (txn.source as any)?.id;

              if (txn.type === 'charge' || txn.type === 'payment') {
                if (sourceId && sourceId.startsWith('ch_')) {
                  try {
                    const charge = await stripe.charges.retrieve(sourceId, undefined, { stripeAccount: stripeAccountId });
                    const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent as any)?.id;
                    if (piId) {
                      const ct = await db.select({ id: checkoutTransactions.id }).from(checkoutTransactions).where(eq(checkoutTransactions.stripePaymentIntentId, piId)).limit(1);
                      if (ct.length > 0) checkoutTransactionId = ct[0].id;
                    }
                  } catch (e) {
                    // ignore
                  }
                }
              } else if (txn.type === 'refund') {
                stripeRefundId = sourceId;
              } else if (txn.type === 'adjustment') {
                stripeDisputeId = sourceId;
              }

              await db.insert(stripePayoutItems).values({
                tenantId,
                stripePayoutId,
                stripeBalanceTransactionId: txn.id,
                stripeSourceId: sourceId,
                sourceType: txn.type,
                grossAmount: txn.amount,
                stripeFee: txn.fee,
                netAmount: txn.net,
                currency: txn.currency,
                availableOn: new Date(txn.available_on * 1000),
                checkoutTransactionId,
                stripeRefundId,
                stripeDisputeId,
              }).onConflictDoNothing();
            }
          }
        }
      } else if (
        event.type === 'charge.dispute.created' ||
        event.type === 'charge.dispute.updated' ||
        event.type === 'charge.dispute.closed'
      ) {
        const stripeAccountId = event.account;
        if (!stripeAccountId) throw new Error('STRIPE_ACCOUNT_ID_MISSING');

        const dispute = event.data.object as Stripe.Dispute;
        const connections = await db.select().from(stripeConnections).where(eq(stripeConnections.stripeAccountId, stripeAccountId));
        if (connections.length > 0) {
          const tenantId = connections[0].tenantId;

          const status = dispute.status;

          await db.insert(stripeDisputes).values({
            tenantId,
            stripeAccountId,
            stripeDisputeId: dispute.id,
            stripeChargeId: typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge as any)?.id,
            stripePaymentIntentId: typeof dispute.payment_intent === 'string' ? dispute.payment_intent : (dispute.payment_intent as any)?.id,
            amount: dispute.amount,
            currency: dispute.currency,
            reason: dispute.reason,
            status,
            isChargeRefundable: dispute.is_charge_refundable,
            evidenceDueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null,
            hasEvidenceDue: dispute.evidence_details?.has_evidence,
            balanceTransactionId: dispute.balance_transactions && dispute.balance_transactions.length > 0 ? (typeof dispute.balance_transactions[0] === 'string' ? dispute.balance_transactions[0] : (dispute.balance_transactions[0] as any)?.id) : null,
            createdAtStripe: new Date(dispute.created * 1000),
            closedAt: event.type === 'charge.dispute.closed' ? new Date() : null,
          }).onConflictDoUpdate({
            target: [stripeDisputes.stripeAccountId, stripeDisputes.stripeDisputeId],
            set: {
              status,
              isChargeRefundable: dispute.is_charge_refundable,
              evidenceDueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null,
              hasEvidenceDue: dispute.evidence_details?.has_evidence,
              balanceTransactionId: dispute.balance_transactions && dispute.balance_transactions.length > 0 ? (typeof dispute.balance_transactions[0] === 'string' ? dispute.balance_transactions[0] : (dispute.balance_transactions[0] as any)?.id) : null,
              updatedAt: new Date(),
              closedAt: event.type === 'charge.dispute.closed' ? new Date() : undefined,
              lastSyncedAt: new Date(),
            }
          });
        }
      }

      await db.update(stripeWebhookEvents).set({
        processingStatus: 'PROCESSED',
        processedAt: new Date(),
      }).where(eq(stripeWebhookEvents.stripeEventId, event.id));

      return { status: 'success' };
    } catch (err: any) {
      await db.update(stripeWebhookEvents).set({
        processingStatus: 'FAILED',
        errorCode: err.message.substring(0, 255),
      }).where(eq(stripeWebhookEvents.stripeEventId, event.id));
      throw new Error('STRIPE_WEBHOOK_PROCESSING_FAILED');
    }
  }
}
