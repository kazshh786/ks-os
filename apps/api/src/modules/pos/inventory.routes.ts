import type { FastifyPluginAsync } from 'fastify';
import {
  AdjustProductStockRequestSchema,
  CreateProductRequestSchema,
  ImportProductsRequestSchema,
  UpdateProductRequestSchema,
} from '@ks-os/contracts';
import { InventoryService } from './inventory.service.js';

const codeFor = (error: any) => error?.code || error?.name || 'INVENTORY_OPERATION_FAILED';

const inventoryRoutes: FastifyPluginAsync = async fastify => {
  const service = new InventoryService();

  fastify.addHook('preHandler', async request => {
    request.requireAuth();
    if (request.auth!.role !== 'owner') {
      const error = new Error('Only workspace owners can manage inventory.') as Error & { code?: string };
      error.code = 'INVENTORY_ACCESS_DENIED';
      throw error;
    }
  });

  const sendError = (reply: any, error: any) => {
    const code = codeFor(error);
    const status = code === 'PRODUCT_NOT_FOUND' ? 404
      : code === 'PRODUCT_SKU_EXISTS' || code === 'INSUFFICIENT_STOCK' ? 409
        : code === 'ENTITLEMENT_REQUIRED' || code === 'INVENTORY_ACCESS_DENIED' ? 403
          : 400;
    return reply.status(status).send({
      error: {
        code,
        message: error?.message || 'Inventory could not be updated.',
      },
    });
  };

  fastify.post('/api/v1/products', async (request, reply) => {
    const parsed = CreateProductRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Check the product details.', details: parsed.error.format() } });
    }
    try {
      const product = await service.createProduct(request.auth!.tenantId, parsed.data);
      return reply.status(201).send({ success: true, data: product });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.patch('/api/v1/products/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const parsed = UpdateProductRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Check the product details.', details: parsed.error.format() } });
    }
    try {
      const product = await service.updateProduct(request.auth!.tenantId, productId, parsed.data);
      return reply.send({ success: true, data: product });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post('/api/v1/products/:productId/stock-adjustments', async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const parsed = AdjustProductStockRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid stock adjustment.', details: parsed.error.format() } });
    }
    try {
      const product = await service.adjustStock(request.auth!.tenantId, productId, parsed.data);
      return reply.send({ success: true, data: product });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post('/api/v1/products/import', async (request, reply) => {
    const parsed = ImportProductsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Check the imported product rows.', details: parsed.error.format() } });
    }
    try {
      const result = await service.importProducts(request.auth!.tenantId, parsed.data);
      return reply.send({ success: true, data: result });
    } catch (error) {
      return sendError(reply, error);
    }
  });
};

export default inventoryRoutes;
