import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  GithubDeploymentError,
  GithubDeploymentService,
} from './github-deployment.service.js';

const DeploymentRequestSchema = z.object({
  target: z.enum(['both', 'vps', 'cloudflare']).default('both'),
  ref: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9._/-]+$/).default('main'),
  applyMigrations: z.boolean().default(false),
}).strict();

const RunParamsSchema = z.object({
  runId: z.coerce.number().int().positive(),
});

function requirePlatformOwner(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.requireAgency('agency.users.manage');
  if (auth.role !== 'PLATFORM_OWNER') {
    void reply.code(403).send({
      success: false,
      error: {
        code: 'DEPLOYMENT_PLATFORM_OWNER_REQUIRED',
        message: 'Only the platform owner can deploy production.',
      },
    });
    return null;
  }
  return auth;
}

function deploymentService() {
  return new GithubDeploymentService({
    token: process.env.KS_OS_GITHUB_DEPLOY_TOKEN?.trim() ?? '',
    repository: process.env.KS_OS_GITHUB_REPOSITORY?.trim() || 'kazshh786/ks-os',
    workflowFile: process.env.KS_OS_GITHUB_DEPLOY_WORKFLOW?.trim() || 'deploy-production.yml',
  });
}

function sendDeploymentError(reply: FastifyReply, error: unknown) {
  if (error instanceof GithubDeploymentError) {
    return reply.code(error.statusCode).send({
      success: false,
      error: { code: error.code, message: error.message },
    });
  }
  throw error;
}

export async function agencyDeploymentRoutes(app: FastifyInstance) {
  app.post('/deployments', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const auth = requirePlatformOwner(request, reply);
    if (!auth) return reply;

    const input = DeploymentRequestSchema.parse(request.body);
    const requestId = `portal-${Date.now()}-${randomUUID().slice(0, 8)}`;

    request.log.info({
      agencyUserId: auth.agencyUserId,
      deploymentTarget: input.target,
      deploymentRef: input.ref,
      applyMigrations: input.applyMigrations,
      deploymentRequestId: requestId,
    }, 'Production deployment requested from the agency portal');

    try {
      const run = await deploymentService().dispatch({ ...input, requestId });
      return reply.code(202).send({ data: run });
    } catch (error) {
      return sendDeploymentError(reply, error);
    }
  });

  app.get('/deployments/:runId', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const auth = requirePlatformOwner(request, reply);
    if (!auth) return reply;

    const { runId } = RunParamsSchema.parse(request.params);
    try {
      return { data: await deploymentService().getRun(runId) };
    } catch (error) {
      return sendDeploymentError(reply, error);
    }
  });
}
