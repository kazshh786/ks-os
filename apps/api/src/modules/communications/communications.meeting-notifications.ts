import { createHash } from 'node:crypto';
import { effectiveCapabilities, PROFILE_CAPABILITIES, type AccessProfile } from '@ks-os/auth';
import { sql, type SQL } from '@ks-os/database';
import { CommunicationsAuthorization, notFound, type CommunicationsActor } from './communications.authorization.js';
import type { CommunicationsDatabase } from './communications.database.js';

export type MeetingNotificationType='CALL_INCOMING'|'CALL_MISSED'|'MEETING_INVITATION'|'MEETING_UPDATED'|'MEETING_CANCELLED'|'MEETING_REMINDER';
type StaffAccess={all:boolean;own:boolean};
const identifier=(value:string)=>{if(!/^[a-z][a-z0-9_]*$/.test(value))throw new Error('Invalid SQL alias');return sql.raw(value);};
function staffCapabilitySql(actor:CommunicationsActor,capability:'MEETINGS_VIEW_ALL'|'MEETINGS_VIEW_OWN'):SQL {
 const profiles=Object.entries(PROFILE_CAPABILITIES).filter(([,caps])=>caps.includes(capability)).map(([profile])=>profile);
 return sql`EXISTS(SELECT 1 FROM users mu WHERE mu.id=${actor.userId} AND mu.tenant_id=${actor.tenantId} AND mu.account_status='ACTIVE' AND (mu.role='owner' OR mu.permissions->${capability}='true'::jsonb OR (coalesce(mu.permissions->${capability},'null'::jsonb)<>'false'::jsonb AND (CASE WHEN mu.access_profile IN ('PRACTITIONER','RECEPTIONIST','MANAGER') THEN mu.access_profile ELSE 'PRACTITIONER' END) IN (${sql.join(profiles.map(profile=>sql`${profile}`),sql`,`)}))))`;
}

/** Caller authenticates the application/provider session first; this predicate rechecks current resource authority. */
export function currentMeetingAccessSql(actor:CommunicationsActor,alias='m',staffAccess:StaffAccess={all:false,own:true}):SQL {
 const m=identifier(alias);
 const tenant=sql`${m}.tenant_id=${actor.tenantId} AND EXISTS(SELECT 1 FROM tenants mt WHERE mt.id=${m}.tenant_id AND mt.is_active AND mt.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED'))`;
 if(actor.kind==='CUSTOMER')return sql`(${tenant} AND ${m}.scheduled_start_at IS NOT NULL AND ${m}.audience='EXTERNAL_CLIENT' AND EXISTS(
  SELECT 1 FROM communication_meeting_customer_grants mg JOIN conversations mc ON mc.id=mg.conversation_id AND mc.tenant_id=mg.tenant_id
  JOIN conversation_members mm ON mm.conversation_id=mc.id AND mm.tenant_id=mc.tenant_id AND mm.left_at IS NULL
  JOIN customer_collaboration_relationships mr ON mr.id=mm.customer_relationship_id AND mr.tenant_id=mc.tenant_id AND mr.client_id=mc.client_id
  JOIN customer_accounts ma ON ma.id=mr.customer_account_id
  WHERE mg.meeting_id=${m}.id AND mg.tenant_id=${m}.tenant_id AND mg.revoked_at IS NULL AND mc.external_client_channel AND mc.archived_at IS NULL
   AND mr.id=${actor.customerRelationshipId} AND mr.customer_account_id=${actor.customerAccountId} AND mr.status='ACTIVE' AND mr.revoked_at IS NULL AND ma.status='ACTIVE' AND ${m}.customer_id=mr.client_id))`;
 return sql`(${tenant} AND EXISTS(SELECT 1 FROM users mu WHERE mu.id=${actor.userId} AND mu.tenant_id=${m}.tenant_id AND mu.account_status='ACTIVE') AND (
  (${m}.scheduled_start_at IS NULL AND EXISTS(SELECT 1 FROM conversations mc JOIN conversation_members mm ON mm.conversation_id=mc.id AND mm.tenant_id=mc.tenant_id WHERE mc.id=${m}.conversation_id AND mc.tenant_id=${m}.tenant_id AND mc.archived_at IS NULL AND mm.user_id=${actor.userId} AND mm.left_at IS NULL))
  OR (${m}.scheduled_start_at IS NOT NULL AND ((${staffAccess.all} AND ${staffCapabilitySql(actor,'MEETINGS_VIEW_ALL')}) OR (${staffAccess.own} AND ${staffCapabilitySql(actor,'MEETINGS_VIEW_OWN')} AND (${m}.created_by=${actor.userId} OR ${m}.host_user_id=${actor.userId} OR EXISTS(SELECT 1 FROM communication_meeting_participants mp WHERE mp.meeting_id=${m}.id AND mp.tenant_id=${m}.tenant_id AND mp.user_id=${actor.userId} AND mp.invitation_state<>'REMOVED')))))))`;
}

