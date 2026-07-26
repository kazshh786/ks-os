import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AgencyCapability } from '@ks-os/contracts';
import {
  GenerationRunRequestSchema,
  SectionRegenerationRequestSchema,
} from '@ks-os/site-generation';
import { SiteJobActionReasonSchema } from '@ks-os/site-jobs';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { AgencySiteGenerationService } from './site-generation.service.js';

const SiteParamsSchema = z.object({ siteReference: z.string().uuid() }).strict();
const RunParamsSchema = SiteParamsSchema.extend({ runReference: z.string().uuid() }).strict();
const FindingParamsSchema = RunParamsSchema.extend({ findingReference: z.string().uuid() }).strict();
const ResolveFindingSchema = z.object({
  resolutionNote: z.string().trim().min(8).max(1_000),
}).strict();
const PageParamsSchema = SiteParamsSchema.extend({
  versionReference: z.string().uuid(),
  pageReference: z.string().uuid(),
}).strict();
const SectionParamsSchema = PageParamsSchema.extend({
  sectionReference: z.string().uuid(),
}).strict();
const VersionParamsSchema = SiteParamsSchema.extend({
  versionReference: z.string().uuid(),
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

export async function agencySiteGenerationRoutes(app: FastifyInstance) {
  let service: AgencySiteGenerationService | undefined;
  const generation = () => {
    service ||= new AgencySiteGenerationService();
    return service;
  };

  app.post('/:siteReference/generation-runs', async (request, reply) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const data = await generation().create(
      actor(request, 'sites.generation.create'),
      siteReference,
      GenerationRunRequestSchema.parse(request.body),
    );
    return reply.code(data.idempotentReplay ? 200 : 201).send({ data });
  });

  app.get('/:siteReference/generation-runs', async request => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    actor(request, 'sites.generation.read');
    return { data: await generation().list(siteReference) };
  });

  app.get('/:siteReference/generation-runs/:runReference', async request => {
    const { siteReference, runReference } = RunParamsSchema.parse(request.params);
    actor(request, 'sites.generation.read');
    return { data: await generation().get(siteReference, runReference) };
  });

  app.get('/:siteReference/generation-runs/:runReference/findings', async request => {
    const { siteReference, runReference } = RunParamsSchema.parse(request.params);
    actor(request, 'sites.generation.read');
    return { data: await generation().findings(siteReference, runReference) };
  });

  app.post('/:siteReference/generation-runs/:runReference/findings/:findingReference/resolve', async request => {
    const params = FindingParamsSchema.parse(request.params);
    const { resolutionNote } = ResolveFindingSchema.parse(request.body);
    return { data: await generation().resolveFinding(
      actor(request, 'sites.generation.regenerate'),
      params.siteReference,
      params.runReference,
      params.findingReference,
      resolutionNote,
    ) };
  });

  app.post('/:siteReference/generation-runs/:runReference/cancel', async request => {
    const { siteReference, runReference } = RunParamsSchema.parse(request.params);
    const { reason } = SiteJobActionReasonSchema.parse(request.body);
    return { data: await generation().cancel(
      actor(request, 'sites.generation.cancel'),
      siteReference,
      runReference,
      reason,
    ) };
  });

  app.post('/:siteReference/generation-runs/:runReference/retry', async request => {
    const { siteReference, runReference } = RunParamsSchema.parse(request.params);
    const { reason } = SiteJobActionReasonSchema.parse(request.body);
    return { data: await generation().retry(
      actor(request, 'sites.generation.retry'),
      siteReference,
      runReference,
      reason,
    ) };
  });

  app.post('/:siteReference/versions/:versionReference/pages/:pageReference/regenerate', async (request, reply) => {
    const params = PageParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const data = await generation().regeneratePage(
      actor(request, 'sites.generation.regenerate'),
      params.siteReference,
      params.versionReference,
      params.pageReference,
    );
    return reply.code(data.idempotentReplay ? 200 : 202).send({ data });
  });

  app.post('/:siteReference/versions/:versionReference/pages/:pageReference/sections/:sectionReference/regenerate', async (request, reply) => {
    const params = SectionParamsSchema.parse(request.params);
    const body = SectionRegenerationRequestSchema.parse(request.body);
    const data = await generation().regenerateSection(
      actor(request, 'sites.generation.regenerate'),
      params.siteReference,
      params.versionReference,
      params.pageReference,
      params.sectionReference,
      body.regenerationInstruction,
    );
    return reply.code(data.idempotentReplay ? 200 : 202).send({ data });
  });

  app.post('/:siteReference/versions/:versionReference/metadata/generate', async (request, reply) => {
    const params = VersionParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const data = await generation().generateMetadata(
      actor(request, 'sites.generation.regenerate'),
      params.siteReference,
      params.versionReference,
    );
    return reply.code(data.idempotentReplay ? 200 : 202).send({ data });
  });

  app.post('/:siteReference/versions/:versionReference/structured-data/generate', async (request, reply) => {
    const params = VersionParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const data = await generation().generateStructuredData(
      actor(request, 'sites.generation.regenerate'),
      params.siteReference,
      params.versionReference,
    );
    return reply.code(data.idempotentReplay ? 200 : 202).send({ data });
  });
}
