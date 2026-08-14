import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AgencyCapability } from '@ks-os/contracts';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { LiveSiteIntelligenceService } from './live-site-intelligence.service.js';

const SiteParamsSchema = z.object({ siteReference: z.string().uuid() }).strict();
const CampaignParamsSchema = SiteParamsSchema.extend({ campaignReference: z.string().uuid() }).strict();
const ProposalParamsSchema = SiteParamsSchema.extend({ proposalReference: z.string().uuid() }).strict();
const CampaignInputSchema = z.object({
  message: z.string().trim().min(1).max(240)
    .refine(value => !/\b(?:only\s+\d+|slots?\s+left|last\s+chance|hurry)\b/i.test(value), 'Deceptive urgency is not allowed.'),
  placement: z.enum(['ANNOUNCEMENT', 'HERO', 'PAGE_BODY', 'PAGE_END']),
  actionLabel: z.string().trim().min(1).max(80),
  serviceReference: z.string().uuid().optional(),
  locationReference: z.string().uuid().optional(),
  staffReference: z.string().uuid().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
}).strict().refine(value => Date.parse(value.startsAt) < Date.parse(value.endsAt), {
  message: 'Campaign end must follow campaign start.',
});

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

export async function agencyLiveSiteIntelligenceRoutes(app: FastifyInstance) {
  const service = new LiveSiteIntelligenceService();

  app.get('/:siteReference/live-intelligence', async request => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    actor(request, 'sites.studio.read');
    return { data: await service.get(siteReference) };
  });

  app.post('/:siteReference/live-intelligence/process-changes', async request => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await service.processPendingChanges(actor(request, 'sites.manage'), siteReference) };
  });

  app.post('/:siteReference/live-intelligence/campaigns', async (request, reply) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const data = await service.createCampaign(
      actor(request, 'sites.manage'),
      siteReference,
      CampaignInputSchema.parse(request.body),
    );
    return reply.code(201).send({ data });
  });

  app.post('/:siteReference/live-intelligence/campaigns/:campaignReference/approve', async request => {
    const { siteReference, campaignReference } = CampaignParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return {
      data: await service.approveCampaign(
        actor(request, 'sites.studio.approve'),
        siteReference,
        campaignReference,
      ),
    };
  });

  app.post('/:siteReference/live-intelligence/proposals/:proposalReference/review', async request => {
    const { siteReference, proposalReference } = ProposalParamsSchema.parse(request.params);
    const { decision } = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).strict().parse(request.body);
    return {
      data: await service.reviewProposal(
        actor(request, 'sites.studio.approve'),
        siteReference,
        proposalReference,
        decision,
      ),
    };
  });
}
