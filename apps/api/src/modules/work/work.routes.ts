import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AssignWorkItemSchema,
  ChangeWorkStatusSchema,
  CreateWorkFromOpportunitySchema,
  CreateWorkItemSchema,
  CreateWorkTaskSchema,
  UpdateWorkItemSchema,
  WorkListQuerySchema,
} from '@ks-os/contracts';
import { WorkService, type WorkActor } from './work.service.js';

const ReferenceParamsSchema = {
  parse(value: unknown) {
    const reference = (value as { reference?: unknown })?.reference;
    if (typeof reference !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference)) {
      throw Object.assign(new Error('Invalid work reference.'), { statusCode: 400, code: 'WORK_REFERENCE_INVALID' });
    }
    return { reference };
  },
};

function actor(request: FastifyRequest): WorkActor {
  request.requireAuth();
  return {
    tenantId: request.auth!.tenantId,
    userId: request.auth!.tenantUserId,
    role: request.auth!.role,
    permissions: request.auth!.permissions as string[],
  };
}

export async function workRoutes(app: FastifyInstance) {
  const service = new WorkService();

  app.get('/summary', async request => ({ data: await service.summary(actor(request)) }));
  app.get('/', async request => ({ data: await service.list(actor(request), WorkListQuerySchema.parse(request.query)) }));
  app.post('/', async request => ({ data: await service.create(actor(request), CreateWorkItemSchema.parse(request.body)) }));

  app.post('/from-opportunity/:reference', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.createFromOpportunity(actor(request), reference, CreateWorkFromOpportunitySchema.parse(request.body)) };
  });

  app.get('/:reference', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.get(actor(request), reference) };
  });

  app.patch('/:reference', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.update(actor(request), reference, UpdateWorkItemSchema.parse(request.body)) };
  });

  app.post('/:reference/assign', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.assign(actor(request), reference, AssignWorkItemSchema.parse(request.body)) };
  });

  app.post('/:reference/status', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.changeStatus(actor(request), reference, ChangeWorkStatusSchema.parse(request.body)) };
  });

  app.post('/:reference/tasks', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.createTask(actor(request), reference, CreateWorkTaskSchema.parse(request.body)) };
  });
}
