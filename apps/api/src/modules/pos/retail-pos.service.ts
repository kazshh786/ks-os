import { and, eq, sql } from 'drizzle-orm';
import {
  checkoutPaymentComponents,
  getDatabase,
  products,
} from '@ks-os/database';
import type {
  PaymentComponentInput,
  RetailSaleCheckoutRequest,
  RetailSalePreviewRequest,
  RetailSaleSummary,
} from '@ks-os/contracts';
import { EntitlementService } from '../agency/agency.service.js';
import { getFinalPaymentComponents, validatePaymentMethod } from './pos.calculator.js';
import { PosStripeService } from './pos-stripe.service.js';
import { RetailPosStripeService } from './retail-pos-stripe.service.js';

const fail = (name: string, message: string) => {
  const error = new Error(message) as Error & { code?: string };
  error.name = name;
  error.code = name;
  return error;
};

const customerLabel = 'Walk-in retail customer';

export class RetailPosService {
  private readonly db = getDatabase();
  private readonly entitlements = new EntitlementService();
  private readonly stripe = new RetailPosStripeService();
  private readonly posStripe = new PosStripeService();

  private async assertAccess(tenantId: string) {
    await this.entitlements.assertBoolean(tenantId, 'inventory.enabled');
  }

  private idempotentSummary(row: any): RetailSaleSummary {
    return {
      transactionId: row.id,
      customerLabel,
      calculation: {
        serviceAmountInCents: 0,
        retailAmountInCents: Number(row.total_amount),
        tipAmountInCents: 0,
        grandTotalInCents: Number(row.total_amount),
      },
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      date: new Date(row.created_at).toISOString(),
      items: [],
    };
  }

  private async findExistingSale(tenantId: string, idempotencyKey: string, executor: any = this.db) {
    const result = await executor.execute(sql`
      SELECT id, total_amount, payment_method, payment_status, created_at
      FROM checkout_transactions
      WHERE tenant_id = ${tenantId}::uuid
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `);
    return result.rows?.[0] || null;
  }