async function staffAccess(db:CommunicationsDatabase,userId:string,tenantId:string):Promise<StaffAccess>{
 const [u]=await db.query<{role:'owner'|'staff';access_profile:string|null;permissions:Record<string,boolean>|null}>(sql`SELECT role,access_profile,permissions FROM users WHERE id=${userId} AND tenant_id=${tenantId} AND account_status='ACTIVE'`);
 if(!u)return {all:false,own:false};
 const caps=effectiveCapabilities(u.role,(u.access_profile??'PRACTITIONER') as AccessProfile,u.permissions??{});
 return {all:caps.includes('MEETINGS_VIEW_ALL'),own:caps.includes('MEETINGS_VIEW_OWN')};
}

/** Safe metadata only: never creates a room, guest admission or media credential. */
export async function authorizedMeetingReference(db:CommunicationsDatabase,actor:CommunicationsActor,id:string){
 await new CommunicationsAuthorization(db).authenticate(actor);
 const access=actor.kind==='CUSTOMER'?undefined:await staffAccess(db,actor.userId,actor.tenantId);
 const [row]=await db.query<Record<string,unknown>>(sql`SELECT m.id,m.tenant_id AS "tenantId",m.conversation_id AS "conversationId",m.status,m.type,m.version,m.scheduled_start_at AS "scheduledStartAt",m.scheduled_end_at AS "scheduledEndAt" FROM communication_meetings m WHERE m.id=${id} AND ${currentMeetingAccessSql(actor,'m',access)}`);
 if(!row)throw notFound();return row;
}

/** History remains visible after a call ends; revoked resource authority always removes visibility. */
export function meetingNotificationVisibility(actor:CommunicationsActor,alias='n'):SQL {
 const n=identifier(alias);
 return sql`EXISTS(SELECT 1 FROM communication_meetings mn WHERE mn.id=${n}.chat_meeting_id AND mn.tenant_id=${n}.tenant_id AND ${currentMeetingAccessSql(actor,'mn',{all:true,own:true})}
  ${actor.kind==='CUSTOMER'?sql`AND EXISTS(SELECT 1 FROM communication_meeting_customer_grants ng JOIN conversations nc ON nc.id=ng.conversation_id AND nc.tenant_id=ng.tenant_id JOIN conversation_members nm ON nm.conversation_id=nc.id AND nm.tenant_id=nc.tenant_id WHERE ng.meeting_id=mn.id AND ng.conversation_id=${n}.chat_conversation_id AND ng.tenant_id=mn.tenant_id AND ng.revoked_at IS NULL AND nc.external_client_channel AND nc.archived_at IS NULL AND nc.client_id=mn.customer_id AND nm.customer_relationship_id=${actor.customerRelationshipId} AND nm.left_at IS NULL)`:sql``})`;
}

