import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { ReputationService, type ReputationActor } from './reputation.service.js';
import { ReviewInvitationService } from './review-invitation.service.js';
import { reputationError } from './reputation.security.js';

const actor = (request: FastifyRequest): ReputationActor => ({
  tenantId: request.auth!.tenantId, userId: request.auth!.tenantUserId, role: request.auth!.role,
  permissions: request.auth!.permissions as unknown as string[],
});

export async function reputationRoutes(app: FastifyInstance) {
  const service = new ReputationService();
  app.addHook('preHandler', async (request) => request.requireAuth());

  app.get('/overview', async (request) => ({ data: await service.overview(actor(request)) }));
  app.get('/connections', async (request) => ({ data: await service.listConnections(actor(request)) }));
  app.get('/locations', async (request) => ({ data: await service.listLocations(actor(request)) }));
  app.post('/connections/google/link', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => ({ data: await service.configureGoogleLink(actor(request), request.body) }));
  app.post('/connections/trustpilot', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => ({ data: await service.configureTrustpilot(actor(request), request.body) }));
  app.post('/connections/:connectionId/test', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request) => ({ data: await service.testConnectionLink(actor(request), (request.params as any).connectionId) }));
  app.delete('/connections/:connectionId', async (request, reply) => { await service.deleteConnection(actor(request), (request.params as any).connectionId); return reply.status(204).send(); });
  app.post('/connections/google/oauth/start', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request) => ({ data: await service.startGoogleOauth(actor(request)) }));
  app.get('/connections/google/:connectionId/accounts', async (request) => ({ data: await service.googleAccounts(actor(request), (request.params as any).connectionId) }));
  app.get('/connections/google/:connectionId/locations', async (request) => ({ data: await service.googleLocations(actor(request), (request.params as any).connectionId, String((request.query as any).accountName ?? '')) }));
  app.put('/connections/:connectionId/location-mapping', async (request) => ({ data: await service.mapProviderLocation(actor(request), (request.params as any).connectionId, request.body) }));
  app.get('/connections/trustpilot/:connectionId/templates', async (request) => ({ data: await service.trustpilotTemplates(actor(request), (request.params as any).connectionId) }));

  app.get('/invitation-rules', async (request) => ({ data: await service.listRules(actor(request)) }));
  app.post('/invitation-rules', async (request) => ({ data: await service.createRule(actor(request), request.body) }));
  app.patch('/invitation-rules/:ruleId', async (request) => ({ data: await service.updateRule(actor(request), (request.params as any).ruleId, request.body) }));
  app.post('/invitation-rules/:ruleId/pause', async (request) => ({ data: await service.setRuleStatus(actor(request), (request.params as any).ruleId, 'PAUSED') }));
  app.post('/invitation-rules/:ruleId/resume', async (request) => ({ data: await service.setRuleStatus(actor(request), (request.params as any).ruleId, 'ACTIVE') }));

  app.get('/invitations', async (request) => ({ data: await service.listInvitations(actor(request), request.query) }));
  app.get('/reviews', async (request) => ({ data: await service.listReviews(actor(request), request.query) }));
  app.post('/reviews/:reviewId/reply', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => { await service.reply(actor(request), (request.params as any).reviewId, request.body); return reply.status(204).send(); });
  app.patch('/reviews/:reviewId/reply', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => { await service.reply(actor(request), (request.params as any).reviewId, request.body); return reply.status(204).send(); });
  app.delete('/reviews/:reviewId/reply', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => { await service.deleteReply(actor(request), (request.params as any).reviewId); return reply.status(204).send(); });
  app.post('/sync', { config: { rateLimit: { max: 2, timeWindow: '5 minutes' } } }, async (request) => ({ data: await service.sync(actor(request)) }));
}

export async function reviewOauthCallbackRoutes(app: FastifyInstance) {
  const service = new ReputationService();
  app.get('/google/oauth/callback', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const { state, code, error } = request.query as any;
    if (error || !state || !code) throw reputationError(401, 'REVIEW_PROVIDER_AUTH_FAILED', 'Google authorisation was not completed.');
    await service.finishGoogleOauth(String(state), String(code));
    const target = env.PUBLIC_APP_ORIGIN ? env.PUBLIC_APP_ORIGIN.replace(/\/$/, '') + '/app/settings/integrations/reviews?google=connected' : '/';
    return reply.redirect(target);
  });
}

export async function publicReputationRoutes(app: FastifyInstance) {
  const invitations = new ReviewInvitationService();
  app.get('/:token', { config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: (request: any) => request.ip + ':' + String(request.params?.token ?? '').slice(0, 12) } } }, async (request) => ({ data: await invitations.getPublicInvitation((request.params as any).token) }));
  app.post('/:token/click', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (request: any) => request.ip + ':' + String(request.params?.token ?? '').slice(0, 12) } } }, async (request) => ({ data: await invitations.click((request.params as any).token, request.body) }));
}

export async function customerReviewInvitationRoutes(app: FastifyInstance) {
  const invitations = new ReviewInvitationService();
  app.get('/', async (request) => {
    if (!request.authIdentity || request.auth) throw reputationError(401, 'REPUTATION_ACCESS_DENIED', 'Customer authentication is required.');
    return { data: await invitations.listForCustomer(request.authIdentity.authUserId) };
  });
}
