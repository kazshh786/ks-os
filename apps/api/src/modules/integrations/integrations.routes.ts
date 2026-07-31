import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDatabase } from '@ks-os/database';
import { AccountingExportQuerySchema,CreateApiCredentialSchema,CreateCalendarFeedSchema,CreateWebhookSubscriptionSchema,OAuthStartSchema,TerminalConnectionTokenSchema } from '@ks-os/contracts';
import { env } from '../../config/env.js';
import { mailboxOauthCallbackRoutes, mailboxRoutes } from '../mailboxes/mailbox.routes.js';
import { IntegrationsService } from './integrations.service.js';

const Id=z.object({id:z.string().uuid()});const FeedToken=z.object({token:z.string().regex(/^cal_[A-Za-z0-9_-]{40,}$/)});
const owner=(r:FastifyRequest)=>{r.requireAuth();if(!r.auth||r.auth.role!=='owner'||r.auth.supportMode)throw Object.assign(new Error('Business owner access is required.'),{statusCode:403,code:'INTEGRATION_FORBIDDEN'});return r.auth;};
const key=(r:FastifyRequest)=>{const value=r.headers.authorization;if(!value?.startsWith('Bearer '))throw Object.assign(new Error('API key required'),{statusCode:401,code:'API_KEY_REQUIRED'});return value.slice(7);};

export async function integrationRoutes(app:FastifyInstance){const service=new IntegrationsService();
 app.register(mailboxOauthCallbackRoutes,{prefix:'/mailboxes/oauth'});
 app.register(mailboxRoutes);
 app.get('/integrations',async r=>{const a=owner(r);return{data:await service.list(a.tenantId)}});
 app.post('/integrations/oauth/start',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async r=>{const a=owner(r),v=OAuthStartSchema.parse(r.body);return{data:{authorizationUrl:service.oauthUrl(a.tenantId,a.tenantUserId,v.provider,v.returnPath)}}});
 app.delete('/integrations/:id',async r=>{const a=owner(r);return{data:await service.disconnect(a.tenantId,a.tenantUserId,Id.parse(r.params).id)}});
 app.post('/integrations/calendar-feeds',async(r,reply)=>{const a=owner(r);return reply.code(201).send({data:await service.createFeed(a.tenantId,a.tenantUserId,CreateCalendarFeedSchema.parse(r.body),env.PUBLIC_APP_ORIGIN||'http://localhost:5000')})});
 app.post('/integrations/calendar-feeds/:id/rotate',async r=>{const a=owner(r);return{data:await service.rotateFeed(a.tenantId,a.tenantUserId,Id.parse(r.params).id,env.PUBLIC_APP_ORIGIN||'http://localhost:5000')}});
 app.delete('/integrations/calendar-feeds/:id',async(r,reply)=>{const a=owner(r);await service.revokeFeed(a.tenantId,a.tenantUserId,Id.parse(r.params).id);return reply.code(204).send()});
 app.get('/integrations/accounting/export',async(r,reply)=>{const a=owner(r),q=AccountingExportQuerySchema.parse(r.query),body=await service.accountingExport(a.tenantId,a.tenantUserId,q);return reply.header('content-type',q.format==='json'?'application/json':'text/csv; charset=utf-8').header('content-disposition',`attachment; filename="accounting-${q.from.toISOString().slice(0,10)}-${q.to.toISOString().slice(0,10)}.${q.format}"`).send(body)});
 app.post('/integrations/api-credentials',async(r,reply)=>{const a=owner(r);return reply.code(201).send({data:await service.createCredential(a.tenantId,a.tenantUserId,CreateApiCredentialSchema.parse(r.body))})});
 app.delete('/integrations/api-credentials/:id',async(r,reply)=>{const a=owner(r);await service.revokeCredential(a.tenantId,a.tenantUserId,Id.parse(r.params).id);return reply.code(204).send()});
 app.post('/integrations/webhooks',async(r,reply)=>{const a=owner(r);return reply.code(201).send({data:await service.createWebhook(a.tenantId,a.tenantUserId,CreateWebhookSubscriptionSchema.parse(r.body))})});
 app.post('/integrations/terminal/connection-token',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async r=>{const a=owner(r);return{data:await service.terminalToken(a.tenantId,a.tenantUserId,TerminalConnectionTokenSchema.parse(r.body).locationId)}});
}

export async function publicCalendarRoutes(app:FastifyInstance){const service=new IntegrationsService();app.get('/calendar-feeds/:token.ics',async(r,reply)=>reply.header('content-type','text/calendar; charset=utf-8').header('cache-control','private, max-age=300, stale-if-error=3600').header('content-disposition','inline; filename="bookings.ics"').send(await service.calendar(FeedToken.parse(r.params).token)));}

export async function externalApiRoutes(app:FastifyInstance){const service=new IntegrationsService();
 app.get('/auth/test',async r=>{const c=await service.authenticateApiKey(key(r),'bookings:read');return{data:{authenticated:true,tenantId:c.tenant_id,scopes:c.scopes}}});
 app.get('/bookings',async r=>{const c=await service.authenticateApiKey(key(r),'bookings:read');const q=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.coerce.date().optional(),status:z.string().max(30).optional()}).strict().parse(r.query);const rows=await getDatabase().execute(sql`select a.public_reference id,a.start_time,a.end_time,a.status,a.updated_at,s.name service,u.name staff,l.name location from appointments a left join services s on s.id=a.service_id and s.tenant_id=a.tenant_id left join users u on u.id=a.user_id and u.tenant_id=a.tenant_id left join locations l on l.id=a.location_id and l.tenant_id=a.tenant_id where a.tenant_id=${c.tenant_id}::uuid and (${q.cursor??null}::timestamptz is null or a.updated_at<${q.cursor??null}) and (${q.status??null}::text is null or a.status=${q.status??null}) order by a.updated_at desc limit ${q.limit}`);return{data:rows.rows,meta:{limit:q.limit,requestId:r.id}}});
 app.get('/services',async r=>{const c=await service.authenticateApiKey(key(r),'services:read');const rows=await getDatabase().execute(sql`select id,name,description,duration,price from services where tenant_id=${c.tenant_id}::uuid and is_active=true order by name`);return{data:rows.rows}});
}
