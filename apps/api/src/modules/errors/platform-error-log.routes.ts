import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PlatformErrorLogService } from './platform-error-log.service.js';

const ErrorLogQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  severity: z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']).optional(),
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  tenantId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

const ErrorLogParamsSchema = z.object({ id: z.string().uuid() });

export async function platformErrorLogRoutes(app: FastifyInstance) {
  const service = new PlatformErrorLogService();

  app.get('/', async request => {
    request.requireAgency('support.read');
    const query = ErrorLogQuerySchema.parse(request.query);
    return { data: await service.list(query) };
  });

  app.get('/:id', async request => {
    request.requireAgency('support.read');
    const { id } = ErrorLogParamsSchema.parse(request.params);
    return { data: await service.get(id) };
  });
}
