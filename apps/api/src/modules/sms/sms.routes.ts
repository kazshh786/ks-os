import type { FastifyPluginAsync } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { getDatabase, smsOutbox, tenants } from '@ks-os/database';
import { z } from 'zod';
import { isSmsConfigured } from '../../lib/twilio.js';
import { env } from '../../config/env.js';
import { maskPhone } from './phone.js';
import { SmsService } from './sms.service.js';

const settings = z.object({ smsEnabled:z.boolean().optional(), operationalPhone:z.string().max(30).nullable().optional(), smsBookingConfirmationEnabled:z.boolean().optional(), smsBookingRescheduleEnabled:z.boolean().optional(), smsBookingCancellationEnabled:z.boolean().optional(), smsAppointmentRemindersEnabled:z.boolean().optional(), smsFormDeliveryEnabled:z.boolean().optional(), smsFormRemindersEnabled:z.boolean().optional(), smsPaymentConfirmationEnabled:z.boolean().optional(), smsRefundUpdatesEnabled:z.boolean().optional(), smsReminderTiming:z.enum(['none','24_hours_before','48_hours_before','24_and_48_hours_before']).optional() });
export const smsRoutes: FastifyPluginAsync = async fastify => {
  fastify.get('/settings', async (req, reply) => { req.requireAuth(); if(req.auth!.role!=='owner') return reply.code(403).send({error:{code:'SMS_ACCESS_DENIED'}}); const [row]=await getDatabase().select().from(tenants).where(eq(tenants.id,req.auth!.tenantId)).limit(1); return { ...row, configured:isSmsConfigured() }; });
  fastify.put('/settings', async (req, reply) => { req.requireAuth(); if(req.auth!.role!=='owner') return reply.code(403).send({error:{code:'SMS_ACCESS_DENIED'}}); const parsed=settings.safeParse(req.body); if(!parsed.success) return reply.code(400).send({error:{code:'INVALID_REQUEST'}}); if(parsed.data.smsEnabled && !isSmsConfigured()) return reply.code(409).send({error:{code:'SMS_NOT_CONFIGURED'}}); await getDatabase().update(tenants).set({...parsed.data,updatedAt:new Date()}).where(eq(tenants.id,req.auth!.tenantId)); return {success:true}; });
  fastify.get('/history', async (req, reply) => { req.requireAuth(); if(req.auth!.role!=='owner') return reply.code(403).send({error:{code:'SMS_ACCESS_DENIED'}}); const rows=await getDatabase().select().from(smsOutbox).where(eq(smsOutbox.tenantId,req.auth!.tenantId)).orderBy(desc(smsOutbox.createdAt)).limit(100); return {data:rows.map(({recipientPhoneE164,templateDataJson,...r})=>({...r,recipientPhoneMasked:maskPhone(recipientPhoneE164)}))}; });
  fastify.get('/usage', async (req, reply) => { req.requireAuth(); if(req.auth!.role!=='owner') return reply.code(403).send({error:{code:'SMS_ACCESS_DENIED'}}); const result=await getDatabase().execute(sql`SELECT count(*)::int messages,coalesce(sum(segment_count),0)::int segments,count(*) filter(where status='DELIVERED')::int delivered,count(*) filter(where status in ('FAILED','UNDELIVERED'))::int failed FROM sms_outbox WHERE tenant_id=${req.auth!.tenantId} AND created_at>=date_trunc('month',now())`); return result.rows[0]; });
  fastify.post('/worker', async (req, reply) => { if(!env.SMS_WORKER_SECRET || req.headers.authorization!==`Bearer ${env.SMS_WORKER_SECRET}`) return reply.code(401).send({error:{code:'SMS_ACCESS_DENIED'}}); return {processed:await new SmsService().processOutbox()}; });
};
