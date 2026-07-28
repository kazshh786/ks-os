import { PosRepository } from './pos.repository.js';
import { getPosAppointmentFilter } from './pos.permissions.js';
import { calculateGrandTotal, validatePaymentMethod, getFinalPaymentComponents } from './pos.calculator.js';
import { appointments, checkoutTransactions, checkoutPaymentComponents, products, services } from '@ks-os/database';
import { eq, and, sql } from 'drizzle-orm';
import { BusinessEventsService, stableEventId } from '../automations/business-events.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { EntitlementService } from '../agency/agency.service.js';
import { PosStripeService } from './pos-stripe.service.js';
import type { CheckoutRequest, TransactionSummary } from '@ks-os/contracts';

const fail = (name: string, message: string) => {
  const error = new Error(message);
  error.name = name;
  return error;
};

export class PosService {
  private readonly businessEvents = new BusinessEventsService();
  private readonly payments = new PaymentsService();
  private readonly entitlements = new EntitlementService();
  private readonly stripe = new PosStripeService();

  constructor(private readonly repository = new PosRepository()) {}

  async getCheckoutCandidates(tenantId: string, role: string, authUserId: string) {
    const roleFilter = getPosAppointmentFilter(role, authUserId);
    const rows = await this.repository.getCheckoutCandidates(tenantId, roleFilter);

    return rows
      .filter(row => !row.checkout)
      .map(row => {
        const appt = row.appointment;
        return {
          appointmentId: appt.id,
          clientName: row.clientName || appt.clientName || null,
          serviceName: row.serviceName || null,
          staffName: row.staffName || null,
          startTime: appt.startTime.toISOString(),
          endTime: appt.endTime.toISOString(),
          status: appt.status,
          paymentStatus: appt.paymentStatus,
          quotedAmount: appt.quotedAmount,
          checkoutState: 'ready' as const,
        };
      });
  }

  private async assertInventoryAccess(tenantId: string, purchasedProducts: unknown[]) {
    if (purchasedProducts.length > 0) {
      await this.entitlements.assertBoolean(tenantId, 'inventory.enabled');
    }
  }

  async previewCheckout(tenantId: string, role: string, authUserId: string, payload: any) {
    await this.assertInventoryAccess(tenantId, payload.purchasedProducts || []);

    const roleFilter = getPosAppointmentFilter(role, authUserId);
    const apptRow = await this.repository.getAppointmentForPreview(tenantId, payload.appointmentId, roleFilter);

    if (!apptRow || !apptRow.appointment) {
      throw fail('POS_APPOINTMENT_NOT_FOUND', 'Appointment not found');
    }

    const appt = apptRow.appointment;
    let serviceAmountInCents = appt.quotedAmount;
    if (!serviceAmountInCents || serviceAmountInCents <= 0) {
      serviceAmountInCents = apptRow.service ? apptRow.service.price : 0;
    }

    let retailAmountInCents = 0;
    for (const item of payload.purchasedProducts || []) {
      const product = await this.repository.getProductForPreview(tenantId, item.productId);

      if (!product) {
        throw fail('PRODUCT_NOT_FOUND', `Product ${item.productId} not found`);
      }
      if (product.stockQuantity < item.quantity) {
        throw fail('INSUFFICIENT_STOCK', `Insufficient stock for product ${product.name}`);
      }

      retailAmountInCents += product.priceInCents * item.quantity;
    }

    const grandTotalInCents = calculateGrandTotal(serviceAmountInCents, retailAmountInCents, payload.tipAmountInCents);
    const finalComponents = getFinalPaymentComponents(payload.paymentMethod, grandTotalInCents, payload.paymentComponents, payload.splitAmounts);
    validatePaymentMethod(payload.paymentMethod, grandTotalInCents, finalComponents);

    return {
      serviceAmountInCents,
      retailAmountInCents,
      tipAmountInCents: payload.tipAmountInCents,
      grandTotalInCents,
    };
  }

