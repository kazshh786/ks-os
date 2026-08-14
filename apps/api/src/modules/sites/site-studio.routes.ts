import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ReorderSiteStudioSectionsSchema,
  UpdateSiteStudioSectionComponentSchema,
  UpdateSiteStudioSectionContentSchema,
  UpdateSiteStudioSectionVariantSchema,
  UpdateSiteStudioThemeSchema,
  type AgencyCapability,
} from '@ks-os/contracts';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { SiteDesignService } from './site-design.service.js';
import { SiteServicePageService } from './site-service-page.service.js';
import { SiteStudioService } from './site-studio.service.js';

const Params = z.object({ siteReference: z.string().uuid() }).strict();
const SectionParams = Params.extend({
  pageReference: z.string().uuid(),
  sectionReference: z.string().uuid(),
}).strict();
const ServicePageBody = z.object({ serviceReference: z.string().uuid() }).strict();

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

export async function agencySiteStudioRoutes(app: FastifyInstance) {
  const service = new SiteStudioService();
  const design = new SiteDesignService();
  const servicePages = new SiteServicePageService();
  app.get('/:siteReference/studio', async request => {
    actor(request, 'sites.studio.read');
    const { siteReference } = Params.parse(request.params);
    return { data: await service.get(siteReference) };
  });
  app.get('/:siteReference/studio/design', async request => {
    actor(request, 'sites.studio.read');
    const { siteReference } = Params.parse(request.params);
    return { data: await design.get(siteReference) };
  });
  app.patch('/:siteReference/studio/design/theme', async request => {
    const agencyActor = actor(request, 'sites.manage');
    const { siteReference } = Params.parse(request.params);
    const input = UpdateSiteStudioThemeSchema.parse(request.body);
    return { data: await design.updateTheme(agencyActor, siteReference, input) };
  });
  app.patch('/:siteReference/studio/design/pages/:pageReference/sections/:sectionReference/variant', async request => {
    const agencyActor = actor(request, 'sites.manage');
    const { siteReference, pageReference, sectionReference } = SectionParams.parse(request.params);
    const input = UpdateSiteStudioSectionVariantSchema.parse(request.body);
    return {
      data: await design.updateSectionVariant(
        agencyActor,
        siteReference,
        pageReference,
        sectionReference,
        input.variant,
      ),
    };
  });
  app.patch('/:siteReference/studio/design/pages/:pageReference/sections/:sectionReference/component', async request => {
    const agencyActor = actor(request, 'sites.manage');
    const { siteReference, pageReference, sectionReference } = SectionParams.parse(request.params);
    const input = UpdateSiteStudioSectionComponentSchema.parse(request.body);
    return {
      data: await design.updateSectionComponent(
        agencyActor,
        siteReference,
        pageReference,
        sectionReference,
        input.componentKey,
      ),
    };
  });
  app.patch('/:siteReference/studio/design/pages/:pageReference/sections/order', async request => {
    const agencyActor = actor(request, 'sites.manage');
    const { siteReference, pageReference } = SectionParams.pick({ siteReference: true, pageReference: true }).parse(request.params);
    const input = ReorderSiteStudioSectionsSchema.parse(request.body);
    return {
      data: await design.reorderSections(
        agencyActor,
        siteReference,
        pageReference,
        input.sectionReferences,
      ),
    };
  });
  app.patch('/:siteReference/studio/design/pages/:pageReference/sections/:sectionReference/content', async request => {
    const agencyActor = actor(request, 'sites.manage');
    const { siteReference, pageReference, sectionReference } = SectionParams.parse(request.params);
    const input = UpdateSiteStudioSectionContentSchema.parse(request.body);
    return {
      data: await design.updateSectionContent(
        agencyActor,
        siteReference,
        pageReference,
        sectionReference,
        input.patch,
      ),
    };
  });
  app.post('/:siteReference/studio/design/pages/:pageReference/sections/:sectionReference/duplicate', async request => {
    const agencyActor = actor(request, 'sites.manage');
    const { siteReference, pageReference, sectionReference } = SectionParams.parse(request.params);
    return { data: await design.duplicateSection(agencyActor, siteReference, pageReference, sectionReference) };
  });
  app.delete('/:siteReference/studio/design/pages/:pageReference/sections/:sectionReference', async request => {
    const agencyActor = actor(request, 'sites.manage');
    const { siteReference, pageReference, sectionReference } = SectionParams.parse(request.params);
    return { data: await design.removeSection(agencyActor, siteReference, pageReference, sectionReference) };
  });
  app.get('/:siteReference/studio/service-pages', async request => {
    actor(request, 'sites.studio.read');
    const { siteReference } = Params.parse(request.params);
    return { data: await servicePages.list(siteReference) };
  });
  app.post('/:siteReference/studio/service-pages', async request => {
    const agencyActor = actor(request, 'sites.manage');
    const { siteReference } = Params.parse(request.params);
    const { serviceReference } = ServicePageBody.parse(request.body);
    return { data: await servicePages.provision(agencyActor, siteReference, serviceReference) };
  });
  app.get('/:siteReference/studio/booking-links', async request => {
    actor(request, 'sites.studio.read');
    const { siteReference } = Params.parse(request.params);
    return { data: await service.getBookingLinks(siteReference) };
  });
  app.get('/:siteReference/booking-links', async request => {
    actor(request, 'sites.studio.read');
    const { siteReference } = Params.parse(request.params);
    return { data: await service.getBookingLinks(siteReference) };
  });
}
