import { FastifyPluginAsync } from 'fastify';
import { getDatabase, services, staffServiceAssignments, users } from '@ks-os/database';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';

const ServiceInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).default(''),
  duration: z.number().int().min(5).max(1440),
  price: z.number().int().min(0).max(100_000_000),
  category: z.string().trim().min(1).max(100).default('General'),
}).strict();

const ServiceParamsSchema = z.object({
  serviceId: z.string().uuid(),
});

type ServiceRow = Pick<typeof services.$inferSelect, 'id' | 'name' | 'description' | 'duration' | 'price'> & { category?: string | null };

const serviceResponse = (service: ServiceRow) => ({
  id: service.id,
  name: service.name,
  description: service.description || '',
  duration: service.duration,
  price: service.price,
  category: service.category || 'General',
});

const canManageServices = (request: any) => request.auth!.role === 'owner'
  || request.auth!.permissions.includes('BUSINESS_SETTINGS_MANAGE');

const servicesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/services', async (request, reply) => {
    request.requireAuth();

    const db = getDatabase();
    const tenantServices = await db.select({
      id: services.id,
      name: services.name,
      description: services.description,
      duration: services.duration,
      price: services.price,
      category: sql<string | null>`category`,
    })
      .from(services)
      .where(
        and(
          eq(services.tenantId, request.auth!.tenantId),
          eq(services.isActive, true)
        )
      );

    return reply.send({
      success: true,
      data: tenantServices.map(serviceResponse)
    });
  });

  fastify.post('/api/v1/services', async (request, reply) => {
    request.requireAuth();
    if (!canManageServices(request)) {
      return reply.code(403).send({ success: false, error: { code: 'SERVICE_ACCESS_DENIED', message: 'Business settings access is required.' } });
    }
    const input = ServiceInputSchema.parse(request.body);
    const created = await getDatabase().transaction(async tx => {
      // Keep the write compatible with deployed databases that predate the
      // optional buffer_time column in the ORM schema.
      const inserted = await tx.execute(sql`
        insert into services (tenant_id, name, description, duration, price, category)
        values (${request.auth!.tenantId}::uuid, ${input.name}, ${input.description}, ${input.duration}, ${input.price}, ${input.category})
        returning id, name, description, duration, price, category
      `);
      const service = inserted.rows[0] as ServiceRow;
      const owners = await tx.select({ id: users.id }).from(users).where(and(
        eq(users.tenantId, request.auth!.tenantId),
        eq(users.role, 'owner'),
        eq(users.accountStatus, 'ACTIVE'),
      ));
      if (owners.length) await tx.insert(staffServiceAssignments).values(owners.map(owner => ({
        tenantId: request.auth!.tenantId,
        staffUserId: owner.id,
        serviceId: service.id,
        isActive: true,
      }))).onConflictDoNothing();
      return service;
    });
    return reply.code(201).send({ success: true, data: serviceResponse(created) });
  });

  fastify.patch('/api/v1/services/:serviceId', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    request.requireAuth();
    if (!canManageServices(request)) {
      return reply.code(403).send({ success: false, error: { code: 'SERVICE_ACCESS_DENIED', message: 'Business settings access is required.' } });
    }

    const { serviceId } = ServiceParamsSchema.parse(request.params);
    const input = ServiceInputSchema.parse(request.body);
    const updated = await getDatabase().execute(sql`
      update services
      set name = ${input.name},
          description = ${input.description},
          duration = ${input.duration},
          price = ${input.price},
          category = ${input.category},
          updated_at = now()
      where id = ${serviceId}::uuid
        and tenant_id = ${request.auth!.tenantId}::uuid
        and is_active = true
      returning id, name, description, duration, price, category
    `);

    const service = updated.rows[0] as ServiceRow | undefined;
    if (!service) {
      return reply.code(404).send({ success: false, error: { code: 'SERVICE_NOT_FOUND', message: 'The service could not be found.' } });
    }

    return reply.send({ success: true, data: serviceResponse(service) });
  });
};

export default servicesRoutes;
