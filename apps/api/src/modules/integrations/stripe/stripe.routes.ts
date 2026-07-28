import { FastifyInstance } from 'fastify';
import { StripeService } from './stripe.service.js';

const maskStripeId = (id: string | null | undefined) => {
  if (!id) return null;
  const clean = id.replace(/^acct_/, '');
  return `acct_••••${clean.slice(-4)}`;
};

const presentConnection = (connection: any) => connection ? {
  ...connection,
  stripeAccountId: maskStripeId(connection.stripeAccountId),
} : null;

export async function stripeRoutes(fastify: FastifyInstance) {
  const stripeService = new StripeService();

  fastify.addHook('preHandler', async (request, reply) => {
    await request.requireAuth();
    if (request.auth?.role !== 'owner') {
      return reply.status(403).send({ error: { code: 'STRIPE_ACCESS_DENIED', message: 'Only the account owner can manage Stripe.' } });
    }
  });

  const handleError = (err: any, reply: any) => {
    const code = err?.message || err?.name || 'STRIPE_REQUEST_FAILED';
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
      TENANT_NOT_FOUND: 404,
    };
    const messageMap: Record<string, string> = {
      STRIPE_NOT_CONFIGURED: 'Stripe is not configured for this environment.',
      STRIPE_CONNECTION_NOT_FOUND: 'No Stripe connection has been started for this business.',
      STRIPE_ACCOUNT_CREATE_FAILED: 'Stripe could not start the account setup. Please try again.',
      STRIPE_ACCOUNT_RETRIEVE_FAILED: 'Stripe account status is temporarily unavailable.',
      STRIPE_ONBOARDING_LINK_FAILED: 'Stripe could not create a secure setup link. Please try again.',
      STRIPE_SYNC_FAILED: 'Stripe account status could not be refreshed.',
      STRIPE_ACCESS_DENIED: 'Only the account owner can manage Stripe.',
      TENANT_NOT_FOUND: 'The business account could not be found.',
    };
    return reply.status(codeMap[code] || 500).send({
      error: {
        code,
        message: messageMap[code] || 'The Stripe request could not be completed.',
      },
    });
  };

  const connectionHandler = async (request: any, reply: any) => {
    const tenantId = request.auth!.tenantId;
    const connection = await stripeService.getFreshConnection(tenantId);
    return reply.send({ data: presentConnection(connection) });
  };

  fastify.get('/', connectionHandler);
  fastify.get('/connection', connectionHandler);

  const onboardingHandler = async (request: any, reply: any) => {
    const tenantId = request.auth!.tenantId;
    try {
      const result = await stripeService.startOnboarding(tenantId);
      return reply.send({
        data: presentConnection(result.connection),
        url: result.url,
      });
    } catch (err: any) {
      request.log.error({ err }, 'Could not start Stripe Connect onboarding');
      return handleError(err, reply);
    }
  };

  // Both endpoints are intentionally idempotent. They create an account only
  // once, then generate a fresh single-use Stripe-hosted onboarding link.
  fastify.post('/connect', onboardingHandler);
  fastify.post('/start', onboardingHandler);
  fastify.post('/onboarding-link', onboardingHandler);

  fastify.post('/sync', async (request, reply) => {
    const tenantId = request.auth!.tenantId;
    try {
      const connection = await stripeService.syncConnection(tenantId);
      return reply.send({ data: presentConnection(connection) });
    } catch (err: any) {
      request.log.error({ err }, 'Could not refresh Stripe Connect status');
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

    return reply.send({ data: connection });
  });
}
