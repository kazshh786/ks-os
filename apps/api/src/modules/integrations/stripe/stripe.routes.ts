import { FastifyInstance } from 'fastify';
import { StripeService } from './stripe.service.js';

export async function stripeRoutes(fastify: FastifyInstance) {
  const stripeService = new StripeService();

  fastify.addHook('preHandler', async (request, reply) => {
    await request.requireAuth();
    if (request.auth?.role !== 'owner') {
      return reply.status(403).send({ error: 'STRIPE_ACCESS_DENIED' });
    }
  });

  const maskStripeId = (id: string | null | undefined) => {
    if (!id) return null;
    const clean = id.replace(/^acct_/, '');
    if (clean.length <= 4) return `acct_••••${clean}`;
    return `acct_••••${clean.slice(-4)}`;
  };

  const handleError = (err: any, reply: any) => {
    const codeMap: Record<string, number> = {
      STRIPE_NOT_CONFIGURED: 500,
      STRIPE_CONNECTION_NOT_FOUND: 404,
      STRIPE_CONNECTION_ALREADY_EXISTS: 409,
      STRIPE_ACCOUNT_CREATE_FAILED: 502,
      STRIPE_ACCOUNT_RETRIEVE_FAILED: 502,
      STRIPE_ONBOARDING_LINK_FAILED: 502,
      STRIPE_SYNC_FAILED: 502,
      STRIPE_ACCESS_DENIED: 403,
      STRIPE_WEBHOOK_SIGNATURE_INVALID: 401,
      STRIPE_WEBHOOK_PROCESSING_FAILED: 500,
    };
    const status = codeMap[err.message] || 500;
    return reply.status(status).send({ error: err.message });
  };

  fastify.get('/', async (request, reply) => {
    const tenantId = request.auth!.tenantId;
    const connection = await stripeService.getConnection(tenantId);

    if (!connection) {
      return reply.send({ data: null });
    }

    return reply.send({
      data: {
        ...connection,
        stripeAccountId: maskStripeId(connection.stripeAccountId)
      }
    });
  });

  fastify.post('/connect', async (request, reply) => {
    const tenantId = request.auth!.tenantId;
    try {
      const connection = await stripeService.connectAccount(tenantId);
      return reply.send({
        data: {
          ...connection,
          stripeAccountId: maskStripeId(connection.stripeAccountId)
        }
      });
    } catch (err: any) {
      return handleError(err, reply);
    }
  });

  fastify.post('/onboarding-link', async (request, reply) => {
    const tenantId = request.auth!.tenantId;
    try {
      const url = await stripeService.createOnboardingLink(tenantId);
      return reply.send({ url });
    } catch (err: any) {
      return handleError(err, reply);
    }
  });

  fastify.post('/sync', async (request, reply) => {
    const tenantId = request.auth!.tenantId;
    try {
      const connection = await stripeService.syncConnection(tenantId);
      return reply.send({
        data: {
          ...connection,
          stripeAccountId: maskStripeId(connection.stripeAccountId)
        }
      });
    } catch (err: any) {
      return handleError(err, reply);
    }
  });
}

export async function stripeAdminRoutes(fastify: FastifyInstance) {
  const stripeService = new StripeService();

  fastify.get('/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const connection = await stripeService.getConnection(tenantId);
    
    if (!connection) {
      return reply.status(404).send({ error: 'STRIPE_CONNECTION_NOT_FOUND' });
    }

    return reply.send({
      data: connection
    });
  });
}
