import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  BlueprintAgencyOverrideSchema,
  BlueprintApprovalRequestSchema,
  BlueprintGenerationRequestSchema,
  BlueprintPageInputSchema,
  BlueprintPagePatchSchema,
  BlueprintRejectRequestSchema,
  type AgencyCapability,
} from '@ks-os/contracts';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { SiteBlueprintService } from './site-blueprint.service.js';

const SiteParamsSchema = z.object({
  siteReference: z.string().uuid(),
}).strict();
const BlueprintParamsSchema = SiteParamsSchema.extend({
  blueprintReference: z.string().uuid(),
}).strict();
const PageParamsSchema = BlueprintParamsSchema.extend({
  pageReference: z.string().uuid(),
}).strict();
const ReorderSchema = z.object({
  pageReferences: z.array(z.string().uuid()).min(2).max(100),
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

export async function agencySiteBlueprintRoutes(app: FastifyInstance) {
  let service: SiteBlueprintService | undefined;
  const blueprints = () => {
    service ||= new SiteBlueprintService();
    return service;
  };

  app.get('/:siteReference/blueprints', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    agencyActor(request, 'sites.blueprints.read');
    return { data: await blueprints().list(siteReference) };
  });

  app.post('/:siteReference/blueprints/generate', async (request, reply) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const input = BlueprintGenerationRequestSchema.parse(request.body);
    const data = await blueprints().generate(
      agencyActor(request, 'sites.blueprints.manage'),
      siteReference,
      input,
    );
    return reply.code(data.idempotentReplay ? 200 : 201).send({ data });
  });

  app.get('/:siteReference/blueprints/:blueprintReference', async (request) => {
    const { siteReference, blueprintReference } =
      BlueprintParamsSchema.parse(request.params);
    agencyActor(request, 'sites.blueprints.read');
    return { data: await blueprints().get(siteReference, blueprintReference) };
  });

  app.patch('/:siteReference/blueprints/:blueprintReference', async (request) => {
    const { siteReference, blueprintReference } =
      BlueprintParamsSchema.parse(request.params);
    const override = BlueprintAgencyOverrideSchema.parse(request.body);
    if (
      override.operation !== 'UPDATE_BLUEPRINT'
      && override.operation !== 'RESOLVE_ACTION_ITEM'
    ) {
      throw Object.assign(
        new Error('Use the dedicated page or reorder route for this override.'),
        { statusCode: 400, code: 'BLUEPRINT_OVERRIDE_ROUTE_INVALID' },
      );
    }
    return {
      data: await blueprints().updateBlueprint(
        agencyActor(request, 'sites.blueprints.manage'),
        siteReference,
        blueprintReference,
        override,
      ),
    };
  });

  app.get(
    '/:siteReference/blueprints/:blueprintReference/validation',
    async (request) => {
      const { siteReference, blueprintReference } =
        BlueprintParamsSchema.parse(request.params);
      agencyActor(request, 'sites.blueprints.read');
      return {
        data: await blueprints().validation(siteReference, blueprintReference),
      };
    },
  );

  app.get(
    '/:siteReference/blueprints/:blueprintReference/action-items',
    async (request) => {
      const { siteReference, blueprintReference } =
        BlueprintParamsSchema.parse(request.params);
      agencyActor(request, 'sites.blueprints.read');
      return {
        data: await blueprints().listActionItems(
          siteReference,
          blueprintReference,
        ),
      };
    },
  );

  app.post(
    '/:siteReference/blueprints/:blueprintReference/pages',
    async (request, reply) => {
      const { siteReference, blueprintReference } =
        BlueprintParamsSchema.parse(request.params);
      const input = BlueprintPageInputSchema.parse(request.body);
      const data = await blueprints().addPage(
        agencyActor(request, 'sites.blueprints.manage'),
        siteReference,
        blueprintReference,
        input,
      );
      return reply.code(201).send({ data });
    },
  );

  app.patch(
    '/:siteReference/blueprints/:blueprintReference/pages/:pageReference',
    async (request) => {
      const { siteReference, blueprintReference, pageReference } =
        PageParamsSchema.parse(request.params);
      const input = BlueprintPagePatchSchema.parse(request.body);
      return {
        data: await blueprints().updatePage(
          agencyActor(request, 'sites.blueprints.manage'),
          siteReference,
          blueprintReference,
          pageReference,
          input,
        ),
      };
    },
  );

  app.delete(
    '/:siteReference/blueprints/:blueprintReference/pages/:pageReference',
    async (request) => {
      const { siteReference, blueprintReference, pageReference } =
        PageParamsSchema.parse(request.params);
      return {
        data: await blueprints().removePage(
          agencyActor(request, 'sites.blueprints.manage'),
          siteReference,
          blueprintReference,
          pageReference,
        ),
      };
    },
  );

  app.post(
    '/:siteReference/blueprints/:blueprintReference/reorder',
    async (request) => {
      const { siteReference, blueprintReference } =
        BlueprintParamsSchema.parse(request.params);
      const input = ReorderSchema.parse(request.body);
      return {
        data: await blueprints().reorder(
          agencyActor(request, 'sites.blueprints.manage'),
          siteReference,
          blueprintReference,
          input.pageReferences,
        ),
      };
    },
  );

  app.post(
    '/:siteReference/blueprints/:blueprintReference/validate',
    async (request) => {
      const { siteReference, blueprintReference } =
        BlueprintParamsSchema.parse(request.params);
      return {
        data: await blueprints().validateAndTransition(
          agencyActor(request, 'sites.blueprints.manage'),
          siteReference,
          blueprintReference,
        ),
      };
    },
  );

  app.post(
    '/:siteReference/blueprints/:blueprintReference/approve',
    async (request) => {
      const { siteReference, blueprintReference } =
        BlueprintParamsSchema.parse(request.params);
      const input = BlueprintApprovalRequestSchema.parse(request.body);
      return {
        data: await blueprints().approve(
          agencyActor(request, 'sites.blueprints.approve'),
          siteReference,
          blueprintReference,
          input,
        ),
      };
    },
  );

  app.post(
    '/:siteReference/blueprints/:blueprintReference/reject',
    async (request) => {
      const { siteReference, blueprintReference } =
        BlueprintParamsSchema.parse(request.params);
      const input = BlueprintRejectRequestSchema.parse(request.body);
      return {
        data: await blueprints().reject(
          agencyActor(request, 'sites.blueprints.approve'),
          siteReference,
          blueprintReference,
          input,
        ),
      };
    },
  );

  app.post(
    '/:siteReference/blueprints/:blueprintReference/revise',
    async (request, reply) => {
      const { siteReference, blueprintReference } =
        BlueprintParamsSchema.parse(request.params);
      const data = await blueprints().revise(
        agencyActor(request, 'sites.blueprints.manage'),
        siteReference,
        blueprintReference,
      );
      return reply.code(201).send({ data });
    },
  );
}
