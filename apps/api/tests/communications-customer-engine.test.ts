import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { NativeConversationSchema, NativeMessageSchema } from '@ks-os/contracts';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { communicationsRoutes } from '../src/modules/communications/communications.routes.js';
import type { CommunicationsActor } from '../src/modules/communications/communications.authorization.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';

test('customer principals use the shared messaging engine with tenant and customer isolation', {timeout:300000}, async t=>{
 const f=await createClientMeetingFixture(t),{pg,db,owner,other,customer,otherCustomer}=f;
 const files=new Map<string,Buffer>(); let afterDownload:(()=>Promise<void>)|undefined;
 const service=new CommunicationsService(db,{storage:{put:async(k,b)=>{files.set(k,b);},get:async k=>{const bytes=files.get(k)!;await afterDownload?.();return bytes;},remove:async keys=>{for(const key of keys)files.delete(key);}}});
 const makeCustomer=async(staff:CommunicationsActor,clientId:string,name:string,accountId?:string)=>{
  const account=accountId??randomUUID(),auth=accountId?(await pg.query<{auth_user_id:string}>('SELECT auth_user_id FROM customer_accounts WHERE id=$1',[account])).rows[0].auth_user_id:randomUUID();
  const actor:CommunicationsActor={tenantId:staff.tenantId,userId:randomUUID(),authUserId:auth,sessionId:randomUUID(),issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),kind:'CUSTOMER',customerAccountId:account}; actor.customerRelationshipId=actor.userId;
  await pg.query('INSERT INTO auth.users(id,email_confirmed_at,is_anonymous) VALUES($1,now(),false) ON CONFLICT DO NOTHING',[auth]);
  await pg.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[actor.sessionId,auth]);
  await pg.query("INSERT INTO customer_accounts(id,auth_user_id,email_normalized,display_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[account,auth,`${auth}@example.test`,name]);
  await pg.query("INSERT INTO application_sessions(auth_session_id,auth_user_id,application_context,expires_at) VALUES($1,$2,'CUSTOMER',$3)",[actor.sessionId,auth,actor.expiresAt]);
  await pg.query('INSERT INTO customer_collaboration_relationships(id,tenant_id,client_id,customer_account_id,created_by) VALUES($1,$2,$3,$4,$5)',[actor.userId,staff.tenantId,clientId,account,staff.userId]);
  return actor;
 };
 const createChannel=async(staff:CommunicationsActor,clientId:string,actors:CommunicationsActor[],name='Shared correspondence')=>{
  const id=randomUUID();
  await pg.query("INSERT INTO conversations(id,tenant_id,client_id,primary_channel,customer_display_name,access_mode,conversation_type,name,created_by_user_id,external_client_channel) VALUES($1,$2,$3,'NATIVE',$4,'MEMBERS','CLIENT',$4,$5,true)",[id,staff.tenantId,clientId,name,staff.userId]);
  await pg.query("INSERT INTO conversation_members(tenant_id,conversation_id,user_id,role) VALUES($1,$2,$3,'OWNER')",[staff.tenantId,id,staff.userId]);
  for(const actor of actors)await pg.query("INSERT INTO conversation_members(tenant_id,conversation_id,customer_relationship_id,role) VALUES($1,$2,$3,'EXTERNAL')",[staff.tenantId,id,actor.userId]);
  return id;
 };
 const secondClient=randomUUID();await pg.query('INSERT INTO clients(id,tenant_id,name) VALUES($1,$2,$3)',[secondClient,owner.tenantId,'Other private customer']);
 const alice=await makeCustomer(owner,customer.id,'Alice'),colleague=await makeCustomer(owner,customer.id,'Chris'),bob=await makeCustomer(owner,secondClient,'Bob');
 const aliceOther=await makeCustomer(other,otherCustomer.id,'Alice',alice.customerAccountId);
 const shared=await createChannel(owner,customer.id,[alice,colleague]),privateBob=await createChannel(owner,secondClient,[bob]),otherChannel=await createChannel(other,otherCustomer.id,[aliceOther]);
 const internal=await service.create(owner,{type:'PRIVATE_CHANNEL',name:'Internal private',memberUserIds:[]});
 const id=String(shared),internalId=String(internal.id);
 const denied=async(work:Promise<unknown>)=>assert.rejects(work,(e:unknown)=>[401,403,404].includes((e as {statusCode:number}).statusCode));
 let messageId='',replyId='',fileId='';

 await t.test('explicit relationships expose only their own new external channels',async()=>{
  const page=await service.list(alice,{limit:30});assert.deepEqual(page.data.map(x=>x.id),[id]);
  const view=NativeConversationSchema.parse(JSON.parse(JSON.stringify(await service.get(alice,id))));assert.equal(view.externalClientChannel,true);assert.equal(view.clientId,customer.id);
  await denied(service.get(alice,privateBob));await denied(service.get(alice,otherChannel));await denied(service.get(alice,internalId));
  await denied(service.get({...alice,tenantId:other.tenantId},otherChannel));await denied(service.get({...alice,userId:bob.userId},privateBob));
  assert.equal((await service.get(aliceOther,otherChannel)).id,otherChannel);
  assert.equal((await pg.query('SELECT * FROM customer_client_links')).rows.length,0);
 });
 await t.test('external identities cannot use staff discovery, channel creation or membership management',async()=>{
  await denied(service.discover(alice,{limit:30}));await denied(service.people(alice,null,{limit:30}));
  await denied(service.people(alice,id,{limit:30},true));await denied(service.join(alice,internalId));
  await denied(service.create(alice,{type:'CHANNEL',name:'Forbidden',memberUserIds:[]}));
  await denied(service.addMember(alice,id,{userId:f.outsider.userId,role:'MEMBER'}));await denied(service.archive(alice,id));
  const members=await service.people(alice,id,{limit:30});assert.deepEqual(new Set(members.data.map(m=>m.userId)),new Set([owner.userId,alice.userId,colleague.userId]));
 });
 await t.test('messages derive customer authorship, deduplicate retries and prevent impersonation',async()=>{
  const input={body:'Private tax correspondence',clientMessageId:randomUUID()};
  const first=NativeMessageSchema.parse(JSON.parse(JSON.stringify(await service.post(alice,id,input))));messageId=first.id;assert.equal(first.senderId,alice.userId);assert.equal(first.senderName,'Alice');
  assert.equal((await service.post(alice,id,input)).id,first.id);
  await assert.rejects(service.post(alice,id,{...input,body:'Changed retry'}),{code:'RETRY_CONFLICT'});
  const row=(await pg.query('SELECT sender_user_id,sender_customer_relationship_id,sender_type FROM conversation_messages WHERE id=$1',[first.id])).rows[0];assert.equal(row.sender_user_id,null);assert.equal(row.sender_type,'CUSTOMER');assert.equal(row.sender_customer_relationship_id,alice.userId);
  await denied(service.post(bob,id,{body:'Injection'}));await denied(service.post(alice,internalId,{body:'Injection'}));
  await denied(service.editMessage(colleague,id,first.id,{body:'Impersonation'}));
  const edited=await service.editMessage(alice,id,first.id,{body:'Private tax correspondence updated'});assert.equal(edited.body,'Private tax correspondence updated');
 });
 await t.test('shared threads, mentions, reactions, read cursors and pagination support both principals',async()=>{
  const reply=await service.post(owner,id,{body:'@Alice please review',parentMessageId:messageId,mentions:[{userId:alice.userId,start:0,end:6}]});replyId=reply.id;
  assert.equal((await service.messages(alice,id,{limit:1,parentMessageId:messageId})).data[0].id,reply.id);
  const reacted=await service.reaction(alice,id,reply.id,{emoji:'👍',active:true});assert.equal(reacted.reactions[0].mine,true);
  assert.equal((await service.reaction(owner,id,reply.id,{emoji:'👍',active:true})).reactions[0].count,2);
  await service.read(alice,id,reply.id);assert.equal(Number((await service.get(alice,id)).unreadCount),0);
  const page=await service.messages(alice,id,{limit:1});assert.equal(page.data[0].id,messageId);
  const scope=await service.liveScope(alice,id,[bob.userId,other.userId]);assert.ok(scope.readers.some(m=>m.userId===alice.userId));assert.ok(!scope.visible.some(m=>m.userId===bob.userId));
  assert.deepEqual(await service.liveScope(alice,null,[bob.userId,owner.userId]),{readers:[],visible:[]});await service.authorizeTyping(alice,id);
 });
 await t.test('search and persistent notifications are scoped to current customer membership',async()=>{
  await service.post(bob,privateBob,{body:'Private tax correspondence for Bob'});
  const result=await service.discovery.search(alice,{q:'tax',limit:30});assert.ok(result.data.length);assert.ok(result.data.every(m=>m.conversationId===id));
  assert.equal((await service.discovery.search(alice,{q:'tax',conversationId:privateBob,limit:30})).data.length,0);
  const notice=(await service.discovery.notifications(alice)).data[0];assert.ok(notice);await service.discovery.readNotification(alice,notice.id);await denied(service.discovery.readNotification(bob,notice.id));
  await service.discovery.preferences(alice,{browser:false,inApp:true,sound:false,dnd:true,directMessages:false});assert.equal((await service.discovery.preferences(alice)).dnd,true);assert.equal((await service.discovery.preferences(colleague)).dnd,false);
  await service.discovery.conversationPreference(alice,id,'NONE');const before=(await service.discovery.notifications(alice)).data.length;await service.post(owner,id,{body:'Muted update'});assert.equal((await service.discovery.notifications(alice)).data.length,before);
 });
 await t.test('attachments retain uploader identity and reject unrelated sharing and post-storage revocation',async()=>{
  const bytes=Buffer.from('Customer document');const file=await service.attachments.reserve(alice,id,{name:'document.txt',size:bytes.length});fileId=String(file.id);
  await service.attachments.upload(alice,id,fileId,bytes);
  await assert.rejects(service.post(colleague,id,{body:'Steal staged file',attachmentIds:[fileId]}),{code:'ATTACHMENT_UNAVAILABLE'});
  await service.post(alice,id,{body:'Shared document',attachmentIds:[fileId]});assert.equal((await service.attachments.download(owner,id,fileId)).bytes.toString(),bytes.toString());
  await denied(service.attachments.download(bob,id,fileId));await denied(service.attachments.download(alice,privateBob,fileId));
  const listed=await service.attachments.files(alice,id,{limit:1});assert.equal(listed.data[0].uploaderName,'Alice');
  await assert.rejects(service.attachments.reserve(alice,id,{name:'program.exe',size:20}),{code:'FILE_TYPE'});
  await assert.rejects(service.attachments.reserve(alice,id,{name:'huge.txt',size:1024**3}),{code:'FILE_TOO_LARGE'});
 });
 await t.test('HTTP and WebSocket tickets validate the relationship and stop protected delivery on removal',async httpT=>{
  const app=Fastify();await app.register(rateLimit,{max:300,timeWindow:'1 minute'});await app.register(websocket);const actors:Record<string,CommunicationsActor>={alice,bob};
  app.decorateRequest('auth',undefined);app.decorateRequest('authIdentity',undefined);
  app.decorateRequest('requireAuth',function(){if(!this.auth)throw Object.assign(new Error('Denied'),{statusCode:401});});
  app.addHook('onRequest',async request=>{
   if(request.headers.authorization!=='Bearer owner')return;
   request.auth={tenantId:owner.tenantId,tenantUserId:owner.userId,authUserId:owner.authUserId,membershipReference:owner.userId,businessReference:owner.tenantId,tenantName:'Business Alpha',tenantSubdomain:'alpha',email:null,role:'owner',permissions:[]};
   request.authIdentity={authUserId:owner.authUserId,authSessionId:owner.sessionId,email:null,assuranceLevel:'aal1',issuedAt:owner.issuedAt,expiresAt:owner.expiresAt};
  });
  await app.register(communicationsRoutes,{prefix:'/api/v1/communications/conversations',service});
  const sessionProjection={actorId:alice.customerAccountId,displayName:'Alice',email:'alice@example.test',relationships:[{id:alice.userId,tenantId:owner.tenantId,clientId:customer.id,businessName:'Business Alpha',clientName:'Private customer',logoUrl:null,primaryColor:'#123456',secondaryColor:'#475569'}]};
  app.get('/api/v1/customer/collaboration/session',async request=>{if(request.headers.authorization!=='Bearer alice')throw Object.assign(new Error('Denied'),{statusCode:401});await service.capabilities(alice);return {data:sessionProjection};});
  app.get('/api/v1/customer/collaboration/:relationshipId/meetings',async request=>{if(request.headers.authorization!=='Bearer alice'||(request.params as {relationshipId:string}).relationshipId!==alice.userId)throw Object.assign(new Error('Denied'),{statusCode:401});await service.capabilities(alice);return {data:[],nextCursor:null};});
  app.get('/api/v1/client-collaboration/channels/:channelId/access',async request=>{request.requireAuth();await service.get(owner,(request.params as {channelId:string}).channelId);return {data:{canManage:true,contacts:[],invitations:[],staff:[{id:owner.userId,name:'Ari Host',role:'OWNER'}],clientId:customer.id}};});
  app.get('/api/v1/client-collaboration/channels/:channelId/meetings',async request=>{request.requireAuth();await service.get(owner,(request.params as {channelId:string}).channelId);return {data:[]};});
  await app.register(communicationsRoutes,{prefix:'/api/v1/customer/collaboration/:relationshipId/chat',service,customer:true,resolveActor:request=>{
   const actor=actors[request.headers.authorization?.replace('Bearer ','')??''];if(!actor||(request.params as {relationshipId:string}).relationshipId!==actor.userId)throw Object.assign(new Error('Denied'),{statusCode:401});return actor;
  }});
  await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());const address=app.server.address();assert.ok(address&&typeof address==='object');
  const base=`/api/v1/customer/collaboration/${alice.userId}/chat`,headers={authorization:'Bearer alice'};
  assert.equal((await app.inject({url:`${base}/${privateBob}/messages`,headers})).statusCode,404);
  assert.equal((await app.inject({url:`${base}/people`,headers})).statusCode,403);
  const ticket=await service.ticket(alice,id),socket=await app.injectWS(`${base}/${id}/events?ticket=${ticket.ticket}&after=${ticket.cursor}`);t.after(()=>socket.close());
  const delivered=new Promise<{type:string;resourceId:string}>((resolve,reject)=>{const timer=setTimeout(()=>{socket.off('message',receive);reject(new Error('Customer message event was not delivered'));},10000);const receive=(raw:unknown)=>{const event=JSON.parse(String(raw));if(event.type==='message.created'){clearTimeout(timer);socket.off('message',receive);resolve(event);}};socket.on('message',receive);});
  const posted=await service.post(owner,id,{body:'Realtime customer update'});assert.equal((await delivered).resourceId,posted.id);
  const globalTicket=await service.ticket(alice,null),globalSocket=await app.injectWS(`${base}/events?ticket=${globalTicket.ticket}&after=${globalTicket.cursor}`);t.after(()=>globalSocket.close());
  const watching=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Customer workspace watch did not become ready')),10000);globalSocket.on('message',raw=>{if(JSON.parse(String(raw)).type==='ephemeral.snapshot'){clearTimeout(timer);resolve();}});});
  globalSocket.send(JSON.stringify({type:'watch',conversationId:id,userIds:[]}));await watching;
  const closed=once(socket,'close'),globalClosed=once(globalSocket,'close');await pg.query('UPDATE conversation_members SET left_at=now() WHERE conversation_id=$1 AND customer_relationship_id=$2',[id,alice.userId]);await Promise.all([closed,globalClosed]);
  await denied(service.messages(alice,id,{limit:30}));await denied(service.events(alice,id,'0'));await denied(service.ticket(alice,id));
  await pg.query('UPDATE conversation_members SET left_at=NULL WHERE conversation_id=$1 AND customer_relationship_id=$2',[id,alice.userId]);
  await httpT.test('native customer portal uses real message, thread, file and realtime APIs', {skip:process.env.COMMUNICATIONS_BROWSER_TEST!=='1',timeout:180000},async()=>{
   const {verifyCustomerCollaborationBrowser}=await import('./helpers/customer-collaboration-browser.mjs');
   await verifyCustomerCollaborationBrowser({apiOrigin:`http://127.0.0.1:${address.port}`,relationshipId:alice.userId,conversationId:id,customerToken:'alice',staffToken:'owner'});
  });
 });
 await t.test('revocation denies slow downloads, retained sessions, staged writes, search and notifications',async()=>{
  afterDownload=async()=>{await pg.query("UPDATE customer_collaboration_relationships SET status='REVOKED',revoked_at=now() WHERE id=$1",[alice.userId]);};
  await denied(service.attachments.download(alice,id,fileId));afterDownload=undefined;
  await denied(service.post(alice,id,{body:'After revocation'}));await denied(service.discovery.search(alice,{q:'tax',limit:30}));await denied(service.discovery.notifications(alice));await denied(service.editMessage(alice,id,messageId,{body:'After revocation'}));await denied(service.reaction(alice,id,replyId,{emoji:'👍',active:false}));
  assert.equal((await service.get(aliceOther,otherChannel)).id,otherChannel,'Other authorised business remains separate');
  await pg.query('DELETE FROM auth.sessions WHERE id=$1',[colleague.sessionId]);await denied(service.get(colleague,id));
 });
});
