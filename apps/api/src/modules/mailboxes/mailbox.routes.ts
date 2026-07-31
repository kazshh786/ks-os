import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MailboxService, type MailboxProvider } from './mailbox.service.js';

const ProviderSchema = z.enum(['GOOGLE_MAIL', 'ZOHO_MAIL']);
const StartSchema = z.object({
  provider: ProviderSchema,
  returnPath: z.string().regex(/^\/[A-Za-z0-9/_?=&.-]*$/).default('/app/settings/integrations'),
}).strict();
const IdSchema = z.object({ id: z.string().uuid() }).strict();

const owner = (request: FastifyRequest) => {
  request.requireAuth();
  if (!request.auth || request.auth.role !== 'owner' || request.auth.supportMode) {
    throw Object.assign(new Error('Business owner access is required.'), { statusCode: 403, code: 'MAILBOX_FORBIDDEN' });
  }
  return request.auth;
};

const errorCode = (cause: unknown) => String((cause as any)?.code || 'MAILBOX_CONNECTION_FAILED')
  .replace(/[^A-Z0-9_:-]/gi, '_')
  .slice(0, 100)
  .toUpperCase();

export async function mailboxOauthCallbackRoutes(app: FastifyInstance) {
  const service = new MailboxService();

  app.get('/google/callback', async (request, reply) => {
    try {
      const redirectUrl = await service.completeGoogle(request.query as Record<string, unknown>);
      return reply.header('cache-control', 'no-store').redirect(redirectUrl);
    } catch (cause) {
      request.log.warn({ err: cause }, 'Google mailbox OAuth callback failed');
      const redirectUrl = service.callbackRedirect('/app/settings/integrations', {
        mailbox: 'error',
        provider: 'GOOGLE_MAIL',
        reason: errorCode(cause),
      });
      return reply.header('cache-control', 'no-store').redirect(redirectUrl);
    }
  });

  app.get('/zoho/callback', async (request, reply) => {
    try {
      const redirectUrl = await service.completeZoho(request.query as Record<string, unknown>);
      return reply.header('cache-control', 'no-store').redirect(redirectUrl);
    } catch (cause) {
      request.log.warn({ err: cause }, 'Zoho mailbox OAuth callback failed');
      const redirectUrl = service.callbackRedirect('/app/settings/integrations', {
        mailbox: 'error',
        provider: 'ZOHO_MAIL',
        reason: errorCode(cause),
      });
      return reply.header('cache-control', 'no-store').redirect(redirectUrl);
    }
  });
}

export async function mailboxRoutes(app: FastifyInstance) {
  const service = new MailboxService();

  app.get('/mailboxes', async request => {
    const actor = owner(request);
    return {
      data: await service.list(actor.tenantId),
      meta: {
        providers: [
          { provider: 'GOOGLE_MAIL', configured: service.providerConfigured('GOOGLE_MAIL') },
          { provider: 'ZOHO_MAIL', configured: service.providerConfigured('ZOHO_MAIL') },
        ],
      },
    };
  });

  app.post('/mailboxes/oauth/start', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async request => {
    const actor = owner(request);
    const input = StartSchema.parse(request.body);
    return {
      data: {
        authorizationUrl: service.oauthUrl(actor.tenantId, actor.tenantUserId, input.provider as MailboxProvider, input.returnPath),
      },
    };
  });

  app.post('/mailboxes/:id/sync', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async request => {
    const actor = owner(request);
    const { id } = IdSchema.parse(request.params);
    return { data: await service.syncConnection(id, actor.tenantId) };
  });

  app.delete('/mailboxes/:id', async (request, reply) => {
    const actor = owner(request);
    const { id } = IdSchema.parse(request.params);
    await service.disconnect(actor.tenantId, actor.tenantUserId, id);
    return reply.code(204).send();
  });
}
