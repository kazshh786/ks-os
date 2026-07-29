import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  InitiateTemplateImportSchema,
  type AgencyCapability,
} from '@ks-os/contracts';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { TemplateImportService } from './template-import.service.js';

const VersionParamsSchema = z.object({
  versionReference: z.string().uuid(),
}).strict();

function agencyActor(request: FastifyRequest, capability: AgencyCapability): AgencyActor {
  const auth = request.requireAgency(capability);
  return {
    agencyUserId: auth.agencyUserId,
    role: auth.role,
    requestId: request.id,
    sessionId: request.authIdentity?.authSessionId || undefined,
    userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || undefined,
  };
}

export async function agencyTemplateImportRoutes(app: FastifyInstance) {
  let service: TemplateImportService | undefined;
  const imports = () => {
    service ||= new TemplateImportService();
    return service;
  };

  app.get('/site-template-imports', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async request => {
    agencyActor(request, 'sites.templates.read');
    return { data: await imports().list() };
  });

  app.get('/site-template-imports/:versionReference', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async request => {
    const { versionReference } = VersionParamsSchema.parse(request.params);
    agencyActor(request, 'sites.templates.read');
    return { data: await imports().get(versionReference) };
  });

  app.post('/site-template-imports', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const actor = agencyActor(request, 'sites.templates.manage');
    const input = InitiateTemplateImportSchema.parse(request.body);
    const data = await imports().initiate(actor, input);
    return reply.code(201).send({ data });
  });

  app.post('/site-template-imports/:versionReference/complete', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { versionReference } = VersionParamsSchema.parse(request.params);
    const actor = agencyActor(request, 'sites.templates.manage');
    const data = await imports().complete(actor, versionReference);
    return reply.code(202).send({ data });
  });
}
