import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AddTemplateLayoutPageTypeSchema,
  CreateTemplateLicenceSchema,
  CreateTemplateSourceSchema,
  CreateTemplateVersionSchema,
  ResolveTemplateFindingSchema,
  SitePageTypeSchema,
  StartTemplateAnalysisSchema,
  TemplateDecisionSchema,
  UpdateTemplateLayoutSchema,
  UpdateTemplateSourceSchema,
  type AgencyCapability,
} from '@ks-os/contracts';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { TemplateIntelligenceService } from './template-intelligence.service.js';

const SourceParamsSchema = z.object({
  templateReference: z.string().uuid(),
}).strict();
const VersionParamsSchema = z.object({
  versionReference: z.string().uuid(),
}).strict();
const LayoutParamsSchema = z.object({
  layoutReference: z.string().uuid(),
}).strict();
const LayoutPageTypeParamsSchema = LayoutParamsSchema.extend({
  pageType: SitePageTypeSchema,
}).strict();
const FindingParamsSchema = z.object({
  findingReference: z.string().uuid(),
}).strict();
const SiteParamsSchema = z.object({
  siteReference: z.string().uuid(),
}).strict();
const SiteLicenceParamsSchema = SiteParamsSchema.extend({
  licenceReference: z.string().uuid(),
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

export async function agencyTemplateIntelligenceRoutes(app: FastifyInstance) {
  let service: TemplateIntelligenceService | undefined;
  const templates = () => {
    service ||= new TemplateIntelligenceService();
    return service;
  };

  app.get('/site-templates', async (request) => {
    agencyActor(request, 'sites.templates.read');
    return { data: await templates().listSources() };
  });

  app.post('/site-templates', async (request, reply) => {
    const actor = agencyActor(request, 'sites.templates.manage');
    const input = CreateTemplateSourceSchema.parse(request.body);
    const data = await templates().createSource(actor, input);
    return reply.code(201).send({ data });
  });

  app.get('/site-templates/:templateReference', async (request) => {
    const { templateReference } = SourceParamsSchema.parse(request.params);
    agencyActor(request, 'sites.templates.read');
    return { data: await templates().getSource(templateReference) };
  });

  app.patch('/site-templates/:templateReference', async (request) => {
    const { templateReference } = SourceParamsSchema.parse(request.params);
    const actor = agencyActor(request, 'sites.templates.manage');
    const input = UpdateTemplateSourceSchema.parse(request.body);
    return {
      data: await templates().updateSource(actor, templateReference, input),
    };
  });

  app.get('/site-templates/:templateReference/versions', async (request) => {
    const { templateReference } = SourceParamsSchema.parse(request.params);
    agencyActor(request, 'sites.templates.read');
    return { data: await templates().listVersions(templateReference) };
  });

  app.post(
    '/site-templates/:templateReference/versions',
    async (request, reply) => {
      const { templateReference } = SourceParamsSchema.parse(request.params);
      const actor = agencyActor(request, 'sites.templates.manage');
      const input = CreateTemplateVersionSchema.parse(request.body);
      const data = await templates().createVersion(
        actor,
        templateReference,
        input,
      );
      return reply.code(201).send({ data });
    },
  );

  app.get('/site-template-versions/:versionReference', async (request) => {
    const { versionReference } = VersionParamsSchema.parse(request.params);
    agencyActor(request, 'sites.templates.read');
    return { data: await templates().getVersion(versionReference) };
  });

  app.post(
    '/site-template-versions/:versionReference/analyse',
    async (request, reply) => {
      const { versionReference } = VersionParamsSchema.parse(request.params);
      const actor = agencyActor(request, 'sites.templates.manage');
      const input = StartTemplateAnalysisSchema.parse(request.body);
      const data = await templates().startAnalysis(
        actor,
        versionReference,
        input,
      );
      return reply.code(202).send({ data });
    },
  );

  app.get(
    '/site-template-versions/:versionReference/analysis',
    async (request) => {
      const { versionReference } = VersionParamsSchema.parse(request.params);
      agencyActor(request, 'sites.templates.read');
      return { data: await templates().getAnalysis(versionReference) };
    },
  );

  app.get(
    '/site-template-versions/:versionReference/manifest',
    async (request) => {
      const { versionReference } = VersionParamsSchema.parse(request.params);
      agencyActor(request, 'sites.templates.read');
      return { data: await templates().getManifest(versionReference) };
    },
  );

  app.patch('/site-template-layouts/:layoutReference', async (request) => {
    const { layoutReference } = LayoutParamsSchema.parse(request.params);
    const actor = agencyActor(request, 'sites.templates.manage');
    const input = UpdateTemplateLayoutSchema.parse(request.body);
    return {
      data: await templates().updateLayout(actor, layoutReference, input),
    };
  });

  app.post(
    '/site-template-layouts/:layoutReference/page-types',
    async (request, reply) => {
      const { layoutReference } = LayoutParamsSchema.parse(request.params);
      const actor = agencyActor(request, 'sites.templates.manage');
      const { pageType } = AddTemplateLayoutPageTypeSchema.parse(request.body);
      const data = await templates().addLayoutPageType(
        actor,
        layoutReference,
        pageType,
      );
      return reply.code(201).send({ data });
    },
  );

  app.delete(
    '/site-template-layouts/:layoutReference/page-types/:pageType',
    async (request, reply) => {
      const { layoutReference, pageType } =
        LayoutPageTypeParamsSchema.parse(request.params);
      const actor = agencyActor(request, 'sites.templates.manage');
      await templates().removeLayoutPageType(actor, layoutReference, pageType);
      return reply.code(204).send();
    },
  );

  app.patch('/site-template-findings/:findingReference', async (request) => {
    const { findingReference } = FindingParamsSchema.parse(request.params);
    const actor = agencyActor(request, 'sites.templates.manage');
    const input = ResolveTemplateFindingSchema.parse(request.body);
    await templates().resolveFinding(actor, findingReference, input);
    return { data: { reference: findingReference, resolved: input.resolved } };
  });

  app.post(
    '/site-template-versions/:versionReference/approve',
    async (request) => {
      const { versionReference } = VersionParamsSchema.parse(request.params);
      const actor = agencyActor(request, 'sites.templates.approve');
      const { reason } = TemplateDecisionSchema.parse(request.body);
      return {
        data: await templates().approveVersion(
          actor,
          versionReference,
          reason,
        ),
      };
    },
  );

  app.post(
    '/site-template-versions/:versionReference/reject',
    async (request) => {
      const { versionReference } = VersionParamsSchema.parse(request.params);
      const actor = agencyActor(request, 'sites.templates.approve');
      const { reason } = TemplateDecisionSchema.parse(request.body);
      return {
        data: await templates().rejectVersion(
          actor,
          versionReference,
          reason,
        ),
      };
    },
  );

  app.get('/sites/:siteReference/template-licences', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    agencyActor(request, 'sites.templates.licenses.manage');
    return { data: await templates().listLicences(siteReference) };
  });

  app.post(
    '/sites/:siteReference/template-licences',
    async (request, reply) => {
      const { siteReference } = SiteParamsSchema.parse(request.params);
      const actor = agencyActor(request, 'sites.templates.licenses.manage');
      const input = CreateTemplateLicenceSchema.parse(request.body);
      const data = await templates().recordLicence(actor, siteReference, input);
      return reply.code(201).send({ data });
    },
  );

  app.post(
    '/sites/:siteReference/template-licences/:licenceReference/revoke',
    async (request) => {
      const { siteReference, licenceReference } =
        SiteLicenceParamsSchema.parse(request.params);
      const actor = agencyActor(request, 'sites.templates.licenses.manage');
      const { reason } = TemplateDecisionSchema.parse(request.body);
      return {
        data: await templates().revokeLicence(
          actor,
          siteReference,
          licenceReference,
          reason,
        ),
      };
    },
  );
}
