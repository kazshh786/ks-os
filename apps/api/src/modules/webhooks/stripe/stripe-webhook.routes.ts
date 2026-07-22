import { FastifyInstance } from 'fastify';
import { StripeWebhookService } from './stripe-webhook.service.js';

export async function stripeWebhookRoutes(fastify: FastifyInstance) {
  const stripeWebhookService = new StripeWebhookService();

  fastify.post('/connect', { config: { rawBody: true } }, async (request, reply) => {
    const signature = request.headers['stripe-signature'];

    if (!signature) {
      return reply.status(400).send({ error: 'Missing stripe-signature header' });
    }

    if (!request.rawBody) {
      return reply.status(400).send({ error: 'Missing raw body' });
    }

    try {
      const sigStr = Array.isArray(signature) ? signature[0] : signature;
      const result = await stripeWebhookService.handleConnectWebhook(request.rawBody, sigStr);
      return reply.send(result);
    } catch (err: any) {
      request.log.error(err);
      const codeMap: Record<string, number> = {
        STRIPE_WEBHOOK_SIGNATURE_INVALID: 401,
        STRIPE_NOT_CONFIGURED: 500,
        STRIPE_WEBHOOK_PROCESSING_FAILED: 500,
      };
      const status = codeMap[err.message] || 400;
      return reply.status(status).send({ error: err.message });
    }
  });
}
