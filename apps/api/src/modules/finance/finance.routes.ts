import { FastifyInstance, FastifyRequest } from 'fastify';
import { BalanceService } from './balance.service.js';
import { PayoutService } from './payout.service.js';
import { DisputeService } from './dispute.service.js';
import { PayoutListQuerySchema, DisputeListQuerySchema } from '@ks-os/contracts';

const rateLimits = {
  balance: new Map<string, number>(),
  payouts: new Map<string, number>(),
  disputes: new Map<string, number>()
};

function checkRateLimit(type: 'balance' | 'payouts' | 'disputes', tenantId: string, limitMs: number): boolean {
  const now = Date.now();
  const lastSync = rateLimits[type].get(tenantId) || 0;
  if (now - lastSync < limitMs) {
    return false;
  }
  rateLimits[type].set(tenantId, now);
  return true;
}

export async function financeRoutes(fastify: FastifyInstance) {
  const balanceService = new BalanceService();
  const payoutService = new PayoutService();
  const disputeService = new DisputeService();

  // Strict auth hook
  fastify.addHook('onRequest', async (request, reply) => {
    request.requireAuth();
    if (request.auth!.role !== 'owner') {
      return reply.status(403).send({ error: 'FORBIDDEN_ROLE' });
    }
  });

  fastify.get('/balance', async (request, reply) => {
    const balance = await balanceService.getBalance(request.auth!.tenantId);
    return balance;
  });

  fastify.get('/payouts', async (request, reply) => {
    const query = PayoutListQuerySchema.parse(request.query);
    const result = await payoutService.listPayouts(request.auth!.tenantId, query);
    return result;
  });

  fastify.get('/payouts/:payoutId', async (request: FastifyRequest<{ Params: { payoutId: string } }>, reply) => {
    const detail = await payoutService.getPayoutDetail(request.auth!.tenantId, request.params.payoutId);
    return detail;
  });

  fastify.get('/disputes', async (request, reply) => {
    const query = DisputeListQuerySchema.parse(request.query);
    const result = await disputeService.listDisputes(request.auth!.tenantId, query);
    return result;
  });

  fastify.get('/disputes/:disputeId', async (request: FastifyRequest<{ Params: { disputeId: string } }>, reply) => {
    const detail = await disputeService.getDisputeDetail(request.auth!.tenantId, request.params.disputeId);
    return detail;
  });

  fastify.post('/sync/balance', async (request, reply) => {
    if (!checkRateLimit('balance', request.auth!.tenantId, 60000)) { // 1 min limit
      return reply.status(429).send({ error: 'RATE_LIMIT_EXCEEDED' });
    }
    const result = await balanceService.syncBalance(request.auth!.tenantId);
    return result;
  });

  fastify.post('/sync/payouts', async (request, reply) => {
    if (!checkRateLimit('payouts', request.auth!.tenantId, 300000)) { // 5 min limit
      return reply.status(429).send({ error: 'RATE_LIMIT_EXCEEDED' });
    }
    const result = await payoutService.syncPayouts(request.auth!.tenantId);
    return result;
  });

  fastify.post('/sync/disputes', async (request, reply) => {
    if (!checkRateLimit('disputes', request.auth!.tenantId, 300000)) { // 5 min limit
      return reply.status(429).send({ error: 'RATE_LIMIT_EXCEEDED' });
    }
    const result = await disputeService.syncDisputes(request.auth!.tenantId);
    return result;
  });
}
