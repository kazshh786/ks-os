import type { FastifyInstance, FastifyRequest } from 'fastify';
import { MobileDeviceParamsSchema } from '@ks-os/contracts';
import { MobileDevices, mobileApplications } from './mobile-devices.service.js';
export async function mobileDeviceRoutes(app: FastifyInstance, options: { service?: MobileDevices } = {}) {
  const service = options.service ?? new MobileDevices();
  const keyGenerator = (request: FastifyRequest) => request.authIdentity ? `mobile:${request.authIdentity.authUserId}:${request.applicationContext ?? 'NONE'}` : `mobile:anonymous:${request.ip}`;
  const limit = (max: number) => ({ hook: 'preHandler' as const, max, timeWindow: '1 minute', keyGenerator });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
  app.get('/api/v1/auth/mobile/config', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () => ({ data: { protocol: 'SUPABASE_PKCE', applications: mobileApplications(), contexts: ['TENANT', 'CUSTOMER'], refresh: 'SUPABASE_ROTATING_REFRESH_TOKEN', credentialStorage: 'PLATFORM_SECURE_STORAGE' } }));
  app.post('/api/v1/auth/mobile/session', { config: { rateLimit: limit(10) } }, async request => ({ data: await service.register(request, request.body) }));
  app.get('/api/v1/auth/mobile/devices', async request => service.list(request));
  app.delete('/api/v1/auth/mobile/devices/:deviceId', { config: { rateLimit: limit(20) } }, async request => ({ data: await service.revoke(request, MobileDeviceParamsSchema.parse(request.params).deviceId) }));
  app.post('/api/v1/auth/mobile/devices/revoke-others', { config: { rateLimit: limit(5) } }, async request => ({ data: await service.revokeOthers(request) }));
}
