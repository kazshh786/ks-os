import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CreateSitePageSchema,
  CreateSiteSchema,
  CreateSiteVersionSchema,
  UpdateDraftSitePageSchema,
  UpdateSiteSchema,
  type AgencyCapability,
} from '@ks-os/contracts';
import { z } from 'zod';
import { SiteService } from './site.service.js';
import type { AgencyActor } from '../agency/agency.service.js';

const SiteParamsSchema = z.object({
  siteReference: z.string().uuid(),
}).strict();
const VersionParamsSchema = SiteParamsSchema.extend({
  versionReference: z.string().uuid(),
}).strict();
const PageParamsSchema = SiteParamsSchema.extend({
  pageReference: z.string().uuid(),
}).strict();
const PageListQuerySchema = z.object({
  versionReference: z.string().uuid().optional(),
}).strict();

function agencyActor(
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

export async function agencySiteRoutes(app: FastifyInstance) {
  let service: SiteService | undefined;
  const siteService = () => {
    service ||= new SiteService();
    return service;
  };

  app.get('/', async (request) => {
    agencyActor(request, 'sites.read');
    return { data: await siteService().list() };
  });

  app.post('/', async (request, reply) => {
    const input = CreateSiteSchema.parse(request.body);
    const data = await siteService().create(
      agencyActor(request, 'sites.manage'),
      input,
    );
    return reply.code(201).send({ data });
  });

  app.get('/:siteReference', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    agencyActor(request, 'sites.read');
    return { data: await siteService().get(siteReference) };
  });

  app.patch('/:siteReference', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const input = UpdateSiteSchema.parse(request.body);
    return {
      data: await siteService().update(
        agencyActor(request, 'sites.manage'),
        siteReference,
        input,
      ),
    };
  });

  app.get('/:siteReference/entitlements', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    agencyActor(request, 'sites.read');
    return { data: await siteService().entitlementSummary(siteReference) };
  });

  app.get('/:siteReference/versions', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    agencyActor(request, 'sites.read');
    return { data: await siteService().listVersions(siteReference) };
  });

  app.post('/:siteReference/versions', async (request, reply) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const input = CreateSiteVersionSchema.parse(request.body);
    const data = await siteService().createVersion(
      agencyActor(request, 'sites.manage'),
      siteReference,
      input,
    );
    return reply.code(201).send({ data });
  });

  app.get('/:siteReference/versions/:versionReference', async (request) => {
    const { siteReference, versionReference } = VersionParamsSchema.parse(
      request.params,
    );
    agencyActor(request, 'sites.read');
    return {
      data: await siteService().getVersion(siteReference, versionReference),
    };
  });

  app.get('/:siteReference/pages', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const query = PageListQuerySchema.parse(request.query);
    agencyActor(request, 'sites.read');
    return {
      data: await siteService().listPages(siteReference, query.versionReference),
    };
  });

  app.post('/:siteReference/pages', async (request, reply) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const input = CreateSitePageSchema.parse(request.body);
    const data = await siteService().createPage(
      agencyActor(request, 'sites.manage'),
      siteReference,
      input,
    );
    return reply.code(201).send({ data });
  });

  app.patch('/:siteReference/pages/:pageReference', async (request) => {
    const { siteReference, pageReference } = PageParamsSchema.parse(
      request.params,
    );
    const input = UpdateDraftSitePageSchema.parse(request.body);
    return {
      data: await siteService().updatePage(
        agencyActor(request, 'sites.manage'),
        siteReference,
        pageReference,
        input,
      ),
    };
  });
}
