import { FastifyPluginAsync } from 'fastify';
import {
  CheckoutPreviewRequestSchema,
  CheckoutRequestSchema,
  ProductListQuerySchema,
  StartPosStripePaymentRequestSchema,
} from '@ks-os/contracts';
import { PosService } from './pos.service.js';
import { EntitlementService } from '../agency/agency.service.js';
import { PosStripeService } from './pos-stripe.service.js';

const errorCode = (error: any, fallback: string) => error?.code || error?.name || fallback;

const posRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new PosService();
  const entitlements = new EntitlementService();
  const stripe = new PosStripeService();

  fastify.addHook('preHandler', async request => {
    request.requireAuth();
    await entitlements.assertBoolean(request.auth!.tenantId, 'pos.enabled');
  });

  fastify.get('/api/v1/pos/config', async (request, reply) => {
    const tenantId = request.auth!.tenantId;
    const [resolved, stripeSummary] = await Promise.all([
      entitlements.resolve(tenantId),
      stripe.getConnectionSummary(tenantId),
    ]);

    const planKey = resolved.plan?.key;
    return reply.send({
      success: true,
      data: {
        plan: resolved.plan ? {
          key: planKey === 'GROWTH' || planKey === 'SCALE' ? planKey : 'CORE',
          name: resolved.plan.name,
          monthlyPriceMinor: resolved.plan.monthlyPriceMinor,
          currency: resolved.plan.currency,
        } : null,
        inventoryEnabled: resolved.entitlements['inventory.enabled']?.enabled === true,
        inventoryFromPriceMinor: 19700,
        stripe: stripeSummary,
      },
    });
  });

  fastify.get('/api/v1/pos/appointments', async (request, reply) => {
    const candidates = await service.getCheckoutCandidates(
      request.auth!.tenantId,
      request.auth!.role,
      request.auth!.tenantUserId,
    );

    return reply.send({ success: true, data: candidates });
  });

  fastify.post('/api/v1/pos/checkout/preview', async (request, reply) => {
    const result = CheckoutPreviewRequestSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: result.error.format() },
      });
    }

    try {
      const data = await service.previewCheckout(
        request.auth!.tenantId,
        request.auth!.role,
        request.auth!.tenantUserId,
        result.data,
      );
      return reply.send({ success: true, data });
    } catch (error: any) {
      const code = errorCode(error, 'PREVIEW_ERROR');
      let status = 400;
      if (code === 'POS_APPOINTMENT_NOT_FOUND' || code === 'PRODUCT_NOT_FOUND') status = 404;
      if (code === 'POS_ACCESS_DENIED' || code === 'ENTITLEMENT_REQUIRED') status = 403;
      if (code === 'INSUFFICIENT_STOCK') status = 409;
      return reply.status(status).send({ error: { code, message: error.message } });
    }
  });

  fastify.get('/api/v1/pos/stripe/readers', async (request, reply) => {
    try {
      const readers = await stripe.listReaders(request.auth!.tenantId);
      return reply.send({ success: true, data: readers });
    } catch (error: any) {
      const code = errorCode(error, 'STRIPE_READERS_FAILED');
      const status = code === 'STRIPE_CONNECTION_NOT_FOUND' ? 404 : code === 'STRIPE_ACCOUNT_NOT_READY' ? 409 : 502;
      request.log.error({ err: error }, 'Could not load Stripe Terminal readers');
      return reply.status(status).send({ error: { code, message: error.message || 'Stripe readers are unavailable.' } });
    }
  });

  fastify.post('/api/v1/pos/stripe/payment-intents', async (request, reply) => {
    const result = StartPosStripePaymentRequestSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid terminal payment request', details: result.error.format() },
      });
    }

    try {
      const totals = await service.previewCheckout(
        request.auth!.tenantId,
        request.auth!.role,
        request.auth!.tenantUserId,
        {
          appointmentId: result.data.appointmentId,
          paymentMethod: 'STRIPE_TERMINAL',
          tipAmountInCents: result.data.tipAmountInCents,
          purchasedProducts: result.data.purchasedProducts,
        },
      );

      const data = await stripe.startReaderPayment({
        tenantId: request.auth!.tenantId,
        appointmentId: result.data.appointmentId,
        readerId: result.data.readerId,
        amountInCents: totals.grandTotalInCents,
        idempotencyKey: result.data.idempotencyKey,
      });

      return reply.status(201).send({ success: true, data });
    } catch (error: any) {
      const code = errorCode(error, 'STRIPE_TERMINAL_PAYMENT_FAILED');
      let status = 502;
      if (code === 'POS_APPOINTMENT_NOT_FOUND' || code === 'PRODUCT_NOT_FOUND') status = 404;
      if (code === 'POS_ACCESS_DENIED' || code === 'ENTITLEMENT_REQUIRED') status = 403;
      if (
        code === 'INSUFFICIENT_STOCK'
        || code === 'STRIPE_ACCOUNT_NOT_READY'
        || code === 'STRIPE_READER_OFFLINE'
        || code === 'STRIPE_READER_BUSY'
        || code === 'STRIPE_READER_NOT_SERVER_DRIVEN'
      ) status = 409;
      if (code === 'INVALID_PAYMENT_TOTAL') status = 400;
      request.log.error({ err: error }, 'Could not start Stripe Terminal payment');
      return reply.status(status).send({ error: { code, message: error.message || 'The Stripe payment could not be started.' } });
    }
  });

  fastify.get('/api/v1/pos/stripe/payment-intents/:paymentIntentId', async (request, reply) => {
    const { paymentIntentId } = request.params as { paymentIntentId: string };
    if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid Stripe PaymentIntent ID.' } });
    }

    try {
      const data = await stripe.getPaymentStatus(request.auth!.tenantId, paymentIntentId);
      return reply.send({ success: true, data });
    } catch (error: any) {
      const code = errorCode(error, 'STRIPE_PAYMENT_STATUS_FAILED');
      const status = code === 'STRIPE_PAYMENT_NOT_FOUND' ? 404 : code === 'STRIPE_ACCOUNT_NOT_READY' ? 409 : 502;
      return reply.status(status).send({ error: { code, message: error.message || 'Stripe payment status is unavailable.' } });
    }
  });

  fastify.post('/api/v1/pos/checkout', async (request, reply) => {
    const result = CheckoutRequestSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid checkout payload', details: result.error.format() },
      });
    }

    try {
      const summary = await service.completeCheckout(
        request.auth!.tenantId,
        request.auth!.role,
        request.auth!.tenantUserId,
        result.data,
      );

      if (summary.__isIdempotentHit) {
        const appt = summary.appt;
        const existingTx = summary.existingTx;
        const serviceName = summary.service?.name || 'Custom Service';

        return reply.send({
          success: true,
          message: 'Checkout retrieved idempotently',
          data: {
            transactionId: existingTx.id,
            appointment: {
              appointmentId: appt.id,
              clientId: appt.clientId,
              clientName: appt.clientName,
              serviceName,
            },
            calculation: {
              serviceAmountInCents: 0,
              retailAmountInCents: 0,
              tipAmountInCents: 0,
              grandTotalInCents: existingTx.totalAmount,
            },
            paymentMethod: existingTx.paymentMethod as any,
            paymentStatus: existingTx.paymentStatus,
            date: existingTx.createdAt.toISOString(),
            items: [],
          },
        });
      }

      return reply.send({ success: true, data: summary, message: 'Checkout completed successfully' });
    } catch (error: any) {
      const code = errorCode(error, 'CHECKOUT_FAILED');
      let status = 400;
      let finalCode = code;

      switch (code) {
        case 'POS_APPOINTMENT_NOT_FOUND':
        case 'PRODUCT_NOT_FOUND':
        case 'STRIPE_PAYMENT_NOT_FOUND':
          status = 404;
          break;
        case 'POS_ACCESS_DENIED':
        case 'ENTITLEMENT_REQUIRED':
          status = 403;
          break;
        case 'POS_APPOINTMENT_NOT_ELIGIBLE':
        case 'POS_ALREADY_COMPLETED':
        case 'INSUFFICIENT_STOCK':
        case 'CHECKOUT_CONFLICT':
        case 'STRIPE_ACCOUNT_NOT_READY':
        case 'STRIPE_PAYMENT_NOT_SUCCEEDED':
        case 'STRIPE_PAYMENT_AMOUNT_MISMATCH':
        case 'STRIPE_PAYMENT_MISMATCH':
          status = 409;
          break;
        case 'INVALID_PRODUCT_QUANTITY':
        case 'INVALID_PAYMENT_METHOD':
        case 'INVALID_PAYMENT_SPLIT':
        case 'INVALID_PAYMENT_TOTAL':
        case 'STRIPE_CONFIRMATION_REQUIRED':
        case 'STRIPE_PAYMENT_INTENT_REQUIRED':
        case 'STRIPE_MANUAL_CONFIRMATION_REQUIRED':
          status = 400;
          break;
        default:
          status = 500;
          finalCode = 'CHECKOUT_FAILED';
          break;
      }

      request.log.error({ err: error }, 'Checkout failed');
      return reply.status(status).send({
        error: {
          code: finalCode,
          message: status === 500 ? 'Failed to process checkout transaction' : error.message,
        },
      });
    }
  });

  fastify.get('/api/v1/products', async (request, reply) => {
    const queryResult = ProductListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: queryResult.error.format() },
      });
    }

    const tenantId = request.auth!.tenantId;
    const resolved = await entitlements.resolve(tenantId);
    if (resolved.entitlements['inventory.enabled']?.enabled !== true) {
      return reply.send({ success: true, data: [] });
    }

    const { limit, search, inStockOnly } = queryResult.data;
    const products = await service.getProducts(tenantId, limit, search, inStockOnly);
    return reply.send({ success: true, data: products });
  });

  fastify.get('/api/v1/products/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };

    try {
      const product = await service.getProductById(request.auth!.tenantId, productId);
      return reply.send({ success: true, data: product });
    } catch (error: any) {
      const code = errorCode(error, 'PRODUCT_ERROR');
      if (code === 'PRODUCT_NOT_FOUND') {
        return reply.status(404).send({ error: { code, message: 'Product not found' } });
      }
      if (code === 'ENTITLEMENT_REQUIRED') {
        return reply.status(403).send({ error: { code, message: 'Inventory is available from the £197 package.' } });
      }
      return reply.status(400).send({ error: { code: 'PRODUCT_ERROR', message: error.message } });
    }
  });
};

export default posRoutes;
