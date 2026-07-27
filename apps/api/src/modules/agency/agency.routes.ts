import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AgencyRoleSchema, BillingExceptionSchema, BillingPlanChangeSchema, CreateAgencyTenantSchema,
  CreateBillingRequestSchema, CreateDeliverableSchema, CreateEntitlementOverrideSchema, CreatePlanVersionSchema,
  SafeRetrySchema, StartSupportSessionSchema, SupportNoteSchema, UpdateAgencyTenantSchema,
  UpdateDeliverableSchema, UpdateOnboardingStageSchema, UpdateTenantOnboardingSchema,
} from '@ks-os/contracts';
import { AgencyAuditService, AgencyService, type AgencyActor } from './agency.service.js';
import { GoCardlessWebhookService } from './gocardless.service.js';
import { AgencyExportsService } from './agency-exports.service.js';
import { AgencyBookingService } from './agency-booking.service.js';

const Id=z.object({id:z.string().uuid()}); const TenantId=z.object({tenantId:z.string().uuid()});
const TenantUserId=TenantId.extend({userReference:z.string().uuid()});
const InvitationReference=z.object({invitationReference:z.string().uuid()});
const StageParams=TenantId.extend({stageKey:z.string().max(40)}); const DeliverableId=z.object({deliverableId:z.string().uuid()});
function actor(request:FastifyRequest,capability?:Parameters<FastifyRequest['requireAgency']>[0]):AgencyActor{
  const auth=request.requireAgency(capability);return{agencyUserId:auth.agencyUserId,role:auth.role,requestId:request.id,ipHash:createHash('sha256').update(`${process.env.AUDIT_IP_HASH_SECRET||'local-development'}:${request.ip}`).digest('hex'),sessionId:request.authIdentity?.authSessionId||undefined,userAgent:String(request.headers['user-agent']||'').slice(0,500)||undefined};
}