  private async prepareStripeCheckout(
    tenantId: string,
    payload: CheckoutRequest,
    expectedAmountInCents: number,
  ) {
    if (payload.paymentMethod !== 'STRIPE_TERMINAL') {
      return {
        trustedComponents: payload.paymentComponents,
        paymentIntentId: null as string | null,
        verificationSource: 'STAFF_CONFIRMED' as const,
      };
    }

    const confirmation = payload.stripePayment;
    if (!confirmation) {
      throw fail('STRIPE_CONFIRMATION_REQUIRED', 'Stripe payment confirmation is required.');
    }

    const connection = await this.stripe.getConnectionSummary(tenantId);
    if (!connection.ready) {
      throw fail('STRIPE_ACCOUNT_NOT_READY', 'The connected Stripe account is not ready to take payments.');
    }

    let verificationSource: 'PROVIDER_CONFIRMED' | 'STAFF_CONFIRMED' = 'STAFF_CONFIRMED';
    let verifiedPaymentIntentId: string | null = null;

    if (confirmation.mode === 'AUTOMATED_TERMINAL' && !confirmation.paymentIntentId) {
      throw fail('STRIPE_PAYMENT_INTENT_REQUIRED', 'The automated terminal payment is missing its Stripe PaymentIntent.');
    }

    if (confirmation.paymentIntentId) {
      const paymentIntent = await this.stripe.assertPaymentSucceeded({
        tenantId,
        appointmentId: payload.appointmentId,
        paymentIntentId: confirmation.paymentIntentId,
        expectedAmountInCents,
      });
      verifiedPaymentIntentId = paymentIntent.id;
      verificationSource = 'PROVIDER_CONFIRMED';
    } else if (!confirmation.manuallyConfirmed) {
      throw fail('STRIPE_MANUAL_CONFIRMATION_REQUIRED', 'Confirm that the Stripe payment succeeded before completing the sale.');
    }

    const provider = confirmation.mode === 'TAP_TO_PAY_MANUAL'
      ? 'STRIPE_TAP_TO_PAY'
      : confirmation.mode === 'TERMINAL_MANUAL'
        ? 'STRIPE_TERMINAL_MANUAL'
        : 'STRIPE_TERMINAL';

    return {
      trustedComponents: [{
        method: 'STRIPE_TERMINAL' as const,
        amountInCents: expectedAmountInCents,
        externalProvider: provider,
        externalProviderName: 'Stripe',
        externalReference: verifiedPaymentIntentId || confirmation.manualReference || undefined,
      }],
      paymentIntentId: verifiedPaymentIntentId,
      verificationSource,
    };
  }

