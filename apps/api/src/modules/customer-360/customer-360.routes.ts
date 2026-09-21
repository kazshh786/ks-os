import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CustomerCommandSchema, CustomerTimelineQuerySchema, CreateTaskSchema, CreateWorkItemSchema, CreateSalesOpportunitySchema, CreateWorkFromOpportunitySchema } from '@ks-os/contracts';
import { Customer360Service, customerError } from './customer-360.service.js';
import { PlatformErrorLogService } from '../errors/platform-error-log.service.js';
import { TaskService } from '../tasks/task.service.js';
import { WorkService } from '../work/work.service.js';
import { SalesService } from '../sales/sales.service.js';

const params = z.object({ reference: z.string().uuid() }).strict();
const empty = z.object({}).strict();
function dependencies(request: FastifyRequest) {
  request.requireAuth();
  const auth = request.auth!;
  const actor = { tenantId: auth.tenantId, userId: auth.tenantUserId, role: auth.role, permissions: [...auth.permissions], readOnly: Boolean(auth.supportMode) };
  const service = new Customer360Service(undefined, source => {
    // Deliberately report a safe error, never SQL parameters or source record payloads.
    const error = new Error(`Customer 360 ${source} source unavailable`);
    void new PlatformErrorLogService().capture(request, error, 503, 'CUSTOMER_SOURCE_UNAVAILABLE', true).catch(() => {});
  }, request.id);
  return { actor, service, reference: params.parse(request.params).reference };
}
export async function customer360Routes(app: FastifyInstance) {
  app.get('/:reference/overview', async request => {
    const { actor, service, reference } = dependencies(request); empty.parse(request.query);
    return { data: await service.overview(actor, reference) };
  });
  app.get('/:reference/timeline', async request => {
    const { actor, service, reference } = dependencies(request);
    return { data: await service.timeline(actor, reference, CustomerTimelineQuerySchema.parse(request.query)) };
  });
  app.get('/:reference/attention', async request => {
    const { actor, service, reference } = dependencies(request); empty.parse(request.query);
    const overview = await service.overview(actor, reference);
    return { data: { attention: overview.attention, diagnostics: overview.diagnostics } };
  });
  app.get('/:reference/actions', async request => {
    const { actor, service, reference } = dependencies(request); empty.parse(request.query);
    const context = await service.context(actor, reference);
    return { data: service.actions(actor, context) };
  });
  app.post('/:reference/actions', async request => {
    const { actor, service, reference } = dependencies(request); empty.parse(request.query);
    if (request.auth?.supportMode) throw customerError(403, 'Customer actions are unavailable in support mode.');
    const input = CustomerCommandSchema.parse(request.body);
    const context = await service.context(actor, reference);
    if (input.kind === 'CONVERT_WORK') {
      const overview = await service.overview(actor, reference);
      if (!overview.attention.some(item => item.action?.kind === input.kind && item.action.reference === input.sourceReference)) throw customerError(403, 'This action is no longer available. Refresh the customer.');
      const result = await new WorkService().createFromOpportunity(actor, input.sourceReference!, CreateWorkFromOpportunitySchema.parse({ title: input.title }));
      return { data: { route: `/app/work/${result.work.reference}` } };
    }
    if (!service.actions(actor, context).some(action => action.kind === input.kind)) throw customerError(403, 'You cannot perform this customer action.');
    if (input.kind === 'ADD_TASK') {
      await new TaskService().create(actor, CreateTaskSchema.parse({ title: input.title, sourceType: 'CLIENT', sourceId: context.customer.id, clientId: context.customer.id, assignedUserId: actor.userId }));
      return { data: { route: null } };
    }
    if (input.kind === 'CREATE_WORK') {
      const result = await new WorkService().create(actor, CreateWorkItemSchema.parse({ title: input.title, clientId: context.customer.id, assignedUserId: actor.userId }));
      return { data: { route: `/app/work/${result.work.reference}` } };
    }
    const result = await new SalesService().createOpportunity(actor, CreateSalesOpportunitySchema.parse({ title: input.title, clientId: context.customer.id, ownerUserId: actor.userId }));
    return { data: { route: `/app/sales/${result.opportunity.reference}` } };
  });
}
