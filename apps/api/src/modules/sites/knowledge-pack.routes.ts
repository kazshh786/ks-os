import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AgencyCapability } from '@ks-os/contracts';
import {
  CreateKnowledgePackSchema,
  KnowledgeImportBundleSchema,
  KnowledgeImportFormatSchema,
  KnowledgePackActionSchema,
  KnowledgePackListQuerySchema,
  ResolveKnowledgeConflictSchema,
  ReviseKnowledgePackSchema,
  UpdateKnowledgePackSchema,
  UpdateKnowledgeRuleSchema,
} from '@ks-os/site-knowledge';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { AgencyKnowledgePackService } from './knowledge-pack.service.js';

const PackParamsSchema = z.object({
  packReference: z.string().uuid(),
}).strict();
const RuleParamsSchema = PackParamsSchema.extend({
  ruleId: z.string()
    .min(3)
    .max(120)
    .regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
}).strict();
const CompareParamsSchema = PackParamsSchema.extend({
  otherPackReference: z.string().uuid(),
}).strict();
const ConflictParamsSchema = PackParamsSchema.extend({
  conflictReference: z.string().uuid(),
}).strict();
const ImportBodySchema = z.object({
  format: KnowledgeImportFormatSchema,
  bundle: KnowledgeImportBundleSchema,
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

export async function agencyKnowledgePackRoutes(app: FastifyInstance) {
  const service = new AgencyKnowledgePackService();

  app.get('/knowledge-packs', async request => {
    actor(request, 'sites.knowledge.read');
    return {
      data: await service.list(
        KnowledgePackListQuerySchema.parse(request.query),
      ),
    };
  });

  app.post('/knowledge-packs', async request => {
    const agencyActor = actor(request, 'sites.knowledge.manage');
    return {
      data: await service.create(
        agencyActor,
        CreateKnowledgePackSchema.parse(request.body),
      ),
    };
  });

  app.get('/knowledge-packs/:packReference', async request => {
    actor(request, 'sites.knowledge.read');
    const { packReference } = PackParamsSchema.parse(request.params);
    return { data: await service.get(packReference) };
  });

  app.patch('/knowledge-packs/:packReference', async request => {
    const agencyActor = actor(request, 'sites.knowledge.manage');
    const { packReference } = PackParamsSchema.parse(request.params);
    return {
      data: await service.update(
        agencyActor,
        packReference,
        UpdateKnowledgePackSchema.parse(request.body),
      ),
    };
  });

  app.post('/knowledge-packs/:packReference/import', async request => {
    const agencyActor = actor(request, 'sites.knowledge.import');
    const { packReference } = PackParamsSchema.parse(request.params);
    const body = ImportBodySchema.parse(request.body);
    return {
      data: await service.importBundle(
        agencyActor,
        packReference,
        body.format,
        body.bundle,
      ),
    };
  });

  app.get('/knowledge-packs/:packReference/imports', async request => {
    actor(request, 'sites.knowledge.read');
    const { packReference } = PackParamsSchema.parse(request.params);
    return { data: await service.imports(packReference) };
  });

  app.get('/knowledge-packs/:packReference/findings', async request => {
    actor(request, 'sites.knowledge.read');
    const { packReference } = PackParamsSchema.parse(request.params);
    return { data: await service.findings(packReference) };
  });

  app.get('/knowledge-packs/:packReference/rules', async request => {
    actor(request, 'sites.knowledge.read');
    const { packReference } = PackParamsSchema.parse(request.params);
    return { data: await service.rules(packReference) };
  });

  app.get('/knowledge-packs/:packReference/rules/:ruleId', async request => {
    actor(request, 'sites.knowledge.read');
    const { packReference, ruleId } = RuleParamsSchema.parse(request.params);
    return { data: await service.rule(packReference, ruleId) };
  });

  app.patch('/knowledge-packs/:packReference/rules/:ruleId', async request => {
    const agencyActor = actor(request, 'sites.knowledge.manage');
    const { packReference, ruleId } = RuleParamsSchema.parse(request.params);
    return {
      data: await service.updateRule(
        agencyActor,
        packReference,
        ruleId,
        UpdateKnowledgeRuleSchema.parse(request.body),
      ),
    };
  });

  app.get('/knowledge-packs/:packReference/page-playbooks', async request => {
    actor(request, 'sites.knowledge.read');
    const { packReference } = PackParamsSchema.parse(request.params);
    return { data: await service.pagePlaybooks(packReference) };
  });

  app.get('/knowledge-packs/:packReference/sources', async request => {
    actor(request, 'sites.knowledge.read');
    const { packReference } = PackParamsSchema.parse(request.params);
    return { data: await service.sources(packReference) };
  });

  app.get('/knowledge-packs/:packReference/conflicts', async request => {
    actor(request, 'sites.knowledge.read');
    const { packReference } = PackParamsSchema.parse(request.params);
    return { data: await service.conflicts(packReference) };
  });

  app.post(
    '/knowledge-packs/:packReference/conflicts/:conflictReference/resolve',
    async request => {
      const agencyActor = actor(request, 'sites.knowledge.manage');
      const { packReference, conflictReference } = ConflictParamsSchema
        .parse(request.params);
      const body = ResolveKnowledgeConflictSchema.parse(request.body);
      return {
        data: await service.resolveConflict(
          agencyActor,
          packReference,
          conflictReference,
          body.resolution,
          body.reason,
        ),
      };
    },
  );

  app.post('/knowledge-packs/:packReference/validate', async request => {
    const agencyActor = actor(request, 'sites.knowledge.manage');
    const { packReference } = PackParamsSchema.parse(request.params);
    return { data: await service.validate(agencyActor, packReference) };
  });

  app.post('/knowledge-packs/:packReference/approve', async request => {
    const agencyActor = actor(request, 'sites.knowledge.approve');
    const { packReference } = PackParamsSchema.parse(request.params);
    const { reason } = KnowledgePackActionSchema.parse(request.body);
    return { data: await service.approve(agencyActor, packReference, reason) };
  });

  app.post('/knowledge-packs/:packReference/activate', async request => {
    const agencyActor = actor(request, 'sites.knowledge.activate');
    const { packReference } = PackParamsSchema.parse(request.params);
    const { reason } = KnowledgePackActionSchema.parse(request.body);
    return { data: await service.activate(agencyActor, packReference, reason) };
  });

  app.post('/knowledge-packs/:packReference/retire', async request => {
    const agencyActor = actor(request, 'sites.knowledge.manage');
    const { packReference } = PackParamsSchema.parse(request.params);
    const { reason } = KnowledgePackActionSchema.parse(request.body);
    return { data: await service.retire(agencyActor, packReference, reason) };
  });

  app.post('/knowledge-packs/:packReference/revise', async request => {
    const agencyActor = actor(request, 'sites.knowledge.manage');
    const { packReference } = PackParamsSchema.parse(request.params);
    return {
      data: await service.revise(
        agencyActor,
        packReference,
        ReviseKnowledgePackSchema.parse(request.body),
      ),
    };
  });

  app.get(
    '/knowledge-packs/:packReference/compare/:otherPackReference',
    async request => {
      actor(request, 'sites.knowledge.read');
      const { packReference, otherPackReference } = CompareParamsSchema
        .parse(request.params);
      return {
        data: await service.compare(packReference, otherPackReference),
      };
    },
  );
}
