import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  type AgencyCapability,
  PublicReferenceSchema,
} from '@ks-os/contracts';
import {
  CreateSiteQualityRunSchema,
  SiteQualityHumanReviewDecisionSchema,
  SiteQualityWaiverDecisionSchema,
} from '@ks-os/site-quality';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { SiteQualityService } from './site-quality.service.js';

const SiteParams = z.object({
  siteReference: PublicReferenceSchema,
}).strict();
const RunParams = SiteParams.extend({
  runReference: PublicReferenceSchema,
}).strict();
const CompareParams = RunParams.extend({
  otherRunReference: PublicReferenceSchema,
}).strict();
const FindingParams = SiteParams.extend({
  findingReference: PublicReferenceSchema,
}).strict();
const HumanReviewParams = RunParams.extend({
  checkReference: PublicReferenceSchema,
}).strict();
const ReasonSchema = z.object({
  reason: z.string().trim().min(8).max(1_000),
}).strict();
const ResolutionSchema = z.object({
  note: z.string().trim().min(8).max(1_000),
}).strict();

function actor(
  request: FastifyRequest,
  capability: AgencyCapability,
): AgencyActor {
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

export async function agencySiteQualityRoutes(app: FastifyInstance) {
  const quality = () => new SiteQualityService();

  app.post('/:siteReference/quality-runs', async (request, reply) => {
    const { siteReference } = SiteParams.parse(request.params);
    const result = await quality().create(
      actor(request, 'sites.quality.run'),
      siteReference,
      CreateSiteQualityRunSchema.parse(request.body),
    );
    return reply.code(result.idempotentReplay ? 200 : 202).send({ data: result });
  });

  app.get('/:siteReference/quality-runs', async request => {
    const { siteReference } = SiteParams.parse(request.params);
    actor(request, 'sites.quality.read');
    return { data: await quality().list(siteReference) };
  });

  app.get('/:siteReference/quality-runs/:runReference', async request => {
    const params = RunParams.parse(request.params);
    actor(request, 'sites.quality.read');
    return { data: await quality().get(params.siteReference, params.runReference) };
  });

  app.get('/:siteReference/quality-runs/:runReference/findings', async request => {
    const params = RunParams.parse(request.params);
    actor(request, 'sites.quality.read');
    return { data: await quality().findings(params.siteReference, params.runReference) };
  });

  app.get('/:siteReference/quality-runs/:runReference/evidence', async request => {
    const params = RunParams.parse(request.params);
    actor(request, 'sites.quality.read');
    return { data: await quality().evidence(params.siteReference, params.runReference) };
  });

  app.get('/:siteReference/quality-runs/:runReference/summary', async request => {
    const params = RunParams.parse(request.params);
    actor(request, 'sites.quality.read');
    return { data: await quality().summary(params.siteReference, params.runReference) };
  });

  app.get(
    '/:siteReference/quality-runs/:runReference/compare/:otherRunReference',
    async request => {
      const params = CompareParams.parse(request.params);
      return { data: await quality().compare(
        actor(request, 'sites.quality.read'),
        params.siteReference,
        params.runReference,
        params.otherRunReference,
      ) };
    },
  );

  app.post('/:siteReference/quality-runs/:runReference/cancel', async request => {
    const params = RunParams.parse(request.params);
    const { reason } = ReasonSchema.parse(request.body);
    return { data: await quality().cancel(
      actor(request, 'sites.quality.cancel'),
      params.siteReference,
      params.runReference,
      reason,
    ) };
  });

  app.post('/:siteReference/quality-runs/:runReference/retry', async request => {
    const params = RunParams.parse(request.params);
    const { reason } = ReasonSchema.parse(request.body);
    return { data: await quality().retry(
      actor(request, 'sites.quality.retry'),
      params.siteReference,
      params.runReference,
      reason,
    ) };
  });

  app.post(
    '/:siteReference/quality-runs/:runReference/human-reviews/:checkReference',
    async request => {
      const params = HumanReviewParams.parse(request.params);
      return { data: await quality().completeHumanReview(
        actor(request, 'sites.quality.human_review'),
        params.siteReference,
        params.runReference,
        params.checkReference,
        SiteQualityHumanReviewDecisionSchema.parse(request.body),
      ) };
    },
  );

  app.post(
    '/:siteReference/quality-findings/:findingReference/acknowledge',
    async request => {
      const params = FindingParams.parse(request.params);
      z.object({}).strict().parse(request.body ?? {});
      return { data: await quality().findingAction(
        actor(request, 'sites.quality.resolve'),
        params.siteReference,
        params.findingReference,
        'ACKNOWLEDGE',
      ) };
    },
  );

  app.post(
    '/:siteReference/quality-findings/:findingReference/resolve',
    async request => {
      const params = FindingParams.parse(request.params);
      const { note } = ResolutionSchema.parse(request.body);
      return { data: await quality().findingAction(
        actor(request, 'sites.quality.resolve'),
        params.siteReference,
        params.findingReference,
        'RESOLVE',
        note,
      ) };
    },
  );

  app.post(
    '/:siteReference/quality-findings/:findingReference/create-change-request',
    async request => {
      const params = FindingParams.parse(request.params);
      z.object({}).strict().parse(request.body ?? {});
      return { data: await quality().createChangeRequest(
        actor(request, 'sites.quality.resolve'),
        params.siteReference,
        params.findingReference,
      ) };
    },
  );

  app.post('/:siteReference/quality-findings/:findingReference/waive', async request => {
    const params = FindingParams.parse(request.params);
    return { data: await quality().waive(
      actor(request, 'sites.quality.waive'),
      params.siteReference,
      params.findingReference,
      SiteQualityWaiverDecisionSchema.parse(request.body),
    ) };
  });

  app.post(
    '/:siteReference/quality-findings/:findingReference/revoke-waiver',
    async request => {
      const params = FindingParams.parse(request.params);
      const { reason } = ReasonSchema.parse(request.body);
      return { data: await quality().revokeWaiver(
        actor(request, 'sites.quality.waive'),
        params.siteReference,
        params.findingReference,
        reason,
      ) };
    },
  );

  app.get('/:siteReference/publication-readiness', async request => {
    const { siteReference } = SiteParams.parse(request.params);
    actor(request, 'sites.publication_readiness.read');
    return { data: await quality().publicationReadiness(siteReference) };
  });

  app.post('/:siteReference/publication-readiness/evaluate', async request => {
    const { siteReference } = SiteParams.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await quality().publicationReadiness(
      siteReference,
      actor(request, 'sites.publication_readiness.evaluate'),
    ) };
  });
}
