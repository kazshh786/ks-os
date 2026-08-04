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

const ServiceOrderInputSchema = z.object({
  serviceIds: z.array(z.string().uuid()).min(1).max(500),
}).strict();

const ServiceParamsSchema = z.object({
  serviceId: z.string().uuid(),
});

type ServiceRow = Pick<typeof services.$inferSelect, 'id' | 'name' | 'description' | 'duration' | 'price'> & {
  category?: string | null;
  sortOrder?: number | null;
  sort_order?: number | null;
};

const serviceResponse = (service: ServiceRow) => ({
  id: service.id,
  name: service.name,
  description: service.description || '',
  duration: service.duration,
  price: service.price,
  category: service.category || 'General',
  sortOrder: service.sortOrder ?? service.sort_order ?? 0,
});

const canManageServices = (request: any) => request.auth!.role === 'owner'
  || request.auth!.permissions.includes('BUSINESS_SETTINGS_MANAGE');

const servicesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/services', async (request, reply) => {
    request.requireAuth();

    const tenantServices = await getDatabase().execute(sql`
      select id,
             name,
             description,
             duration,
             price,
             category,
             sort_order as "sortOrder"
      from services
      where tenant_id = ${request.auth!.tenantId}::uuid
        and is_active = true
      order by sort_order asc, created_at asc, id asc
    `);

    return reply.send({
      success: true,
      data: (tenantServices.rows as ServiceRow[]).map(serviceResponse)
    });
  });

  fastify.post('/api/v1/services', async (request, reply) => {
    request.requireAuth();
    if (!canManageServices(request)) {
      return reply.code(403).send({ success: false, error: { code: 'SERVICE_ACCESS_DENIED', message: 'Business settings access is required.' } });
    }
    const input = ServiceInputSchema.parse(request.body);
    const created = await getDatabase().transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.auth!.tenantId}::text, 0))`);
      // Keep the write compatible with deployed databases that predate the
      // optional buffer_time column in the ORM schema.
      const inserted = await tx.execute(sql`
        insert into services (tenant_id, name, description, duration, price, category, sort_order)
        select ${request.auth!.tenantId}::uuid,
               ${input.name},
               ${input.description},
               ${input.duration},
               ${input.price},
               ${input.category},
               coalesce(max(sort_order), -1) + 1
        from services
        where tenant_id = ${request.auth!.tenantId}::uuid
        returning id, name, description, duration, price, category, sort_order as "sortOrder"
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

  fastify.patch('/api/v1/services/order', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    request.requireAuth();
    if (!canManageServices(request)) {
      return reply.code(403).send({ success: false, error: { code: 'SERVICE_ACCESS_DENIED', message: 'Business settings access is required.' } });
    }

    const input = ServiceOrderInputSchema.parse(request.body);
    const uniqueIds = new Set(input.serviceIds);
    if (uniqueIds.size !== input.serviceIds.length) {
      return reply.code(400).send({ success: false, error: { code: 'SERVICE_ORDER_DUPLICATE', message: 'Each service can only appear once in the order.' } });
    }

    const activeServices = await getDatabase().select({ id: services.id }).from(services).where(and(
      eq(services.tenantId, request.auth!.tenantId),
      eq(services.isActive, true),
    ));
    const activeIds = new Set(activeServices.map(service => service.id));
    const orderMatchesCatalog = activeIds.size === input.serviceIds.length
      && input.serviceIds.every(serviceId => activeIds.has(serviceId));

    if (!orderMatchesCatalog) {
      return reply.code(409).send({ success: false, error: { code: 'SERVICE_ORDER_MISMATCH', message: 'The service list changed. Refresh the page and try again.' } });
    }

    const orderRows = input.serviceIds.map((id, sortOrder) => ({ id, sort_order: sortOrder }));
    await getDatabase().execute(sql`
      update services as service
      set sort_order = ordered.sort_order,
          updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(orderRows)}::jsonb) as ordered(id uuid, sort_order integer)
      where service.id = ordered.id
        and service.tenant_id = ${request.auth!.tenantId}::uuid
        and service.is_active = true
    `);

    return reply.code(204).send();
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
      returning id, name, description, duration, price, category, sort_order as "sortOrder"
    `);

    const service = updated.rows[0] as ServiceRow | undefined;
    if (!service) {
      return reply.code(404).send({ success: false, error: { code: 'SERVICE_NOT_FOUND', message: 'The service could not be found.' } });
    }

    return reply.send({ success: true, data: serviceResponse(service) });
  });

  fastify.delete('/api/v1/services/:serviceId', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    request.requireAuth();
    if (!canManageServices(request)) {
      return reply.code(403).send({ success: false, error: { code: 'SERVICE_ACCESS_DENIED', message: 'Business settings access is required.' } });
    }

    const { serviceId } = ServiceParamsSchema.parse(request.params);
    const deleted = await getDatabase().transaction(async tx => {
      const result = await tx.execute(sql`
        update services
        set is_active = false,
            updated_at = now()
        where id = ${serviceId}::uuid
          and tenant_id = ${request.auth!.tenantId}::uuid
          and is_active = true
        returning id
      `);

      if (!result.rows[0]) return false;

      await tx.update(staffServiceAssignments).set({
        isActive: false,
        updatedAt: new Date(),
      }).where(and(
        eq(staffServiceAssignments.tenantId, request.auth!.tenantId),
        eq(staffServiceAssignments.serviceId, serviceId),
      ));

      await tx.execute(sql`
        with ranked as (
          select id,
                 row_number() over (order by sort_order asc, created_at asc, id asc) - 1 as next_sort_order
          from services
          where tenant_id = ${request.auth!.tenantId}::uuid
            and is_active = true
        )
        update services as service
        set sort_order = ranked.next_sort_order,
            updated_at = now()
        from ranked
        where service.id = ranked.id
          and service.sort_order is distinct from ranked.next_sort_order
      `);

      return true;
    });

    if (!deleted) {
      return reply.code(404).send({ success: false, error: { code: 'SERVICE_NOT_FOUND', message: 'The service could not be found.' } });
    }

    return reply.code(204).send();
  });
};

export default servicesRoutes;
