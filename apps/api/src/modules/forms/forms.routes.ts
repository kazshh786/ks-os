import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CreateFormAssignmentSchema, FormAssignmentIdParamsSchema, FormAssignmentListQuerySchema, FormDraftInputSchema, FormIdParamsSchema, FormSubmissionIdParamsSchema, FormSubmissionListQuerySchema, FormVersionParamsSchema, PublicFormSubmissionSchema, PublicFormTokenParamsSchema } from '@ks-os/contracts';
import { env } from '../../config/env.js';
import { FormsService } from './forms.service.js';

const actor = (request: FastifyRequest) => { request.requireAuth(); return { tenantId: request.auth!.tenantId, userId: request.auth!.tenantUserId, role: request.auth!.role }; };

export async function formsRoutes(app: FastifyInstance) {
  const service = new FormsService();
  app.get('/', async (request) => ({ data: await service.listForms(actor(request)) }));
  app.post('/', async (request, reply) => reply.code(201).send({ data: await service.create(actor(request), FormDraftInputSchema.parse(request.body)) }));
  app.get('/:formId', async (request) => { const { formId }=FormIdParamsSchema.parse(request.params); return { data: await service.getForm(actor(request),formId) }; });
  app.patch('/:formId', async (request) => { const { formId }=FormIdParamsSchema.parse(request.params); return { data: await service.update(actor(request),formId,FormDraftInputSchema.parse(request.body)) }; });
  app.post('/:formId/publish', async (request) => { const { formId }=FormIdParamsSchema.parse(request.params); return { data: await service.publish(actor(request),formId) }; });
  app.post('/:formId/archive', async (request,reply) => { const { formId }=FormIdParamsSchema.parse(request.params); await service.archive(actor(request),formId); return reply.code(204).send(); });
  app.get('/:formId/versions', async (request) => { const { formId }=FormIdParamsSchema.parse(request.params); return { data: await service.listVersions(actor(request),formId) }; });
  app.get('/:formId/versions/:versionId', async (request) => { const { formId,versionId }=FormVersionParamsSchema.parse(request.params); return { data: await service.getVersion(actor(request),formId,versionId) }; });
}

export async function formAssignmentRoutes(app: FastifyInstance) {
  const service=new FormsService();
  app.get('/',async(request)=>({data:await service.listAssignments(actor(request),FormAssignmentListQuerySchema.parse(request.query))}));
  app.post('/',async(request,reply)=>reply.code(201).send({data:await service.createAssignment(actor(request),CreateFormAssignmentSchema.parse(request.body),env.FORM_ASSIGNMENT_EXPIRY_DAYS)}));
  app.get('/:assignmentId',async(request)=>{const {assignmentId}=FormAssignmentIdParamsSchema.parse(request.params);return{data:await service.getAssignment(actor(request),assignmentId)};});
  app.post('/:assignmentId/cancel',async(request,reply)=>{const {assignmentId}=FormAssignmentIdParamsSchema.parse(request.params);await service.cancelAssignment(actor(request),assignmentId);return reply.code(204).send();});
  app.post('/:assignmentId/regenerate-link',async(request)=>{const {assignmentId}=FormAssignmentIdParamsSchema.parse(request.params);return{data:await service.regenerate(actor(request),assignmentId)};});
}

export async function formSubmissionRoutes(app:FastifyInstance){const service=new FormsService();app.get('/',async(request)=>({data:await service.listSubmissions(actor(request),FormSubmissionListQuerySchema.parse(request.query))}));app.get('/:submissionId',async(request)=>{const{submissionId}=FormSubmissionIdParamsSchema.parse(request.params);return{data:await service.getSubmission(actor(request),submissionId)};});}

export async function publicFormRoutes(app:FastifyInstance){const service=new FormsService();app.get('/:token',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async(request)=>{const{token}=PublicFormTokenParamsSchema.parse(request.params);return{data:await service.getPublic(token)};});app.post('/:token/submissions',{bodyLimit:262144,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(request,reply)=>{const{token}=PublicFormTokenParamsSchema.parse(request.params);return reply.code(201).send({data:await service.submitPublic(token,PublicFormSubmissionSchema.parse(request.body))});});}

export async function relatedFormAssignmentRoutes(app:FastifyInstance){const service=new FormsService();app.get('/clients/:clientId/form-assignments',async(request)=>{const{clientId}=request.params as{clientId:string};return{data:await service.listAssignments(actor(request),FormAssignmentListQuerySchema.parse({...request.query as object,clientId}))};});app.get('/appointments/:appointmentId/form-assignments',async(request)=>{const{appointmentId}=request.params as{appointmentId:string};return{data:await service.listAssignments(actor(request),FormAssignmentListQuerySchema.parse({...request.query as object,appointmentId}))};});}
