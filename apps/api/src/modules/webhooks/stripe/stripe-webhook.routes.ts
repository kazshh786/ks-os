import { FastifyInstance } from 'fastify';
import { StripeWebhookService } from './stripe-webhook.service.js';

export async function stripeWebhookRoutes(fastify: FastifyInstance) {
  const stripeWebhookService = new StripeWebhookService();

  const registerWebhook = (
    path: '/connect' | '/payments',
    handler: (rawBody: string | Buffer, signature: string) => Promise<unknown>,
  ) => fastify.post(path, { config: { rawBody: true } }, async (request, reply) => {
    const signature = request.headers['stripe-signature'];

    if (!signature) {
      return reply.status(400).send({ error: 'Missing stripe-signature header' });
    }

    if (!request.rawBody) {
      return reply.status(400).send({ error: 'Missing raw body' });
    }

    try {
      const sigStr = Array.isArray(signature) ? signature[0] : signature;
      const result = await handler(request.rawBody, sigStr);
      return reply.send(result);
    } catch (err: any) {
      request.log.error(err);
      const code = typeof err?.name === 'string' && err.name.startsWith('STRIPE_')
        ? err.name
        : err?.message;
      const codeMap: Record<string, number> = {
        STRIPE_WEBHOOK_SIGNATURE_INVALID: 401,
        STRIPE_NOT_CONFIGURED: 500,
        STRIPE_KEY_MODE_MISMATCH: 500,
        STRIPE_WEBHOOK_PROCESSING_FAILED: 500,
      };
      const status = codeMap[code] || 400;
      return reply.status(status).send({ error: code || 'STRIPE_WEBHOOK_FAILED' });
    }
  });

  registerWebhook('/connect', (rawBody, signature) => (
    stripeWebhookService.handleConnectWebhook(rawBody, signature)
  ));
  registerWebhook('/payments', (rawBody, signature) => (
    stripeWebhookService.handlePaymentsWebhook(rawBody, signature)
  ));
}