export interface MeetingNotificationReference {tenantId:string;recipientUserId:string|null;recipientCustomerRelationshipId:string|null;meetingId:string;meetingVersion:number;type:string;conversationId:string|null}
/** Delivery is stricter than history. Device/provider/session and preferences are checked by the delivery worker. */
export async function canDeliverMeetingNotification(db:CommunicationsDatabase,row:MeetingNotificationReference):Promise<boolean>{
 let actor:CommunicationsActor;
 if(row.recipientCustomerRelationshipId){const [r]=await db.query<{accountId:string}>(sql`SELECT customer_account_id AS "accountId" FROM customer_collaboration_relationships WHERE id=${row.recipientCustomerRelationshipId} AND tenant_id=${row.tenantId}`);if(!r)return false;
  actor={kind:'CUSTOMER',tenantId:row.tenantId,userId:row.recipientCustomerRelationshipId,customerRelationshipId:row.recipientCustomerRelationshipId,customerAccountId:r.accountId} as CommunicationsActor;
 }else if(row.recipientUserId)actor={tenantId:row.tenantId,userId:row.recipientUserId} as CommunicationsActor;else return false;
 const access=actor.kind==='CUSTOMER'?undefined:await staffAccess(db,actor.userId,actor.tenantId);
 const [m]=await db.query<{status:string;expiresAt:Date;state:string|null}>(sql`SELECT m.status,m.expires_at AS "expiresAt",p.invitation_state AS state FROM communication_meetings m LEFT JOIN communication_meeting_participants p ON p.meeting_id=m.id AND p.user_id=${row.recipientUserId} WHERE m.id=${row.meetingId} AND m.version=${row.meetingVersion} AND ${currentMeetingAccessSql(actor,'m',access)}
  ${actor.kind==='CUSTOMER'?sql`AND EXISTS(SELECT 1 FROM communication_meeting_customer_grants g JOIN conversations c ON c.id=g.conversation_id AND c.tenant_id=g.tenant_id JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.tenant_id=c.tenant_id WHERE g.meeting_id=m.id AND g.conversation_id=${row.conversationId} AND g.revoked_at IS NULL AND c.archived_at IS NULL AND cm.customer_relationship_id=${actor.customerRelationshipId} AND cm.left_at IS NULL)`:sql``}`);
 if(!m)return false;
 if(row.type==='CALL_INCOMING')return ['RINGING','ACTIVE'].includes(m.status)&&m.state==='INVITED'&&new Date(m.expiresAt).getTime()>Date.now();
 if(row.type==='CALL_MISSED')return m.state==='MISSED';
 if(row.type==='MEETING_CANCELLED')return ['CANCELLED','EXPIRED','FAILED'].includes(m.status);
 if(['MEETING_INVITATION','MEETING_UPDATED','MEETING_REMINDER'].includes(row.type))return ['SCHEDULED','CREATED','RINGING','ACTIVE'].includes(m.status)&&new Date(m.expiresAt).getTime()>Date.now();
 return false;
}

