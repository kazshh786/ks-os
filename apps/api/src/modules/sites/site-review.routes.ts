import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  type AgencyCapability,
  PublicReferenceSchema,
} from '@ks-os/contracts';
import {
  AddReviewParticipantSchema,
  AgencyFactDecisionSchema,
  BoundedRegenerationReasonSchema,
  CreateApprovalDecisionSchema,
  CreateChangeRequestSchema,
  CreateCommentSchema,
  CreateReviewCycleSchema,
  ResolveChangeRequestSchema,
  safeReviewTextSchema,
  UpdateChangeRequestSchema,
  UpdateCommentSchema,
} from '@ks-os/site-review';
import { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { SiteReviewService } from './site-review.service.js';

const SiteParamsSchema = z.object({
  siteReference: PublicReferenceSchema,
}).strict();
const CycleParamsSchema = SiteParamsSchema.extend({
  reviewReference: PublicReferenceSchema,
}).strict();
const CommentParamsSchema = CycleParamsSchema.extend({
  commentReference: PublicReferenceSchema,
}).strict();
const ChangeRequestParamsSchema = CycleParamsSchema.extend({
  requestReference: PublicReferenceSchema,
}).strict();
const FactParamsSchema = CycleParamsSchema.extend({
  factReference: PublicReferenceSchema,
}).strict();
const ParticipantParamsSchema = CycleParamsSchema.extend({
  participantReference: PublicReferenceSchema,
}).strict();
const PreviewSessionParamsSchema = CycleParamsSchema.extend({
  sessionReference: PublicReferenceSchema,
}).strict();
const CompareParamsSchema = SiteParamsSchema.extend({
  versionReference: PublicReferenceSchema,
  otherVersionReference: PublicReferenceSchema,
}).strict();

const ReasonSchema = z.object({
  reason: safeReviewTextSchema(1_000),
}).strict();
const OptionalReasonSchema = z.object({
  reason: safeReviewTextSchema(1_000).optional(),
}).strict();
const UpdateCycleSchema = z.object({
  clientApprovalRequired: z.boolean().optional(),
  agencyApprovalRequired: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one review policy change is required.',
});

function agencyActor(
  request: FastifyRequest,
  capability: AgencyCapability,
): AgencyActor {
  const auth = request.requireAgency(capability);
  return {
    agencyUserId: auth.agencyUserId,
    role: auth.role,
    requestId: request.id,
    ipHash: createHash('sha256')
      .update(`${process.env.AUDIT_IP_HASH_SECRET || 'local-development'}:${request.ip}`)
      .digest('hex'),
    sessionId: request.authIdentity?.authSessionId || undefined,
    userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || undefined,
  };
}

export async function agencySiteReviewRoutes(app: FastifyInstance) {
  let instance: SiteReviewService | undefined;
  const review = () => {
    instance ||= new SiteReviewService();
    return instance;
  };

  app.post('/:siteReference/review-cycles', async (request, reply) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const data = await review().createCycle(
      agencyActor(request, 'sites.review.create'),
      siteReference,
      CreateReviewCycleSchema.parse(request.body),
    );
    return reply.code(201).send({ data });
  });

  app.get('/:siteReference/review-cycles', async request => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.read');
    return { data: await review().listCycles(siteReference) };
  });

  app.get('/:siteReference/review-cycles/:reviewReference', async request => {
    const params = CycleParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.read');
    return { data: await review().getCycle(params.siteReference, params.reviewReference) };
  });

  app.patch('/:siteReference/review-cycles/:reviewReference', async request => {
    const params = CycleParamsSchema.parse(request.params);
    return { data: await review().updateCycle(
      agencyActor(request, 'sites.review.manage'),
      params.siteReference,
      params.reviewReference,
      UpdateCycleSchema.parse(request.body),
    ) };
  });

  const transition = (
    path: string,
    capability: AgencyCapability,
    action:
      | 'OPEN_INTERNAL_REVIEW'
      | 'REQUEST_INTERNAL_CHANGES'
      | 'MARK_READY_FOR_CLIENT'
      | 'START_CLIENT_REVIEW'
      | 'START_AGENCY_FINAL_REVIEW'
      | 'REJECT'
      | 'CANCEL',
    reasonRequired = false,
  ) => {
    app.post(path, async request => {
      const params = CycleParamsSchema.parse(request.params);
      const body = (reasonRequired ? ReasonSchema : OptionalReasonSchema).parse(request.body ?? {});
      return { data: await review().transition(
        agencyActor(request, capability),
        params.siteReference,
        params.reviewReference,
        action,
        body.reason,
      ) };
    });
  };

  transition('/:siteReference/review-cycles/:reviewReference/open-internal-review', 'sites.review.manage', 'OPEN_INTERNAL_REVIEW');
  transition('/:siteReference/review-cycles/:reviewReference/request-internal-changes', 'sites.review.manage', 'REQUEST_INTERNAL_CHANGES', true);
  transition('/:siteReference/review-cycles/:reviewReference/ready-for-client', 'sites.review.manage', 'MARK_READY_FOR_CLIENT');
  transition('/:siteReference/review-cycles/:reviewReference/start-client-review', 'sites.review.manage', 'START_CLIENT_REVIEW');
  transition('/:siteReference/review-cycles/:reviewReference/final-review', 'sites.review.manage', 'START_AGENCY_FINAL_REVIEW');
  transition('/:siteReference/review-cycles/:reviewReference/reject', 'sites.review.reject', 'REJECT', true);
  transition('/:siteReference/review-cycles/:reviewReference/cancel', 'sites.review.manage', 'CANCEL');

  app.post('/:siteReference/review-cycles/:reviewReference/approve', async request => {
    const params = CycleParamsSchema.parse(request.params);
    return { data: await review().agencyFinalApproval(
      agencyActor(request, 'sites.review.approve'),
      params.siteReference,
      params.reviewReference,
      CreateApprovalDecisionSchema.parse(request.body),
    ) };
  });

  app.get('/:siteReference/review-cycles/:reviewReference/readiness', async request => {
    const params = CycleParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.read');
    return { data: await review().evaluateReadiness(params.siteReference, params.reviewReference) };
  });

  app.get('/:siteReference/review-cycles/:reviewReference/items', async request => {
    const params = CycleParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.read');
    return { data: await review().listItems(params.siteReference, params.reviewReference) };
  });

  app.get('/:siteReference/review-cycles/:reviewReference/comments', async request => {
    const params = CycleParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.read');
    return { data: await review().listComments(params.siteReference, params.reviewReference) };
  });

  app.post('/:siteReference/review-cycles/:reviewReference/comments', async (request, reply) => {
    const params = CycleParamsSchema.parse(request.params);
    const data = await review().addAgencyComment(
      agencyActor(request, 'sites.review.comment'),
      params.siteReference,
      params.reviewReference,
      CreateCommentSchema.parse(request.body),
    );
    return reply.code(201).send({ data });
  });

  app.patch('/:siteReference/review-cycles/:reviewReference/comments/:commentReference', async request => {
    const params = CommentParamsSchema.parse(request.params);
    return { data: await review().updateAgencyComment(
      agencyActor(request, 'sites.review.comment'),
      params.siteReference,
      params.reviewReference,
      params.commentReference,
      UpdateCommentSchema.parse(request.body),
    ) };
  });

  app.post('/:siteReference/review-cycles/:reviewReference/comments/:commentReference/resolve', async request => {
    const params = CommentParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await review().resolveAgencyComment(
      agencyActor(request, 'sites.review.resolve'),
      params.siteReference,
      params.reviewReference,
      params.commentReference,
    ) };
  });

  app.get('/:siteReference/review-cycles/:reviewReference/change-requests', async request => {
    const params = CycleParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.read');
    return { data: await review().listChangeRequests(params.siteReference, params.reviewReference) };
  });

  app.post('/:siteReference/review-cycles/:reviewReference/change-requests', async (request, reply) => {
    const params = CycleParamsSchema.parse(request.params);
    const data = await review().addAgencyChangeRequest(
      agencyActor(request, 'sites.review.change_requests'),
      params.siteReference,
      params.reviewReference,
      CreateChangeRequestSchema.parse(request.body),
    );
    return reply.code(201).send({ data });
  });

  app.patch('/:siteReference/review-cycles/:reviewReference/change-requests/:requestReference', async request => {
    const params = ChangeRequestParamsSchema.parse(request.params);
    return { data: await review().updateChangeRequest(
      agencyActor(request, 'sites.review.change_requests'),
      params.siteReference,
      params.reviewReference,
      params.requestReference,
      UpdateChangeRequestSchema.parse(request.body),
    ) };
  });

  app.post('/:siteReference/review-cycles/:reviewReference/change-requests/:requestReference/accept', async request => {
    const params = ChangeRequestParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await review().changeRequestAction(
      agencyActor(request, 'sites.review.change_requests'),
      params.siteReference,
      params.reviewReference,
      params.requestReference,
      'ACCEPT',
    ) };
  });

  for (const action of ['reject', 'resolve'] as const) {
    app.post(`/:siteReference/review-cycles/:reviewReference/change-requests/:requestReference/${action}`, async request => {
      const params = ChangeRequestParamsSchema.parse(request.params);
      return { data: await review().changeRequestAction(
        agencyActor(request, 'sites.review.change_requests'),
        params.siteReference,
        params.reviewReference,
        params.requestReference,
        action === 'reject' ? 'REJECT' : 'RESOLVE',
        ResolveChangeRequestSchema.parse(request.body),
      ) };
    });
  }

  app.post('/:siteReference/review-cycles/:reviewReference/change-requests/:requestReference/regenerate-section', async (request, reply) => {
    const params = ChangeRequestParamsSchema.parse(request.params);
    const data = await review().regenerateForChangeRequest(
      agencyActor(request, 'sites.generation.regenerate'),
      params.siteReference,
      params.reviewReference,
      params.requestReference,
      'SECTION',
      BoundedRegenerationReasonSchema.parse(request.body),
    );
    return reply.code(data.idempotentReplay ? 200 : 202).send({ data });
  });

  app.post('/:siteReference/review-cycles/:reviewReference/change-requests/:requestReference/regenerate-page', async (request, reply) => {
    const params = ChangeRequestParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const data = await review().regenerateForChangeRequest(
      agencyActor(request, 'sites.generation.regenerate'),
      params.siteReference,
      params.reviewReference,
      params.requestReference,
      'PAGE',
    );
    return reply.code(data.idempotentReplay ? 200 : 202).send({ data });
  });

  app.get('/:siteReference/review-cycles/:reviewReference/facts', async request => {
    const params = CycleParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.read');
    return { data: await review().listFacts(params.siteReference, params.reviewReference) };
  });

  app.patch('/:siteReference/review-cycles/:reviewReference/facts/:factReference', async request => {
    const params = FactParamsSchema.parse(request.params);
    return { data: await review().updateFact(
      agencyActor(request, 'sites.review.fact_verification'),
      params.siteReference,
      params.reviewReference,
      params.factReference,
      AgencyFactDecisionSchema.parse(request.body),
    ) };
  });

  app.get('/:siteReference/review-cycles/:reviewReference/participants', async request => {
    const params = CycleParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.read');
    return { data: await review().listParticipants(params.siteReference, params.reviewReference) };
  });

  app.post('/:siteReference/review-cycles/:reviewReference/participants', async (request, reply) => {
    const params = CycleParamsSchema.parse(request.params);
    const data = await review().addParticipant(
      agencyActor(request, 'sites.review.invite'),
      params.siteReference,
      params.reviewReference,
      AddReviewParticipantSchema.parse(request.body),
    );
    return reply.code(201).send({ data });
  });

  app.post('/:siteReference/review-cycles/:reviewReference/participants/:participantReference/invite', async request => {
    const params = ParticipantParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await review().inviteParticipant(
      agencyActor(request, 'sites.review.invite'),
      params.siteReference,
      params.reviewReference,
      params.participantReference,
    ) };
  });

  app.post('/:siteReference/review-cycles/:reviewReference/participants/:participantReference/revoke', async request => {
    const params = ParticipantParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await review().revokeParticipant(
      agencyActor(request, 'sites.review.invite'),
      params.siteReference,
      params.reviewReference,
      params.participantReference,
    ) };
  });

  app.post('/:siteReference/review-cycles/:reviewReference/preview-session', async (request, reply) => {
    const params = CycleParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const data = await review().createAgencyPreviewSession(
      agencyActor(request, 'sites.review.read'),
      params.siteReference,
      params.reviewReference,
    );
    return reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('X-Robots-Tag', 'noindex, nofollow, noarchive')
      .code(201)
      .send({ data });
  });

  app.post(
    '/:siteReference/review-cycles/:reviewReference/preview-sessions/:sessionReference/revoke',
    async request => {
      const params = PreviewSessionParamsSchema.parse(request.params);
      z.object({}).strict().parse(request.body ?? {});
      return { data: await review().revokeAgencyPreviewSession(
        agencyActor(request, 'sites.review.read'),
        params.siteReference,
        params.reviewReference,
        params.sessionReference,
      ) };
    },
  );

  app.get('/:siteReference/review-cycles/:reviewReference/approvals', async request => {
    const params = CycleParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.read');
    return { data: await review().listApprovals(params.siteReference, params.reviewReference) };
  });

  app.get('/:siteReference/review-cycles/:reviewReference/activity', async request => {
    const params = CycleParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.read');
    return { data: await review().activityLog(params.siteReference, params.reviewReference) };
  });

  app.get('/:siteReference/versions/:versionReference/compare/:otherVersionReference', async request => {
    const params = CompareParamsSchema.parse(request.params);
    agencyActor(request, 'sites.review.compare');
    return { data: await review().compareVersions(
      params.siteReference,
      params.versionReference,
      params.otherVersionReference,
    ) };
  });
}