  async preview(tenantId: string, payload: RetailSalePreviewRequest) {
    await this.assertAccess(tenantId);
    if (!payload.purchasedProducts.length) throw fail('EMPTY_POS_SALE', 'Add at least one product before taking payment.');

    let retailAmountInCents = 0;
    for (const item of payload.purchasedProducts) {
      const [product] = await this.db.select()
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.id, item.productId)))
        .limit(1);
      if (!product) throw fail('PRODUCT_NOT_FOUND', 'A product in the basket no longer exists.');
      if (product.stockQuantity < item.quantity) throw fail('INSUFFICIENT_STOCK', `Only ${product.stockQuantity} ${product.name} remain in stock.`);
      retailAmountInCents += product.priceInCents * item.quantity;
    }

    const grandTotalInCents = retailAmountInCents + payload.tipAmountInCents;
    if (grandTotalInCents <= 0) throw fail('INVALID_PAYMENT_TOTAL', 'The payment total must be greater than zero.');
    validatePaymentMethod(payload.paymentMethod, grandTotalInCents, payload.paymentComponents);

    return {
      serviceAmountInCents: 0,
      retailAmountInCents,
      tipAmountInCents: payload.tipAmountInCents,
      grandTotalInCents,
    };
  }

  private async prepareStripeCheckout(
    tenantId: string,
    payload: RetailSaleCheckoutRequest,
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
    if (!confirmation) throw fail('STRIPE_CONFIRMATION_REQUIRED', 'Stripe payment confirmation is required.');

    const connection = await this.posStripe.getConnectionSummary(tenantId);
    if (!connection.ready) throw fail('STRIPE_ACCOUNT_NOT_READY', 'The connected Stripe account is not ready to take payments.');

    let verificationSource: 'PROVIDER_CONFIRMED' | 'STAFF_CONFIRMED' = 'STAFF_CONFIRMED';
    let paymentIntentId: string | null = null;

    if (confirmation.mode === 'AUTOMATED_TERMINAL' && !confirmation.paymentIntentId) {
      throw fail('STRIPE_PAYMENT_INTENT_REQUIRED', 'The automated terminal payment is missing its Stripe PaymentIntent.');
    }

    if (confirmation.paymentIntentId) {
      const paymentIntent = await this.stripe.assertPaymentSucceeded({
        tenantId,
        idempotencyKey: payload.idempotencyKey,
        paymentIntentId: confirmation.paymentIntentId,
        expectedAmountInCents,
      });
      paymentIntentId = paymentIntent.id;
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
        externalReference: paymentIntentId || confirmation.manualReference || undefined,
      }],
      paymentIntentId,
      verificationSource,
    };
  }

  async complete(
    tenantId: string,
    authUserId: string,
    payload: RetailSaleCheckoutRequest,
  ): Promise<{ summary: RetailSaleSummary; idempotent: boolean }> {
    await this.assertAccess(tenantId);

    const existing = await this.findExistingSale(tenantId, payload.idempotencyKey);
    if (existing) return { summary: this.idempotentSummary(existing), idempotent: true };

    const preview = await this.preview(tenantId, payload);
    const stripeCheckout = await this.prepareStripeCheckout(tenantId, payload, preview.grandTotalInCents);
    const trustedComponents = stripeCheckout.trustedComponents;

    try {
      const summary: RetailSaleSummary = await this.db.transaction(async tx => {
        const existingInside = await this.findExistingSale(tenantId, payload.idempotencyKey, tx);
        if (existingInside) return this.idempotentSummary(existingInside);

        let retailAmountInCents = 0;
        const receiptItems: RetailSaleSummary['items'] = [];

        for (const item of payload.purchasedProducts) {
          const [product] = await tx.select({
            id: products.id,
            name: products.name,
            priceInCents: products.priceInCents,
            stockQuantity: products.stockQuantity,
          })
            .from(products)
            .where(and(eq(products.tenantId, tenantId), eq(products.id, item.productId)))
            .limit(1)
            .for('update');

          if (!product) throw fail('PRODUCT_NOT_FOUND', 'A product in the basket no longer exists.');
          if (product.stockQuantity < item.quantity) throw fail('INSUFFICIENT_STOCK', `Only ${product.stockQuantity} ${product.name} remain in stock.`);

          const [updated] = await tx.update(products)
            .set({
              stockQuantity: sql`${products.stockQuantity} - ${item.quantity}`,
              updatedAt: sql`NOW()`,
            })
            .where(and(
              eq(products.tenantId, tenantId),
              eq(products.id, item.productId),
              sql`${products.stockQuantity} >= ${item.quantity}`,
            ))
            .returning({ id: products.id });
          if (!updated) throw fail('INSUFFICIENT_STOCK', `There is not enough ${product.name} in stock.`);

          const lineTotal = product.priceInCents * item.quantity;
          retailAmountInCents += lineTotal;
          receiptItems.push({
            name: product.name,
            quantity: item.quantity,
            priceInCents: product.priceInCents,
            totalInCents: lineTotal,
          });
        }

        const grandTotalInCents = retailAmountInCents + payload.tipAmountInCents;
        if (grandTotalInCents !== preview.grandTotalInCents) {
          throw fail('CHECKOUT_CONFLICT', 'The checkout total changed. Review the basket and try again.');
        }

        const finalComponents = getFinalPaymentComponents(
          payload.paymentMethod,
          grandTotalInCents,
          trustedComponents,
        );
        validatePaymentMethod(payload.paymentMethod, grandTotalInCents, finalComponents);

        const insertedResult = await tx.execute(sql`
          INSERT INTO checkout_transactions (
            tenant_id,
            appointment_id,
            total_amount,
            payment_status,
            payment_method,
            purchased_products,
            stripe_payment_intent_id,
            purpose,
            idempotency_key
          ) VALUES (
            ${tenantId}::uuid,
            NULL,
            ${grandTotalInCents},
            'SUCCEEDED',
            ${payload.paymentMethod},
            ${JSON.stringify(payload.purchasedProducts)}::jsonb,
            ${stripeCheckout.paymentIntentId},
            'point_of_sale',
            ${payload.idempotencyKey}
          )
          RETURNING id, total_amount, payment_method, payment_status, created_at
        `);
        const transaction = insertedResult.rows[0] as any;

        const insertedComponents: NonNullable<RetailSaleSummary['paymentComponents']> = [];
        for (const component of finalComponents as PaymentComponentInput[]) {
          const isStripe = component.method === 'STRIPE_TERMINAL';
          const [inserted] = await tx.insert(checkoutPaymentComponents).values({
            checkoutTransactionId: transaction.id,
            tenantId,
            paymentMethod: component.method,
            amountInCents: component.amountInCents,
            externalProvider: component.externalProvider,
            externalProviderName: component.externalProviderName,
            externalReference: component.externalReference,
            methodDescription: component.methodDescription,
            verificationSource: isStripe ? stripeCheckout.verificationSource : 'STAFF_CONFIRMED',
            providerPaymentId: isStripe
              ? stripeCheckout.paymentIntentId || component.externalReference || null
              : null,
            staffUserId: authUserId,
          }).returning();
          insertedComponents.push({
            id: inserted.id,
            method: component.method,
            amountInCents: inserted.amountInCents,
            verificationSource: inserted.verificationSource as 'PROVIDER_CONFIRMED' | 'STAFF_CONFIRMED',
            ...(inserted.externalProvider ? { externalProvider: inserted.externalProvider } : {}),
            ...(inserted.externalProviderName ? { externalProviderName: inserted.externalProviderName } : {}),
            ...(inserted.externalReference ? { externalReference: inserted.externalReference } : {}),
            ...(inserted.methodDescription ? { methodDescription: inserted.methodDescription } : {}),
          });
        }

        return {
          transactionId: transaction.id,
          customerLabel,
          calculation: {
            serviceAmountInCents: 0,
            retailAmountInCents,
            tipAmountInCents: payload.tipAmountInCents,
            grandTotalInCents,
          },
          paymentMethod: payload.paymentMethod,
          paymentComponents: insertedComponents,
          paymentStatus: transaction.payment_status,
          date: new Date(transaction.created_at).toISOString(),
          items: receiptItems,
        };
      });

      return { summary, idempotent: summary.items.length === 0 };
    } catch (error: any) {
      if (error?.code === '23505') {
        const concurrent = await this.findExistingSale(tenantId, payload.idempotencyKey);
        if (concurrent) return { summary: this.idempotentSummary(concurrent), idempotent: true };
      }
      throw error;
    }
  }

  async startReaderPayment(tenantId: string, payload: {
    readerId: string;
    idempotencyKey: string;
    tipAmountInCents: number;
    purchasedProducts: RetailSalePreviewRequest['purchasedProducts'];
  }) {
    const totals = await this.preview(tenantId, {
      paymentMethod: 'STRIPE_TERMINAL',
      tipAmountInCents: payload.tipAmountInCents,
      purchasedProducts: payload.purchasedProducts,
    });
    return this.stripe.startReaderPayment({
      tenantId,
      readerId: payload.readerId,
      amountInCents: totals.grandTotalInCents,
      idempotencyKey: payload.idempotencyKey,
    });
  }
}
