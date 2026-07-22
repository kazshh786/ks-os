import { FastifyPluginAsync } from 'fastify';
import { CheckoutPreviewRequestSchema, CheckoutRequestSchema, ProductListQuerySchema } from '@ks-os/contracts';
import { PosService } from './pos.service.js';
import { EntitlementService } from '../agency/agency.service.js';

const posRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new PosService();
  const entitlements = new EntitlementService();

  fastify.addHook('preHandler', async request => {
    request.requireAuth();
    await entitlements.assertBoolean(request.auth!.tenantId, 'pos.enabled');
  });

  // 1. Checkout Candidates Endpoint
  fastify.get('/api/v1/pos/appointments', async (request, reply) => {
    request.requireAuth();
    
    const candidates = await service.getCheckoutCandidates(
      request.auth!.tenantId,
      request.auth!.role,
      request.auth!.tenantUserId
    );

    return reply.send({
      success: true,
      data: candidates
    });
  });

  // 2. Checkout Preview Endpoint
  fastify.post('/api/v1/pos/checkout/preview', async (request, reply) => {
    request.requireAuth();

    const result = CheckoutPreviewRequestSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: result.error.format() }
      });
    }

    try {
      const data = await service.previewCheckout(
        request.auth!.tenantId,
        request.auth!.role,
        request.auth!.tenantUserId,
        result.data
      );

      return reply.send({
        success: true,
        data
      });
    } catch (error: any) {
      let status = 400;
      if (error.name === 'POS_APPOINTMENT_NOT_FOUND' || error.name === 'PRODUCT_NOT_FOUND') {
        status = 404;
      } else if (error.name === 'POS_ACCESS_DENIED') {
        status = 403;
      }
      return reply.status(status).send({ error: { code: error.name || 'PREVIEW_ERROR', message: error.message } });
    }
  });

  // 3. Complete Checkout Endpoint
  fastify.post('/api/v1/pos/checkout', async (request, reply) => {
    request.requireAuth();

    const result = CheckoutRequestSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid checkout payload', details: result.error.format() }
      });
    }

    try {
      const summary = await service.completeCheckout(
        request.auth!.tenantId,
        request.auth!.role,
        request.auth!.tenantUserId,
        result.data
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
                serviceName: serviceName
              },
              calculation: {
                serviceAmountInCents: 0,
                retailAmountInCents: 0,
                tipAmountInCents: 0,
                grandTotalInCents: existingTx.totalAmount
              },
              paymentMethod: existingTx.paymentMethod as any,
              paymentStatus: existingTx.paymentStatus,
              date: existingTx.createdAt.toISOString(),
              items: []
            }
         });
      }

      return reply.send({
        success: true,
        data: summary,
        message: 'Checkout completed successfully'
      });
    } catch (error: any) {
      const code = error.name || 'CHECKOUT_FAILED';
      let status = 400;
      let finalCode = code;
      
      switch (code) {
        case 'POS_APPOINTMENT_NOT_FOUND':
        case 'PRODUCT_NOT_FOUND':
          status = 404;
          break;
        case 'POS_ACCESS_DENIED':
          status = 403;
          break;
        case 'POS_APPOINTMENT_NOT_ELIGIBLE':
        case 'POS_ALREADY_COMPLETED':
        case 'INSUFFICIENT_STOCK':
        case 'CHECKOUT_CONFLICT':
          status = 409;
          break;
        case 'INVALID_PRODUCT_QUANTITY':
        case 'INVALID_PAYMENT_METHOD':
        case 'INVALID_PAYMENT_SPLIT':
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
          message: status === 500 ? 'Failed to process checkout transaction' : error.message
        }
      });
    }
  });

  // 4. Products endpoints (migrated from products.ts)
  fastify.get('/api/v1/products', async (request, reply) => {
    request.requireAuth();

    const queryResult = ProductListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: queryResult.error.format() }
      });
    }

    const { limit, search, inStockOnly } = queryResult.data;
    
    const products = await service.getProducts(request.auth!.tenantId, limit, search, inStockOnly);
      
    return reply.send({
      success: true,
      data: products
    });
  });

  fastify.get('/api/v1/products/:productId', async (request, reply) => {
    request.requireAuth();

    const { productId } = request.params as { productId: string };
    
    try {
      const product = await service.getProductById(request.auth!.tenantId, productId);

      return reply.send({
        success: true,
        data: product
      });
    } catch (error: any) {
      if (error.name === 'PRODUCT_NOT_FOUND') {
        return reply.status(404).send({
          error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' }
        });
      }
      return reply.status(400).send({
        error: { code: 'PRODUCT_ERROR', message: error.message }
      });
    }
  });
};

export default posRoutes;
