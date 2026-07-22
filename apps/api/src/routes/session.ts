import { FastifyPluginAsync } from 'fastify';

const sessionRoutes: FastifyPluginAsync = async (fastify, opts) => {
  fastify.get('/api/v1/session', async (request, reply) => {
    // If auth plugin successfully decoded the token and found the DB user, request.auth is populated.
    if (!request.auth) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'No valid session found' }
      });
    }

    return reply.send({
      success: true,
      data: {
        authenticated: true,
        user: {
          id: request.auth.membershipReference,
          email: request.auth.email || '',
          name: request.auth.email?.split('@')[0] || 'User', // In Phase 2 we map from db, name could be added to auth context
          role: request.auth.role,
          permissions: request.auth.permissions.reduce((acc, perm) => {
            acc[perm] = true;
            return acc;
          }, {} as Record<string, boolean>)
        },
        tenant: {
          id: request.auth.businessReference,
          name: request.auth.tenantName,
          subdomain: request.auth.tenantSubdomain,
          customDomain: null,
          primaryColor: '#000000',
          secondaryColor: '#ffffff',
          accentColor: '#10b981'
        },
        devMode: false
        ,supportMode: request.auth.supportMode ? {
          active: true,
          agencyUserId: request.auth.agencyUserId,
          supportSessionId: request.auth.supportSessionId,
          expiresAt: request.auth.supportExpiresAt,
          reason: request.auth.supportReason
          ,scope: request.auth.supportScope
        } : null
      }
    });
  });
};

export default sessionRoutes;
