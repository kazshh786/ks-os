import { FastifyPluginAsync } from 'fastify';
import { getDatabase, users } from '@ks-os/database';
import { eq, inArray, and } from 'drizzle-orm';

const staffRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/staff', async (request, reply) => {
    request.requireAuth();

    const db = getDatabase();
    // Appointment creation only accepts active, booking-enabled owners/staff.
    // Keep the directory aligned so stale memberships cannot be selected in the UI.
    const tenantStaff = await db.select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, request.auth!.tenantId),
          inArray(users.role, ['owner', 'staff']),
          eq(users.accountStatus, 'ACTIVE'),
          eq(users.bookingEnabled, true)
        )
      );

    return reply.send({
      success: true,
      data: tenantStaff.map(s => ({
        id: s.id,
        name: s.name,
        role: s.role,
        email: s.email
      }))
    });
  });
};

export default staffRoutes;
