import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PublicFormSubmissionSchema } from '@ks-os/contracts';
import { PublicWorkspaceFormsService } from './public-workspace-forms.service.js';

const PublicWorkspaceFormParamsSchema = z.object({
  workspaceSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  formSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,119}[a-z0-9])?$/),
}).strict();

export async function publicWorkspaceFormRoutes(app: FastifyInstance) {
  const service = new PublicWorkspaceFormsService();

  app.get('/:workspaceSlug/forms/:formSlug', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async request => {
    const { workspaceSlug, formSlug } = PublicWorkspaceFormParamsSchema.parse(request.params);
    return { data: await service.getPublic(workspaceSlug, formSlug) };
  });

  app.post('/:workspaceSlug/forms/:formSlug/submissions', {
    bodyLimit: 262_144,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { workspaceSlug, formSlug } = PublicWorkspaceFormParamsSchema.parse(request.params);
    const input = PublicFormSubmissionSchema.parse(request.body);
    return reply.code(201).send({ data: await service.submit(workspaceSlug, formSlug, input) });
  });
}
