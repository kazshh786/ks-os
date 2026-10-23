import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireMobileDevice } from '../authentication/mobile-devices.service.js';
import { communicationError } from '../communications/communications.authorization.js';
import { staffCommunicationsActor } from '../communications/communications.routes.js';
import { ClientCollaboration, collaborationIdentity } from '../communications/communications.client-collaboration.js';
import { communicationsDatabase, type CommunicationsDatabase } from '../communications/communications.database.js';
import { configuredPushAdapters } from './push.config.js';
import { MobilePushService, PushRegistrationSchema } from './push.service.js';
import type { PushAdapter } from './push.types.js';

export async function mobilePushRoutes(app: FastifyInstance, options: { db?: CommunicationsDatabase; adapters?: PushAdapter[] } = {}) {
  const db = options.db ?? communicationsDatabase(); let adapters: PushAdapter[];
  try { adapters = options.adapters ?? configuredPushAdapters(); } catch { adapters = []; app.log.warn('Mobile push registration is unavailable because provider configuration is invalid.'); }
  const service = new MobilePushService(db, adapters), params = z.object({ id: z.string().uuid() });
  const rate = { config: { rateLimit: { max: 30, timeWindow: '1 minute', hook: 'preHandler' as const, keyGenerator: (request: FastifyRequest) => request.authIdentity?.authUserId ?? request.ip } } };
  app.addHook('onSend', async (_request, reply, body) => { reply.header('Cache-Control', 'no-store'); return body; });
  app.addHook('onClose', async () => { if (!options.adapters) for (const adapter of adapters) adapter.close?.(); });
  app.get('/capabilities', rate, async request => { const device = await requireMobileDevice(request, db); return { data: { enabled: adapters.some(adapter => adapter.matches({ ...device, provider: device.platform === 'IOS' ? 'APNS' : 'FCM', channel: 'ALERT' })), voip: adapters.some(adapter => adapter.matches({ ...device, provider: 'APNS', channel: 'VOIP' })) } }; });
  app.get('/registrations', rate, async request => ({ data: await service.registrations(await requireMobileDevice(request, db)) }));
  app.put('/registrations', { ...rate, bodyLimit: 8192 }, async request => ({ data: await service.register(await requireMobileDevice(request, db), PushRegistrationSchema.parse(request.body)) }));
  app.delete('/registrations/:id', rate, async request => ({ data: await service.revoke(await requireMobileDevice(request, db), params.parse(request.params).id) }));
  app.get('/contexts', rate, async request => ({ data: await service.contexts(await requireMobileDevice(request, db)) }));
  app.post('/contexts', rate, async request => {
    const device = await requireMobileDevice(request, db), input = z.object({ relationshipId: z.string().uuid().optional() }).strict().parse(request.body);
    if ((device.context === 'CUSTOMER') !== Boolean(input.relationshipId)) throw communicationError(400, 'PUSH_CONTEXT_INVALID', 'Choose an authorised account context.');
    const actor = input.relationshipId ? await new ClientCollaboration(db).actor(collaborationIdentity(request), input.relationshipId) : staffCommunicationsActor(request);
    return { data: await service.enableContext(device, actor) };
  });
  app.delete('/contexts/:id', rate, async request => ({ data: await service.disableContext(await requireMobileDevice(request, db), params.parse(request.params).id) }));
}
