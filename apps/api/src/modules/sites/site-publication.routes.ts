import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PublicReferenceSchema, type AgencyCapability } from '@ks-os/contracts';
import { PublicationReasonSchema } from '@ks-os/site-publishing';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { SitePublicationService } from './site-publication.service.js';

const SiteParams = z.object({ siteReference: PublicReferenceSchema }).strict();
const CreatePublication = z.object({
  siteVersionReference: PublicReferenceSchema,
  qualityRunReference: PublicReferenceSchema,
  reason: PublicationReasonSchema.exclude(['ROLLBACK', 'DOMAIN_ACTIVATION_RECHECK']),
  acknowledgeWarnings: z.boolean().default(false),
}).strict();
const CreateCustomDomain = z.object({ hostname: z.string().trim().min(1).max(253) }).strict();
const CreateFallbackDomain = z.object({
  fallbackDomain: z.string().trim().regex(/^[a-z0-9.-]+$/).default('sites.kasimshah.com'),
}).strict();

function actor(request: FastifyRequest, capability: AgencyCapability): AgencyActor {
  const auth = request.requireAgency(capability);
  return {
    agencyUserId: auth.agencyUserId,
    role: auth.role,
    requestId: request.id,
    ipHash: createHash('sha256').update(`${process.env.AUDIT_IP_HASH_SECRET || 'local-development'}:${request.ip}`).digest('hex'),
    sessionId: request.authIdentity?.authSessionId || undefined,
    userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || undefined,
  };
}

export async function agencySitePublicationRoutes(app: FastifyInstance) {
  const service = () => new SitePublicationService();
  app.get('/:siteReference/publications', async request => {
    const { siteReference } = SiteParams.parse(request.params);
    actor(request, 'sites.publications.read');
    return { data: await service().list(siteReference) };
  });
  app.get('/:siteReference/publication-live', async request => {
    const { siteReference } = SiteParams.parse(request.params);
    actor(request, 'sites.publications.read');
    return { data: await service().live(siteReference) };
  });
  app.post('/:siteReference/publications', async (request, reply) => {
    const { siteReference } = SiteParams.parse(request.params);
    const result = await service().create(
      actor(request, 'sites.publications.create'),
      siteReference,
      CreatePublication.parse(request.body),
    );
    return reply.code(result.idempotentReplay ? 200 : 202).send({ data: result });
  });
  app.get('/:siteReference/domains', async request => {
    const { siteReference } = SiteParams.parse(request.params);
    actor(request, 'sites.domains.read');
    return { data: await service().domains(siteReference) };
  });
  app.post('/:siteReference/domains/fallback', async (request, reply) => {
    const { siteReference } = SiteParams.parse(request.params);
    const agencyActor = actor(request, 'sites.domains.create');
    const { fallbackDomain } = CreateFallbackDomain.parse(request.body ?? {});
    return reply.code(202).send({ data: await service().createFallback(agencyActor, siteReference, fallbackDomain) });
  });
  app.post('/:siteReference/domains/custom', async (request, reply) => {
    const { siteReference } = SiteParams.parse(request.params);
    const agencyActor = actor(request, 'sites.domains.create');
    const { hostname } = CreateCustomDomain.parse(request.body);
    return reply.code(202).send({ data: await service().createCustom(agencyActor, siteReference, hostname) });
  });
}
