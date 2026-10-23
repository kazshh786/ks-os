import { randomUUID } from 'node:crypto';
import { effectiveCapabilities, type AccessProfile } from '@ks-os/auth';
import { sql } from '@ks-os/database';
import { z } from 'zod';
import { CommunicationsAuthorization, communicationError, type CommunicationsActor } from './communications.authorization.js';
import { communicationsDatabase, type CommunicationsDatabase } from './communications.database.js';
import { LiveKitProvider, type MeetingMediaProvider } from './communications.livekit.js';
import { meetingBranding } from './communications.meeting-branding.js';
import { resolveMeetingSchedule } from './communications.meeting-time.js';
import { guestCredential, guestCsrf, guestMeetingsConfigured, invitationToken, invitationUrl, sameSecret, secretHash } from './communications.meeting-secrets.js';
import { meetingLimits, reserveConnectionCapacity, reserveMeetingCapacity } from './communications.meeting-policy.js';
import { enqueueMeetingEmail } from './communications.meeting-delivery.js';
import { validateCustomerProviderSession } from './communications.customer-provider.js';
import { createMeetingNotifications } from './communications.meeting-notifications.js';
import { mobileProviderSessionCurrent } from '../authentication/mobile-devices.service.js';

const uuid=z.string().uuid();
export const ClientMeetingInputSchema=z.object({
 requestId:uuid,title:z.string().trim().min(1).max(160),description:z.string().trim().max(2000).default(''),
 audience:z.enum(['INTERNAL','EXTERNAL_CLIENT']),type:z.enum(['AUDIO','VIDEO']),localStart:z.string().max(60),timezone:z.string().max(100),durationMinutes:z.number().int().min(5).max(480),
 hostUserId:uuid,customerId:uuid.nullish(),appointmentId:uuid.nullish(),attendeeIds:z.array(uuid).max(100).default([]),cohostIds:z.array(uuid).max(10).default([]),guestScreenShare:z.boolean().default(false),
}).strict();
export const ClientMeetingUpdateSchema=ClientMeetingInputSchema.omit({requestId:true}).extend({version:z.number().int().positive()});
export type ClientMeetingInput=z.input<typeof ClientMeetingInputSchema>;
type Row=Record<string,any>;
const terminal=['ENDED','CANCELLED','FAILED','EXPIRED'];
const unavailable=()=>communicationError(404,'MEETING_UNAVAILABLE','This meeting or invitation is unavailable.');
const conflict=(code:string,message:string)=>communicationError(409,code,message);
const mediaUnavailable=()=>communicationError(503,'MEDIA_UNAVAILABLE','The calling service is unavailable. Please try again.');
const iso=(value:unknown)=>value?new Date(value as string).toISOString():null;
const fingerprint=(input:z.output<typeof ClientMeetingInputSchema>)=>secretHash(JSON.stringify({...input,attendeeIds:[...new Set(input.attendeeIds)].sort(),cohostIds:[...new Set(input.cohostIds)].sort()}));

