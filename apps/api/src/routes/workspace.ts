import { FastifyPluginAsync } from 'fastify';
import { WorkspacePlanSummarySchema } from '@ks-os/contracts';
import { EntitlementService } from '../modules/agency/agency.service.js';

const workspaceRoutes: FastifyPluginAsync = async (fastify) => {
  const entitlements = new EntitlementService();

  fastify.get('/api/v1/workspace', async (request, reply) => {
    request.requireAuth();
    const plan = WorkspacePlanSummarySchema.parse(await entitlements.workspaceSummary(request.auth!.tenantId));

    return reply.send({
      success: true,
      data: {
        id: request.auth!.businessReference,
        name: request.auth!.tenantName,
        subdomain: request.auth!.tenantSubdomain,
        customDomain: null, // Placeholder for Phase 2
        packageTier: plan.plan.key.toLowerCase(),
        plan,
      }
    });
  });
};

export default workspaceRoutes;
