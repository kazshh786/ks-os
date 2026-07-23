import { FastifyPluginAsync } from 'fastify';
import { getDatabase, services, staffServiceAssignments, users } from '@ks-os/database';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';

const CreateServiceSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).default(''),
  duration: z.number().int().min(5).max(1440),
  price: z.number().int().min(0).max(100_000_000),
  category: z.string().trim().min(1).max(100).default('General'),
}).strict();

type ServiceRow = Pick<typeof services.$inferSelect, 'id' | 'name' | 'description' | 'duration' | 'price'> & { category?: string | null };

const serviceResponse = (service: ServiceRow) => ({
  id: service.id,
  name: service.name,
  description: service.description || '',
  duration: service.duration,
  price: service.price,
  category: service.category || 'General',
});

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
    if (request.auth!.role !== 'owner' && !request.auth!.permissions.includes('BUSINESS_SETTINGS_MANAGE')) {
      return reply.code(403).send({ success: false, error: { code: 'SERVICE_ACCESS_DENIED', message: 'Business settings access is required.' } });
    }
    const input = CreateServiceSchema.parse(request.body);
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
};

export default servicesRoutes;
