import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateFormAssignmentSchema,
  FormAnalyticsEventSchema,
  FormAssignmentIdParamsSchema,
  FormAssignmentListQuerySchema,
  FormDraftInputSchema,
  FormIdParamsSchema,
  FormSubmissionIdParamsSchema,
  FormSubmissionListQuerySchema,
  FormVersionParamsSchema,
  PublicFormSubmissionSchema,
  PublicFormTokenParamsSchema,
  ReviewFormSubmissionSchema,
  SaveFormDraftSchema,
} from '@ks-os/contracts';
import { env } from '../../config/env.js';
import { FormsService } from './forms.service.js';
import { PublicWorkspaceFormsService } from './public-workspace-forms.service.js';

const actor = (request: FastifyRequest) => {
  request.requireAuth();
  return {
    tenantId: request.auth!.tenantId,
    userId: request.auth!.tenantUserId,
    role: request.auth!.role,
  };
};

const PublicWorkspaceFormParamsSchema = z.object({
  workspaceSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  formSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,119}[a-z0-9])?$/),
}).strict();

export async function formsRoutes(app: FastifyInstance) {
  const service = new FormsService();
  app.get('/', async request => ({ data: await service.listForms(actor(request)) }));
  app.post('/', async (request, reply) => reply.code(201).send({ data: await service.create(actor(request), FormDraftInputSchema.parse(request.body)) }));
  app.get('/:formId', async request => {
    const { formId } = FormIdParamsSchema.parse(request.params);
    return { data: await service.getForm(actor(request), formId) };
  });
  app.patch('/:formId', async request => {
    const { formId } = FormIdParamsSchema.parse(request.params);
    return { data: await service.update(actor(request), formId, FormDraftInputSchema.parse(request.body)) };
  });
  app.post('/:formId/publish', async request => {
    const { formId } = FormIdParamsSchema.parse(request.params);
    return { data: await service.publish(actor(request), formId) };
  });
  app.post('/:formId/archive', async (request, reply) => {
    const { formId } = FormIdParamsSchema.parse(request.params);
    await service.archive(actor(request), formId);
    return reply.code(204).send();
  });
  app.get('/:formId/versions', async request => {
    const { formId } = FormIdParamsSchema.parse(request.params);
    return { data: await service.listVersions(actor(request), formId) };
  });
  app.get('/:formId/versions/:versionId', async request => {
    const { formId, versionId } = FormVersionParamsSchema.parse(request.params);
    return { data: await service.getVersion(actor(request), formId, versionId) };
  });
}

export async function formAssignmentRoutes(app: FastifyInstance) {
  const service = new FormsService();
  app.get('/', async request => ({ data: await service.listAssignments(actor(request), FormAssignmentListQuerySchema.parse(request.query)) }));
  app.post('/', async (request, reply) => reply.code(201).send({ data: await service.createAssignment(actor(request), CreateFormAssignmentSchema.parse(request.body), env.FORM_ASSIGNMENT_EXPIRY_DAYS) }));
  app.get('/:assignmentId', async request => {
    const { assignmentId } = FormAssignmentIdParamsSchema.parse(request.params);
    return { data: await service.getAssignment(actor(request), assignmentId) };
  });
  app.post('/:assignmentId/cancel', async (request, reply) => {
    const { assignmentId } = FormAssignmentIdParamsSchema.parse(request.params);
    await service.cancelAssignment(actor(request), assignmentId);
    return reply.code(204).send();
  });
  app.post('/:assignmentId/regenerate-link', async request => {
    const { assignmentId } = FormAssignmentIdParamsSchema.parse(request.params);
    return { data: await service.regenerate(actor(request), assignmentId) };
  });
}

export async function formSubmissionRoutes(app: FastifyInstance) {
  const service = new FormsService();
  app.get('/', async request => ({ data: await service.listSubmissions(actor(request), FormSubmissionListQuerySchema.parse(request.query)) }));
  app.get('/:submissionId', async request => {
    const { submissionId } = FormSubmissionIdParamsSchema.parse(request.params);
    return { data: await service.getSubmission(actor(request), submissionId) };
  });
  app.patch('/:submissionId/review', async request => {
    const { submissionId } = FormSubmissionIdParamsSchema.parse(request.params);
    return { data: await service.reviewSubmission(actor(request), submissionId, ReviewFormSubmissionSchema.parse(request.body)) };
  });
}

export async function publicFormRoutes(app: FastifyInstance) {
  const service = new FormsService();
  const workspaceForms = new PublicWorkspaceFormsService();

  app.get('/workspace/:workspaceSlug/:formSlug', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async request => {
    const { workspaceSlug, formSlug } = PublicWorkspaceFormParamsSchema.parse(request.params);
    return { data: await workspaceForms.getPublic(workspaceSlug, formSlug) };
  });

  app.post('/workspace/:workspaceSlug/:formSlug/submissions', {
    bodyLimit: 262_144,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { workspaceSlug, formSlug } = PublicWorkspaceFormParamsSchema.parse(request.params);
    return reply.code(201).send({ data: await workspaceForms.submit(workspaceSlug, formSlug, PublicFormSubmissionSchema.parse(request.body)) });
  });

  app.get('/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async request => {
    const { token } = PublicFormTokenParamsSchema.parse(request.params);
    return { data: await service.getPublic(token) };
  });
  app.put('/:token/draft', { bodyLimit: 262_144, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async request => {
    const { token } = PublicFormTokenParamsSchema.parse(request.params);
    return { data: await service.saveDraft(token, SaveFormDraftSchema.parse(request.body)) };
  });
  app.get('/resume/:token', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async request => {
    const { token } = PublicFormTokenParamsSchema.parse(request.params);
    return { data: await service.resumeDraft(token) };
  });
  app.post('/:token/analytics', { bodyLimit: 8_192, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { token } = PublicFormTokenParamsSchema.parse(request.params);
    await service.recordAnalytics(token, FormAnalyticsEventSchema.parse(request.body));
    return reply.code(204).send();
  });
  app.post('/:token/submissions', { bodyLimit: 262_144, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { token } = PublicFormTokenParamsSchema.parse(request.params);
    return reply.code(201).send({ data: await service.submitPublic(token, PublicFormSubmissionSchema.parse(request.body)) });
  });
}

export async function relatedFormAssignmentRoutes(app: FastifyInstance) {
  const service = new FormsService();
  app.get('/clients/:clientId/form-assignments', async request => {
    const { clientId } = request.params as { clientId: string };
    return { data: await service.listAssignments(actor(request), FormAssignmentListQuerySchema.parse({ ...(request.query as object), clientId })) };
  });
  app.get('/appointments/:appointmentId/form-assignments', async request => {
    const { appointmentId } = request.params as { appointmentId: string };
    return { data: await service.listAssignments(actor(request), FormAssignmentListQuerySchema.parse({ ...(request.query as object), appointmentId })) };
  });
}
