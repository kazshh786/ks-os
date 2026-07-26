import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AgencyCapability } from '@ks-os/contracts';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { SiteStudioService } from './site-studio.service.js';

const Params = z.object({ siteReference: z.string().uuid() }).strict();

function actor(request: FastifyRequest, capability: AgencyCapability): AgencyActor {
  const auth = request.requireAgency(capability);
  return {
    agencyUserId: auth.agencyUserId,
    role: auth.role,
    requestId: request.id,
    ipHash: createHash('sha256')
      .update(`${process.env.AUDIT_IP_HASH_SECRET || 'local-development'}:${request.ip}`)
      .digest('hex'),
    sessionId: request.authIdentity?.authSessionId || undefined,
    userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || undefined,
  };
}

export async function agencySiteStudioRoutes(app: FastifyInstance) {
  const service = new SiteStudioService();
  app.get('/:siteReference/studio', async request => {
    actor(request, 'sites.studio.read');
    const { siteReference } = Params.parse(request.params);
    return { data: await service.get(siteReference) };
  });
  app.get('/:siteReference/studio/booking-links', async request => {
    actor(request, 'sites.studio.read');
    const { siteReference } = Params.parse(request.params);
    return { data: await service.getBookingLinks(siteReference) };
  });
  app.get('/:siteReference/booking-links', async request => {
    actor(request, 'sites.studio.read');
    const { siteReference } = Params.parse(request.params);
    return { data: await service.getBookingLinks(siteReference) };
  });
}
