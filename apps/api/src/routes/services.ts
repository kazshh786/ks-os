import { FastifyPluginAsync } from 'fastify';
import { getDatabase, services } from '@ks-os/database';
import { eq, and } from 'drizzle-orm';

const servicesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/services', async (request, reply) => {
    request.requireAuth();

    const db = getDatabase();
    const tenantServices = await db.select()
      .from(services)
      .where(
        and(
          eq(services.tenantId, request.auth!.tenantId),
          eq(services.isActive, true)
        )
      );

    return reply.send({
      success: true,
      data: tenantServices.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description || '',
        duration: s.duration,
        price: s.price
      }))
    });
  });
};

export default servicesRoutes;
