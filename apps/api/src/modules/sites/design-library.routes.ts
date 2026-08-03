import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AgencyCapability } from '@ks-os/contracts';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import {
  AssignDesignLibraryThemeSchema,
  DesignLibraryListQuerySchema,
  DesignLibraryService,
} from './design-library.service.js';
import {
  DesignLibraryKnowledgeService,
  DesignStudioGenerateRequestSchema,
} from './design-library-knowledge.service.js';

const ItemParamsSchema = z.object({ reference: z.string().uuid() }).strict();

function agencyActor(request: FastifyRequest, capability: AgencyCapability): AgencyActor {
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

export async function agencyDesignLibraryRoutes(app: FastifyInstance) {
  let service: DesignLibraryService | undefined;
  let knowledgeService: DesignLibraryKnowledgeService | undefined;
  const library = () => {
    service ||= new DesignLibraryService();
    return service;
  };
  const knowledge = () => {
    knowledgeService ||= new DesignLibraryKnowledgeService();
    return knowledgeService;
  };

  app.get('/design-library/config', async request => {
    agencyActor(request, 'sites.templates.read');
    const [base, governedKnowledge] = await Promise.all([
      Promise.resolve(library().config()),
      knowledge().config(),
    ]);
    return { data: { ...base, knowledge: governedKnowledge } };
  });

  app.get('/design-library', async request => {
    agencyActor(request, 'sites.templates.read');
    const query = DesignLibraryListQuerySchema.parse(request.query);
    return { data: await library().list(query) };
  });

  app.get('/design-library/:reference', async request => {
    agencyActor(request, 'sites.templates.read');
    const { reference } = ItemParamsSchema.parse(request.params);
    return { data: await library().get(reference) };
  });

  app.post('/design-library/generate', {
    config: { rateLimit: { max: 12, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const actor = agencyActor(request, 'sites.templates.manage');
    const input = DesignStudioGenerateRequestSchema.parse(request.body);
    const prepared = await knowledge().prepare(input);
    const generated = await library().generate(actor, prepared.generationInput);
    await knowledge().pinResult(generated.reference, prepared.provenance);
    const data = await library().get(generated.reference);
    return reply.code(201).send({ data });
  });

  app.post('/design-library/:reference/approve', async request => {
    const actor = agencyActor(request, 'sites.templates.approve');
    const { reference } = ItemParamsSchema.parse(request.params);
    return { data: await library().approve(actor, reference) };
  });

  app.post('/design-library/:reference/archive', async request => {
    const actor = agencyActor(request, 'sites.templates.manage');
    const { reference } = ItemParamsSchema.parse(request.params);
    return { data: await library().archive(actor, reference) };
  });

  app.post('/design-library/:reference/assign', async (request, reply) => {
    const actor = agencyActor(request, 'sites.templates.manage');
    const { reference } = ItemParamsSchema.parse(request.params);
    const { tenantReference } = AssignDesignLibraryThemeSchema.parse(request.body);
    const data = await library().assign(actor, reference, tenantReference);
    return reply.code(201).send({ data });
  });
}
