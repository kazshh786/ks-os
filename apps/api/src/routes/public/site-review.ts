import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PublicReferenceSchema } from '@ks-os/contracts';
import {
  CreateChangeRequestSchema,
  CreateCommentSchema,
  FactResponseSchema,
  safeReviewTextSchema,
} from '@ks-os/site-review';
import { z } from 'zod';
import { SiteReviewService } from '../../modules/sites/site-review.service.js';

const InvitationExchangeSchema = z.object({
  invitationToken: z.string().min(40).max(1_000),
}).strict();
const PageParamsSchema = z.object({
  pageReference: PublicReferenceSchema,
}).strict();
const CommentParamsSchema = z.object({
  commentReference: PublicReferenceSchema,
}).strict();
const FactParamsSchema = z.object({
  factReference: PublicReferenceSchema,
}).strict();
const DecisionNoteSchema = z.object({
  notes: safeReviewTextSchema(2_000).optional(),
}).strict();
const RequiredDecisionNoteSchema = z.object({
  notes: safeReviewTextSchema(2_000),
}).strict();

function sessionToken(request: FastifyRequest): string {
  const value = request.headers['x-site-review-session'];
  if (typeof value !== 'string' || !value) {
    throw Object.assign(new Error('Review session is required.'), {
      statusCode: 401,
      code: 'SITE_REVIEW_SESSION_REQUIRED',
    });
  }
  return value;
}

export async function publicSiteReviewRoutes(app: FastifyInstance) {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('Pragma', 'no-cache')
      .header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return payload;
  });
  let instance: SiteReviewService | undefined;
  const review = () => {
    instance ||= new SiteReviewService();
    return instance;
  };
  const context = (request: FastifyRequest) => {
    const token = sessionToken(request);
    return review().clientContext(token);
  };

  app.post('/session', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { invitationToken } = InvitationExchangeSchema.parse(request.body);
    const data = await review().exchangeInvitation(invitationToken);
    return reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('X-Robots-Tag', 'noindex, nofollow, noarchive')
      .code(201)
      .send({ data });
  });

  app.get('/session', async (request, reply) => {
    const client = await context(request);
    return reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('X-Robots-Tag', 'noindex, nofollow, noarchive')
      .send({ data: await review().clientSessionDto(client) });
  });

  app.delete('/session', async (request, reply) => {
    const client = await context(request);
    return reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .send({ data: await review().revokeSession(client) });
  });

  app.get('/site', async (request, reply) => {
    const client = await context(request);
    return reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('X-Robots-Tag', 'noindex, nofollow, noarchive')
      .send({ data: await review().clientSite(client) });
  });

  app.get('/pages', async (request, reply) => {
    const client = await context(request);
    return reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('X-Robots-Tag', 'noindex, nofollow, noarchive')
      .send({ data: await review().clientPages(client) });
  });

  app.get('/pages/:pageReference', async (request, reply) => {
    const { pageReference } = PageParamsSchema.parse(request.params);
    const client = await context(request);
    const pages = await review().clientPages(client, pageReference) as unknown[];
    if (pages.length === 0) {
      throw Object.assign(new Error('Review page not found.'), {
        statusCode: 404,
        code: 'SITE_REVIEW_PAGE_NOT_FOUND',
      });
    }
    return reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('X-Robots-Tag', 'noindex, nofollow, noarchive')
      .send({ data: pages[0] });
  });

  app.get('/comments', async request => {
    const client = await context(request);
    return { data: await review().listComments(client.siteReference, client.reviewCycleReference, true) };
  });

  app.post('/comments', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const client = await context(request);
    const data = await review().addClientComment(client, CreateCommentSchema.parse(request.body));
    return reply.code(201).send({ data });
  });

  app.post('/comments/:commentReference/reply', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { commentReference } = CommentParamsSchema.parse(request.params);
    const body = CreateCommentSchema.omit({ parentCommentReference: true }).parse(request.body);
    const client = await context(request);
    const data = await review().addClientComment(client, {
      ...body,
      parentCommentReference: commentReference,
    });
    return reply.code(201).send({ data });
  });

  app.post('/comments/:commentReference/resolve', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async request => {
    const { commentReference } = CommentParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const client = await context(request);
    return { data: await review().resolveClientComment(client, commentReference) };
  });

  app.get('/change-requests', async request => {
    const client = await context(request);
    return { data: await review().listChangeRequests(
      client.siteReference,
      client.reviewCycleReference,
      true,
    ) };
  });

  app.post('/change-requests', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const client = await context(request);
    const data = await review().addClientChangeRequest(
      client,
      CreateChangeRequestSchema.parse(request.body),
    );
    return reply.code(201).send({ data });
  });

  app.get('/facts', async request => {
    const client = await context(request);
    return { data: await review().listFacts(client.siteReference, client.reviewCycleReference, true) };
  });

  app.post('/facts/:factReference/confirm', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async request => {
    const { factReference } = FactParamsSchema.parse(request.params);
    const body = z.object({ note: safeReviewTextSchema(1_000).optional() }).strict().parse(request.body ?? {});
    const client = await context(request);
    return { data: await review().clientFactResponse(
      client,
      factReference,
      FactResponseSchema.parse({ response: 'CONFIRM', ...body }),
    ) };
  });

  app.post('/facts/:factReference/dispute', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async request => {
    const { factReference } = FactParamsSchema.parse(request.params);
    const body = z.object({ note: safeReviewTextSchema(1_000) }).strict().parse(request.body);
    const client = await context(request);
    return { data: await review().clientFactResponse(
      client,
      factReference,
      FactResponseSchema.parse({ response: 'DISPUTE', ...body }),
    ) };
  });

  app.get('/summary', async request => {
    const client = await context(request);
    return { data: await review().clientSummary(client) };
  });

  app.post('/request-changes', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async request => {
    const { notes } = RequiredDecisionNoteSchema.parse(request.body);
    const client = await context(request);
    return { data: await review().clientDecision(client, {
      decision: 'REQUEST_CHANGES',
      approvalLevel: 'CLIENT_FINAL',
      notes,
    }) };
  });

  app.post('/approve', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async request => {
    const { notes } = DecisionNoteSchema.parse(request.body ?? {});
    const client = await context(request);
    return { data: await review().clientDecision(client, {
      decision: notes ? 'APPROVE_WITH_NOTES' : 'APPROVE',
      approvalLevel: 'CLIENT_FINAL',
      notes,
    }) };
  });

  app.post('/reject', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async request => {
    const { notes } = RequiredDecisionNoteSchema.parse(request.body);
    const client = await context(request);
    return { data: await review().clientDecision(client, {
      decision: 'REJECT',
      approvalLevel: 'CLIENT_FINAL',
      notes,
    }) };
  });

  app.get('/compare', async request => {
    const client = await context(request);
    return { data: await review().clientCompare(client) };
  });
}
