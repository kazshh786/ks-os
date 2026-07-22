import { PosRepository } from './pos.repository.js';
import { getPosAppointmentFilter } from './pos.permissions.js';
import { calculateGrandTotal, validatePaymentMethod, getFinalPaymentComponents } from './pos.calculator.js';
import { getDatabase } from '@ks-os/database';
import { appointments, checkoutTransactions, checkoutPaymentComponents, products, services } from '@ks-os/database';
import { eq, and, sql } from 'drizzle-orm';
import { BusinessEventsService, stableEventId } from '../automations/business-events.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { TransactionSummary } from '@ks-os/contracts';

export class PosService {
  private readonly businessEvents = new BusinessEventsService();
  private readonly payments = new PaymentsService();
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

  async previewCheckout(tenantId: string, role: string, authUserId: string, payload: any) {
    const roleFilter = getPosAppointmentFilter(role, authUserId);
    const apptRow = await this.repository.getAppointmentForPreview(tenantId, payload.appointmentId, roleFilter);

    if (!apptRow || !apptRow.appointment) {
      const err = new Error('Appointment not found');
      err.name = 'POS_APPOINTMENT_NOT_FOUND';
      throw err;
    }

    const appt = apptRow.appointment;
    let serviceAmountInCents = appt.quotedAmount;
    if (!serviceAmountInCents || serviceAmountInCents <= 0) {
      serviceAmountInCents = apptRow.service ? apptRow.service.price : 0;
    }

    let retailAmountInCents = 0;
    for (const item of payload.purchasedProducts) {
      const product = await this.repository.getProductForPreview(tenantId, item.productId);

      if (!product) {
        const err = new Error(`Product ${item.productId} not found`);
        err.name = 'PRODUCT_NOT_FOUND';
        throw err;
      }
      if (product.stockQuantity < item.quantity) {
        const err = new Error(`Insufficient stock for product ${product.name}`);
        err.name = 'INSUFFICIENT_STOCK';
        throw err;
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
      grandTotalInCents
    };
  }

  async completeCheckout(tenantId: string, role: string, authUserId: string, payload: any) {
    const db = this.repository.getRawDb();
    
    const summary: TransactionSummary | any = await db.transaction(async (tx) => {
      const baseConditions = [
        eq(appointments.id, payload.appointmentId),
        eq(appointments.tenantId, tenantId)
      ];

      const [apptRow] = await tx.select({
        appointment: appointments,
        service: services
      })
        .from(appointments)
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(and(...baseConditions))
        .limit(1)
        .for('update');

      if (!apptRow || !apptRow.appointment) {
        const err = new Error('Appointment not found or belongs to another tenant');
        err.name = 'POS_APPOINTMENT_NOT_FOUND';
        throw err;
      }
      
      const appt = apptRow.appointment;
      
      if (role !== 'owner' && appt.userId !== authUserId) {
        const err = new Error('Access denied to checkout this appointment');
        err.name = 'POS_ACCESS_DENIED';
        throw err;
      }

      if (['CANCELLED', 'NO_SHOW', 'BLOCKED'].includes(appt.status)) {
        const err = new Error(`Cannot checkout ${appt.status.toLowerCase()} appointment`);
        err.name = 'POS_APPOINTMENT_NOT_ELIGIBLE';
        throw err;
      }

      const [existingTx] = await tx.select()
        .from(checkoutTransactions)
        .where(
          and(
            eq(checkoutTransactions.appointmentId, payload.appointmentId),
            eq(checkoutTransactions.paymentStatus, 'SUCCEEDED')
          )
        )
        .limit(1);

      if (existingTx) {
        if (appt.idempotencyKey === payload.idempotencyKey) {
           return { __isIdempotentHit: true, existingTx, appt, service: apptRow.service };
        }
        const err = new Error('Appointment has already been checked out successfully.');
        err.name = 'POS_ALREADY_COMPLETED';
        throw err;
      }

      let serviceAmountInCents = appt.quotedAmount;
      let serviceName = apptRow.service?.name || 'Custom Service';
      
      if (!serviceAmountInCents || serviceAmountInCents <= 0) {
        serviceAmountInCents = apptRow.service ? apptRow.service.price : 0;
      }

      let retailAmountInCents = 0;
      const receiptItems: TransactionSummary['items'] = [];
      
      receiptItems.push({
        name: serviceName,
        quantity: 1,
        priceInCents: serviceAmountInCents,
        totalInCents: serviceAmountInCents
      });

      for (const item of payload.purchasedProducts) {
        if (item.quantity < 1) {
          const err = new Error(`Requested quantity must be >= 1`);
          err.name = 'INVALID_PRODUCT_QUANTITY';
          throw err;
        }
        
        const [product] = await tx.select({ priceInCents: products.priceInCents, name: products.name })
          .from(products)
          .where(
            and(
              eq(products.id, item.productId),
              eq(products.tenantId, tenantId)
            )
          )
          .limit(1)
          .for('update');

        if (!product) {
          const err = new Error(`Product ${item.productId} not found`);
          err.name = 'PRODUCT_NOT_FOUND';
          throw err;
        }

        const [updatedProduct] = await tx.update(products)
          .set({
            stockQuantity: sql`${products.stockQuantity} - ${item.quantity}`,
            updatedAt: sql`NOW()`
          })
          .where(
             and(
               eq(products.id, item.productId),
               sql`${products.stockQuantity} >= ${item.quantity}`
             )
          )
          .returning({ id: products.id });

        if (!updatedProduct) {
          const err = new Error(`Insufficient stock for product ${product.name}`);
          err.name = 'INSUFFICIENT_STOCK';
          throw err;
        }

        const lineTotal = product.priceInCents * item.quantity;
        retailAmountInCents += lineTotal;
        
        receiptItems.push({
          name: product.name,
          quantity: item.quantity,
          priceInCents: product.priceInCents,
          totalInCents: lineTotal
        });
      }

      const grandTotalInCents = calculateGrandTotal(serviceAmountInCents, retailAmountInCents, payload.tipAmountInCents);
      const finalComponents = getFinalPaymentComponents(payload.paymentMethod, grandTotalInCents, payload.paymentComponents, payload.splitAmounts);
      validatePaymentMethod(payload.paymentMethod, grandTotalInCents, finalComponents);

      const [transaction] = await tx.insert(checkoutTransactions)
        .values({
          tenantId: tenantId,
          appointmentId: payload.appointmentId,
          totalAmount: grandTotalInCents,
          paymentStatus: 'SUCCEEDED',
          paymentMethod: payload.paymentMethod,
          purchasedProducts: payload.purchasedProducts,
          purpose: 'point_of_sale'
        })
        .returning();

      // Insert components
      const insertedComponents = [];
      for (const comp of finalComponents) {
        const [inserted] = await tx.insert(checkoutPaymentComponents).values({
          checkoutTransactionId: transaction.id,
          tenantId: tenantId,
          paymentMethod: comp.method,
          amountInCents: comp.amountInCents,
          externalProvider: comp.externalProvider,
          externalProviderName: comp.externalProviderName,
          externalReference: comp.externalReference,
          methodDescription: comp.methodDescription,
          verificationSource: 'STAFF_CONFIRMED',
          staffUserId: authUserId,
        }).returning();
        insertedComponents.push({
           ...inserted,
           verificationSource: inserted.verificationSource as 'PROVIDER_CONFIRMED' | 'STAFF_CONFIRMED'
        });
      }

      await this.payments.enqueuePaymentEmail(tx, tenantId, transaction.id, 'payment-confirmed', `payment-confirmed:${transaction.id}`);

      const nextStatus = appt.status === 'COMPLETED' ? 'COMPLETED' : 'COMPLETED';
      await tx.update(appointments)
        .set({
          status: nextStatus,
          paymentStatus: 'FullyPaid',
          idempotencyKey: payload.idempotencyKey,
          updatedAt: sql`NOW()`
        })
        .where(eq(appointments.id, payload.appointmentId));

      if (appt.status !== 'COMPLETED') {
        await this.businessEvents.emit({
          id: stableEventId('APPOINTMENT_COMPLETED', appt.id, 'COMPLETED'), tenantId,
          type: 'APPOINTMENT_COMPLETED', occurredAt: new Date().toISOString(), sourceType: 'appointment', sourceId: appt.id,
          payload: { appointmentId: appt.id, previousStatus: appt.status, status: 'COMPLETED' },
        }, tx);
      }

      return {
        transactionId: transaction.id,
        appointment: {
          appointmentId: appt.id,
          clientId: appt.clientId,
          clientName: appt.clientName,
          serviceName: serviceName
        },
        calculation: {
          serviceAmountInCents,
          retailAmountInCents,
          tipAmountInCents: payload.tipAmountInCents,
          grandTotalInCents
        },
        paymentMethod: transaction.paymentMethod as any,
        paymentComponents: insertedComponents,
        paymentStatus: transaction.paymentStatus,
        date: transaction.createdAt.toISOString(),
        items: receiptItems
      };
    });

    return summary;
  }

  async getProducts(tenantId: string, limit: number, search?: string, inStockOnly?: boolean) {
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
    const product = await this.repository.getProductById(tenantId, productId);
    if (!product) {
      const err = new Error('Product not found');
      err.name = 'PRODUCT_NOT_FOUND';
      throw err;
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
