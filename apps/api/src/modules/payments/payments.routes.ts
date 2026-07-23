import { FastifyInstance } from 'fastify';
import { PaymentsService } from './payments.service.js';
import { PaymentHistoryQuerySchema, CreateRefundRequestSchema } from '@ks-os/contracts';

export async function paymentRoutes(fastify: FastifyInstance) {
  const service = new PaymentsService();

  fastify.get('/', async (request, reply) => {
    request.requireAuth();
    if (!request.auth || request.auth.role !== 'owner') {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const tenantId = request.auth!.tenantId;
    const query = PaymentHistoryQuerySchema.parse(request.query);
    const history = await service.getPaymentHistory(tenantId, query);
    return reply.send({ data: history });
  });

  fastify.get('/:transactionId', async (request, reply) => {
    request.requireAuth();
    if (!request.auth || request.auth.role !== 'owner') {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const tenantId = request.auth!.tenantId;
    const { transactionId } = request.params as { transactionId: string };
    const detail = await service.getPaymentDetail(tenantId, transactionId);

    if (!detail) {
      return reply.code(404).send({ error: 'Transaction not found' });
    }

    return reply.send(detail);
  });

  fastify.post('/:transactionId/refunds', async (request, reply) => {
    request.requireAuth();
    if (!request.auth || request.auth.role !== 'owner') {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const tenantId = request.auth!.tenantId;
    const authUserId = request.auth!.tenantUserId;
    const { transactionId } = request.params as { transactionId: string };
    const reqData = CreateRefundRequestSchema.parse(request.body);

    try {
      const response = await service.createRefund(tenantId, transactionId, authUserId, reqData);
      return reply.send(response);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
}
