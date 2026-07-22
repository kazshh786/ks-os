import { FastifyPluginAsync } from 'fastify';
import { ClientRepository } from './client.repository.js';
import { 
  ClientDirectoryQuerySchema, 
  ClientNotFoundResponse 
} from '@ks-os/contracts';

const clientsRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /api/v1/clients - Paginated Directory
  fastify.get('/api/v1/clients', async (request, reply) => {
    request.requireAuth();

    const parseResult = ClientDirectoryQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'Invalid query parameters' } });
    }

    const { page, limit, search } = parseResult.data;
    const offset = (page - 1) * limit;
    
    const repo = new ClientRepository();
    const { total, tenantClients, countsMap } = await repo.getClientsDirectory(request.auth!.tenantId, limit, offset, search);

    return reply.send({
      data: tenantClients.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        lastVisitDate: c.lastVisitDate?.toISOString() || null,
        upcomingBookingCount: countsMap[c.id]?.upcoming || 0,
        totalBookingCount: countsMap[c.id]?.total || 0
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  });

  // GET /api/v1/clients/:id - Profile
  fastify.get<{ Params: { id: string } }>('/api/v1/clients/:id', async (request, reply) => {
    request.requireAuth();

    const { id: clientId } = request.params;
    
    const repo = new ClientRepository();
    const result = await repo.getClientProfile(request.auth!.tenantId, clientId);

    if (!result) {
      const errorResponse: ClientNotFoundResponse = {
        error: { code: 'CLIENT_NOT_FOUND', message: 'Client not found' }
      };
      return reply.status(404).send(errorResponse);
    }

    const { client, historyRows } = result;

    return reply.send({
      profile: {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        patchTestDate: client.patchTestDate?.toISOString() || null,
        lastVisitDate: client.lastVisitDate?.toISOString() || null,
        loyaltyPoints: client.loyaltyPoints,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString()
      },
      bookingHistory: historyRows.map(r => ({
        id: r.id,
        serviceName: r.serviceName,
        staffName: r.staffName,
        startTime: r.startTime.toISOString(),
        endTime: r.endTime.toISOString(),
        status: r.status,
        price: r.quotedAmount
      })),
      medicalNotes: request.auth!.role === 'owner' ? (client.medicalNotes || null) : null
    });
  });
};

export default clientsRoutes;
