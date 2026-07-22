import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    user?: {
      id: string;
      email: string;
      role: string;
    };
  }
}

export default async function registerRequestContext(fastify: FastifyInstance) {
  fastify.decorateRequest('tenantId', null);
  fastify.decorateRequest('user', null);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // In Phase 1, we do not implement production auth verification.
    // Tenant context and validation will be fully integrated in Phase 2.
    fastify.log.info({ path: request.url }, 'Request context hook executed');
  });
}
