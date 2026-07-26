import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  SiteJobActionReasonSchema,
  SiteJobListQuerySchema,
} from '@ks-os/site-jobs';
import type { AgencyCapability } from '@ks-os/contracts';
import type { AgencyActor } from '../agency/agency.service.js';
import { AgencySiteJobService } from './site-job.service.js';

const JobParamsSchema = z.object({
  jobReference: z.string().uuid(),
}).strict();
const SiteParamsSchema = z.object({
  siteReference: z.string().uuid(),
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
      .update(
        `${process.env.AUDIT_IP_HASH_SECRET || 'local-development'}:${request.ip}`,
      )
      .digest('hex'),
    sessionId: request.authIdentity?.authSessionId || undefined,
    userAgent: String(request.headers['user-agent'] || '')
      .slice(0, 500) || undefined,
  };
}

export async function agencySiteJobRoutes(app: FastifyInstance) {
  const service = new AgencySiteJobService();

  app.get('/site-jobs', async request => {
    actor(request, 'sites.jobs.read');
    return { data: await service.list(SiteJobListQuerySchema.parse(request.query)) };
  });

  app.get('/site-jobs/:jobReference', async request => {
    actor(request, 'sites.jobs.read');
    const { jobReference } = JobParamsSchema.parse(request.params);
    return { data: await service.get(jobReference) };
  });

  app.get('/site-jobs/:jobReference/attempts', async request => {
    actor(request, 'sites.jobs.read');
    const { jobReference } = JobParamsSchema.parse(request.params);
    return { data: await service.attempts(jobReference) };
  });

  app.get('/site-jobs/:jobReference/events', async request => {
    actor(request, 'sites.jobs.read');
    const { jobReference } = JobParamsSchema.parse(request.params);
    return { data: await service.events(jobReference) };
  });

  app.post('/site-jobs/:jobReference/cancel', async request => {
    const agencyActor = actor(request, 'sites.jobs.cancel');
    const { jobReference } = JobParamsSchema.parse(request.params);
    const { reason } = SiteJobActionReasonSchema.parse(request.body);
    return { data: await service.cancel(agencyActor, jobReference, reason) };
  });

  app.post('/site-jobs/:jobReference/retry', async request => {
    const agencyActor = actor(request, 'sites.jobs.retry');
    const { jobReference } = JobParamsSchema.parse(request.params);
    const { reason } = SiteJobActionReasonSchema.parse(request.body);
    return { data: await service.retry(agencyActor, jobReference, reason) };
  });

  app.get('/sites/:siteReference/jobs', async request => {
    actor(request, 'sites.jobs.read');
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const query = SiteJobListQuerySchema
      .omit({ siteReference: true })
      .parse(request.query);
    return {
      data: await service.listForSite(siteReference, query),
    };
  });
}
