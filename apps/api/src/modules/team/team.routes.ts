import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ApplyStaffLifecycleRequestSchema,
  CreateTeamInvitationRequestSchema,
  StaffLifecycleActionSchema,
  TeamInvitationIdParamsSchema,
  TeamMemberIdParamsSchema,
  UpdateBookingChannelScheduleRequestSchema,
  UpdateBookingScheduleOverridesRequestSchema,
  UpdateStaffProfileRequestSchema,
  UpdateStaffScheduleRequestSchema,
  UpdateStaffServicesRequestSchema,
} from '@ks-os/contracts';
import { supabase } from '../../lib/supabase.js';
import { requireOwner } from './team.permissions.js';
import { TeamService } from './team.service.js';
import { teamError } from './team.errors.js';

const owner = (request: FastifyRequest) => {
  request.requireAuth();
  return requireOwner(request.auth!);
};
const readLimit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
const writeLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

export async function teamRoutes(app: FastifyInstance) {
  const service = new TeamService();
  app.get('/', readLimit, async request => ({ data: await service.list(owner(request)) }));
  app.get('/invitations', readLimit, async request => ({ data: (await service.list(owner(request))).invitations }));
  app.post('/invitations', writeLimit, async (request, reply) => reply.code(201).send({ data: await service.invite(owner(request), CreateTeamInvitationRequestSchema.parse(request.body)) }));
  app.post('/invitations/:invitationId/resend', writeLimit, async request => {
    const { invitationId } = TeamInvitationIdParamsSchema.parse(request.params);
    return { data: await service.resend(owner(request), invitationId) };
  });
  app.post('/invitations/:invitationId/cancel', writeLimit, async (request, reply) => {
    const { invitationId } = TeamInvitationIdParamsSchema.parse(request.params);
    await service.cancelInvitation(owner(request), invitationId);
    return reply.code(204).send();
  });

  app.get('/:staffUserId', readLimit, async request => {
    const { staffUserId } = TeamMemberIdParamsSchema.parse(request.params);
    return { data: await service.get(owner(request), staffUserId) };
  });
  app.patch('/:staffUserId', writeLimit, async request => {
    const { staffUserId } = TeamMemberIdParamsSchema.parse(request.params);
    return { data: await service.updateProfile(owner(request), staffUserId, UpdateStaffProfileRequestSchema.parse(request.body)) };
  });
  app.put('/:staffUserId/services', writeLimit, async request => {
    const { staffUserId } = TeamMemberIdParamsSchema.parse(request.params);
    return { data: await service.updateServices(owner(request), staffUserId, UpdateStaffServicesRequestSchema.parse(request.body)) };
  });
  app.put('/:staffUserId/schedule', writeLimit, async request => {
    const { staffUserId } = TeamMemberIdParamsSchema.parse(request.params);
    return { data: await service.updateSchedule(owner(request), staffUserId, UpdateStaffScheduleRequestSchema.parse(request.body)) };
  });
  app.put('/:staffUserId/booking-channel-schedule', writeLimit, async request => {
    const { staffUserId } = TeamMemberIdParamsSchema.parse(request.params);
    return { data: await service.updateChannels(owner(request), staffUserId, UpdateBookingChannelScheduleRequestSchema.parse(request.body)) };
  });
  app.put('/:staffUserId/booking-schedule-overrides', writeLimit, async request => {
    const { staffUserId } = TeamMemberIdParamsSchema.parse(request.params);
    return { data: await service.updateOverrides(owner(request), staffUserId, UpdateBookingScheduleOverridesRequestSchema.parse(request.body)) };
  });
  app.get('/:staffUserId/lifecycle/:action/preview', readLimit, async request => {
    const { staffUserId } = TeamMemberIdParamsSchema.parse(request.params);
    const { action } = request.params as { action: string };
    return { data: await service.preview(owner(request), staffUserId, StaffLifecycleActionSchema.parse(action)) };
  });
  app.post('/:staffUserId/lifecycle', writeLimit, async request => {
    const { staffUserId } = TeamMemberIdParamsSchema.parse(request.params);
    const input = ApplyStaffLifecycleRequestSchema.parse(request.body);
    return { data: await service.apply(owner(request), staffUserId, input.action) };
  });
}

export async function teamInvitationAcceptanceRoutes(app: FastifyInstance) {
  const service = new TeamService();
  app.post('/accept', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async request => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw teamError(401, 'UNAUTHENTICATED', 'Authentication required.');
    const { data, error } = await supabase.auth.getClaims(header.slice(7));
    const claims = (data as any)?.claims ?? data;
    if (error || !claims?.sub || !claims?.email) throw teamError(401, 'UNAUTHENTICATED', 'Authentication required.');
    return { data: await service.accept(claims.sub, claims.email) };
  });
}
