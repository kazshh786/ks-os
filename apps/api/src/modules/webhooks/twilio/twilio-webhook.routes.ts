import type { FastifyPluginAsync } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { clients, communicationChannels, getDatabase, reviewInvitations, smsOutbox, tenants, twilioWebhookEvents } from '@ks-os/database';
import { env } from '../../../config/env.js';
import { validateTwilioSignature } from '../../../lib/twilio.js';
import { ConversationDeliveryService } from '../../conversations/conversation-delivery.service.js';
import { ConversationIngestService } from '../../conversations/conversation-ingest.service.js';
import { OperationsIssueReporter } from '../../operations/operations.issue-service.js';
import { normalizeSmsPhone } from '../../sms/phone.js';

const precedence: Record<string,number> = { PENDING:0,PROCESSING:1,ACCEPTED:2,QUEUED:3,SENT:4,UNDELIVERED:5,FAILED:5,CANCELLED:5,DELIVERED:6 };
const statusMap: Record<string,string> = { accepted:'ACCEPTED',queued:'QUEUED',sent:'SENT',delivered:'DELIVERED',undelivered:'UNDELIVERED',failed:'FAILED',cancelled:'CANCELLED' };
const stop = new Set(['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT']);
const start = new Set(['START','UNSTOP','YES']);
const help = new Set(['HELP','INFO']);
const xml = (message:string) => `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message.replace(/[<>&'\"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]!))}</Message></Response>`;
const emptyXml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export const twilioWebhookRoutes: FastifyPluginAsync = async fastify => {
  const delivery = new ConversationDeliveryService();
  const ingest = new ConversationIngestService();

  fastify.post('/status', async (request, reply) => {
    const body=request.body as Record<string,string>; const signature=request.headers['x-twilio-signature'] as string|undefined;
    if(!env.TWILIO_STATUS_CALLBACK_URL || !validateTwilioSignature(signature,env.TWILIO_STATUS_CALLBACK_URL,body)) return reply.code(401).send({error:{code:'SMS_WEBHOOK_SIGNATURE_INVALID'}});
    const sid=body.MessageSid; const mapped=statusMap[(body.MessageStatus||'').toLowerCase()]; if(!sid||!mapped) return reply.code(204).send();
    const db=getDatabase();
    await delivery.applyProviderStatus('SMS', sid, body.MessageStatus);
    const [current]=await db.select().from(smsOutbox).where(eq(smsOutbox.providerMessageSid,sid)).limit(1); if(!current) return reply.code(204).send();
    if((precedence[mapped]??0) >= (precedence[current.status]??0)){await db.update(smsOutbox).set({status:mapped,deliveredAt:mapped==='DELIVERED'?new Date():current.deliveredAt,failedAt:['FAILED','UNDELIVERED'].includes(mapped)?new Date():current.failedAt,lastErrorCode:body.ErrorCode||current.lastErrorCode}).where(eq(smsOutbox.id,current.id));const reviewInvitationId=String((current.templateDataJson as any)?.reviewInvitationId??'');if(current.templateKey==='review-invitation'&&reviewInvitationId)await db.update(reviewInvitations).set({status:mapped==='DELIVERED'?'DELIVERED':['FAILED','UNDELIVERED'].includes(mapped)?'FAILED':'SENT',deliveredAt:mapped==='DELIVERED'?new Date():undefined,failureCode:['FAILED','UNDELIVERED'].includes(mapped)?'SMS_'+mapped:null,updatedAt:new Date()}).where(and(eq(reviewInvitations.id,reviewInvitationId),eq(reviewInvitations.tenantId,current.tenantId)));}
    const issues=new OperationsIssueReporter();if(['FAILED','UNDELIVERED'].includes(mapped)){const formDelivery=!!current.formAssignmentId;const issueType=formDelivery?'FORM_DELIVERY_FAILED':'SMS_FAILED';await issues.report({tenantId:current.tenantId,category:formDelivery?'FORM':'SMS',issueType,severity:'WARNING',title:formDelivery?'Form delivery failed':'SMS delivery failed',message:'The SMS provider reported a permanent delivery failure.',sourceType:'SMS_OUTBOX',sourceId:current.id,deduplicationKey:`${issueType}:${current.id}`,relatedAppointmentId:current.appointmentId,metadata:{providerStatus:mapped,errorCode:body.ErrorCode}});}if(mapped==='DELIVERED'){await issues.resolve(current.tenantId,`SMS_FAILED:${current.id}`);await issues.resolve(current.tenantId,`FORM_DELIVERY_FAILED:${current.id}`);}
    return reply.code(204).send();
  });

  fastify.post('/inbound', async (request, reply) => {
    const body=request.body as Record<string,string>; const signature=request.headers['x-twilio-signature'] as string|undefined;
    if(!env.TWILIO_INBOUND_WEBHOOK_URL || !validateTwilioSignature(signature,env.TWILIO_INBOUND_WEBHOOK_URL,body)) return reply.code(401).send({error:{code:'SMS_WEBHOOK_SIGNATURE_INVALID'}});
    const db=getDatabase(); const eventKey=body.MessageSid; if(!eventKey) return reply.code(204).send();
    const inserted=await db.insert(twilioWebhookEvents).values({eventKey,eventType:'INBOUND'}).onConflictDoNothing({target:twilioWebhookEvents.eventKey}).returning();
    if(!inserted.length) return reply.type('text/xml').send(emptyXml);
    const keyword=(body.OptOutType || body.Body || '').trim().toUpperCase(); const phone=normalizeSmsPhone(body.From);
    const matches=await db.select().from(clients).where(eq(clients.phoneE164,phone));
    if(stop.has(keyword) || body.OptOutType?.toUpperCase()==='STOP') {
      for(const client of matches) {
        await db.update(clients).set({smsTransactionalStatus:'OPTED_OUT',smsMarketingStatus:'OPTED_OUT',smsOptedOutAt:new Date(),smsSuppressionReason:'CUSTOMER_OPT_OUT'}).where(eq(clients.id,client.id));
        const suppressed = await db.update(smsOutbox).set({status:'SUPPRESSED',lastErrorCode:'RECIPIENT_OPTED_OUT'}).where(and(eq(smsOutbox.clientId,client.id),inArray(smsOutbox.status,['PENDING','PROCESSING']),inArray(smsOutbox.templateKey,['appointment-reminder','form-reminder','review-invitation']))).returning({templateKey:smsOutbox.templateKey,templateDataJson:smsOutbox.templateDataJson});
        for(const message of suppressed) {
          const reviewInvitationId=String((message.templateDataJson as any)?.reviewInvitationId??'');
          if(message.templateKey==='review-invitation'&&reviewInvitationId) await db.update(reviewInvitations).set({status:'SUPPRESSED',failureCode:'RECIPIENT_OPTED_OUT',updatedAt:new Date()}).where(and(eq(reviewInvitations.id,reviewInvitationId),eq(reviewInvitations.tenantId,client.tenantId)));
        }
      }
      return reply.type('text/xml').send(xml('You are opted out of KS OS text reminders. Reply START to opt in again.'));
    }
    if(start.has(keyword) || body.OptOutType?.toUpperCase()==='START') { for(const client of matches) await db.update(clients).set({smsTransactionalStatus:'OPTED_IN',smsOptedInAt:new Date(),smsSuppressionReason:null}).where(eq(clients.id,client.id)); return reply.type('text/xml').send(xml('You are opted in to transactional KS OS messages. Marketing remains off.')); }
    const normalizedTo = normalizeSmsPhone(body.To);
    const [channel] = await db.select({id:communicationChannels.id,tenantId:communicationChannels.tenantId})
      .from(communicationChannels)
      .where(and(eq(communicationChannels.channelType,'SMS'),eq(communicationChannels.status,'CONNECTED'),eq(communicationChannels.externalAccountId,normalizedTo)))
      .limit(1);
    if(channel && !help.has(keyword)) {
      const tenantClient=matches.find(match=>match.tenantId===channel.tenantId);
      await ingest.ingest({tenantId:channel.tenantId,channelId:channel.id,channel:'SMS',externalSenderId:phone,externalMessageId:eventKey,body:body.Body||'',customerName:tenantClient?.name,customerPhone:phone,metadata:{twilioTo:normalizedTo,numMedia:Number(body.NumMedia||0)}});
      return reply.type('text/xml').send(emptyXml);
    }
    const client=matches[0]; const [tenant]=client ? await db.select().from(tenants).where(eq(tenants.id,client.tenantId)).limit(1) : [];
    const contact=tenant?.operationalPhone ? ` Please contact ${tenant.name} on ${tenant.operationalPhone}.` : ' Please contact the salon directly.';
    return reply.type('text/xml').send(xml(help.has(keyword) ? `KS OS sends automated appointment and form messages.${contact}` : `KS OS could not route this reply to a connected business inbox.${contact}`));
  });
};
