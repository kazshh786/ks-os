import { FastifyPluginAsync } from 'fastify';
import { ResendWebhookService } from './resend-webhook.service.js';

export const resendWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  const webhookService = new ResendWebhookService();

  fastify.post('/', async (request, reply) => {
    try {
      // Assuming fastify-raw-body attaches rawBody
      const payload = request.rawBody as string;
      if (!payload) {
        return reply.code(400).send({ error: 'Missing raw body' });
      }
      await webhookService.processWebhook(payload, request.headers);
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });
};