  async completeCheckout(tenantId: string, role: string, authUserId: string, payload: CheckoutRequest) {
    await this.assertInventoryAccess(tenantId, payload.purchasedProducts || []);

    // Recalculate before touching Stripe or opening the transaction. The browser
    // never provides the amount sent to a Stripe reader.
    const preview = await this.previewCheckout(tenantId, role, authUserId, payload);
    const stripeCheckout = await this.prepareStripeCheckout(tenantId, payload, preview.grandTotalInCents);
    const trustedPayload = {
      ...payload,
      paymentComponents: stripeCheckout.trustedComponents,
    };

    const db = this.repository.getRawDb();

    const summary: TransactionSummary | any = await db.transaction(async (tx) => {
      const baseConditions = [
        eq(appointments.id, trustedPayload.appointmentId),
        eq(appointments.tenantId, tenantId),
      ];

      const [apptRow] = await tx.select({
        appointment: appointments,
        service: services,
      })
        .from(appointments)
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(and(...baseConditions))
        .limit(1)
        .for('update');

      if (!apptRow || !apptRow.appointment) {
        throw fail('POS_APPOINTMENT_NOT_FOUND', 'Appointment not found or belongs to another tenant');
      }

      const appt = apptRow.appointment;

      if (role !== 'owner' && appt.userId !== authUserId) {
        throw fail('POS_ACCESS_DENIED', 'Access denied to checkout this appointment');
      }

      if (['CANCELLED', 'NO_SHOW', 'BLOCKED'].includes(appt.status)) {
        throw fail('POS_APPOINTMENT_NOT_ELIGIBLE', `Cannot checkout ${appt.status.toLowerCase()} appointment`);
      }

      const [existingTx] = await tx.select()
        .from(checkoutTransactions)
        .where(
          and(
            eq(checkoutTransactions.appointmentId, trustedPayload.appointmentId),
            eq(checkoutTransactions.paymentStatus, 'SUCCEEDED'),
          ),
        )
        .limit(1);

      if (existingTx) {
        if (appt.idempotencyKey === trustedPayload.idempotencyKey) {
          return { __isIdempotentHit: true, existingTx, appt, service: apptRow.service };
        }
        throw fail('POS_ALREADY_COMPLETED', 'Appointment has already been checked out successfully.');
      }

      let serviceAmountInCents = appt.quotedAmount;
      const serviceName = apptRow.service?.name || 'Custom Service';

      if (!serviceAmountInCents || serviceAmountInCents <= 0) {
        serviceAmountInCents = apptRow.service ? apptRow.service.price : 0;
      }

      let retailAmountInCents = 0;
      const receiptItems: TransactionSummary['items'] = [];

      receiptItems.push({
        name: serviceName,
        quantity: 1,
        priceInCents: serviceAmountInCents,
        totalInCents: serviceAmountInCents,
      });

      for (const item of trustedPayload.purchasedProducts) {
        if (item.quantity < 1) {
          throw fail('INVALID_PRODUCT_QUANTITY', 'Requested quantity must be >= 1');
        }

        const [product] = await tx.select({ priceInCents: products.priceInCents, name: products.name })
          .from(products)
          .where(
            and(
              eq(products.id, item.productId),
              eq(products.tenantId, tenantId),
            ),
          )
          .limit(1)
          .for('update');

        if (!product) {
          throw fail('PRODUCT_NOT_FOUND', `Product ${item.productId} not found`);
        }

        const [updatedProduct] = await tx.update(products)
          .set({
            stockQuantity: sql`${products.stockQuantity} - ${item.quantity}`,
            updatedAt: sql`NOW()`,
          })
          .where(
            and(
              eq(products.id, item.productId),
              sql`${products.stockQuantity} >= ${item.quantity}`,
            ),
          )
          .returning({ id: products.id });

        if (!updatedProduct) {
          throw fail('INSUFFICIENT_STOCK', `Insufficient stock for product ${product.name}`);
        }

        const lineTotal = product.priceInCents * item.quantity;
        retailAmountInCents += lineTotal;

        receiptItems.push({
          name: product.name,
          quantity: item.quantity,
          priceInCents: product.priceInCents,
          totalInCents: lineTotal,
        });
      }

      const grandTotalInCents = calculateGrandTotal(serviceAmountInCents, retailAmountInCents, trustedPayload.tipAmountInCents);
      if (grandTotalInCents !== preview.grandTotalInCents) {
        throw fail('CHECKOUT_CONFLICT', 'The checkout total changed. Review the basket and try again.');
      }

      const finalComponents = getFinalPaymentComponents(
        trustedPayload.paymentMethod,
        grandTotalInCents,
        trustedPayload.paymentComponents,
        trustedPayload.splitAmounts,
      );
      validatePaymentMethod(trustedPayload.paymentMethod, grandTotalInCents, finalComponents);

      const [transaction] = await tx.insert(checkoutTransactions)
        .values({
          tenantId,
          appointmentId: trustedPayload.appointmentId,
          totalAmount: grandTotalInCents,
          paymentStatus: 'SUCCEEDED',
          paymentMethod: trustedPayload.paymentMethod,
          purchasedProducts: trustedPayload.purchasedProducts,
          stripePaymentIntentId: stripeCheckout.paymentIntentId,
          purpose: 'point_of_sale',
        })
        .returning();

      const insertedComponents = [];
      for (const comp of finalComponents) {
        const isStripeComponent = comp.method === 'STRIPE_TERMINAL';
        const [inserted] = await tx.insert(checkoutPaymentComponents).values({
          checkoutTransactionId: transaction.id,
          tenantId,
          paymentMethod: comp.method,
          amountInCents: comp.amountInCents,
          externalProvider: comp.externalProvider,
          externalProviderName: comp.externalProviderName,
          externalReference: comp.externalReference,
          methodDescription: comp.methodDescription,
          verificationSource: isStripeComponent ? stripeCheckout.verificationSource : 'STAFF_CONFIRMED',
          providerPaymentId: isStripeComponent
            ? stripeCheckout.paymentIntentId || comp.externalReference || null
            : null,
          staffUserId: authUserId,
        }).returning();
        insertedComponents.push({
          ...inserted,
          verificationSource: inserted.verificationSource as 'PROVIDER_CONFIRMED' | 'STAFF_CONFIRMED',
        });
      }

      await this.payments.enqueuePaymentEmail(tx, tenantId, transaction.id, 'payment-confirmed', `payment-confirmed:${transaction.id}`);

      await tx.update(appointments)
        .set({
          status: 'COMPLETED',
          paymentStatus: 'FullyPaid',
          idempotencyKey: trustedPayload.idempotencyKey,
          updatedAt: sql`NOW()`,
        })
        .where(eq(appointments.id, trustedPayload.appointmentId));

      if (appt.status !== 'COMPLETED') {
        await this.businessEvents.emit({
          id: stableEventId('APPOINTMENT_COMPLETED', appt.id, 'COMPLETED'),
          tenantId,
          type: 'APPOINTMENT_COMPLETED',
          occurredAt: new Date().toISOString(),
          sourceType: 'appointment',
          sourceId: appt.id,
          payload: { appointmentId: appt.id, previousStatus: appt.status, status: 'COMPLETED' },
        }, tx);
      }

      return {
        transactionId: transaction.id,
        appointment: {
          appointmentId: appt.id,
          clientId: appt.clientId,
          clientName: appt.clientName,
          serviceName,
        },
        calculation: {
          serviceAmountInCents,
          retailAmountInCents,
          tipAmountInCents: trustedPayload.tipAmountInCents,
          grandTotalInCents,
        },
        paymentMethod: transaction.paymentMethod as any,
        paymentComponents: insertedComponents,
        paymentStatus: transaction.paymentStatus,
        date: transaction.createdAt.toISOString(),
        items: receiptItems,
      };
    });

    return summary;
  }

  async getProducts(tenantId: string, limit: number, search?: string, inStockOnly?: boolean) {
    await this.entitlements.assertBoolean(tenantId, 'inventory.enabled');
    const tenantProducts = await this.repository.getProducts(tenantId, limit, search, inStockOnly);
    return tenantProducts.map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      priceInCents: p.priceInCents,
      stockQuantity: p.stockQuantity,
    }));
  }

  async getProductById(tenantId: string, productId: string) {
    await this.entitlements.assertBoolean(tenantId, 'inventory.enabled');
    const product = await this.repository.getProductById(tenantId, productId);
    if (!product) {
      throw fail('PRODUCT_NOT_FOUND', 'Product not found');
    }
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      priceInCents: product.priceInCents,
      stockQuantity: product.stockQuantity,
    };
  }
}
