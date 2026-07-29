import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  UpdateSiteStudioSectionVariantSchema,
  UpdateSiteStudioThemeSchema,
  type AgencyCapability,
} from '@ks-os/contracts';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { SiteDesignService } from './site-design.service.js';
import { SiteStudioService } from './site-studio.service.js';

const Params = z.object({ siteReference: z.string().uuid() }).strict();
const SectionParams = Params.extend({
  pageReference: z.string().uuid(),
  sectionReference: z.string().uuid(),
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

export async function agencySiteStudioRoutes(app: FastifyInstance) {
  const service = new SiteStudioService();
  const design = new SiteDesignService();
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
