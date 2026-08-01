import type { FastifyPluginAsync } from 'fastify';
import {
  RetailSaleCheckoutRequestSchema,
  RetailSalePreviewRequestSchema,
  StartRetailStripeOnlinePaymentRequestSchema,
  StartRetailStripePaymentRequestSchema,
} from '@ks-os/contracts';
import { EntitlementService } from '../agency/agency.service.js';
import { RetailPosService } from './retail-pos.service.js';
import { PosOnlineStripeService } from './pos-online-stripe.service.js';

const errorCode = (error: any, fallback: string) => error?.code || error?.name || fallback;

const statusFor = (code: string) => {
  if (code === 'PRODUCT_NOT_FOUND') return 404;
  if (code === 'ENTITLEMENT_REQUIRED' || code === 'POS_ACCESS_DENIED') return 403;
  if (
    code === 'INSUFFICIENT_STOCK'
    || code === 'CHECKOUT_CONFLICT'
    || code === 'STRIPE_ACCOUNT_NOT_READY'
    || code === 'STRIPE_READER_OFFLINE'
    || code === 'STRIPE_READER_BUSY'
    || code === 'STRIPE_READER_NOT_SERVER_DRIVEN'
    || code === 'STRIPE_PAYMENT_NOT_SUCCEEDED'
    || code === 'STRIPE_PAYMENT_AMOUNT_MISMATCH'
    || code === 'STRIPE_PAYMENT_MISMATCH'
  ) return 409;
  if (
    code === 'EMPTY_POS_SALE'
    || code === 'INVALID_PAYMENT_METHOD'
    || code === 'INVALID_PAYMENT_COMPONENTS'
    || code === 'INVALID_PAYMENT_COMPONENT_AMOUNT'
    || code === 'INVALID_PAYMENT_TOTAL'
    || code === 'STRIPE_CONFIRMATION_REQUIRED'
    || code === 'STRIPE_PAYMENT_INTENT_REQUIRED'
    || code === 'STRIPE_MANUAL_CONFIRMATION_REQUIRED'
  ) return 400;
  return 500;
};

const retailPosRoutes: FastifyPluginAsync = async fastify => {
  const service = new RetailPosService();
  const entitlements = new EntitlementService();
  const onlineStripe = new PosOnlineStripeService();

  fastify.addHook('preHandler', async request => {
    request.requireAuth();
    await entitlements.assertBoolean(request.auth!.tenantId, 'pos.enabled');
  });

  fastify.post('/api/v1/pos/retail/preview', async (request, reply) => {
    const parsed = RetailSalePreviewRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Check the retail sale basket.', details: parsed.error.format() },
      });
    }

    try {
      const data = await service.preview(request.auth!.tenantId, parsed.data);
      return reply.send({ success: true, data });
    } catch (error: any) {
      const code = errorCode(error, 'RETAIL_PREVIEW_FAILED');
      const status = statusFor(code);
      return reply.status(status).send({
        error: { code: status === 500 ? 'RETAIL_PREVIEW_FAILED' : code, message: status === 500 ? 'The retail total could not be calculated.' : error.message },
      });
    }
  });


fastify.post('/api/v1/pos/retail/stripe/online-sessions', async (request, reply) => {
  const parsed = StartRetailStripeOnlinePaymentRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: 'Check the online retail payment request.', details: parsed.error.format() },
    });
  }

  try {
    const totals = await service.preview(request.auth!.tenantId, {
      paymentMethod: 'STRIPE_ONLINE',
      tipAmountInCents: parsed.data.tipAmountInCents,
      purchasedProducts: parsed.data.purchasedProducts,
    });
    const data = await onlineStripe.createSession({
      tenantId: request.auth!.tenantId,
      amountInCents: totals.grandTotalInCents,
      presentation: parsed.data.presentation,
      context: { kind: 'RETAIL', idempotencyKey: parsed.data.idempotencyKey },
    });
    return reply.status(201).send({ success: true, data });
  } catch (error: any) {
    const code = errorCode(error, 'RETAIL_STRIPE_ONLINE_PAYMENT_FAILED');
    const status = statusFor(code);
    request.log.error({ err: error }, 'Could not start standalone retail online payment');
    return reply.status(status === 500 && code === 'STRIPE_PUBLISHABLE_KEY_MISSING' ? 409 : status).send({
      error: { code, message: error.message || 'The online retail payment could not be started.' },
    });
  }
});

  fastify.post('/api/v1/pos/retail/stripe/payment-intents', async (request, reply) => {
    const parsed = StartRetailStripePaymentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Check the Stripe reader payment request.', details: parsed.error.format() },
      });
    }

    try {
      const data = await service.startReaderPayment(request.auth!.tenantId, parsed.data);
      return reply.status(201).send({ success: true, data });
    } catch (error: any) {
      const code = errorCode(error, 'RETAIL_STRIPE_PAYMENT_FAILED');
      const status = statusFor(code);
      request.log.error({ err: error }, 'Could not start standalone retail Stripe payment');
      return reply.status(status).send({
        error: { code: status === 500 ? 'RETAIL_STRIPE_PAYMENT_FAILED' : code, message: status === 500 ? 'The Stripe payment could not be started.' : error.message },
      });
    }
  });

  fastify.post('/api/v1/pos/retail/checkout', async (request, reply) => {
    const parsed = RetailSaleCheckoutRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Check the retail checkout details.', details: parsed.error.format() },
      });
    }

    try {
      const result = await service.complete(
        request.auth!.tenantId,
        request.auth!.tenantUserId,
        parsed.data,
      );
      return reply.send({
        success: true,
        data: result.summary,
        message: result.idempotent ? 'Retail sale retrieved idempotently' : 'Retail sale completed successfully',
      });
    } catch (error: any) {
      const code = errorCode(error, 'RETAIL_CHECKOUT_FAILED');
      const status = statusFor(code);
      request.log.error({ err: error }, 'Standalone retail checkout failed');
      return reply.status(status).send({
        error: { code: status === 500 ? 'RETAIL_CHECKOUT_FAILED' : code, message: status === 500 ? 'The retail sale could not be completed.' : error.message },
      });
    }
  });
};

export default retailPosRoutes;