/** Scheduled meetings extend the same persisted rooms, participants and media sessions as instant calls. */
export class ClientMeetings {
 constructor(private db:CommunicationsDatabase=communicationsDatabase(),private provider:MeetingMediaProvider=new LiveKitProvider()){}
 private lock<T>(tenant:string,work:(db:CommunicationsDatabase)=>Promise<T>){return this.db.transaction(async db=>{
  await db.query(sql`SELECT pg_advisory_xact_lock(8241006)`);
  await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenant},8241))`);return work(db);
 });}
 private enabled(){if(!this.provider.enabled)throw communicationError(503,'CALLS_UNAVAILABLE','Calling has not been enabled.');}
 private async user(db:CommunicationsDatabase,actor:CommunicationsActor){
  if(actor.kind==='CUSTOMER')throw unavailable();
  await new CommunicationsAuthorization(db).authenticate(actor);
  const [user]=await db.query<Row>(sql`SELECT role,access_profile,permissions FROM users WHERE id=${actor.userId} AND tenant_id=${actor.tenantId}`);
  const profile=['PRACTITIONER','RECEPTIONIST','MANAGER'].includes(user.access_profile)?user.access_profile as AccessProfile:'PRACTITIONER';
  return {owner:user.role==='owner',caps:effectiveCapabilities(user.role,profile,user.permissions??{})};
 }
 private async row(db:CommunicationsDatabase,id:string,tenant?:string){
  const [m]=await db.query<Row>(sql`SELECT * FROM communication_meetings WHERE id=${id} AND scheduled_start_at IS NOT NULL ${tenant?sql`AND tenant_id=${tenant}`:sql``}`);
  if(!m)throw unavailable();return m;
 }
 async eventAccess(actor:CommunicationsActor){const user=await this.user(this.db,actor);return {all:user.caps.includes('MEETINGS_VIEW_ALL'),own:user.caps.includes('MEETINGS_VIEW_OWN')};}
 private async access(db:CommunicationsDatabase,actor:CommunicationsActor,id:string,manage=false){
  const u=await this.user(db,actor),m=await this.row(db,id,actor.tenantId);
  const [p]=await db.query<Row>(sql`SELECT role,invitation_state FROM communication_meeting_participants WHERE meeting_id=${id} AND user_id=${actor.userId}`);
  const own=m.created_by===actor.userId||m.host_user_id===actor.userId||p&&p.invitation_state!=='REMOVED';
  if(!u.caps.includes('MEETINGS_VIEW_ALL')&&!(u.caps.includes('MEETINGS_VIEW_OWN')&&own))throw unavailable();
  const canManage=u.caps.includes('MEETINGS_MANAGE_ALL')||m.created_by===actor.userId||m.host_user_id===actor.userId||p?.role==='COHOST'&&p.invitation_state!=='REMOVED';
  if(manage&&!canManage)throw communicationError(403,'MEETING_FORBIDDEN','Only the organiser, co-host or authorised business manager can do this.');
  return {m,u,canManage,canJoin:Boolean(p&&p.invitation_state!=='REMOVED')};
 }
 private async event(db:CommunicationsDatabase,m:Row,type:string,actor?:string){
  await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,meeting_id,type,resource_id,actor_user_id) VALUES(${m.tenant_id},NULL,${m.id},${type},${m.id},${actor??null})`);
  const safeType=type==='meeting.scheduled'?'meeting.created':type==='meeting.cancelled'?'meeting.ended':['meeting.updated','meeting.started','meeting.ended'].includes(type)?type:null;
  if(safeType)await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,meeting_id,type,resource_id,actor_user_id) SELECT ${m.tenant_id},g.conversation_id,${m.id},${safeType},${m.id},${actor??null} FROM communication_meeting_customer_grants g JOIN conversations c ON c.id=g.conversation_id AND c.tenant_id=g.tenant_id WHERE g.meeting_id=${m.id} AND g.tenant_id=${m.tenant_id} AND g.revoked_at IS NULL AND c.external_client_channel AND c.archived_at IS NULL AND c.client_id=${m.customer_id}`);
 }
 private async customerAudit(db:CommunicationsDatabase,actor:CommunicationsActor,action:string,meetingId:string,conversationId:string){
  await db.query(sql`INSERT INTO account_access_audit_events(auth_user_id,tenant_id,tenant_user_id,application_context,action,outcome,metadata) VALUES(${actor.authUserId},${actor.tenantId},${actor.kind==='CUSTOMER'?null:actor.userId},${actor.kind==='CUSTOMER'?'CUSTOMER':'TENANT'},${action},'SUCCESS',${JSON.stringify({meetingId,conversationId,...(actor.kind==='CUSTOMER'?{relationshipId:actor.customerRelationshipId}: {})})}::jsonb)`);
 }
 private async publicView(db:CommunicationsDatabase,m:Row){
  const [host]=await db.query<Row>(sql`SELECT name FROM users WHERE id=${m.host_user_id} AND tenant_id=${m.tenant_id}`);
  const limits=await meetingLimits(db,m.tenant_id,this.provider.participantLimit);
  return {title:m.title,type:m.type,status:m.status,scheduledStartAt:iso(m.scheduled_start_at),scheduledEndAt:iso(m.scheduled_end_at),timezone:m.timezone,hostName:host?.name??'Your host',branding:await meetingBranding(db,m.tenant_id),guestScreenShare:m.guest_screen_share,waitingRoomEnabled:true,participantLimit:limits.participants};
 }
 private async view(db:CommunicationsDatabase,actor:CommunicationsActor,m:Row){
  const {u,canManage,canJoin}=await this.access(db,actor,m.id);
  const [host]=await db.query<Row>(sql`SELECT name FROM users WHERE id=${m.host_user_id} AND tenant_id=${m.tenant_id}`);
  const [customer]=m.customer_id&&u.caps.includes('CLIENTS_VIEW_BASIC')?await db.query<Row>(sql`SELECT name,public_reference FROM clients WHERE id=${m.customer_id} AND tenant_id=${m.tenant_id}`):[];
  const participants=await db.query<Row>(sql`SELECT p.id,p.user_id AS "userId",coalesce(u.name,p.guest_name) AS name,p.role,p.invitation_state AS "invitationState",p.joined_at AS "joinedAt",p.left_at AS "leftAt",(SELECT count(*)::int FROM communication_meeting_sessions s WHERE s.participant_id=p.id AND s.joined_at IS NOT NULL AND s.left_at IS NULL AND s.revoked_at IS NULL) AS "sessionCount" FROM communication_meeting_participants p LEFT JOIN users u ON u.id=p.user_id AND u.tenant_id=p.tenant_id WHERE p.meeting_id=${m.id} AND p.tenant_id=${m.tenant_id} ORDER BY p.invited_at,p.id LIMIT 200`);
  const invitations=canManage?await db.query<Row>(sql`SELECT id,email,expires_at AS "expiresAt",revoked_at AS "revokedAt",claimed_at AS "claimedAt" FROM communication_meeting_invitations WHERE meeting_id=${m.id} ORDER BY created_at DESC LIMIT 100`):[];
  return {id:m.id,conversationId:null,createdBy:m.created_by,hostUserId:m.host_user_id,title:m.title,description:m.description,type:m.type,audience:m.audience,status:m.status,version:m.version,
   createdAt:iso(m.created_at),startedAt:iso(m.started_at),endedAt:iso(m.ended_at),endReason:m.end_reason,expiresAt:iso(m.expires_at),scheduledStartAt:iso(m.scheduled_start_at),scheduledEndAt:iso(m.scheduled_end_at),timezone:m.timezone,
   organizerName:host?.name??'Host',conversationName:m.title,customerId:customer?m.customer_id:null,customerName:customer?.name??null,customerReference:customer?.public_reference??null,appointmentId:customer?m.appointment_id:null,
   canManage,canJoin,canInvite:canManage&&m.audience==='EXTERNAL_CLIENT',guestScreenShare:m.guest_screen_share,waitingRoomEnabled:true,branding:await meetingBranding(db,m.tenant_id),participants,invitations,
   attendeeIds:participants.filter(p=>p.userId&&p.role==='PARTICIPANT').map(p=>p.userId),cohostIds:participants.filter(p=>p.userId&&p.role==='COHOST').map(p=>p.userId),waiting:canManage?await this.waitingRows(db,m):[]};
 }
 async config(actor:CommunicationsActor,query:{customerReference?:string}={}){return this.lock(actor.tenantId,async db=>{
  const u=await this.user(db,actor);if(!u.caps.some(c=>c==='MEETINGS_VIEW_OWN'||c==='MEETINGS_VIEW_ALL'))throw unavailable();
  const [tenant]=await db.query<Row>(sql`SELECT timezone FROM tenants WHERE id=${actor.tenantId}`);
  const hostRows=await db.query<Row>(sql`SELECT id,name,role,access_profile,permissions FROM users WHERE tenant_id=${actor.tenantId} AND account_status='ACTIVE' ORDER BY name,id LIMIT 200`);
  const hosts=hostRows.filter(row=>effectiveCapabilities(row.role,(row.access_profile??'PRACTITIONER') as AccessProfile,row.permissions??{}).some(c=>c==='MEETINGS_VIEW_OWN'||c==='MEETINGS_VIEW_ALL')).map(row=>({id:row.id,name:row.name}));
  const customers=u.caps.includes('CLIENTS_VIEW_BASIC')?await db.query<Row>(sql`SELECT id,name,public_reference AS reference FROM clients WHERE tenant_id=${actor.tenantId} ORDER BY name,id LIMIT 200`):[];
  if(query.customerReference&&u.caps.includes('CLIENTS_VIEW_BASIC')){const [customer]=await db.query<Row>(sql`SELECT id,name,public_reference AS reference FROM clients WHERE tenant_id=${actor.tenantId} AND public_reference=${query.customerReference}`);if(!customer)throw unavailable();if(!customers.some(c=>c.id===customer.id))customers.unshift(customer);}
  const appointments=u.caps.includes('BOOKINGS_VIEW_ALL')||u.caps.includes('BOOKINGS_VIEW_OWN')?await db.query<Row>(sql`SELECT a.id,a.client_id AS "customerId",a.user_id AS "hostUserId",a.start_time AS "startAt",a.end_time AS "endAt",c.name AS label FROM appointments a JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=${actor.tenantId} AND a.end_time>now() AND a.status NOT IN ('CANCELLED','NO_SHOW') ${u.caps.includes('BOOKINGS_VIEW_ALL')?sql``:sql`AND a.user_id=${actor.userId}`} ORDER BY a.start_time LIMIT 200`):[];
  return {enabled:this.provider.enabled,guestEnabled:guestMeetingsConfigured(),canCreate:u.caps.includes('MEETINGS_CREATE'),currentUserId:actor.userId,timezone:tenant.timezone,branding:await meetingBranding(db,actor.tenantId),limits:await meetingLimits(db,actor.tenantId,this.provider.participantLimit),hosts,customers,appointments};
 });}
 async list(actor:CommunicationsActor,query:Record<string,string|undefined>={}){return this.lock(actor.tenantId,async db=>{
  const u=await this.user(db,actor);if(!u.caps.some(c=>c==='MEETINGS_VIEW_OWN'||c==='MEETINGS_VIEW_ALL'))throw unavailable();
  if((query.customerId||query.customerReference)&&!u.caps.includes('CLIENTS_VIEW_HISTORY'))throw unavailable();
  if(query.customerReference){const [customer]=await db.query<Row>(sql`SELECT id FROM clients WHERE tenant_id=${actor.tenantId} AND public_reference=${query.customerReference}`);if(!customer)throw unavailable();query={...query,customerId:customer.id};}
  const rows=await db.query<Row>(sql`SELECT m.* FROM communication_meetings m WHERE m.tenant_id=${actor.tenantId} AND m.scheduled_start_at IS NOT NULL
   ${u.caps.includes('MEETINGS_VIEW_ALL')?sql``:sql`AND (m.created_by=${actor.userId} OR EXISTS(SELECT 1 FROM communication_meeting_participants p WHERE p.meeting_id=m.id AND p.user_id=${actor.userId} AND p.invitation_state<>'REMOVED'))`}
   ${query.search?sql`AND (m.title ILIKE ${'%'+query.search.slice(0,100)+'%'})`:sql``}
   ${query.status?sql`AND m.status=${query.status}`:sql``}${query.hostId?sql`AND m.host_user_id=${query.hostId}`:sql``}${query.customerId?sql`AND m.customer_id=${query.customerId}`:sql``}
   ${query.from?sql`AND m.scheduled_start_at>=${query.from}::timestamptz`:sql``}${query.to?sql`AND m.scheduled_start_at<${query.to}::timestamptz`:sql``}
   ${query.cursor?sql`AND (m.scheduled_start_at,m.id)<(SELECT scheduled_start_at,id FROM communication_meetings WHERE id=${query.cursor} AND tenant_id=${actor.tenantId})`:sql``}
   ORDER BY m.scheduled_start_at DESC,m.id DESC LIMIT 31`);
  const data=[];for(const m of rows.slice(0,30)){await this.syncAppointment(db,m);data.push(await this.view(db,actor,await this.row(db,m.id)));}return {data,nextCursor:rows.length>30?rows[29].id:null};
 });}
 async get(actor:CommunicationsActor,id:string){return this.lock(actor.tenantId,async db=>{const {m}=await this.access(db,actor,id);await this.syncAppointment(db,m);return this.view(db,actor,await this.row(db,id));});}
 private async validateInput(db:CommunicationsDatabase,actor:CommunicationsActor,input:z.output<typeof ClientMeetingInputSchema>){
  const u=await this.user(db,actor);const ids=[...new Set([input.hostUserId,...input.attendeeIds,...input.cohostIds])];
  const users=await db.query<Row>(sql`SELECT id,role,access_profile,permissions FROM users WHERE tenant_id=${actor.tenantId} AND account_status='ACTIVE' AND id IN (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`);
  if(users.length!==ids.length||users.some(row=>!effectiveCapabilities(row.role,(row.access_profile??'PRACTITIONER') as AccessProfile,row.permissions??{}).some(c=>c==='MEETINGS_VIEW_OWN'||c==='MEETINGS_VIEW_ALL')))throw unavailable();
  if(input.customerId){if(!u.caps.includes('CLIENTS_VIEW_BASIC'))throw unavailable();const [c]=await db.query(sql`SELECT id FROM clients WHERE id=${input.customerId} AND tenant_id=${actor.tenantId}`);if(!c)throw unavailable();}
  let schedule=resolveMeetingSchedule(input),appointmentVersion:number|null=null;
  if(input.appointmentId){
   if(!input.customerId||!u.caps.some(c=>c==='BOOKINGS_VIEW_ALL'||c==='BOOKINGS_VIEW_OWN'))throw unavailable();
   const [a]=await db.query<Row>(sql`SELECT * FROM appointments WHERE id=${input.appointmentId} AND tenant_id=${actor.tenantId} AND client_id=${input.customerId} ${u.caps.includes('BOOKINGS_VIEW_ALL')?sql``:sql`AND user_id=${actor.userId}`}`);
   if(!a||['CANCELLED','NO_SHOW'].includes(a.status))throw unavailable();
   if(a.user_id!==input.hostUserId)throw conflict('APPOINTMENT_HOST','The meeting host must match the linked appointment.');
   schedule={...schedule,scheduledStartAt:iso(a.start_time)!,scheduledEndAt:iso(a.end_time)!};appointmentVersion=a.version;
  }
  if(new Date(schedule.scheduledStartAt).getTime()<Date.now()-60000||new Date(schedule.scheduledStartAt).getTime()>Date.now()+366*86400000)throw communicationError(400,'MEETING_SCHEDULE_INVALID','Schedule the meeting within the next year.');
  if(input.audience==='EXTERNAL_CLIENT'&&!guestMeetingsConfigured())throw communicationError(503,'GUEST_MEETINGS_UNAVAILABLE','Guest meetings are not configured.');
  return {...schedule,appointmentVersion};
 }
 private async members(db:CommunicationsDatabase,m:Row,input:z.output<typeof ClientMeetingInputSchema>){
  const ids=[...new Set([input.hostUserId,...input.cohostIds,...input.attendeeIds])];
  await db.query(sql`UPDATE communication_meeting_participants SET invitation_state='REMOVED' WHERE meeting_id=${m.id} AND user_id IS NOT NULL AND user_id NOT IN (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`);
  for(const id of ids)await db.query(sql`INSERT INTO communication_meeting_participants(meeting_id,tenant_id,user_id,role,invitation_state) VALUES(${m.id},${m.tenant_id},${id},${id===input.hostUserId?'ORGANIZER':input.cohostIds.includes(id)?'COHOST':'PARTICIPANT'},'ACCEPTED') ON CONFLICT(meeting_id,user_id) DO UPDATE SET role=excluded.role,invitation_state='ACCEPTED'`);
 }
 async create(actor:CommunicationsActor,raw:ClientMeetingInput){const input=ClientMeetingInputSchema.parse(raw);return this.lock(actor.tenantId,async db=>{
  const u=await this.user(db,actor);if(!u.caps.includes('MEETINGS_CREATE'))throw communicationError(403,'MEETING_FORBIDDEN','You cannot create meetings.');
  const [retry]=await db.query<Row>(sql`SELECT * FROM communication_meetings WHERE tenant_id=${actor.tenantId} AND created_by=${actor.userId} AND request_id=${input.requestId}`);
  if(retry){if(!retry.scheduled_start_at||retry.request_fingerprint!==fingerprint(input))throw conflict('RETRY_CONFLICT','This request belongs to another meeting.');return this.view(db,actor,retry);}
  const schedule=await this.validateInput(db,actor,input);
  const [recent]=await db.query<Row>(sql`SELECT count(*)::int AS count FROM communication_meetings WHERE tenant_id=${actor.tenantId} AND created_by=${actor.userId} AND created_at>now()-interval '1 hour'`);
  if(recent.count>=50)throw communicationError(429,'MEETING_RATE_LIMIT','Please wait before scheduling more meetings.');
  if(input.appointmentId){const [existing]=await db.query<Row>(sql`SELECT * FROM communication_meetings WHERE tenant_id=${actor.tenantId} AND appointment_id=${input.appointmentId} AND status NOT IN ('CANCELLED','FAILED','EXPIRED')`);if(existing)return this.view(db,actor,existing);}
  const id=randomUUID();await db.query(sql`INSERT INTO communication_meetings(id,tenant_id,conversation_id,created_by,request_id,title,type,status,provider_room_name,audience,description,host_user_id,scheduled_start_at,scheduled_end_at,timezone,customer_id,appointment_id,appointment_version,guest_screen_share,expires_at)
   VALUES(${id},${actor.tenantId},NULL,${actor.userId},${input.requestId},${input.title},${input.type},'SCHEDULED',${'ksos-'+randomUUID()},${input.audience},${input.description},${input.hostUserId},${schedule.scheduledStartAt}::timestamptz,${schedule.scheduledEndAt}::timestamptz,${schedule.timezone},${input.customerId??null},${input.appointmentId??null},${schedule.appointmentVersion},${input.guestScreenShare},${new Date(new Date(schedule.scheduledEndAt).getTime()+1800000).toISOString()}::timestamptz)`);
  await db.query(sql`UPDATE communication_meetings SET request_fingerprint=${fingerprint(input)} WHERE id=${id}`);
  const m=await this.row(db,id);await this.members(db,m,input);await this.event(db,m,'meeting.scheduled',actor.userId);await createMeetingNotifications(db,id,'MEETING_INVITATION',{excludeUserId:actor.userId});return this.view(db,actor,m);
 });}
 async update(actor:CommunicationsActor,id:string,raw:unknown){const patch=ClientMeetingUpdateSchema.parse(raw);return this.lock(actor.tenantId,async db=>{
  const {m}=await this.access(db,actor,id,true);if(m.status!=='SCHEDULED'||m.version!==patch.version)throw conflict('MEETING_CHANGED','The meeting has changed or already started. Reload it before editing.');
  const input={...patch,requestId:m.request_id};const schedule=await this.validateInput(db,actor,input);
  if(m.audience!==input.audience){const [count]=await db.query<Row>(sql`SELECT count(*)::int AS n FROM communication_meeting_invitations WHERE meeting_id=${id} AND revoked_at IS NULL`);if(count.n)throw conflict('MEETING_INVITATIONS_EXIST','Revoke invitations before changing the audience.');}
  await this.invalidateAdmissions(db,m,'CANCELLED');
  if(m.customer_id!==(input.customerId??null)||m.audience!==input.audience)await db.query(sql`UPDATE communication_meeting_customer_grants SET revoked_at=coalesce(revoked_at,now()) WHERE meeting_id=${id}`);
  await db.query(sql`UPDATE communication_meetings SET title=${input.title},description=${input.description},audience=${input.audience},type=${input.type},host_user_id=${input.hostUserId},scheduled_start_at=${schedule.scheduledStartAt}::timestamptz,scheduled_end_at=${schedule.scheduledEndAt}::timestamptz,timezone=${schedule.timezone},customer_id=${input.customerId??null},appointment_id=${input.appointmentId??null},appointment_version=${schedule.appointmentVersion},guest_screen_share=${input.guestScreenShare},expires_at=${new Date(new Date(schedule.scheduledEndAt).getTime()+1800000).toISOString()}::timestamptz,version=version+1,updated_at=now() WHERE id=${id}`);
  await this.members(db,m,input);const current=await this.row(db,id);await this.rotateInvitations(db,current);await this.queueUpdates(db,current,'rescheduled');await this.event(db,current,'meeting.updated',actor.userId);return this.view(db,actor,current);
 });}
 private async rotateInvitations(db:CommunicationsDatabase,m:Row){
  const previous=await db.query<Row>(sql`UPDATE communication_meeting_invitations SET revoked_at=now() WHERE meeting_id=${m.id} AND revoked_at IS NULL RETURNING email`);
  for(const old of previous){const id=randomUUID();await db.query(sql`INSERT INTO communication_meeting_invitations(id,tenant_id,meeting_id,secret_hash,request_id,created_by,email,expires_at) VALUES(${id},${m.tenant_id},${m.id},${secretHash(invitationToken(id))},${randomUUID()},${m.created_by},${old.email},${iso(m.expires_at)}::timestamptz)`);}
 }
 private async queueUpdates(db:CommunicationsDatabase,m:Row,kind:'rescheduled'|'cancelled'){
  await createMeetingNotifications(db,m.id,kind==='rescheduled'?'MEETING_UPDATED':'MEETING_CANCELLED');
  const invitations=await db.query<Row>(sql`SELECT DISTINCT ON (email) id,email FROM communication_meeting_invitations WHERE meeting_id=${m.id} AND email IS NOT NULL ${kind==='cancelled'?sql``:sql`AND revoked_at IS NULL`} ORDER BY email,created_at DESC,id DESC LIMIT 100`);
  for(const i of invitations)await enqueueMeetingEmail({tenantId:m.tenant_id,meetingId:m.id,invitationId:i.id,version:m.version,kind,to:i.email},db);
 }
 private async invalidateAdmissions(db:CommunicationsDatabase,m:Row,state:'CANCELLED'|'DENIED'|'EXPIRED'){
  await db.query(sql`UPDATE communication_meeting_guests SET state=${state},revoked_at=coalesce(revoked_at,now()) WHERE meeting_id=${m.id} AND state IN ('WAITING','APPROVED')`);
  await db.query(sql`UPDATE communication_meeting_sessions SET revoked_at=coalesce(revoked_at,now()),left_at=CASE WHEN joined_at IS NOT NULL THEN coalesce(left_at,now()) ELSE left_at END WHERE meeting_id=${m.id}`);
 }
 private async finish(db:CommunicationsDatabase,m:Row,status:string,reason:string,actor?:string){
  if(terminal.includes(m.status))return;
  await db.query(sql`UPDATE communication_meetings SET status=${status},end_reason=${reason},ended_at=now(),cleanup_pending=true,version=version+1,updated_at=now() WHERE id=${m.id}`);
  await this.invalidateAdmissions(db,m,status==='EXPIRED'?'EXPIRED':'CANCELLED');
  await db.query(sql`UPDATE communication_meeting_invitations SET revoked_at=coalesce(revoked_at,now()),revoked_by=coalesce(revoked_by,${actor??null}::uuid) WHERE meeting_id=${m.id}`);
  await db.query(sql`UPDATE communication_meeting_participants SET left_at=coalesce(left_at,now()) WHERE meeting_id=${m.id} AND joined_at IS NOT NULL`);
  await this.event(db,m,status==='ENDED'?'meeting.ended':'meeting.cancelled',actor);
  if(status!=='ENDED')await createMeetingNotifications(db,m.id,'MEETING_CANCELLED',{excludeUserId:actor});
 }
 private async deleteRoom(m:Row){try{await this.provider.deleteRoom(m.provider_room_name);await this.db.query(sql`UPDATE communication_meetings SET cleanup_pending=false WHERE id=${m.id}`);}catch{throw mediaUnavailable();}}
 async cancel(actor:CommunicationsActor,id:string){
  const m=await this.lock(actor.tenantId,async db=>{const {m}=await this.access(db,actor,id,true);if(!terminal.includes(m.status)){await this.finish(db,m,'CANCELLED','HOST_CANCELLED',actor.userId);await this.queueUpdates(db,await this.row(db,id),'cancelled');}return m;});
  if(this.provider.enabled)await this.deleteRoom(m);return this.get(actor,id);
 }
 async end(actor:CommunicationsActor,id:string){const m=await this.lock(actor.tenantId,async db=>{const {m}=await this.access(db,actor,id,true);await this.finish(db,m,m.started_at?'ENDED':'CANCELLED','HOST_ENDED',actor.userId);return m;});if(this.provider.enabled)await this.deleteRoom(m);return this.get(actor,id);}
 async start(actor:CommunicationsActor,id:string){this.enabled();
  const result=await this.lock(actor.tenantId,async db=>{let {m}=await this.access(db,actor,id,true);await this.syncAppointment(db,m);m=await this.row(db,id);
   if(['CREATED','RINGING','ACTIVE'].includes(m.status))return {m,fresh:false};
   if(m.status!=='SCHEDULED'||new Date(m.scheduled_start_at).getTime()>Date.now()+1800000||new Date(m.expires_at).getTime()<=Date.now())throw conflict('MEETING_NOT_READY','This meeting can start from 30 minutes before its scheduled time.');
   const limits=await meetingLimits(db,m.tenant_id,this.provider.participantLimit);await reserveMeetingCapacity(db,m.tenant_id,limits);
   await db.query(sql`UPDATE communication_meetings SET status='CREATED',updated_at=now() WHERE id=${id}`);return {m,fresh:true};
  });
  if(result.fresh){try{await this.provider.createRoom(result.m.provider_room_name);}catch{await this.lock(actor.tenantId,async db=>this.finish(db,await this.row(db,id),'FAILED','PROVIDER_UNAVAILABLE'));throw mediaUnavailable();}
   await this.lock(actor.tenantId,async db=>{const m=await this.row(db,id);if(m.status!=='CREATED'){await this.provider.deleteRoom(m.provider_room_name);return;}await db.query(sql`UPDATE communication_meetings SET status='RINGING',updated_at=now() WHERE id=${id}`);await this.event(db,m,'meeting.updated',actor.userId);});}
  return this.get(actor,id);
 }
 private async issue(db:CommunicationsDatabase,m:Row,p:Row,requestId:string,actor?:CommunicationsActor,guest?:Row){
  if(!['RINGING','ACTIVE'].includes(m.status)||new Date(m.expires_at).getTime()<=Date.now())throw conflict('MEETING_NOT_READY','The host has not started this meeting, or it has ended.');
  const limits=await meetingLimits(db,m.tenant_id,this.provider.participantLimit);
  let [s]=await db.query<Row>(sql`SELECT * FROM communication_meeting_sessions WHERE meeting_id=${m.id} AND participant_id=${p.id} AND request_id=${requestId} ${guest?sql`AND guest_session_id=${guest.id}`:sql`AND auth_session_id=${actor!.sessionId}`}`);
  if(s&&(s.revoked_at||s.left_at||new Date(s.token_expires_at).getTime()<Date.now()))throw conflict('JOIN_RETRY_EXPIRED','Start a new join attempt.');
  const [rate]=await db.query<Row>(sql`SELECT coalesce(sum(token_count),0)::int AS issued,count(*) FILTER(WHERE revoked_at IS NULL AND left_at IS NULL AND (joined_at IS NOT NULL OR token_expires_at>now()))::int AS devices FROM communication_meeting_sessions WHERE participant_id=${p.id} AND token_issued_at>now()-interval '1 minute'`);
  if(rate.issued>=12)throw communicationError(429,'TOKEN_RATE_LIMIT','Please wait before requesting another connection.');
  if(!s){
   await reserveConnectionCapacity(db,m.id,limits,Boolean(guest));
   const [devices]=await db.query<Row>(sql`SELECT count(*)::int AS count FROM communication_meeting_sessions WHERE participant_id=${p.id} AND revoked_at IS NULL AND left_at IS NULL AND (joined_at IS NOT NULL OR token_expires_at>now())`);
   if(devices.count>=(guest?1:2))throw conflict('CALL_CAPACITY','Leave the other connection before joining again.');
   const id=randomUUID();await db.query(sql`INSERT INTO communication_meeting_sessions(id,tenant_id,meeting_id,participant_id,user_id,auth_session_id,auth_issued_at,guest_session_id,request_id,identity,token_expires_at) VALUES(${id},${m.tenant_id},${m.id},${p.id},${actor?.userId??null},${actor?.sessionId??null},${actor?.issuedAt??null}::timestamptz,${guest?.id??null},${requestId},${'ksos_'+id},now()+interval '60 seconds')`);
   [s]=await db.query<Row>(sql`SELECT * FROM communication_meeting_sessions WHERE id=${id}`);
  }
  await db.query(sql`UPDATE communication_meeting_sessions SET token_expires_at=now()+interval '60 seconds',token_count=CASE WHEN token_issued_at>now()-interval '1 minute' THEN token_count+1 ELSE 1 END,token_issued_at=now() WHERE id=${s.id}`);
  let token:string;try{token=await this.provider.token(m.provider_room_name,s.identity,p.name??p.guest_name,{screenShare:guest?m.guest_screen_share:true});}catch{throw mediaUnavailable();}
  return {token,url:this.provider.url,identity:s.identity,sessionId:s.id,expiresIn:this.provider.tokenTtlSeconds};
 }
 async join(actor:CommunicationsActor,id:string,requestId:string){uuid.parse(requestId);this.enabled();return this.lock(actor.tenantId,async db=>{
  const access=await this.access(db,actor,id);await this.syncAppointment(db,access.m);const {m,canJoin}=await this.access(db,actor,id);if(!canJoin)throw communicationError(403,'MEETING_ATTENDANCE_REQUIRED','Only explicitly invited staff can join this meeting.');
  const [p]=await db.query<Row>(sql`SELECT p.*,u.name FROM communication_meeting_participants p JOIN users u ON u.id=p.user_id WHERE p.meeting_id=${id} AND p.user_id=${actor.userId}`);
  return {...await this.issue(db,m,p,requestId,actor),meeting:await this.view(db,actor,m)};
 });}
 async leave(actor:CommunicationsActor,id:string,sessionId:string){const pair=await this.lock(actor.tenantId,async db=>{const {m}=await this.access(db,actor,id);const [s]=await db.query<Row>(sql`UPDATE communication_meeting_sessions SET revoked_at=coalesce(revoked_at,now()),left_at=CASE WHEN joined_at IS NOT NULL THEN coalesce(left_at,now()) ELSE left_at END WHERE id=${sessionId} AND meeting_id=${id} AND user_id=${actor.userId} AND auth_session_id=${actor.sessionId} RETURNING identity`);if(!s)throw unavailable();return {m,s};});await this.provider.removeParticipant(pair.m.provider_room_name,pair.s.identity);return {left:true};}
 async remove(actor:CommunicationsActor,id:string,participantId:string){const result=await this.lock(actor.tenantId,async db=>{
  const {m}=await this.access(db,actor,id,true);const [p]=await db.query<Row>(sql`SELECT * FROM communication_meeting_participants WHERE id=${participantId} AND meeting_id=${id}`);if(!p)throw unavailable();
  if(p.user_id===m.host_user_id)throw conflict('HOST_REQUIRED','End the meeting to remove its host.');
  await db.query(sql`UPDATE communication_meeting_participants SET invitation_state='REMOVED' WHERE id=${p.id}`);
  await db.query(sql`UPDATE communication_meeting_guests SET state='DENIED',revoked_at=coalesce(revoked_at,now()),decided_by=${actor.userId} WHERE participant_id=${p.id}`);
  const sessions=await db.query<Row>(sql`UPDATE communication_meeting_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE participant_id=${p.id} RETURNING identity`);await this.event(db,m,'guest.denied',actor.userId);return {m,sessions};
 });for(const s of result.sessions)await this.provider.removeParticipant(result.m.provider_room_name,s.identity);return this.get(actor,id);}
 async invite(actor:CommunicationsActor,id:string,input:{requestId:string;email?:string;expiresAt?:string}){
  const clean=z.object({requestId:uuid,email:z.string().trim().email().max(254).optional(),expiresAt:z.string().datetime().optional()}).strict().parse(input);
  return this.lock(actor.tenantId,async db=>{const initial=await this.access(db,actor,id,true);await this.syncAppointment(db,initial.m);const {m}=await this.access(db,actor,id,true);if(m.audience!=='EXTERNAL_CLIENT'||terminal.includes(m.status)||!guestMeetingsConfigured())throw unavailable();
   const email=clean.email?.toLowerCase()??null;
   let [invite]=await db.query<Row>(sql`SELECT * FROM communication_meeting_invitations WHERE meeting_id=${id} AND request_id=${clean.requestId}`);
   if(invite&&(invite.revoked_at||invite.email!==email))throw conflict('INVITATION_RETRY_CONFLICT','Create a new invitation request.');
   if(!invite){
    const [rate]=await db.query<Row>(sql`SELECT count(*)::int AS n FROM communication_meeting_invitations WHERE meeting_id=${id}`);if(rate.n>=100)throw communicationError(429,'INVITATION_LIMIT','This meeting has reached its invitation limit.');
    const expiry=clean.expiresAt?new Date(clean.expiresAt):new Date(m.expires_at);if(expiry.getTime()<=Date.now()||expiry.getTime()>new Date(m.expires_at).getTime())throw communicationError(400,'INVITATION_EXPIRY','Invitation expiry must be before the meeting access window ends.');
    const invitationId=randomUUID();await db.query(sql`INSERT INTO communication_meeting_invitations(id,tenant_id,meeting_id,request_id,created_by,secret_hash,email,expires_at) VALUES(${invitationId},${actor.tenantId},${id},${clean.requestId},${actor.userId},${secretHash(invitationToken(invitationId))},${email},${expiry.toISOString()}::timestamptz)`);
    [invite]=await db.query<Row>(sql`SELECT * FROM communication_meeting_invitations WHERE id=${invitationId}`);
   }
   const queued=email?await enqueueMeetingEmail({tenantId:actor.tenantId,meetingId:id,invitationId:invite.id,version:m.version,kind:'invite',to:email},db):{queued:false};
   const brand=await meetingBranding(db,m.tenant_id),url=invitationUrl(invite.id),when=new Intl.DateTimeFormat('en-GB',{dateStyle:'full',timeStyle:'short',timeZone:m.timezone}).format(new Date(m.scheduled_start_at));
   return {id:invite.id,url,text:`${brand.name} invites you to ${m.title}\n${when} (${m.timezone})\n${url}\nThis individual link requires host admission. Do not forward it.`,expiresAt:iso(invite.expires_at),emailQueued:queued.queued};
  });
 }
 async revokeInvitation(actor:CommunicationsActor,id:string,invitationId:string){
  const result=await this.lock(actor.tenantId,async db=>{const {m}=await this.access(db,actor,id,true);const rows=await db.query(sql`UPDATE communication_meeting_invitations SET revoked_at=coalesce(revoked_at,now()),revoked_by=${actor.userId} WHERE id=${invitationId} AND meeting_id=${id} RETURNING id`);if(!rows.length)throw unavailable();
   await db.query(sql`UPDATE communication_meeting_guests SET state='CANCELLED',revoked_at=coalesce(revoked_at,now()) WHERE invitation_id=${invitationId}`);
   const sessions=await db.query<Row>(sql`UPDATE communication_meeting_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE guest_session_id IN (SELECT id FROM communication_meeting_guests WHERE invitation_id=${invitationId}) RETURNING identity`);await this.event(db,m,'invitation.revoked',actor.userId);return {m,sessions};
  });for(const s of result.sessions)await this.provider.removeParticipant(result.m.provider_room_name,s.identity);return {revoked:true};
 }
 private async invitation(db:CommunicationsDatabase,token:string){
  if(!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token))throw unavailable();
  const [i]=await db.query<Row>(sql`SELECT i.* FROM communication_meeting_invitations i JOIN tenants t ON t.id=i.tenant_id WHERE i.secret_hash=${secretHash(token)} AND i.revoked_at IS NULL AND i.expires_at>now() AND t.is_active AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED')`);
  if(!i||!sameSecret(invitationToken(i.id),i.secret_hash))throw unavailable();
  const m=await this.row(db,i.meeting_id,i.tenant_id);if(m.audience!=='EXTERNAL_CLIENT'||terminal.includes(m.status)||new Date(m.expires_at).getTime()<=Date.now())throw unavailable();return {i,m};
 }
 async resolve(token:string){const {i}=await this.invitation(this.db,token);return this.lock(i.tenant_id,async db=>{const {m}=await this.invitation(db,token);await this.syncAppointment(db,m);const current=await this.invitation(db,token);return this.publicView(db,current.m);});}
 async requestGuest(input:{invitationToken:string;name:string;requestId:string}){
  const data=z.object({invitationToken:z.string().max(100),name:z.string().trim().min(1).max(100).refine(v=>!/[\u0000-\u001f\u007f]/.test(v)),requestId:uuid}).strict().parse(input);
  const {i}=await this.invitation(this.db,data.invitationToken);
  return this.lock(i.tenant_id,async db=>{const initial=await this.invitation(db,data.invitationToken);await this.syncAppointment(db,initial.m);const {i,m}=await this.invitation(db,data.invitationToken);
   if(new Date(m.scheduled_start_at).getTime()>Date.now()+1800000)throw conflict('MEETING_TOO_EARLY','The waiting room opens 30 minutes before the meeting.');
   let [g]=await db.query<Row>(sql`SELECT * FROM communication_meeting_guests WHERE invitation_id=${i.id}`);
   if(g&&(g.request_id!==data.requestId||g.name!==data.name||g.revoked_at||new Date(g.expires_at).getTime()<=Date.now()))throw unavailable();
   if(!g){
    const [count]=await db.query<Row>(sql`SELECT count(*)::int AS n FROM communication_meeting_guests WHERE meeting_id=${m.id} AND state IN ('WAITING','APPROVED') AND revoked_at IS NULL AND expires_at>now()`);if(count.n>=50)throw communicationError(429,'WAITING_ROOM_FULL','The waiting room is busy. Try again shortly.');
    const id=randomUUID(),participant=randomUUID(),ttl=Math.max(1,Math.min(30,Number(process.env.MEETING_WAITING_MINUTES)||15));
    await db.query(sql`INSERT INTO communication_meeting_participants(id,tenant_id,meeting_id,user_id,guest_name,role,invitation_state) VALUES(${participant},${m.tenant_id},${m.id},NULL,${data.name},'GUEST','INVITED')`);
    await db.query(sql`INSERT INTO communication_meeting_guests(id,tenant_id,meeting_id,participant_id,invitation_id,request_id,name,credential_hash,expires_at) VALUES(${id},${m.tenant_id},${m.id},${participant},${i.id},${data.requestId},${data.name},${secretHash(guestCredential(id))},${new Date(Math.min(Date.now()+ttl*60000,new Date(m.expires_at).getTime())).toISOString()}::timestamptz)`);
    await db.query(sql`UPDATE communication_meeting_invitations SET claimed_at=now() WHERE id=${i.id}`);await this.event(db,m,'guest.waiting');[g]=await db.query<Row>(sql`SELECT * FROM communication_meeting_guests WHERE id=${id}`);
   }
   return {sessionId:g.id,credential:guestCredential(g.id),csrfToken:guestCsrf(g.id),name:g.name,state:g.state,expiresAt:iso(g.expires_at),meeting:await this.publicView(db,m)};
  });
 }
 private async customerMeeting(db:CommunicationsDatabase,actor:CommunicationsActor,id:string,conversationId:string){
  if(actor.kind!=='CUSTOMER')throw unavailable();
  await new CommunicationsAuthorization(db).requireConversation(actor,conversationId);
  const [m]=await db.query<Row>(sql`SELECT m.* FROM communication_meetings m JOIN communication_meeting_customer_grants g ON g.meeting_id=m.id AND g.tenant_id=m.tenant_id JOIN conversations c ON c.id=g.conversation_id AND c.tenant_id=m.tenant_id JOIN customer_collaboration_relationships r ON r.id=${actor.customerRelationshipId} AND r.tenant_id=m.tenant_id AND r.client_id=c.client_id WHERE m.id=${id} AND m.tenant_id=${actor.tenantId} AND g.conversation_id=${conversationId} AND g.revoked_at IS NULL AND c.external_client_channel AND c.archived_at IS NULL AND m.audience='EXTERNAL_CLIENT' AND m.customer_id=r.client_id AND m.scheduled_start_at IS NOT NULL`);
  if(!m)throw unavailable();return m;
 }
 async customerList(actor:CommunicationsActor,query:{conversationId?:string;meetingId?:string;after?:string}={}){return this.lock(actor.tenantId,async db=>{
  if(actor.kind!=='CUSTOMER')throw unavailable();await new CommunicationsAuthorization(db).authenticate(actor);
  const rows=await db.query<Row>(sql`SELECT DISTINCT ON(m.id) m.*,g.conversation_id AS customer_channel FROM communication_meetings m JOIN communication_meeting_customer_grants g ON g.meeting_id=m.id AND g.tenant_id=m.tenant_id JOIN conversations c ON c.id=g.conversation_id AND c.tenant_id=m.tenant_id JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.tenant_id=m.tenant_id AND cm.customer_relationship_id=${actor.customerRelationshipId} AND cm.left_at IS NULL JOIN customer_collaboration_relationships r ON r.id=cm.customer_relationship_id AND r.client_id=c.client_id AND r.tenant_id=m.tenant_id WHERE m.tenant_id=${actor.tenantId} AND m.customer_id=r.client_id AND m.audience='EXTERNAL_CLIENT' AND m.scheduled_start_at IS NOT NULL AND c.external_client_channel AND c.archived_at IS NULL AND g.revoked_at IS NULL ${query.conversationId?sql`AND c.id=${query.conversationId}`:sql``} ${query.meetingId?sql`AND m.id=${query.meetingId}`:sql``} ${query.after?sql`AND m.id>${query.after}`:sql``} ORDER BY m.id,g.conversation_id LIMIT 31`);
  const data=[];for(const row of rows.slice(0,30)){await this.syncAppointment(db,row);const fresh=await this.row(db,row.id);data.push({id:row.id,conversationId:row.customer_channel,...await this.publicView(db,fresh)});}return {data,nextCursor:rows.length>30?rows[29].id:null};
 });}
 async channelMeetings(actor:CommunicationsActor,conversationId:string){
  if(actor.kind==='CUSTOMER')throw unavailable();await new CommunicationsAuthorization(this.db).requireConversation(actor,conversationId);
  const rows=await this.db.query<Row>(sql`SELECT m.* FROM communication_meeting_customer_grants g JOIN communication_meetings m ON m.id=g.meeting_id AND m.tenant_id=g.tenant_id JOIN conversations c ON c.id=g.conversation_id AND c.tenant_id=g.tenant_id WHERE g.tenant_id=${actor.tenantId} AND g.conversation_id=${conversationId} AND g.revoked_at IS NULL AND c.external_client_channel AND m.customer_id=c.client_id ORDER BY m.scheduled_start_at DESC LIMIT 100`);
  const data=[];for(const m of rows)data.push({id:m.id,conversationId,...await this.publicView(this.db,m)});return {data};
 }
 async grantCustomerChannel(actor:CommunicationsActor,conversationId:string,meetingId:string){return this.lock(actor.tenantId,async db=>{
  const {m}=await this.access(db,actor,meetingId,true);await new CommunicationsAuthorization(db).requireConversation(actor,conversationId,'invite');
  const [c]=await db.query<Row>(sql`SELECT client_id FROM conversations WHERE id=${conversationId} AND tenant_id=${actor.tenantId} AND external_client_channel AND archived_at IS NULL`);
  if(!c||m.audience!=='EXTERNAL_CLIENT'||m.customer_id!==c.client_id||terminal.includes(m.status))throw unavailable();
  await db.query(sql`INSERT INTO communication_meeting_customer_grants(tenant_id,meeting_id,conversation_id,created_by) VALUES(${actor.tenantId},${meetingId},${conversationId},${actor.userId}) ON CONFLICT(meeting_id,conversation_id) DO UPDATE SET revoked_at=NULL`);
  await createMeetingNotifications(db,meetingId,'MEETING_INVITATION',{conversationId,customersOnly:true});
  await this.customerAudit(db,actor,'CUSTOMER_MEETING_SHARED',meetingId,conversationId);
  await this.event(db,m,'meeting.updated',actor.userId);return {granted:true};
 });}
 async revokeCustomerGrant(actor:CommunicationsActor,conversationId:string,meetingId:string){
  await this.lock(actor.tenantId,async db=>{await this.access(db,actor,meetingId,true);await new CommunicationsAuthorization(db).requireConversation(actor,conversationId,'invite');const [row]=await db.query(sql`UPDATE communication_meeting_customer_grants SET revoked_at=coalesce(revoked_at,now()) WHERE tenant_id=${actor.tenantId} AND meeting_id=${meetingId} AND conversation_id=${conversationId} RETURNING meeting_id`);if(!row)throw unavailable();await this.customerAudit(db,actor,'CUSTOMER_MEETING_ACCESS_REVOKED',meetingId,conversationId);});
  await this.revokeCustomerBindings(actor.tenantId,{conversationId,meetingId});return {revoked:true};
 }
 async requestCustomer(actor:CommunicationsActor,meetingId:string,conversationId:string,requestId:string){uuid.parse(requestId);return this.lock(actor.tenantId,async db=>{
  const initial=await this.customerMeeting(db,actor,meetingId,conversationId);await this.syncAppointment(db,initial);const m=await this.customerMeeting(db,actor,meetingId,conversationId);
  if(terminal.includes(m.status)||new Date(m.expires_at).getTime()<=Date.now())throw unavailable();if(new Date(m.scheduled_start_at).getTime()>Date.now()+1800000)throw conflict('MEETING_TOO_EARLY','The waiting room opens 30 minutes before the meeting.');
  let [g]=await db.query<Row>(sql`SELECT * FROM communication_meeting_guests WHERE meeting_id=${meetingId} AND customer_relationship_id=${actor.customerRelationshipId} AND customer_auth_session_id=${actor.sessionId} AND request_id=${requestId}`);
  if(g&&(g.customer_conversation_id!==conversationId||g.revoked_at||new Date(g.expires_at).getTime()<=Date.now()))throw unavailable();
  if(!g){
   const [existing]=await db.query<Row>(sql`SELECT * FROM communication_meeting_guests WHERE meeting_id=${meetingId} AND customer_relationship_id=${actor.customerRelationshipId} AND state IN ('WAITING','APPROVED') AND revoked_at IS NULL AND expires_at>now() AND customer_expires_at>now()`);
   if(existing){if(existing.customer_auth_session_id!==actor.sessionId||existing.customer_conversation_id!==conversationId)throw conflict('ADMISSION_EXISTS','You already have an active admission request for this meeting.');return {sessionId:existing.id,credential:guestCredential(existing.id),csrfToken:guestCsrf(existing.id),name:existing.name,state:existing.state,expiresAt:iso(existing.expires_at),meeting:await this.publicView(db,m)};}
   const [count]=await db.query<Row>(sql`SELECT count(*)::int AS n FROM communication_meeting_guests WHERE meeting_id=${meetingId} AND state IN ('WAITING','APPROVED') AND revoked_at IS NULL AND expires_at>now()`);if(count.n>=50)throw communicationError(429,'WAITING_ROOM_FULL','The waiting room is busy. Try again shortly.');
   const [account]=await db.query<Row>(sql`SELECT display_name FROM customer_accounts WHERE id=${actor.customerAccountId}`);
   const id=randomUUID(),participant=randomUUID(),ttl=Math.max(1,Math.min(30,Number(process.env.MEETING_WAITING_MINUTES)||15)),expiry=new Date(Math.min(Date.now()+ttl*60000,new Date(m.expires_at).getTime(),new Date(actor.expiresAt).getTime())).toISOString();
   await db.query(sql`INSERT INTO communication_meeting_participants(id,tenant_id,meeting_id,user_id,guest_name,role,invitation_state) VALUES(${participant},${actor.tenantId},${meetingId},NULL,${account.display_name},'GUEST','INVITED')`);
   await db.query(sql`INSERT INTO communication_meeting_guests(id,tenant_id,meeting_id,participant_id,invitation_id,request_id,name,credential_hash,expires_at,customer_relationship_id,customer_conversation_id,customer_auth_session_id,customer_auth_user_id,customer_issued_at,customer_expires_at) VALUES(${id},${actor.tenantId},${meetingId},${participant},NULL,${requestId},${account.display_name},${secretHash(guestCredential(id))},${expiry}::timestamptz,${actor.customerRelationshipId},${conversationId},${actor.sessionId},${actor.authUserId},${actor.issuedAt}::timestamptz,${actor.expiresAt}::timestamptz)`);
   [g]=await db.query<Row>(sql`SELECT * FROM communication_meeting_guests WHERE id=${id}`);await this.event(db,m,'guest.waiting');await this.customerAudit(db,actor,'CUSTOMER_MEETING_REQUESTED',meetingId,conversationId);
  }
  return {sessionId:g.id,credential:guestCredential(g.id),csrfToken:guestCsrf(g.id),name:g.name,state:g.state,expiresAt:iso(g.expires_at),meeting:await this.publicView(db,m)};
 });}
 private async customerGuestAllowed(db:CommunicationsDatabase,g:Row,m:Row){
  if(!g.customer_relationship_id)return true;
  const [allowed]=await db.query(sql`SELECT r.id FROM customer_collaboration_relationships r JOIN customer_accounts a ON a.id=r.customer_account_id JOIN application_sessions app ON app.auth_user_id=a.auth_user_id JOIN conversation_members cm ON cm.customer_relationship_id=r.id AND cm.tenant_id=r.tenant_id JOIN conversations c ON c.id=cm.conversation_id AND c.tenant_id=r.tenant_id JOIN communication_meeting_customer_grants grant_row ON grant_row.conversation_id=c.id AND grant_row.tenant_id=r.tenant_id JOIN tenants t ON t.id=r.tenant_id WHERE r.id=${g.customer_relationship_id} AND r.tenant_id=${g.tenant_id} AND r.client_id=${m.customer_id} AND r.status='ACTIVE' AND r.revoked_at IS NULL AND a.status='ACTIVE' AND a.auth_user_id=${g.customer_auth_user_id} AND (a.sessions_valid_after IS NULL OR a.sessions_valid_after<${iso(g.customer_issued_at)}::timestamptz) AND app.auth_session_id=${g.customer_auth_session_id} AND app.application_context='CUSTOMER' AND app.revoked_at IS NULL AND app.expires_at>now() AND ${iso(g.customer_expires_at)}::timestamptz>now() AND cm.conversation_id=${g.customer_conversation_id} AND cm.left_at IS NULL AND c.external_client_channel AND c.client_id=r.client_id AND c.archived_at IS NULL AND grant_row.meeting_id=${m.id} AND grant_row.revoked_at IS NULL AND t.is_active AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED')`);
  if(!allowed||m.audience!=='EXTERNAL_CLIENT')return false;
  try{await validateCustomerProviderSession(db,{sessionId:g.customer_auth_session_id,authUserId:g.customer_auth_user_id});return true;}catch{return false;}
 }
 private async revokeCustomerBindings(tenantId:string,scope:{relationshipId?:string;conversationId?:string;meetingId?:string}){
  const sessions=await this.lock(tenantId,async db=>{
   const guests=await db.query<Row>(sql`UPDATE communication_meeting_guests SET state='CANCELLED',revoked_at=coalesce(revoked_at,now()) WHERE tenant_id=${tenantId} AND customer_relationship_id IS NOT NULL ${scope.relationshipId?sql`AND customer_relationship_id=${scope.relationshipId}`:sql``} ${scope.conversationId?sql`AND customer_conversation_id=${scope.conversationId}`:sql``} ${scope.meetingId?sql`AND meeting_id=${scope.meetingId}`:sql``} RETURNING id,meeting_id`);
   const rows:Row[]=[];for(const guest of guests){const m=await this.row(db,guest.meeting_id);const values=await db.query<Row>(sql`UPDATE communication_meeting_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE guest_session_id=${guest.id} RETURNING identity`);rows.push(...values.map(s=>({...s,room:m.provider_room_name})));}return rows;
  });
  for(const s of sessions)await this.provider.removeParticipant(s.room,s.identity);
 }
 async revokeCustomerAccess(tenantId:string,relationshipId:string,conversationId?:string){return this.revokeCustomerBindings(tenantId,{relationshipId,conversationId});}
 async revokeCustomerConversation(tenantId:string,conversationId:string){return this.revokeCustomerBindings(tenantId,{conversationId});}
 async customerGuestSession(actor:CommunicationsActor,meetingId:string,id:string,credential:string,action:'state'|'join'|'leave',requestId?:string){
  if(actor.kind!=='CUSTOMER')throw unavailable();await new CommunicationsAuthorization(this.db).authenticate(actor);
  const [g]=await this.db.query(sql`SELECT id FROM communication_meeting_guests WHERE id=${id} AND meeting_id=${meetingId} AND tenant_id=${actor.tenantId} AND customer_relationship_id=${actor.customerRelationshipId} AND customer_auth_user_id=${actor.authUserId} AND customer_auth_session_id=${actor.sessionId}`);
  if(!g)throw unavailable();if(action==='join')return this.guestJoin(id,credential,uuid.parse(requestId),actor);if(action==='leave')return this.guestLeave(id,credential,actor);return this.guestState(id,credential,actor);
 }
 /** Only called after the native device guard. The verifier never leaves the server;
  * customerGuestSession still checks the exact relationship/provider-session binding. */
 async customerNativeGuestSession(actor:CommunicationsActor,meetingId:string,id:string,action:'state'|'join'|'leave',requestId?:string){
  return this.customerGuestSession(actor,meetingId,id,guestCredential(id),action,requestId);
 }
 private async guest(db:CommunicationsDatabase,id:string,credential:string,customerActor?:CommunicationsActor){
  const [g]=await db.query<Row>(sql`SELECT g.*,i.revoked_at AS invitation_revoked,i.expires_at AS invitation_expires FROM communication_meeting_guests g LEFT JOIN communication_meeting_invitations i ON i.id=g.invitation_id JOIN tenants t ON t.id=g.tenant_id WHERE g.id=${id} AND t.is_active AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED')`);
  if(!g||!sameSecret(credential,g.credential_hash)||!sameSecret(guestCredential(id),g.credential_hash))throw unavailable();
  if(g.customer_relationship_id){if(customerActor?.kind!=='CUSTOMER'||customerActor.tenantId!==g.tenant_id||customerActor.customerRelationshipId!==g.customer_relationship_id||customerActor.authUserId!==g.customer_auth_user_id||customerActor.sessionId!==g.customer_auth_session_id||!await this.customerGuestAllowed(db,g,await this.row(db,g.meeting_id)))throw unavailable();}
  else if(customerActor)throw unavailable();
  return g;
 }
 private guestValid(g:Row,m:Row){return !g.revoked_at&&!g.invitation_revoked&&new Date(g.expires_at).getTime()>Date.now()&&(g.customer_relationship_id?new Date(g.customer_expires_at).getTime()>Date.now():new Date(g.invitation_expires).getTime()>Date.now())&&!terminal.includes(m.status)&&new Date(m.expires_at).getTime()>Date.now();}
 async guestState(id:string,credential:string,customerActor?:CommunicationsActor){const g=await this.guest(this.db,id,credential,customerActor);return this.lock(g.tenant_id,async db=>{
  const m=await this.row(db,g.meeting_id);await this.syncAppointment(db,m);const current=await this.guest(db,id,credential,customerActor),fresh=await this.row(db,m.id);const valid=this.guestValid(current,fresh);
  return {sessionId:id,name:current.name,state:valid?current.state:current.state==='DENIED'?'DENIED':current.revoked_at||current.invitation_revoked||terminal.includes(fresh.status)?'CANCELLED':'EXPIRED',expiresAt:iso(current.expires_at),meeting:valid?await this.publicView(db,fresh):null};
 });}
 private async waitingRows(db:CommunicationsDatabase,m:Row){const rows=await db.query<Row>(sql`SELECT g.*,i.revoked_at AS invitation_revoked,i.expires_at AS invitation_expires FROM communication_meeting_guests g LEFT JOIN communication_meeting_invitations i ON i.id=g.invitation_id WHERE g.meeting_id=${m.id} AND g.revoked_at IS NULL AND g.expires_at>now() ORDER BY g.created_at LIMIT 100`);const result=[];for(const g of rows)if(this.guestValid(g,m)&&await this.customerGuestAllowed(db,g,m))result.push({id:g.id,name:g.name,state:g.state,createdAt:g.created_at,expiresAt:g.expires_at,participantId:g.participant_id,verifiedCustomer:Boolean(g.customer_relationship_id)});return result;}
 async waiting(actor:CommunicationsActor,id:string){return this.lock(actor.tenantId,async db=>{const {m}=await this.access(db,actor,id,true);return {data:await this.waitingRows(db,m)};});}
 async admit(actor:CommunicationsActor,id:string,guestId:string,approve:boolean){return this.lock(actor.tenantId,async db=>{
  const access=await this.access(db,actor,id,true);await this.syncAppointment(db,access.m);const {m}=await this.access(db,actor,id,true);if(terminal.includes(m.status))throw unavailable();
  const [g]=await db.query<Row>(sql`SELECT g.*,i.revoked_at AS invitation_revoked,i.expires_at AS invitation_expires FROM communication_meeting_guests g LEFT JOIN communication_meeting_invitations i ON i.id=g.invitation_id WHERE g.id=${guestId} AND g.meeting_id=${id}`);
  if(g?.state==='DENIED'&&!approve)return {state:'DENIED'};
  if(!g||!this.guestValid(g,m)||!await this.customerGuestAllowed(db,g,m))throw unavailable();if(g.state==='APPROVED'&&approve)return {state:g.state};if(g.state!=='WAITING')throw conflict('ADMISSION_CHANGED','This request was already answered.');
  if(approve){const limits=await meetingLimits(db,m.tenant_id,this.provider.participantLimit);const [count]=await db.query<Row>(sql`SELECT count(*)::int AS n FROM communication_meeting_guests WHERE meeting_id=${id} AND state='APPROVED' AND revoked_at IS NULL AND expires_at>now()`);if(count.n>=limits.externalGuests)throw conflict('GUEST_CAPACITY','The guest admission limit has been reached.');}
  const admittedExpiry=g.customer_relationship_id?new Date(Math.min(new Date(m.expires_at).getTime(),new Date(g.customer_expires_at).getTime())).toISOString():iso(m.expires_at);
  await db.query(sql`UPDATE communication_meeting_guests SET state=${approve?'APPROVED':'DENIED'},admitted_at=${approve?new Date().toISOString():null}::timestamptz,decided_by=${actor.userId},revoked_at=${approve?null:new Date().toISOString()}::timestamptz,expires_at=${approve?admittedExpiry:iso(g.expires_at)}::timestamptz WHERE id=${guestId}`);
  await db.query(sql`UPDATE communication_meeting_participants SET invitation_state=${approve?'ACCEPTED':'DECLINED'},responded_at=now() WHERE id=${g.participant_id}`);
  await this.event(db,m,approve?'guest.admitted':'guest.denied',actor.userId);return {state:approve?'APPROVED':'DENIED'};
 });}
 async guestJoin(id:string,credential:string,requestId:string,customerActor?:CommunicationsActor){uuid.parse(requestId);this.enabled();const g=await this.guest(this.db,id,credential,customerActor);return this.lock(g.tenant_id,async db=>{
  await this.syncAppointment(db,await this.row(db,g.meeting_id));const current=await this.guest(db,id,credential,customerActor),m=await this.row(db,g.meeting_id);if(!this.guestValid(current,m)||current.state!=='APPROVED')throw unavailable();
  const [p]=await db.query<Row>(sql`SELECT * FROM communication_meeting_participants WHERE id=${g.participant_id} AND invitation_state='ACCEPTED'`);if(!p)throw unavailable();
  const joined=await this.issue(db,m,p,requestId,undefined,current),publicMeeting=await this.publicView(db,m);
  return {...joined,meeting:{...publicMeeting,id:m.id,conversationId:null,createdBy:'',organizerName:publicMeeting.hostName,conversationName:m.title,createdAt:iso(m.created_at),startedAt:iso(m.started_at),endedAt:iso(m.ended_at),endReason:m.end_reason,expiresAt:iso(m.expires_at),canManage:false,canJoin:true,participants:[],name:g.name}};
 });}
 async guestLeave(id:string,credential:string,customerActor?:CommunicationsActor){const g=await this.guest(this.db,id,credential,customerActor);const result=await this.lock(g.tenant_id,async db=>{const current=await this.guest(db,id,credential,customerActor);const m=await this.row(db,g.meeting_id);if(current.state==='WAITING'||current.customer_relationship_id)await db.query(sql`UPDATE communication_meeting_guests SET state='CANCELLED',revoked_at=now() WHERE id=${id}`);const sessions=await db.query<Row>(sql`UPDATE communication_meeting_sessions SET revoked_at=coalesce(revoked_at,now()),left_at=CASE WHEN joined_at IS NOT NULL THEN coalesce(left_at,now()) ELSE left_at END WHERE guest_session_id=${id} RETURNING identity`);await this.event(db,m,'guest.left');return {m,sessions};});for(const s of result.sessions)await this.provider.removeParticipant(result.m.provider_room_name,s.identity);return {left:true};}
 private async syncAppointment(db:CommunicationsDatabase,m:Row){
  if(!m.appointment_id||terminal.includes(m.status))return;
  const [a]=await db.query<Row>(sql`SELECT * FROM appointments WHERE id=${m.appointment_id} AND tenant_id=${m.tenant_id} AND client_id=${m.customer_id}`);
  if(!a||['CANCELLED','NO_SHOW'].includes(a.status)){await this.finish(db,m,'CANCELLED','APPOINTMENT_CANCELLED');await this.queueUpdates(db,await this.row(db,m.id),'cancelled');return;}
  if(a.version===m.appointment_version)return;
  const changed=iso(a.start_time)!==iso(m.scheduled_start_at)||iso(a.end_time)!==iso(m.scheduled_end_at)||a.user_id!==m.host_user_id;
  if(changed&&m.status!=='SCHEDULED'){await this.finish(db,m,'CANCELLED','APPOINTMENT_CHANGED');await this.queueUpdates(db,await this.row(db,m.id),'cancelled');return;}
  if(changed){
   await this.invalidateAdmissions(db,m,'CANCELLED');
   await db.query(sql`UPDATE communication_meetings SET scheduled_start_at=${iso(a.start_time)}::timestamptz,scheduled_end_at=${iso(a.end_time)}::timestamptz,host_user_id=${a.user_id},expires_at=${new Date(new Date(a.end_time).getTime()+1800000).toISOString()}::timestamptz,version=version+1,updated_at=now() WHERE id=${m.id}`);
   await db.query(sql`UPDATE communication_meeting_participants SET role='PARTICIPANT',invitation_state='REMOVED' WHERE meeting_id=${m.id} AND role='ORGANIZER'`);
   await db.query(sql`INSERT INTO communication_meeting_participants(meeting_id,tenant_id,user_id,role,invitation_state) VALUES(${m.id},${m.tenant_id},${a.user_id},'ORGANIZER','ACCEPTED') ON CONFLICT(meeting_id,user_id) DO UPDATE SET role='ORGANIZER',invitation_state='ACCEPTED'`);
   const current=await this.row(db,m.id);await this.rotateInvitations(db,current);await this.queueUpdates(db,current,'rescheduled');await this.event(db,m,'meeting.updated');
  }
  await db.query(sql`UPDATE communication_meetings SET appointment_version=${a.version} WHERE id=${m.id}`);
 }
 /** Called by the existing signed-webhook/reconciliation path while it owns the shared locks. */
 async observeSnapshot(db:CommunicationsDatabase,id:string,exists:boolean,observed:{identity:string;sid:string}[]){
  let m=await this.row(db,id);await this.syncAppointment(db,m);m=await this.row(db,id);
  await db.query(sql`UPDATE communication_meeting_guests SET state='EXPIRED',revoked_at=now() WHERE meeting_id=${id} AND state IN ('WAITING','APPROVED') AND revoked_at IS NULL AND expires_at<=now()`);
  if(!terminal.includes(m.status)&&new Date(m.expires_at).getTime()<Date.now()){await this.finish(db,m,m.started_at?'ENDED':'EXPIRED','ACCESS_WINDOW_ENDED');m=await this.row(db,id);}
  if(terminal.includes(m.status)){if(exists)await this.provider.deleteRoom(m.provider_room_name);await db.query(sql`UPDATE communication_meetings SET cleanup_pending=false,last_reconciled_at=now() WHERE id=${id}`);return;}
  if(m.status==='SCHEDULED'){if(exists)await this.provider.deleteRoom(m.provider_room_name);await db.query(sql`UPDATE communication_meetings SET last_reconciled_at=now() WHERE id=${id}`);return;}
  if(m.status==='CREATED'){if(Date.now()-new Date(m.updated_at).getTime()<30000)return;await this.finish(db,m,'FAILED','PROVISIONING_TIMEOUT');if(exists)await this.provider.deleteRoom(m.provider_room_name);return;}
  const active:string[]=[];
  for(const remote of observed){
   const [s]=await db.query<Row>(sql`SELECT s.*,p.invitation_state,p.user_id AS participant_user FROM communication_meeting_sessions s JOIN communication_meeting_participants p ON p.id=s.participant_id WHERE s.meeting_id=${id} AND s.identity=${remote.identity} AND s.revoked_at IS NULL AND p.invitation_state<>'REMOVED' AND (s.joined_at IS NOT NULL OR s.token_expires_at>now()-interval '30 seconds')`);
   let allowed=false;
   if(s?.guest_session_id){const [g]=await db.query<Row>(sql`SELECT g.*,i.revoked_at AS invitation_revoked,i.expires_at AS invitation_expires,t.is_active,t.lifecycle_status FROM communication_meeting_guests g LEFT JOIN communication_meeting_invitations i ON i.id=g.invitation_id JOIN tenants t ON t.id=g.tenant_id WHERE g.id=${s.guest_session_id}`);allowed=Boolean(g&&g.state==='APPROVED'&&g.is_active&&!['SUSPENDED','OFFBOARDING','OFFBOARDED'].includes(g.lifecycle_status)&&this.guestValid(g,m)&&await this.customerGuestAllowed(db,g,m));}
   else if(s){const [u]=await db.query<Row>(sql`SELECT u.auth_user_id FROM users u JOIN application_sessions app ON app.auth_user_id=u.auth_user_id AND app.auth_session_id=${s.auth_session_id} JOIN tenants t ON t.id=u.tenant_id WHERE u.id=${s.user_id} AND u.tenant_id=${m.tenant_id} AND u.account_status='ACTIVE' AND t.is_active AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED') AND app.application_context='TENANT' AND app.selected_tenant_user_id=u.id AND app.security_version=u.security_version AND app.revoked_at IS NULL AND app.expires_at>now() AND (u.sessions_valid_after IS NULL OR u.sessions_valid_after<${iso(s.auth_issued_at)}::timestamptz)`);allowed=Boolean(u);if(u)try{await mobileProviderSessionCurrent(db,{authSessionId:s.auth_session_id,authUserId:u.auth_user_id});}catch{allowed=false;}}
   if(!s||!allowed){await this.provider.removeParticipant(m.provider_room_name,remote.identity);continue;}
   active.push(s.id);if(!s.joined_at||s.left_at||s.provider_sid!==remote.sid){await db.query(sql`UPDATE communication_meeting_sessions SET joined_at=coalesce(joined_at,now()),left_at=NULL,provider_sid=${remote.sid} WHERE id=${s.id}`);await db.query(sql`UPDATE communication_meeting_participants SET joined_at=coalesce(joined_at,now()),left_at=NULL WHERE id=${s.participant_id}`);await this.event(db,m,'meeting.updated');}
  }
  const missing=await db.query<Row>(sql`SELECT id,participant_id FROM communication_meeting_sessions WHERE meeting_id=${id} AND joined_at IS NOT NULL AND left_at IS NULL`);
  for(const s of missing)if(!active.includes(s.id)){await db.query(sql`UPDATE communication_meeting_sessions SET left_at=now() WHERE id=${s.id}`);await db.query(sql`UPDATE communication_meeting_participants SET left_at=now() WHERE id=${s.participant_id} AND NOT EXISTS(SELECT 1 FROM communication_meeting_sessions WHERE participant_id=${s.participant_id} AND left_at IS NULL AND joined_at IS NOT NULL)`);await this.event(db,m,'meeting.updated');}
  if(active.length&&m.status==='RINGING'){await db.query(sql`UPDATE communication_meetings SET status='ACTIVE',started_at=coalesce(started_at,now()) WHERE id=${id}`);await this.event(db,m,'meeting.started');}
  else if(!exists)await this.finish(db,m,m.started_at?'ENDED':'EXPIRED','ROOM_FINISHED');
  await db.query(sql`UPDATE communication_meetings SET last_reconciled_at=now() WHERE id=${id}`);
 }
}
