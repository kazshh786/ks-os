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
import { SearchResearchInboxService } from './search-research-inbox.service.js';

const ParamsSchema = z.object({ siteReference: z.string().uuid() }).strict();
const StrategyParamsSchema = ParamsSchema.extend({ strategyReference: z.string().uuid() }).strict();
const BriefParamsSchema = StrategyParamsSchema.extend({ briefReference: z.string().uuid() }).strict();
const ResearchSourceParamsSchema = ParamsSchema.extend({ sourceReference: z.string().uuid() }).strict();
const CreateDraftSchema = z.object({
  strategy: SearchIntelligenceStrategyV2Schema,
  briefs: z.array(PageSeoBriefSchema).min(1).max(100),
  evidence: z.array(SearchResearchEvidenceSchema).max(1_000).default([]),
}).strict();
const ResearchUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255).refine(value => !/[\\/\0]/.test(value), 'Filename is unsafe.'),
  mimeType: z.enum([
    'text/csv',
    'text/plain',
    'application/json',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
  byteSize: z.number().int().positive().max(20 * 1024 * 1024),
  digestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  providerHint: z.string().trim().min(1).max(80).optional(),
  market: z.string().trim().min(2).max(80),
  locale: z.string().trim().min(2).max(35),
  location: z.string().trim().min(1).max(160),
  language: z.string().trim().min(2).max(35),
  device: z.enum(['DESKTOP', 'MOBILE']),
  capturedAt: z.string().datetime().optional(),
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
  const research = new SearchResearchInboxService();

  app.post('/:siteReference/search-intelligence/create-draft', async (request, reply) => {
    const { siteReference } = ParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const data = await service.createPlatformDraft(actor(request, 'sites.manage'), siteReference);
    return reply.code(data.idempotentReplay ? 200 : 201).send({ data });
  });

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

  app.get('/:siteReference/search-intelligence/research-sources', async request => {
    const { siteReference } = ParamsSchema.parse(request.params);
    actor(request, 'sites.studio.read');
    return { data: await research.list(siteReference) };
  });

  app.post('/:siteReference/search-intelligence/research-sources', async (request, reply) => {
    const { siteReference } = ParamsSchema.parse(request.params);
    const data = await research.initiate(actor(request, 'sites.manage'), siteReference, ResearchUploadSchema.parse(request.body));
    return reply.code(201).send({ data });
  });

  app.post('/:siteReference/search-intelligence/research-sources/:sourceReference/complete', async request => {
    const { siteReference, sourceReference } = ResearchSourceParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await research.complete(actor(request, 'sites.manage'), siteReference, sourceReference) };
  });

  app.post('/:siteReference/search-intelligence/research-sources/:sourceReference/apply', async request => {
    const { siteReference, sourceReference } = ResearchSourceParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await research.apply(actor(request, 'sites.manage'), siteReference, sourceReference) };
  });

  app.post('/:siteReference/search-intelligence/research-sources/:sourceReference/reject', async request => {
    const { siteReference, sourceReference } = ResearchSourceParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await research.reject(actor(request, 'sites.manage'), siteReference, sourceReference) };
  });
}
