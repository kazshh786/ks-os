import { FastifyPluginAsync } from 'fastify';

const workspaceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/workspace', async (request, reply) => {
    request.requireAuth();

    return reply.send({
      success: true,
      data: {
        id: request.auth!.businessReference,
        name: request.auth!.tenantName,
        subdomain: request.auth!.tenantSubdomain,
        customDomain: null, // Placeholder for Phase 2
        packageTier: 'core'
      }
    });
  });
};

export default workspaceRoutes;
