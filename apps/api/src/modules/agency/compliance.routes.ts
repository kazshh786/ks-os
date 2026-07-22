import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditQuerySchema, CreateConsentRecordSchema, CreateLegalHoldSchema, CreatePrivacyRequestSchema, CreateRetentionPolicySchema, UpdatePrivacyRequestSchema } from '@ks-os/contracts';
import { ComplianceService } from './compliance.service.js';
import type { AgencyActor } from './agency.service.js';

const Id=z.object({id:z.string().uuid()});
function actor(request:FastifyRequest,capability:Parameters<FastifyRequest['requireAgency']>[0]):AgencyActor{const auth=request.requireAgency(capability);return{agencyUserId:auth.agencyUserId,role:auth.role,requestId:request.id,ipHash:createHash('sha256').update(`${process.env.AUDIT_IP_HASH_SECRET||'local-development'}:${request.ip}`).digest('hex'),sessionId:request.authIdentity?.authSessionId||undefined,userAgent:String(request.headers['user-agent']||'').slice(0,500)||undefined};}
function worker(request:FastifyRequest){const expected=process.env.PRIVACY_WORKER_SECRET;const supplied=request.headers.authorization?.replace(/^Bearer\s+/i,'')||'';if(!expected||expected.length<32||supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw Object.assign(new Error('Unauthorized'),{statusCode:401,code:'UNAUTHENTICATED'});}

export async function complianceRoutes(app:FastifyInstance){const service=new ComplianceService();
  app.get('/compliance/audit',async r=>{actor(r,'audit.read');return{data:await service.listAudit(AuditQuerySchema.parse(r.query))};});
  app.get('/compliance/audit/:id',async r=>{const{id}=Id.parse(r.params);actor(r,'audit.read');return{data:await service.getAudit(id)};});
  app.post('/compliance/audit/exports',{config:{rateLimit:{max:3,timeWindow:'1 hour'}}},async(r,reply)=>{actor(r,'audit.export');return reply.code(202).send({data:{status:'QUEUED',message:'Use the existing audited agency export worker with export type AUDIT.'}});});
  app.post('/compliance/consents',async(r,reply)=>reply.code(201).send({data:await service.createConsent(actor(r,'privacy.manage'),CreateConsentRecordSchema.parse(r.body))}));
  app.get('/compliance/consents',async r=>{const q=z.object({tenantId:z.string().uuid().optional(),authUserId:z.string().uuid().optional(),clientId:z.string().uuid().optional()}).strict().parse(r.query);actor(r,'privacy.read');return{data:await service.consentHistory(q.tenantId,q.authUserId,q.clientId)};});
  app.get('/privacy/requests',async r=>{actor(r,'privacy.read');return{data:await service.listPrivacyRequests()};});
  app.post('/privacy/requests',{config:{rateLimit:{max:20,timeWindow:'1 hour'}}},async(r,reply)=>reply.code(201).send({data:await service.createPrivacyRequest(actor(r,'privacy.manage'),CreatePrivacyRequestSchema.parse(r.body))}));
  app.patch('/privacy/requests/:id',async r=>{const{id}=Id.parse(r.params);return{data:await service.updatePrivacyRequest(actor(r,'privacy.manage'),id,UpdatePrivacyRequestSchema.parse(r.body))};});
  app.get('/privacy/requests/:id/download',{config:{rateLimit:{max:10,timeWindow:'1 hour'}}},async r=>{const{id}=Id.parse(r.params);return{data:await service.privacyDownload(actor(r,'privacy.read'),id)};});
  app.post('/privacy/legal-holds',async(r,reply)=>reply.code(201).send({data:await service.createLegalHold(actor(r,'privacy.manage'),CreateLegalHoldSchema.parse(r.body))}));
  app.post('/privacy/legal-holds/:id/release',async r=>{const{id}=Id.parse(r.params);const{reason}=z.object({reason:z.string().trim().min(12).max(500)}).strict().parse(r.body);return{data:await service.releaseLegalHold(actor(r,'privacy.manage'),id,reason)};});
  app.get('/privacy/retention-policies',async r=>{actor(r,'privacy.read');return{data:await service.listRetentionPolicies()};});
  app.post('/privacy/retention-policies',async(r,reply)=>reply.code(201).send({data:await service.createRetentionPolicy(actor(r,'retention.manage'),CreateRetentionPolicySchema.parse(r.body))}));
  app.post('/privacy/retention-policies/:id/runs',async(r,reply)=>{const{id}=Id.parse(r.params);const{dryRun}=z.object({dryRun:z.boolean().default(true)}).strict().parse(r.body||{});return reply.code(202).send({data:await service.queueRetention(actor(r,'retention.manage'),id,dryRun)});});
}

export async function complianceWorkerRoutes(app:FastifyInstance){const service=new ComplianceService();app.post('/exports',async r=>{worker(r);return service.processAccessExports();});app.post('/deletions',async r=>{worker(r);return service.processDeletionRequests();});}