function sourceId(meetingId:string,version:number,type:MeetingNotificationType){const hex=createHash('sha256').update(`ksos:meeting-notification:v1:${meetingId}:${version}:${type}`).digest('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
const content:Record<MeetingNotificationType,[string,string]>={CALL_INCOMING:['Incoming call','Open KSOS to answer this call.'],CALL_MISSED:['Missed call','Open KSOS to view this call.'],MEETING_INVITATION:['Meeting invitation','Open KSOS to view this meeting.'],MEETING_UPDATED:['Meeting updated','Open KSOS to view the updated meeting.'],MEETING_CANCELLED:['Meeting cancelled','Open KSOS to view this meeting.'],MEETING_REMINDER:['Meeting reminder','Open KSOS to view this meeting.']};

/** Called under the meeting/tenant transaction lock. Canonical records are independent of delivery preferences. */
export async function createMeetingNotifications(db:CommunicationsDatabase,meetingId:string,type:MeetingNotificationType,options:{excludeUserId?:string;conversationId?:string;customersOnly?:boolean}={}){
 const [m]=await db.query<{id:string;tenant_id:string;conversation_id:string|null;version:number;expires_at:Date;customer_id:string|null}>(sql`SELECT id,tenant_id,conversation_id,version,expires_at,customer_id FROM communication_meetings WHERE id=${meetingId}`);if(!m)return;
 const source=sourceId(m.id,m.version,type),[title,message]=content[type];
 if(!options.customersOnly){const rows=await db.query<{id:string;recipient_user_id:string}>(sql`INSERT INTO internal_notifications(tenant_id,recipient_user_id,type,title,message,source_type,source_id,chat_conversation_id,chat_meeting_id,meeting_version,expires_at)
  SELECT m.tenant_id,p.user_id,${type},${title},${message},CASE WHEN m.conversation_id IS NULL THEN 'MEETING' ELSE 'CHAT' END,${source},m.conversation_id,m.id,m.version,${type==='CALL_INCOMING'?sql`m.expires_at`:sql`NULL::timestamptz`}
  FROM communication_meetings m JOIN communication_meeting_participants p ON p.meeting_id=m.id AND p.tenant_id=m.tenant_id JOIN users u ON u.id=p.user_id AND u.tenant_id=m.tenant_id AND u.account_status='ACTIVE'
  WHERE m.id=${m.id} AND p.invitation_state ${type==='CALL_INCOMING'?sql`='INVITED'`:type==='CALL_MISSED'?sql`='MISSED'`:sql`<>'REMOVED'`} ${options.excludeUserId?sql`AND p.user_id<>${options.excludeUserId}`:sql``}
   AND (m.conversation_id IS NULL OR EXISTS(SELECT 1 FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id WHERE cm.conversation_id=m.conversation_id AND cm.tenant_id=m.tenant_id AND cm.user_id=p.user_id AND cm.left_at IS NULL AND c.archived_at IS NULL)) ON CONFLICT DO NOTHING RETURNING id,recipient_user_id`);
  for(const row of rows)await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,meeting_id,type,resource_id,recipient_user_id) VALUES(${m.tenant_id},${m.conversation_id},${m.id},'notification.created',${row.id},${row.recipient_user_id})`);
 }
 if(type.startsWith('CALL_'))return;
 const rows=await db.query<{id:string;recipient_customer_relationship_id:string;chat_conversation_id:string}>(sql`INSERT INTO internal_notifications(tenant_id,recipient_customer_relationship_id,type,title,message,source_type,source_id,chat_conversation_id,chat_meeting_id,meeting_version)
  SELECT DISTINCT ON (r.id) m.tenant_id,r.id,${type},${title},${message},'CHAT',${source},c.id,m.id,m.version FROM communication_meetings m
  JOIN communication_meeting_customer_grants g ON g.meeting_id=m.id AND g.tenant_id=m.tenant_id AND g.revoked_at IS NULL JOIN conversations c ON c.id=g.conversation_id AND c.tenant_id=m.tenant_id AND c.external_client_channel AND c.archived_at IS NULL AND c.client_id=m.customer_id
  JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.tenant_id=m.tenant_id AND cm.left_at IS NULL JOIN customer_collaboration_relationships r ON r.id=cm.customer_relationship_id AND r.tenant_id=m.tenant_id AND r.client_id=m.customer_id AND r.status='ACTIVE' AND r.revoked_at IS NULL JOIN customer_accounts a ON a.id=r.customer_account_id AND a.status='ACTIVE'
  WHERE m.id=${m.id} AND m.audience='EXTERNAL_CLIENT' ${options.conversationId?sql`AND c.id=${options.conversationId}`:sql``} ORDER BY r.id,c.id ON CONFLICT DO NOTHING RETURNING id,recipient_customer_relationship_id,chat_conversation_id`);
 for(const row of rows)await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,meeting_id,type,resource_id,recipient_customer_relationship_id) VALUES(${m.tenant_id},${row.chat_conversation_id},${m.id},'notification.created',${row.id},${row.recipient_customer_relationship_id})`);
}

export async function invalidateCallNotifications(db:CommunicationsDatabase,meetingId:string,userId?:string){await db.query(sql`UPDATE internal_notifications SET expires_at=now() WHERE chat_meeting_id=${meetingId} AND type='CALL_INCOMING' ${userId?sql`AND recipient_user_id=${userId}`:sql``} AND (expires_at IS NULL OR expires_at>now())`);}
