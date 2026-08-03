import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AgencyCapability } from '@ks-os/contracts';
import {
  AgencyFactDecisionSchema,
  BuildProductionBriefSchema,
  CreateQuestionnaireSchema,
  CreateQuestionnaireTemplateSchema,
  FactAnswerValueSchema,
  FactFindingSessionExchangeSchema,
  FactFindingUploadSchema,
  PrequalifyQuestionnaireSchema,
  RejectFactResponseSchema,
  RequestClarificationSchema,
  PublicReferenceSchema,
} from '@ks-os/fact-finding';
import type { AgencyActor } from '../agency/agency.service.js';
import { BookingAwareFactFindingService } from './booking-aware-fact-finding.service.js';
import { ManualFactFindingService } from './manual-fact-finding.service.js';
import { ManualFactFindingUploadService } from './manual-fact-finding-upload.service.js';

const ReferenceParams = z.object({ reference: PublicReferenceSchema }).strict();
const QuestionnaireParams = z.object({ questionnaireReference: PublicReferenceSchema }).strict();
const QuestionParams = QuestionnaireParams.extend({ questionReference: PublicReferenceSchema });
const ManualUploadParams = QuestionnaireParams.extend({ uploadReference: PublicReferenceSchema });
const ResponseParams = z.object({ responseReference: PublicReferenceSchema }).strict();
const BriefParams = z.object({ briefReference: PublicReferenceSchema }).strict();
const UploadParams = z.object({ uploadReference: PublicReferenceSchema }).strict();
const InviteSchema = z.object({ participantReference: PublicReferenceSchema.optional() }).strict();
const AssetDecisionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).strict();
const AgencyAnswerSchema = z.object({ answer: FactAnswerValueSchema }).strict();

