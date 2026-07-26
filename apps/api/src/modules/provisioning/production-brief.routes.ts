import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AgencyCapability } from '@ks-os/contracts';
import { PublicReferenceSchema } from '@ks-os/fact-finding';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { FactFindingService } from './fact-finding.service.js';

const Params = z.object({ briefReference: PublicReferenceSchema }).strict();

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

export async function agencyProductionBriefRoutes(app: FastifyInstance) {
  const service = new FactFindingService();
  app.get('/production-briefs/:briefReference', async request => {
    actor(request, 'production_briefs.read');
    const { briefReference } = Params.parse(request.params);
    return { data: await service.brief(briefReference) };
  });
  app.get('/production-briefs/:briefReference/readiness', async request => {
    actor(request, 'production_briefs.read');
    const { briefReference } = Params.parse(request.params);
    const brief = await service.brief(briefReference);
    return { data: brief.readiness };
  });
  app.post('/production-briefs/:briefReference/approve', async request => {
    const { briefReference } = Params.parse(request.params);
    return { data: await service.approveBrief(actor(request, 'production_briefs.approve'), briefReference) };
  });
  app.post('/production-briefs/:briefReference/lock', async request => {
    const { briefReference } = Params.parse(request.params);
    return { data: await service.lockBrief(actor(request, 'production_briefs.lock'), briefReference) };
  });
}