export async function agencyRoutes(app:FastifyInstance){const service=new AgencyService();
  const agencyBooking = new AgencyBookingService();
  app.get('/session',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async(request,reply)=>{
    if(!request.agencyAuth)return reply.code(401).send({success:false,error:{code:'AGENCY_UNAUTHENTICATED',message:'No valid agency session found.'}});
    const session=request.agencyAuth;return{success:true,data:{authenticated:true,context:'AGENCY',user:{email:session.email,displayName:session.displayName,role:session.role},mfa:{required:session.mfaRequired,assuranceLevel:session.assuranceLevel},capabilities:session.capabilities,expiresAt:session.expiresAt}};
  });
  app.post('/booking-workspace/activate', async request => {
    const auth = request.requireAgency();
    return { data: await agencyBooking.ensureWorkspace(auth) };
  });
  app.get('/users',async r=>({data:await service.listUsers(),actor:actor(r,'agency.users.manage')}));
  app.post('/users',{config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async(r,reply)=>{const body=z.object({email:z.string().email(),displayName:z.string().trim().min(2).max(255),role:AgencyRoleSchema}).strict().parse(r.body);return reply.code(201).send({data:await service.inviteUser(actor(r,'agency.users.manage'),body)});});
  app.post('/users/invitations',{config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async(r,reply)=>{const body=z.object({email:z.string().email(),displayName:z.string().trim().min(2).max(255),role:AgencyRoleSchema.exclude(['PLATFORM_OWNER'])}).strict().parse(r.body);return reply.code(201).send({data:await service.inviteUser(actor(r,'agency.users.manage'),body)});});
  app.post('/users/invitations/:invitationReference/resend',async r=>{const{invitationReference}=InvitationReference.parse(r.params);return{data:await service.resendAccountInvitation(actor(r,'agency.users.manage'),invitationReference)};});
  app.post('/users/invitations/:invitationReference/cancel',async(r,reply)=>{const{invitationReference}=InvitationReference.parse(r.params);await service.cancelAccountInvitation(actor(r,'agency.users.manage'),invitationReference);return reply.code(204).send();});
  app.post('/users/:id/status',async r=>{const{id}=Id.parse(r.params);const{status}=z.object({status:z.enum(['ACTIVE','SUSPENDED'])}).strict().parse(r.body);return{data:await service.setUserStatus(actor(r,'agency.users.manage'),id,status)};});
  app.get('/sessions',async r=>{const query=z.object({agencyUserId:z.string().uuid().optional()}).parse(r.query);return{data:await service.listSessions(actor(r),query.agencyUserId)};});
  app.post('/sessions/:id/revoke',async(r,reply)=>{const{id}=Id.parse(r.params);await service.revokeSession(actor(r),id);return reply.code(204).send();});
  app.post('/users/:id/revoke-sessions',async(r,reply)=>{const{id}=Id.parse(r.params);await service.revokeAllSessions(actor(r),id);return reply.code(204).send();});
  app.post('/users/:id/suspend',async r=>{const{id}=Id.parse(r.params);return{data:await service.setUserStatus(actor(r,'agency.users.manage'),id,'SUSPENDED')};});
  app.post('/users/:id/reactivate',async r=>{const{id}=Id.parse(r.params);return{data:await service.setUserStatus(actor(r,'agency.users.manage'),id,'ACTIVE')};});
  app.post('/users/:id/mfa-recovery',{config:{rateLimit:{max:3,timeWindow:'1 hour'}}},async(r,reply)=>{const{id}=Id.parse(r.params);const body=z.object({factorId:z.string().uuid(),reason:z.string().trim().min(20).max(500),identityVerified:z.literal(true)}).strict().parse(r.body);await service.resetMfa(actor(r,'agency.users.manage'),id,body.factorId,body.reason);return reply.code(204).send();});

  app.get('/tenants',async r=>({data:await service.listTenants(),actor:actor(r,'tenants.read')}));
  app.post('/tenants/:tenantId/owner-invitations',{config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async(r,reply)=>{const{tenantId}=TenantId.parse(r.params);const body=z.object({email:z.string().email(),displayName:z.string().trim().min(1).max(255)}).strict().parse(r.body);return reply.code(201).send({data:await service.inviteTenantOwner(actor(r,'tenants.manage'),tenantId,body)});});
  app.get('/tenants/:tenantId/users',async r=>{const{tenantId}=TenantId.parse(r.params);return{data:await service.listTenantUsers(actor(r,'tenants.read'),tenantId)};});
  app.post('/tenants/:tenantId/users/:userReference/suspend',async r=>{const{tenantId,userReference}=TenantUserId.parse(r.params);return{data:await service.setTenantUserStatus(actor(r,'tenants.manage'),tenantId,userReference,'SUSPENDED')};});
  app.post('/tenants/:tenantId/users/:userReference/reactivate',async r=>{const{tenantId,userReference}=TenantUserId.parse(r.params);return{data:await service.setTenantUserStatus(actor(r,'tenants.manage'),tenantId,userReference,'ACTIVE')};});
  app.post('/tenants/:tenantId/users/:userReference/revoke-sessions',{config:{rateLimit:{max:10,timeWindow:'5 minutes'}}},async(r,reply)=>{const{tenantId,userReference}=TenantUserId.parse(r.params);await service.revokeTenantUserSessions(actor(r,'tenants.manage'),tenantId,userReference);return reply.code(204).send();});
  app.post('/tenants',async(r,reply)=>{
    const input=CreateAgencyTenantSchema.parse(r.body);
    const agencyActor=actor(r,'tenants.manage');
    const startedAt=Date.now();
    try{
      return reply.code(201).send({data:await service.createTenant(agencyActor,input)});
    }catch(error){
      // Tenant creation commits before the audit write. If that final audit step
      // fails, reconcile the just-created tenant so the UI does not report a
      // false failure or encourage a duplicate submission.
      const reconciled=(await service.listTenants()).find(tenant=>tenant.subdomain===input.subdomain&&new Date(tenant.createdAt).getTime()>=startedAt-5_000);
      if(reconciled)return reply.code(201).send({data:reconciled,meta:{reconciledAfterCreate:true}});
      throw error;
    }
  });
  app.get('/tenants/:tenantId',async r=>{const{tenantId}=TenantId.parse(r.params);actor(r,'tenants.read');return{data:await service.getTenant(tenantId)};});
  app.patch('/tenants/:tenantId',async r=>{const{tenantId}=TenantId.parse(r.params);return{data:await service.updateTenant(actor(r,'tenants.manage'),tenantId,UpdateAgencyTenantSchema.parse(r.body))};});
  for(const action of ['suspend','reactivate','offboard'] as const)app.post(`/tenants/:tenantId/${action}`,async r=>{const{tenantId}=TenantId.parse(r.params);const parsed=SafeRetrySchema.safeParse(r.body);const reason=parsed.success?parsed.data.reason:'Confirmed through the agency tenant lifecycle control';return{data:await service.changeLifecycle(actor(r,'tenants.manage'),tenantId,action.toUpperCase() as any,reason)};});

  app.get('/plans',async r=>({data:await service.listPlans(),actor:actor(r,'plans.read')}));
  app.post('/plans/versions',async(r,reply)=>reply.code(201).send({data:await service.createPlanVersion(actor(r,'plans.manage'),CreatePlanVersionSchema.parse(r.body))}));
  app.get('/tenants/:tenantId/entitlements',async r=>{const{tenantId}=TenantId.parse(r.params);actor(r,'plans.read');return{data:await service.entitlementsForTenant(tenantId)};});
  app.post('/tenants/:tenantId/entitlement-overrides',async(r,reply)=>{const{tenantId}=TenantId.parse(r.params);return reply.code(201).send({data:await service.addOverride(actor(r,'plans.manage'),tenantId,CreateEntitlementOverrideSchema.parse(r.body))});});
  app.post('/tenants/:tenantId/plan-change',async r=>{const{tenantId}=TenantId.parse(r.params);const body=BillingPlanChangeSchema.parse(r.body);return{data:await service.changePlan(actor(r,'billing.manage'),tenantId,body.planVersionId,body.effective,body.reason)};});

  app.patch('/tenants/:tenantId/onboarding/:stageKey',async r=>{const{tenantId,stageKey}=StageParams.parse(r.params);return{data:await service.updateStage(actor(r,'tenants.manage'),tenantId,stageKey,UpdateOnboardingStageSchema.parse(r.body))};});
  app.get('/tenants/:tenantId/onboarding',async r=>{const{tenantId}=TenantId.parse(r.params);actor(r,'tenants.read');return{data:await service.onboarding(tenantId)};});
  app.patch('/tenants/:tenantId/onboarding',async r=>{const{tenantId}=TenantId.parse(r.params);return{data:await service.updateOnboarding(actor(r,'tenants.manage'),tenantId,UpdateTenantOnboardingSchema.parse(r.body))};});
  app.post('/tenants/:tenantId/launch-checks',async r=>{const{tenantId}=TenantId.parse(r.params);return{data:await service.runLaunchChecks(actor(r,'tenants.manage'),tenantId)};});
  app.post('/tenants/:tenantId/launch',async r=>{const{tenantId}=TenantId.parse(r.params);return{data:await service.launch(actor(r,'tenants.manage'),tenantId)};});

  app.post('/tenants/:tenantId/billing-request',async r=>{const{tenantId}=TenantId.parse(r.params);return{data:await service.startBillingRequest(actor(r,'billing.manage'),tenantId,CreateBillingRequestSchema.parse(r.body))};});
  app.post('/tenants/:tenantId/subscriptions',async r=>{const{tenantId}=TenantId.parse(r.params);const{planVersionId}=z.object({planVersionId:z.string().uuid()}).strict().parse(r.body);return{data:await service.activateSubscription(actor(r,'billing.manage'),tenantId,planVersionId)};});
  app.post('/tenants/:tenantId/setup-fee/waive',async r=>{const{tenantId}=TenantId.parse(r.params);const{reason}=SafeRetrySchema.parse(r.body);return{data:await service.waiveSetupFee(actor(r,'billing.manage'),tenantId,reason)};});
  app.post('/tenants/:tenantId/price-exceptions',async(r,reply)=>{const{tenantId}=TenantId.parse(r.params);return reply.code(201).send({data:await service.addPriceException(actor(r,'billing.manage'),tenantId,BillingExceptionSchema.parse(r.body))});});
  app.get('/tenants/:tenantId/billing',async r=>{const{tenantId}=TenantId.parse(r.params);actor(r,'billing.read');return{data:await service.billing(tenantId)};});
  app.post('/tenants/:tenantId/subscription-actions/:action',async r=>{const{tenantId}=TenantId.parse(r.params);const{action}=z.object({action:z.enum(['pause','resume','cancel'])}).parse(r.params);const{reason}=SafeRetrySchema.parse(r.body);return{data:await service.subscriptionAction(actor(r,'billing.manage'),tenantId,action.toUpperCase() as any,reason)};});

  app.post('/tenants/:tenantId/deliverables',async(r,reply)=>{const{tenantId}=TenantId.parse(r.params);return reply.code(201).send({data:await service.createDeliverable(actor(r,'fulfilment.manage'),tenantId,CreateDeliverableSchema.parse(r.body))});});
  app.patch('/deliverables/:deliverableId',async r=>{const{deliverableId}=DeliverableId.parse(r.params);return{data:await service.updateDeliverable(actor(r,'fulfilment.manage'),deliverableId,UpdateDeliverableSchema.parse(r.body))};});
  app.post('/deliverables/:deliverableId/approval-requests',async(r,reply)=>{const{deliverableId}=DeliverableId.parse(r.params);return reply.code(201).send({data:await service.requestDeliverableApproval(actor(r,'fulfilment.manage'),deliverableId)});});
  app.post('/deliverables/:deliverableId/time-entries',async(r,reply)=>{const{deliverableId}=DeliverableId.parse(r.params);const body=z.object({minutes:z.number().int().positive().max(1440),costMinor:z.number().int().nonnegative().default(0),note:z.string().max(1000).optional(),workedAt:z.coerce.date()}).strict().parse(r.body);return reply.code(201).send({data:await service.recordDeliverableTime(actor(r,'fulfilment.manage'),deliverableId,body)});});

  app.post('/support-sessions',{config:{rateLimit:{max:10,timeWindow:'5 minutes'}}},async(r,reply)=>reply.code(201).send({data:await service.startSupportSession(actor(r,'support.session.start'),StartSupportSessionSchema.parse(r.body))}));
  app.post('/tenants/:tenantId/support-sessions',{config:{rateLimit:{max:10,timeWindow:'5 minutes'}}},async(r,reply)=>{const{tenantId}=TenantId.parse(r.params);const body=StartSupportSessionSchema.omit({tenantId:true}).parse(r.body);return reply.code(201).send({data:await service.startSupportSession(actor(r,'support.session.start'),{...body,tenantId})});});
  app.get('/support-sessions/:id',async r=>{const{id}=Id.parse(r.params);return{data:await service.getSupportSession(actor(r,'support.read'),id)};});
  app.post('/support-sessions/:id/revoke',async(r,reply)=>{const{id}=Id.parse(r.params);await service.revokeSupportSession(actor(r,'support.session.start'),id);return reply.code(204).send();});
  app.post('/support-sessions/:id/end',async(r,reply)=>{const{id}=Id.parse(r.params);await service.revokeSupportSession(actor(r,'support.session.start'),id);return reply.code(204).send();});
  app.get('/support/overview',async r=>{actor(r,'support.read');return{data:await service.supportOverview()};});
  app.get('/tenants/:tenantId/health',async r=>{const{tenantId}=TenantId.parse(r.params);actor(r,'support.read');return{data:await service.tenantHealth(tenantId)};});
  app.get('/webhooks',async r=>{actor(r,'support.read');return{data:await service.webhookEvents()};});
  app.post('/webhooks/:id/replay',async r=>{const{id}=Id.parse(r.params);const{reason}=SafeRetrySchema.parse(r.body);return{data:await service.replayWebhook(actor(r,'support.retry'),id,reason)};});
  app.get('/jobs',async r=>{actor(r,'support.read');return{data:await service.failedJobs()};});
  app.post('/jobs/:id/retry',async r=>{const{id}=Id.parse(r.params);const{reason}=SafeRetrySchema.parse(r.body);return{data:await service.retryJob(actor(r,'support.retry'),id,reason)};});
  app.post('/support/failed-jobs/:id/retry',async r=>{const{id}=Id.parse(r.params);const{reason}=SafeRetrySchema.parse(r.body);return{data:await service.retryJob(actor(r,'support.retry'),id,reason)};});
  app.post('/support/notes',async(r,reply)=>reply.code(201).send({data:await service.addSupportNote(actor(r,'support.read'),SupportNoteSchema.parse(r.body))}));
  app.get('/audit',async r=>{actor(r,'audit.read');return{data:await service.auditLog()};});
  app.get('/analytics',async r=>{actor(r,'analytics.read');return{data:await service.analytics()};});
  for(const section of ['overview','revenue','activation','churn','usage','fulfilment'] as const)app.get(`/analytics/${section}`,async r=>{actor(r,'analytics.read');const data=await service.analytics();return{data:section==='overview'?data:(data as any)[section==='fulfilment'?'workload':section]};});
  app.get('/fulfilment',async r=>{actor(r,'fulfilment.read');return{data:await service.fulfilment()};});
  app.post('/fulfilment',async(r,reply)=>{const body=CreateDeliverableSchema.extend({tenantId:z.string().uuid()}).parse(r.body);const{tenantId,...input}=body;return reply.code(201).send({data:await service.createDeliverable(actor(r,'fulfilment.manage'),tenantId,input)});});
  app.post('/analytics/exports',async(r,reply)=>{const body=z.object({exportType:z.string(),filters:z.object({}).strict().default({})}).strict().parse(r.body);return reply.code(202).send({data:await service.requestExport(actor(r,'analytics.read'),body.exportType,body.filters)});});
  app.get('/analytics/exports/:id/download',async r=>{const{id}=Id.parse(r.params);const agencyActor=actor(r,'analytics.read');const data=await new AgencyExportsService().download(id);await new AgencyAuditService().write(agencyActor,'AGENCY_EXPORT_DOWNLOADED','AGENCY_EXPORT',id);return{data};});
}

export async function goCardlessWebhookRoutes(app:FastifyInstance){const service=new GoCardlessWebhookService();app.post('/',{config:{rawBody:true,rateLimit:{max:300,timeWindow:'1 minute'}}},async(request,reply)=>{const raw=(request as any).rawBody as string|undefined;if(!raw)throw Object.assign(new Error('Raw webhook body is required.'),{statusCode:400,code:'RAW_BODY_REQUIRED'});const result=await service.handle(raw,request.headers['webhook-signature'] as string|undefined);return reply.code(200).send(result);});}

export async function managedServiceTenantRoutes(app:FastifyInstance){const service=new AgencyService();app.post('/approvals/:id/respond',async request=>{request.requireAuth();if(request.auth!.role!=='owner')throw Object.assign(new Error('Owner access is required.'),{statusCode:403,code:'OWNER_REQUIRED'});const{id}=Id.parse(request.params);const body=z.object({status:z.enum(['APPROVED','REJECTED']),note:z.string().max(1000).optional()}).strict().parse(request.body);return{data:await service.respondDeliverableApproval(request.auth!.tenantId,id,body)};});}

export async function agencyWorkerRoutes(app:FastifyInstance){const service=new AgencyService();const exports=new AgencyExportsService();const authorize=(request:FastifyRequest)=>{const supplied=request.headers.authorization?.replace(/^Bearer\s+/i,'');if(!process.env.AGENCY_WORKER_SECRET||supplied!==process.env.AGENCY_WORKER_SECRET)throw Object.assign(new Error('Unauthorized'),{statusCode:401,code:'UNAUTHENTICATED'});};app.post('/plan-changes',async request=>{authorize(request);return service.applyDuePlanChanges();});app.post('/offboarding',async request=>{authorize(request);return service.processDueOffboarding();});app.post('/exports',async request=>{authorize(request);return exports.process();});}