function actor(request: FastifyRequest, capability: AgencyCapability): AgencyActor {
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

export async function agencyFactFindingRoutes(app: FastifyInstance) {
  let instance: BookingAwareFactFindingService | undefined;
  let manualInstance: ManualFactFindingService | undefined;
  let manualUploadInstance: ManualFactFindingUploadService | undefined;
  const service = () => (instance ||= new BookingAwareFactFindingService());
  const manual = () => (manualInstance ||= new ManualFactFindingService());
  const manualUploads = () => (manualUploadInstance ||= new ManualFactFindingUploadService());

  app.get('/templates', async request => {
    actor(request, 'fact_finding.read');
    return { data: await service().listTemplates() };
  });
  app.post('/templates', async (request, reply) => reply.code(201).send({
    data: await service().createTemplate(
      actor(request, 'fact_finding.templates.manage'),
      CreateQuestionnaireTemplateSchema.parse(request.body),
    ),
  }));
  app.post('/templates/:reference/activate', async request => {
    const { reference } = ReferenceParams.parse(request.params);
    return { data: await service().activateTemplate(actor(request, 'fact_finding.templates.manage'), reference) };
  });

  app.post('/questionnaires', async (request, reply) => {
    const body = z.object({
      tenantReference: PublicReferenceSchema,
      questionnaire: CreateQuestionnaireSchema,
    }).strict().parse(request.body);
    return reply.code(201).send({ data: await service().createQuestionnaire(
      actor(request, 'fact_finding.create'),
      body.tenantReference,
      body.questionnaire,
    ) });
  });
  app.get('/questionnaires/:questionnaireReference', async request => {
    const { questionnaireReference } = QuestionnaireParams.parse(request.params);
    actor(request, 'fact_finding.read');
    return { data: await service().questionnaireDetail(questionnaireReference) };
  });
  app.patch('/questionnaires/:questionnaireReference', async request => {
    const { questionnaireReference } = QuestionnaireParams.parse(request.params);
    return { data: await service().prequalify(
      actor(request, 'fact_finding.manage'),
      questionnaireReference,
      PrequalifyQuestionnaireSchema.parse(request.body),
    ) };
  });
  app.post('/questionnaires/:questionnaireReference/prequalify', async request => {
    const { questionnaireReference } = QuestionnaireParams.parse(request.params);
    return { data: await service().prequalify(
      actor(request, 'fact_finding.manage'),
      questionnaireReference,
      PrequalifyQuestionnaireSchema.parse(request.body),
    ) };
  });
  app.post('/questionnaires/:questionnaireReference/sync-booking-facts', async request => {
    const { questionnaireReference } = QuestionnaireParams.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await service().syncBookingFacts(
      actor(request, 'fact_finding.manage'),
      questionnaireReference,
    ) };
  });
  app.post('/questionnaires/:questionnaireReference/invite', async request => {
    const { questionnaireReference } = QuestionnaireParams.parse(request.params);
    const input = InviteSchema.parse(request.body ?? {});
    return { data: await service().invite(
      actor(request, 'fact_finding.invite'),
      questionnaireReference,
      input.participantReference,
    ) };
  });
  app.get('/questionnaires/:questionnaireReference/responses', async request => {
    const { questionnaireReference } = QuestionnaireParams.parse(request.params);
    actor(request, 'fact_finding.review');
    return { data: await service().responses(questionnaireReference) };
  });

  app.get('/questionnaires/:questionnaireReference/manual-form', async request => {
    const { questionnaireReference } = QuestionnaireParams.parse(request.params);
    actor(request, 'fact_finding.manage');
    return { data: await manual().form(questionnaireReference) };
  });
  app.patch('/questionnaires/:questionnaireReference/manual-responses/:questionReference', async request => {
    const { questionnaireReference, questionReference } = QuestionParams.parse(request.params);
    const { answer } = AgencyAnswerSchema.parse(request.body);
    return { data: await manual().save(actor(request, 'fact_finding.manage'), questionnaireReference, questionReference, answer) };
  });
  app.post('/questionnaires/:questionnaireReference/manual-uploads', async request => {
    const { questionnaireReference } = QuestionnaireParams.parse(request.params);
    return { data: await manualUploads().initiate(
      actor(request, 'fact_finding.manage'),
      questionnaireReference,
      FactFindingUploadSchema.parse(request.body),
    ) };
  });
  app.post('/questionnaires/:questionnaireReference/manual-uploads/:uploadReference/complete', async request => {
    const { questionnaireReference, uploadReference } = ManualUploadParams.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await manualUploads().complete(actor(request, 'fact_finding.manage'), questionnaireReference, uploadReference) };
  });
  app.post('/questionnaires/:questionnaireReference/submit-manually', async request => {
    const { questionnaireReference } = QuestionnaireParams.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await manual().submit(actor(request, 'fact_finding.manage'), questionnaireReference) };
  });

  app.post('/responses/:responseReference/approve', async request => {
    const { responseReference } = ResponseParams.parse(request.params);
    return { data: await service().approveResponse(
      actor(request, 'fact_finding.approve'),
      responseReference,
      AgencyFactDecisionSchema.parse(request.body),
    ) };
  });
  app.post('/responses/:responseReference/reject', async request => {
    const { responseReference } = ResponseParams.parse(request.params);
    return { data: await service().rejectResponse(
      actor(request, 'fact_finding.approve'),
      responseReference,
      RejectFactResponseSchema.parse(request.body),
    ) };
  });
  app.post('/responses/:responseReference/request-clarification', async request => {
    const { responseReference } = ResponseParams.parse(request.params);
    return { data: await service().requestClarification(
      actor(request, 'fact_finding.review'),
      responseReference,
      RequestClarificationSchema.parse(request.body),
    ) };
  });
  app.post('/questionnaires/:questionnaireReference/build-brief', async (request, reply) => {
    const { questionnaireReference } = QuestionnaireParams.parse(request.params);
    const data = await service().buildBrief(
      actor(request, 'production_briefs.build'),
      questionnaireReference,
      BuildProductionBriefSchema.parse(request.body ?? {}),
    );
    return reply.code(201).send({ data });
  });
  app.get('/production-briefs/:briefReference', async request => {
    const { briefReference } = BriefParams.parse(request.params);
    actor(request, 'production_briefs.read');
    return { data: await service().brief(briefReference) };
  });
  app.get('/production-briefs/:briefReference/readiness', async request => {
    const { briefReference } = BriefParams.parse(request.params);
    actor(request, 'production_briefs.read');
    const brief = await service().brief(briefReference);
    return { data: brief.readiness };
  });
  app.post('/production-briefs/:briefReference/approve', async request => {
    const { briefReference } = BriefParams.parse(request.params);
    return { data: await service().approveBrief(actor(request, 'production_briefs.approve'), briefReference) };
  });
  app.post('/production-briefs/:briefReference/lock', async request => {
    const { briefReference } = BriefParams.parse(request.params);
    return { data: await service().lockBrief(actor(request, 'production_briefs.lock'), briefReference) };
  });
  app.post('/uploads/:uploadReference/review', async request => {
    const { uploadReference } = UploadParams.parse(request.params);
    const { decision } = AssetDecisionSchema.parse(request.body);
    return { data: await service().reviewUpload(actor(request, 'fact_finding.uploads.review'), uploadReference, decision) };
  });
}

export const factFindingSessionExchange = FactFindingSessionExchangeSchema;
