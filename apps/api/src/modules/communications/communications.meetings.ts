import { randomUUID, createHash } from 'node:crypto';
import { sql } from '@ks-os/database';
import { CommunicationsAuthorization, communicationError, notFound, type CommunicationsActor } from './communications.authorization.js';
import { communicationsDatabase, type CommunicationsDatabase } from './communications.database.js';
import { LiveKitProvider, type MeetingMediaProvider } from './communications.livekit.js';

export interface MeetingParticipantView extends Record<string,unknown> {userId:string;name:string;role:string;invitationState:string;joinedAt:Date|null;leftAt:Date|null;sessionCount:number}
export interface MeetingView {id:string;conversationId:string;createdBy:string;status:string;type:string;title:string;createdAt:Date;startedAt:Date|null;endedAt:Date|null;endReason:string|null;expiresAt:Date;organizerName:string;conversationName:string;canManage:boolean;invitationState?:string;participants:MeetingParticipantView[]}
type Meeting=Record<string,unknown>&{id:string;tenantId:string;conversationId:string;createdBy:string;room:string;status:string;type:string;createdAt:Date;startedAt:Date|null;endedAt:Date|null;expiresAt:Date};
const fields=sql`m.id,m.tenant_id AS "tenantId",m.conversation_id AS "conversationId",m.created_by AS "createdBy",m.provider_room_name AS room,m.status,m.type,m.title,m.created_at AS "createdAt",m.started_at AS "startedAt",m.ended_at AS "endedAt",m.end_reason AS "endReason",m.expires_at AS "expiresAt"`;
const live=['CREATED','RINGING','ACTIVE'];
const unavailable=()=>communicationError(503,'MEDIA_UNAVAILABLE','The calling service is unavailable. Please try again.');
export class CommunicationsMeetings {
 constructor(private db:CommunicationsDatabase=communicationsDatabase(),private provider:MeetingMediaProvider=new LiveKitProvider()){}
 private requireEnabled(){if(!this.provider.enabled)throw communicationError(503,'CALLS_UNAVAILABLE','Calling has not been enabled for this workspace.');}
 private async lock<T>(tenant:string,work:(db:CommunicationsDatabase)=>Promise<T>){return this.db.transaction(async db=>{await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenant},8241))`);return work(db);});}
 private async row(db:CommunicationsDatabase,id:string,tenant?:string){const [m]=await db.query<Meeting>(sql`SELECT ${fields} FROM communication_meetings m WHERE m.id=${id} ${tenant?sql`AND m.tenant_id=${tenant}`:sql``}`);if(!m)throw notFound();return m;}
 private async access(db:CommunicationsDatabase,actor:CommunicationsActor,id:string,manage=false){
  const m=await this.row(db,id,actor.tenantId);const access=await new CommunicationsAuthorization(db).requireConversation(actor,m.conversationId);
  if(manage&&m.createdBy!==actor.userId&&!['OWNER','ADMIN'].includes(access.role))throw communicationError(403,'MEETING_FORBIDDEN','Only the organiser or a conversation manager can do this.');
  return m;
 }
 private async event(db:CommunicationsDatabase,m:Meeting,type:string,recipient?:string){await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,type,resource_id,recipient_user_id) VALUES(${m.tenantId},${m.conversationId},${type},${m.id},${recipient??null})`);}
 private async view(db:CommunicationsDatabase,actor:CommunicationsActor,m:Meeting){
  const [names]=await db.query<Record<string,unknown>&{organizerName:string;conversationName:string;canManage:boolean;invitationState?:string}>(sql`SELECT u.name AS "organizerName",CASE WHEN c.conversation_type='DIRECT' THEN coalesce((SELECT peer.name FROM conversation_members cm JOIN users peer ON peer.id=cm.user_id WHERE cm.conversation_id=c.id AND cm.left_at IS NULL AND cm.user_id<>${actor.userId} LIMIT 1),'Direct conversation') ELSE c.name END AS "conversationName", (m.created_by=${actor.userId} OR cm.role IN ('OWNER','ADMIN')) AS "canManage",p.invitation_state AS "invitationState"
   FROM communication_meetings m JOIN conversations c ON c.id=m.conversation_id JOIN users u ON u.id=m.created_by
   JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=${actor.userId} AND cm.left_at IS NULL
   LEFT JOIN communication_meeting_participants p ON p.meeting_id=m.id AND p.user_id=${actor.userId} WHERE m.id=${m.id}`);
  const participants=await db.query<MeetingParticipantView>(sql`SELECT p.user_id AS "userId",u.name,p.role,p.invitation_state AS "invitationState",p.joined_at AS "joinedAt",p.left_at AS "leftAt",
   (SELECT count(*)::int FROM communication_meeting_sessions s WHERE s.meeting_id=p.meeting_id AND s.user_id=p.user_id AND s.joined_at IS NOT NULL AND s.left_at IS NULL AND s.revoked_at IS NULL) AS "sessionCount"
   FROM communication_meeting_participants p JOIN users u ON u.id=p.user_id WHERE p.meeting_id=${m.id} ORDER BY p.invited_at,p.user_id LIMIT 200`);
  return {id:m.id,conversationId:m.conversationId,createdBy:m.createdBy,status:m.status,type:m.type,title:String(m.title),createdAt:m.createdAt,startedAt:m.startedAt,endedAt:m.endedAt,endReason:m.endReason as string|null,expiresAt:m.expiresAt,...names,participants} satisfies MeetingView;
 }
 async config(actor:CommunicationsActor){await new CommunicationsAuthorization(this.db).authenticate(actor);return {enabled:this.provider.enabled,participantLimit:this.provider.participantLimit,tokenTtlSeconds:this.provider.tokenTtlSeconds};}
 async get(actor:CommunicationsActor,id:string){return this.lock(actor.tenantId,async db=>this.view(db,actor,await this.access(db,actor,id)));}
 async history(actor:CommunicationsActor,id:string,before?:string){
  return this.lock(actor.tenantId,async db=>{await new CommunicationsAuthorization(db).requireConversation(actor,id);
   const rows=await db.query<Meeting>(sql`SELECT ${fields} FROM communication_meetings m WHERE m.tenant_id=${actor.tenantId} AND m.conversation_id=${id}
    ${before?sql`AND (m.created_at,m.id)<(SELECT created_at,id FROM communication_meetings WHERE id=${before} AND tenant_id=${actor.tenantId} AND conversation_id=${id})`:sql``} ORDER BY m.created_at DESC,m.id DESC LIMIT 21`);
   return {data:await Promise.all(rows.slice(0,20).map(m=>this.view(db,actor,m))),nextCursor:rows.length>20?rows[19].id:null};
  });
 }
 async incoming(actor:CommunicationsActor){
  return this.lock(actor.tenantId,async db=>{await new CommunicationsAuthorization(db).authenticate(actor);
   const rows=await db.query<Meeting>(sql`SELECT ${fields} FROM communication_meetings m
    JOIN communication_meeting_participants p ON p.meeting_id=m.id AND p.user_id=${actor.userId} AND p.invitation_state='INVITED'
    JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=p.user_id AND cm.left_at IS NULL
    JOIN conversations c ON c.id=m.conversation_id LEFT JOIN communication_preferences pref ON pref.user_id=p.user_id AND pref.tenant_id=m.tenant_id
    WHERE m.tenant_id=${actor.tenantId} AND m.status IN ('RINGING','ACTIVE') AND m.expires_at>now() AND cm.notification_preference='ALL'
     AND NOT coalesce(pref.dnd,false) AND (coalesce(pref.in_app,true) OR coalesce(pref.browser,false)) AND (c.conversation_type<>'DIRECT' OR coalesce(pref.direct_messages,true))
    ORDER BY m.created_at DESC LIMIT 10`);
   return {data:await Promise.all(rows.map(m=>this.view(db,actor,m)))};
  });
 }
 async create(actor:CommunicationsActor,conversationId:string,input:{type:'AUDIO'|'VIDEO';requestId:string}){
  this.requireEnabled();
  const created=await this.lock(actor.tenantId,async db=>{
   const access=await new CommunicationsAuthorization(db).requireConversation(actor,conversationId,'post');
   if(!['CHANNEL','PRIVATE_CHANNEL','DIRECT','GROUP_DIRECT'].includes(access.type))throw notFound();
   const [retry]=await db.query<Meeting>(sql`SELECT ${fields} FROM communication_meetings m WHERE m.tenant_id=${actor.tenantId} AND m.created_by=${actor.userId} AND m.request_id=${input.requestId}`);
   if(retry){if(retry.conversationId!==conversationId||retry.type!==input.type)throw communicationError(409,'RETRY_CONFLICT','This retry belongs to another call.');return {meeting:retry,fresh:false};}
   const [existing]=await db.query<Meeting>(sql`SELECT ${fields} FROM communication_meetings m WHERE m.tenant_id=${actor.tenantId} AND m.conversation_id=${conversationId} AND m.status IN ('CREATED','RINGING','ACTIVE')`);
   if(existing)return {meeting:existing,fresh:false};
   const [count]=await db.query<{recent:number;hour:number}>(sql`SELECT count(*) FILTER(WHERE created_at>now()-interval '1 minute')::int AS recent,count(*)::int AS hour FROM communication_meetings WHERE tenant_id=${actor.tenantId} AND created_by=${actor.userId} AND created_at>now()-interval '1 hour'`);
   if(count.recent>=3||count.hour>=10)throw communicationError(429,'CALL_RATE_LIMIT','Too many call invitations. Please wait before trying again.');
   const id=randomUUID(),room='ksos-'+randomUUID();
   const [m]=await db.query<Meeting>(sql`INSERT INTO communication_meetings(id,tenant_id,conversation_id,created_by,request_id,title,type,provider_room_name)
     VALUES(${id},${actor.tenantId},${conversationId},${actor.userId},${input.requestId},${input.type==='AUDIO'?'Voice call':'Video meeting'},${input.type},${room}) RETURNING id`);
   const meeting=await this.row(db,m.id);
   await db.query(sql`INSERT INTO communication_meeting_participants(meeting_id,tenant_id,user_id,role,invitation_state)
    SELECT ${id},${actor.tenantId},cm.user_id,CASE WHEN cm.user_id=${actor.userId} THEN 'ORGANIZER' ELSE 'PARTICIPANT' END,CASE WHEN cm.user_id=${actor.userId} THEN 'ACCEPTED' ELSE 'INVITED' END
    FROM conversation_members cm JOIN users u ON u.id=cm.user_id AND u.account_status='ACTIVE' WHERE cm.conversation_id=${conversationId} AND cm.tenant_id=${actor.tenantId} AND cm.left_at IS NULL ORDER BY (cm.user_id=${actor.userId}) DESC,cm.joined_at LIMIT 200`);
   await this.event(db,meeting,'call.created');return {meeting,fresh:true};
  });
  if(created.fresh){
   try{await this.provider.createRoom(created.meeting.room);}
   catch{await this.lock(actor.tenantId,async db=>{const m=await this.row(db,created.meeting.id);await this.finish(db,m,'FAILED','PROVIDER_UNAVAILABLE');});throw unavailable();}
   await this.lock(actor.tenantId,async db=>{
    const m=await this.row(db,created.meeting.id);
    if(m.status!=='CREATED'){await this.provider.deleteRoom(m.room);return;}
    await db.query(sql`UPDATE communication_meetings SET status='RINGING' WHERE id=${m.id}`);
    await this.event(db,m,'call.invited');
   });
  }
  return this.get(actor,created.meeting.id);
 }
 private async finish(db:CommunicationsDatabase,m:Meeting,status:'ENDED'|'CANCELLED'|'FAILED',reason:string){
  if(!live.includes(m.status))return;
  await db.query(sql`UPDATE communication_meetings SET status=${status},ended_at=now(),end_reason=${reason},cleanup_pending=true WHERE id=${m.id}`);
  await db.query(sql`UPDATE communication_meeting_sessions SET revoked_at=coalesce(revoked_at,now()),left_at=CASE WHEN joined_at IS NOT NULL THEN coalesce(left_at,now()) ELSE left_at END WHERE meeting_id=${m.id}`);
  await db.query(sql`UPDATE communication_meeting_participants SET left_at=coalesce(left_at,now()) WHERE meeting_id=${m.id} AND joined_at IS NOT NULL`);
  await this.event(db,m,status==='ENDED'?'call.ended':status==='FAILED'?'call.failed':'call.cancelled');
 }
 async respond(actor:CommunicationsActor,id:string,accept:boolean){
  return this.lock(actor.tenantId,async db=>{
   const m=await this.access(db,actor,id);
   if(!['RINGING','ACTIVE'].includes(m.status)||new Date(m.expiresAt).getTime()<=Date.now())throw communicationError(409,'INVITATION_EXPIRED','This call invitation has ended.');
   const [p]=await db.query<{state:string}>(sql`SELECT invitation_state AS state FROM communication_meeting_participants WHERE meeting_id=${id} AND user_id=${actor.userId}`);
   if(!p||p.state==='REMOVED')throw notFound();
   if(p.state===(accept?'ACCEPTED':'DECLINED'))return this.view(db,actor,m);
   if(p.state!=='INVITED')throw communicationError(409,'INVITATION_ANSWERED','This invitation was already answered on another device.');
   await db.query(sql`UPDATE communication_meeting_participants SET invitation_state=${accept?'ACCEPTED':'DECLINED'},responded_at=now() WHERE meeting_id=${id} AND user_id=${actor.userId}`);
   await this.event(db,m,accept?'call.accepted':'call.declined');
   const [c]=await db.query<{type:string}>(sql`SELECT conversation_type AS type FROM conversations WHERE id=${m.conversationId}`);
   if(!accept&&c.type==='DIRECT')await this.finish(db,m,'CANCELLED','DECLINED');
   return this.view(db,actor,await this.row(db,id));
  });
 }
 async join(actor:CommunicationsActor,id:string,requestId:string){
  this.requireEnabled();
  return this.lock(actor.tenantId,async db=>{
   const m=await this.access(db,actor,id);await new CommunicationsAuthorization(db).requireConversation(actor,m.conversationId,'post');
   if(!['RINGING','ACTIVE'].includes(m.status)||m.status==='RINGING'&&new Date(m.expiresAt).getTime()<=Date.now())throw communicationError(409,'CALL_ENDED','This call is no longer joinable.');
   const [existingParticipant]=await db.query<{state:string}>(sql`SELECT invitation_state AS state FROM communication_meeting_participants WHERE meeting_id=${id} AND user_id=${actor.userId}`);
   if(existingParticipant?.state==='REMOVED')throw communicationError(403,'CALL_REMOVED','You were removed from this call.');
   const [name]=await db.query<{name:string}>(sql`SELECT name FROM users WHERE id=${actor.userId}`);
   let [session]=await db.query<{id:string;identity:string;revokedAt:Date|null;leftAt:Date|null;expiresAt:Date}>(sql`SELECT id,identity,revoked_at AS "revokedAt",left_at AS "leftAt",token_expires_at AS "expiresAt" FROM communication_meeting_sessions WHERE meeting_id=${id} AND user_id=${actor.userId} AND auth_session_id=${actor.sessionId} AND request_id=${requestId}`);
   if(session&&(session.revokedAt||session.leftAt||new Date(session.expiresAt).getTime()<=Date.now()))throw communicationError(409,'JOIN_RETRY_EXPIRED','Start a new join attempt.');
   if(!session){
    const [rate]=await db.query<{recent:number;devices:number;capacity:number}>(sql`SELECT count(*) FILTER(WHERE user_id=${actor.userId} AND created_at>now()-interval '1 minute')::int AS recent,
     count(*) FILTER(WHERE user_id=${actor.userId} AND meeting_id=${id} AND revoked_at IS NULL AND left_at IS NULL AND (joined_at IS NOT NULL OR token_expires_at>now()))::int AS devices,
     count(*) FILTER(WHERE meeting_id=${id} AND revoked_at IS NULL AND left_at IS NULL AND (joined_at IS NOT NULL OR token_expires_at>now()))::int AS capacity
     FROM communication_meeting_sessions WHERE tenant_id=${actor.tenantId}`);
    if(rate.recent>=10)throw communicationError(429,'TOKEN_RATE_LIMIT','Please wait before requesting another call connection.');
    if(rate.devices>=2||rate.capacity>=this.provider.participantLimit)throw communicationError(409,'CALL_CAPACITY','This call has reached its connection limit. Leave another device or try later.');
    await db.query(sql`INSERT INTO communication_meeting_participants(meeting_id,tenant_id,user_id,role,invitation_state) VALUES(${id},${actor.tenantId},${actor.userId},'PARTICIPANT','ACCEPTED') ON CONFLICT(meeting_id,user_id) DO UPDATE SET invitation_state='ACCEPTED',responded_at=now()`);
    const sessionId=randomUUID(),identity='ksos_'+sessionId,expiry=new Date(Date.now()+this.provider.tokenTtlSeconds*1000).toISOString();
    await db.query(sql`INSERT INTO communication_meeting_sessions(id,tenant_id,meeting_id,participant_id,user_id,auth_session_id,auth_issued_at,request_id,identity,token_expires_at)
      VALUES(${sessionId},${actor.tenantId},${id},(SELECT id FROM communication_meeting_participants WHERE meeting_id=${id} AND user_id=${actor.userId}),${actor.userId},${actor.sessionId},${actor.issuedAt}::timestamptz,${requestId},${identity},${expiry}::timestamptz)`);
    session={id:sessionId,identity,revokedAt:null,leftAt:null,expiresAt:new Date(expiry)};
   }
   const [issuance]=await db.query<{count:number}>(sql`SELECT coalesce(sum(token_count),0)::int AS count FROM communication_meeting_sessions WHERE tenant_id=${actor.tenantId} AND user_id=${actor.userId} AND token_issued_at>now()-interval '1 minute'`);
   if(issuance.count>=12)throw communicationError(429,'TOKEN_RATE_LIMIT','Please wait before requesting another call connection.');
   await db.query(sql`UPDATE communication_meeting_sessions SET token_count=CASE WHEN token_issued_at>now()-interval '1 minute' THEN token_count+1 ELSE 1 END,token_issued_at=now(),token_expires_at=${new Date(Date.now()+this.provider.tokenTtlSeconds*1000).toISOString()}::timestamptz WHERE id=${session.id}`);
   let token:string;try{token=await this.provider.token(m.room,session.identity,name.name);}catch{throw unavailable();}
   return {token,url:this.provider.url,identity:session.identity,sessionId:session.id,expiresIn:this.provider.tokenTtlSeconds,meeting:await this.view(db,actor,m)};
  });
 }
 async leave(actor:CommunicationsActor,id:string,sessionId:string){
  const result=await this.lock(actor.tenantId,async db=>{
   const m=await this.access(db,actor,id);
   const [s]=await db.query<{identity:string}>(sql`UPDATE communication_meeting_sessions SET revoked_at=coalesce(revoked_at,now()),left_at=CASE WHEN joined_at IS NOT NULL THEN coalesce(left_at,now()) ELSE left_at END
     WHERE id=${sessionId} AND meeting_id=${id} AND user_id=${actor.userId} AND auth_session_id=${actor.sessionId} RETURNING identity`);
   if(!s)throw notFound();await this.event(db,m,'call.participant_left');return {m,identity:s.identity};
  });
  try{await this.provider.removeParticipant(result.m.room,result.identity);}catch{throw unavailable();}
  return {left:true};
 }
 async end(actor:CommunicationsActor,id:string){
  const m=await this.lock(actor.tenantId,async db=>{const m=await this.access(db,actor,id,true);await this.finish(db,m,m.startedAt?'ENDED':'CANCELLED',m.startedAt?'ORGANIZER_ENDED':'CALLER_CANCELLED');return m;});
  try{await this.provider.deleteRoom(m.room);await this.db.query(sql`UPDATE communication_meetings SET cleanup_pending=false WHERE id=${id}`);}catch{throw unavailable();}
  return this.get(actor,id);
 }
 async remove(actor:CommunicationsActor,id:string,userId:string){
  const m=await this.lock(actor.tenantId,async db=>{
   const m=await this.access(db,actor,id,true);if(userId===m.createdBy)throw communicationError(403,'ORGANIZER_REQUIRED','The organiser cannot be removed. End the meeting instead.');
   const rows=await db.query(sql`UPDATE communication_meeting_participants SET invitation_state='REMOVED',left_at=CASE WHEN joined_at IS NOT NULL THEN now() ELSE left_at END WHERE meeting_id=${id} AND user_id=${userId} RETURNING user_id`);
   if(!rows.length)throw notFound();await db.query(sql`UPDATE communication_meeting_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE meeting_id=${id} AND user_id=${userId}`);await this.event(db,m,'call.participant_left');return m;
  });await this.evict(m,userId);return this.get(actor,id);
 }
 private async evict(m:Meeting,userId:string){const rows=await this.db.query<{identity:string}>(sql`SELECT identity FROM communication_meeting_sessions WHERE meeting_id=${m.id} AND user_id=${userId}`);
  for(const row of rows)try{await this.provider.removeParticipant(m.room,row.identity);}catch{throw unavailable();}
 }
 async revokeConversationMember(tenantId:string,conversationId:string,userId:string){
  if(!this.provider.enabled)return;
  const rows=await this.lock(tenantId,async db=>{
   const rows=await db.query<Meeting>(sql`SELECT ${fields} FROM communication_meetings m WHERE m.tenant_id=${tenantId} AND m.conversation_id=${conversationId} AND m.status IN ('CREATED','RINGING','ACTIVE')`);
   for(const m of rows){await db.query(sql`UPDATE communication_meeting_participants SET invitation_state='REMOVED' WHERE meeting_id=${m.id} AND user_id=${userId}`);await db.query(sql`UPDATE communication_meeting_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE meeting_id=${m.id} AND user_id=${userId}`);await this.event(db,m,'call.participant_left');}return rows;
  });
  for(const m of rows)await this.evict(m,userId);
 }
 private async sessionAllowed(db:CommunicationsDatabase,m:Meeting,identity:string){
  const [session]=await db.query<Record<string,unknown>&{id:string;userId:string;joinedAt:Date|null;leftAt:Date|null;sid:string|null}>(sql`SELECT s.id,s.user_id AS "userId",s.joined_at AS "joinedAt",s.left_at AS "leftAt",s.provider_sid AS sid
   FROM communication_meeting_sessions s JOIN communication_meeting_participants p ON p.meeting_id=s.meeting_id AND p.user_id=s.user_id AND p.invitation_state<>'REMOVED'
   JOIN conversation_members cm ON cm.conversation_id=${m.conversationId} AND cm.tenant_id=s.tenant_id AND cm.user_id=s.user_id AND cm.left_at IS NULL
   JOIN conversations c ON c.id=cm.conversation_id AND c.archived_at IS NULL
   JOIN users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id AND u.account_status='ACTIVE'
   JOIN tenants t ON t.id=u.tenant_id AND t.is_active=true AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED')
   JOIN application_sessions app ON app.auth_session_id=s.auth_session_id AND app.auth_user_id=u.auth_user_id AND app.selected_tenant_user_id=u.id AND app.application_context='TENANT' AND app.security_version=u.security_version AND app.revoked_at IS NULL AND app.expires_at>now()
   WHERE s.meeting_id=${m.id} AND s.identity=${identity} AND s.revoked_at IS NULL
    AND (u.sessions_valid_after IS NULL OR u.sessions_valid_after<s.auth_issued_at)
    AND (s.joined_at IS NOT NULL OR s.token_expires_at>now()-interval '30 seconds')`);
  return session;
 }
 private async observe(db:CommunicationsDatabase,m:Meeting,roomExists:boolean,participants:{identity:string;sid:string}[]){
  if(!live.includes(m.status)){
   if(roomExists)await this.provider.deleteRoom(m.room);
   await db.query(sql`UPDATE communication_meetings SET cleanup_pending=false,last_reconciled_at=now() WHERE id=${m.id}`);return;
  }
  if(m.status==='CREATED'&&Date.now()-new Date(m.createdAt).getTime()<30000)return;
  if(m.status==='CREATED'){await this.finish(db,m,'FAILED','PROVISIONING_TIMEOUT');if(roomExists)await this.provider.deleteRoom(m.room);return;}
  const [direct]=await db.query<{type:string;answered:boolean}>(sql`SELECT c.conversation_type AS type,EXISTS(SELECT 1 FROM communication_meeting_participants p WHERE p.meeting_id=${m.id} AND p.user_id<>${m.createdBy} AND p.invitation_state='ACCEPTED') AS answered FROM conversations c WHERE c.id=${m.conversationId}`);
  if(direct.type==='DIRECT'&&!direct.answered&&new Date(m.expiresAt).getTime()<Date.now()){
   await this.finish(db,m,'CANCELLED','UNANSWERED');if(roomExists)await this.provider.deleteRoom(m.room);return;
  }
  const identities:string[]=[];
  for(const p of participants){
   const s=await this.sessionAllowed(db,m,p.identity);
   if(!s){await this.provider.removeParticipant(m.room,p.identity);continue;}
   identities.push(p.identity);
   if(!s.joinedAt||s.leftAt||s.sid!==p.sid){
    await db.query(sql`UPDATE communication_meeting_sessions SET joined_at=coalesce(joined_at,now()),left_at=NULL,provider_sid=${p.sid} WHERE id=${s.id}`);
    await db.query(sql`UPDATE communication_meeting_participants SET joined_at=coalesce(joined_at,now()),left_at=NULL,invitation_state='ACCEPTED' WHERE meeting_id=${m.id} AND user_id=${s.userId}`);
    await this.event(db,m,'call.participant_joined');
   }
  }
  const active=await db.query<{id:string;identity:string;userId:string}>(sql`SELECT id,identity,user_id AS "userId" FROM communication_meeting_sessions WHERE meeting_id=${m.id} AND joined_at IS NOT NULL AND left_at IS NULL`);
  for(const s of active)if(!identities.includes(s.identity)){
   await db.query(sql`UPDATE communication_meeting_sessions SET left_at=now() WHERE id=${s.id}`);
   await db.query(sql`UPDATE communication_meeting_participants SET left_at=now() WHERE meeting_id=${m.id} AND user_id=${s.userId} AND NOT EXISTS(SELECT 1 FROM communication_meeting_sessions WHERE meeting_id=${m.id} AND user_id=${s.userId} AND joined_at IS NOT NULL AND left_at IS NULL)`);
   await this.event(db,m,'call.participant_left');
  }
  if(identities.length&&m.status==='RINGING'){
   await db.query(sql`UPDATE communication_meetings SET status='ACTIVE',started_at=coalesce(started_at,now()) WHERE id=${m.id}`);await this.event(db,m,'call.started');
  }else if(!roomExists){await this.finish(db,m,m.startedAt?'ENDED':'CANCELLED',m.startedAt?'ROOM_FINISHED':'UNANSWERED');}
  else if(!identities.length&&!m.startedAt&&new Date(m.expiresAt).getTime()<Date.now()){await this.finish(db,m,'CANCELLED','UNANSWERED');await this.provider.deleteRoom(m.room);}
  await db.query(sql`UPDATE communication_meetings SET last_reconciled_at=now() WHERE id=${m.id}`);
 }
 async webhook(raw:string,authorization:string){
  this.requireEnabled();const event=await this.provider.verify(raw,authorization);
  if(!event.id||event.id.length>200||!event.room?.name)return {accepted:true};
  const hash=createHash('sha256').update(raw).digest('hex');
  const [m]=await this.db.query<Meeting>(sql`SELECT ${fields} FROM communication_meetings m WHERE m.provider_room_name=${event.room.name}`);
  if(!m)return {accepted:true};
  return this.lock(m.tenantId,async db=>{
   const [seen]=await db.query<{hash:string}>(sql`SELECT body_hash AS hash FROM communication_meeting_webhooks WHERE id=${event.id!}`);
   if(seen){if(seen.hash!==hash)throw communicationError(409,'WEBHOOK_CONFLICT','Conflicting media notification');return {accepted:true,duplicate:true};}
   // Observe current server state, so a delayed old leave/finish cannot undo a reconnect.
   const rooms=await this.provider.rooms(),exists=rooms.some(r=>r.name===m.room);
   const participants=exists?await this.provider.participants(m.room):[];
   await this.observe(db,await this.row(db,m.id),exists,participants);
   await db.query(sql`INSERT INTO communication_meeting_webhooks(id,body_hash) VALUES(${event.id!},${hash})`);
   return {accepted:true};
  });
 }
 async reconcile(limit=50){
  if(!this.provider.enabled)return {checked:0};
  const rooms=await this.provider.rooms();
  const pending=await this.db.query<Meeting>(sql`SELECT ${fields} FROM communication_meetings m WHERE m.status IN ('CREATED','RINGING','ACTIVE') OR m.cleanup_pending ORDER BY m.last_reconciled_at NULLS FIRST,m.created_at LIMIT ${Math.max(1,Math.min(100,limit))}`);
  // Include resurrected terminal rooms. room.auto_create=false is still REQUIRED in deployment config.
  for(const room of rooms.filter(r=>r.name.startsWith('ksos-')).slice(0,100)){
   if(pending.some(m=>m.room===room.name))continue;
   const [m]=await this.db.query<Meeting>(sql`SELECT ${fields} FROM communication_meetings m WHERE m.provider_room_name=${room.name}`);
   if(m)pending.push(m);
  }
  for(const m of pending)await this.lock(m.tenantId,async db=>{
   const currentRooms=await this.provider.rooms();
   const exists=currentRooms.some(r=>r.name===m.room),participants=exists?await this.provider.participants(m.room):[];
   await this.observe(db,await this.row(db,m.id),exists,participants);
  });
  await this.db.query(sql`DELETE FROM communication_meeting_webhooks WHERE processed_at<now()-interval '7 days'`);
  return {checked:pending.length};
 }
}
