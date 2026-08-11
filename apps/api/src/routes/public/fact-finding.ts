import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  FactFindingSessionExchangeSchema,
  FactFindingUploadSchema,
  RespondToClarificationSchema,
  SaveFactFindingResponseSchema,
  PublicReferenceSchema,
} from '@ks-os/fact-finding';
import { FactFindingService } from '../../modules/provisioning/fact-finding.service.js';

const ClarificationParams = z.object({ clarificationReference: PublicReferenceSchema }).strict();
const UploadParams = z.object({ uploadReference: PublicReferenceSchema }).strict();

function sessionToken(request: FastifyRequest) {
  const bearer = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer || String(request.headers['x-fact-finding-session'] || '');
}

export async function publicFactFindingRoutes(app: FastifyInstance) {
  let instance: FactFindingService | undefined;
  const service = () => (instance ||= new FactFindingService());
  const session = async (request: FastifyRequest) => service().sessionContext(sessionToken(request));

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'private, no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return payload;
  });

  app.post('/session', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async request => ({
    data: await service().exchangeSession(FactFindingSessionExchangeSchema.parse(request.body).invitationToken),
  }));
  app.get('/questionnaire', { config: { rateLimit: { max: 120, timeWindow: '15 minutes' } } }, async request => ({
    data: await service().clientQuestionnaire(await session(request)),
  }));
  app.patch('/responses/:responseReference', { config: { rateLimit: { max: 60, timeWindow: '15 minutes' } } }, async request => {
    // The public response reference in the path is checked against the controlled
    // question reference in the body; clients cannot address arbitrary records.
    const { responseReference } = z.object({ responseReference: PublicReferenceSchema }).strict().parse(request.params);
    const input = SaveFactFindingResponseSchema.parse(request.body);
    if (input.questionReference !== responseReference) {
      throw Object.assign(new Error('The response path does not match the questionnaire question.'), {
        statusCode: 400,
        code: 'FACT_FINDING_RESPONSE_REFERENCE_MISMATCH',
      });
    }
    return { data: await service().saveClientResponse(await session(request), input) };
  });
  app.post('/uploads', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async request => ({
    data: await service().initiateUpload(await session(request), FactFindingUploadSchema.parse(request.body)),
  }));
  app.post('/uploads/:uploadReference/complete', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async request => {
    const { uploadReference } = UploadParams.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await service().completeUpload(await session(request), uploadReference) };
  });
  app.post('/submit', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async request => ({ data: await service().submit(await session(request)) }));
  app.get('/clarifications', { config: { rateLimit: { max: 120, timeWindow: '15 minutes' } } }, async request => ({
    data: await service().clientClarifications(await session(request)),
  }));
  app.post('/clarifications/:clarificationReference/respond', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async request => {
    const { clarificationReference } = ClarificationParams.parse(request.params);
    return { data: await service().respondToClarification(
      await session(request),
      clarificationReference,
      RespondToClarificationSchema.parse(request.body),
    ) };
  });
}
