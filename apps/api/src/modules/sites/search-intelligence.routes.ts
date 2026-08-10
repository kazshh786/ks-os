import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AgencyCapability } from '@ks-os/contracts';
import {
  PageSeoBriefSchema,
  SearchIntelligenceStrategyV2Schema,
  SearchResearchEvidenceSchema,
} from '@ks-os/site-generation';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { SearchIntelligenceService } from './search-intelligence.service.js';

const ParamsSchema = z.object({ siteReference: z.string().uuid() }).strict();
const StrategyParamsSchema = ParamsSchema.extend({ strategyReference: z.string().uuid() }).strict();
const BriefParamsSchema = StrategyParamsSchema.extend({ briefReference: z.string().uuid() }).strict();
const CreateDraftSchema = z.object({
  strategy: SearchIntelligenceStrategyV2Schema,
  briefs: z.array(PageSeoBriefSchema).min(1).max(100),
  evidence: z.array(SearchResearchEvidenceSchema).max(1_000).default([]),
}).strict();

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

export async function agencySearchIntelligenceRoutes(app: FastifyInstance) {
  const service = new SearchIntelligenceService();

  app.post('/:siteReference/search-intelligence/strategies', async (request, reply) => {
    const { siteReference } = ParamsSchema.parse(request.params);
    const data = await service.createDraft(
      actor(request, 'sites.manage'),
      siteReference,
      CreateDraftSchema.parse(request.body),
    );
    return reply.code(201).send({ data });
  });

  app.get('/:siteReference/search-intelligence', async request => {
    const { siteReference } = ParamsSchema.parse(request.params);
    actor(request, 'sites.studio.read');
    return { data: await service.get(siteReference) };
  });

  app.get('/:siteReference/search-intelligence/strategies/:strategyReference', async request => {
    const { siteReference, strategyReference } = StrategyParamsSchema.parse(request.params);
    actor(request, 'sites.studio.read');
    return { data: await service.get(siteReference, strategyReference) };
  });

  app.patch('/:siteReference/search-intelligence/strategies/:strategyReference/briefs/:briefReference/metadata', async request => {
    const { siteReference, strategyReference, briefReference } = BriefParamsSchema.parse(request.params);
    const input = z.object({
      recommendedTitle: z.string().trim().min(1).max(70),
      recommendedMetaDescription: z.string().trim().min(1).max(170),
    }).strict().parse(request.body);
    return {
      data: await service.updateDraftBriefMetadata(
        actor(request, 'sites.manage'),
        siteReference,
        strategyReference,
        briefReference,
        input,
      ),
    };
  });

  app.post('/:siteReference/search-intelligence/strategies/:strategyReference/approve', async request => {
    const { siteReference, strategyReference } = StrategyParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await service.approve(actor(request, 'sites.manage'), siteReference, strategyReference) };
  });
}
