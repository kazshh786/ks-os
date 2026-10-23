import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { MobileDevices, checkRegisteredMobileSession, mobileApplications, registeredMobileSessionStartedAt, requireMobileDevice, validateMobileDeviceSession } from '../src/modules/authentication/mobile-devices.service.js';
import { mobileDeviceRoutes } from '../src/modules/authentication/mobile-devices.routes.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { CommunicationsAuthorization } from '../src/modules/communications/communications.authorization.js';

const appConfig = { applicationId: 'test.ksos.mobile', platform: 'IOS' as const, environment: 'SANDBOX' as const, redirectUri: 'https://mobile.example.test/auth/callback' };
const env = { MOBILE_APPLICATIONS_JSON: JSON.stringify([appConfig]) };
const registration = () => ({ applicationId: appConfig.applicationId, platform: appConfig.platform, environment: appConfig.environment, installationId: randomUUID(), deviceName: 'My phone' });
function request(actor: {authUserId:string;sessionId:string;issuedAt:string;expiresAt:string}, context: 'TENANT'|'CUSTOMER'='TENANT', deviceId?: string): FastifyRequest {
  return { applicationContext: context, headers: deviceId ? { 'x-ks-device-id': deviceId } : {}, requireIdentity: () => ({ authUserId: actor.authUserId, authSessionId: actor.sessionId, issuedAt: actor.issuedAt, expiresAt: actor.expiresAt, email: 'verified@example.test', assuranceLevel: 'aal1' }) } as unknown as FastifyRequest;
}
test('mobile devices reuse provider identity with isolated, revocable sessions', {timeout:120000}, async t => {
  const f = await createClientMeetingFixture(t), service = new MobileDevices(f.db, env);
  const seed = async () => { const actor = await f.seed(); await f.pg.query("UPDATE application_sessions SET hard_expires_at=now()+interval '1 day' WHERE auth_session_id=$1", [actor.sessionId]); return actor; };
  const anotherSession = async (actor: Awaited<ReturnType<typeof seed>>) => {
    const next = {...actor,sessionId:randomUUID()};
    await f.pg.query('INSERT INTO auth.sessions(id,user_id,created_at) VALUES($1,$2,$3)', [next.sessionId,next.authUserId,next.issuedAt]);
    await f.pg.query("INSERT INTO application_sessions(auth_session_id,auth_user_id,application_context,selected_tenant_user_id,expires_at,hard_expires_at) VALUES($1,$2,'TENANT',$3,$4,now()+interval '1 day')", [next.sessionId,next.authUserId,next.userId,next.expiresAt]);
    return next;
  };
  await t.test('registration is idempotent, bound to one installation and never returns provider IDs or secrets', async () => {
    const actor = await seed(), input = registration(), first = await service.register(request(actor), input);
    const retry = await service.register(request(actor), {...input,deviceName:'Renamed phone'});
    assert.equal(retry.id,first.id); assert.equal(retry.deviceName,'Renamed phone');
    assert.equal(Object.keys(first).some(key=>/token|authUser|sessionId|installation/i.test(key)),false);
    const stored = (await f.pg.query('SELECT installation_hash FROM mobile_devices WHERE id=$1',[first.id])).rows[0];
    assert.match(String(stored.installation_hash),/^[a-f0-9]{64}$/);assert.notEqual(stored.installation_hash,input.installationId);
    await assert.rejects(service.register(request(actor),registration()),{code:'MOBILE_SESSION_BOUND'});
    assert.equal((await requireMobileDevice(request(actor,'TENANT',String(first.id)),f.db)).deviceId,first.id);
  });
  await t.test('only configured apps and explicit business/customer contexts can register', async () => {
    const actor=await seed();
    await assert.rejects(service.register(request(actor),{...registration(),environment:'PRODUCTION'}),{code:'MOBILE_APPLICATION_DENIED'});
    await assert.rejects(new MobileDevices(f.db,{}).register(request(actor),registration()),{code:'MOBILE_APPLICATION_DENIED'});
    const agency=request(actor);agency.applicationContext='AGENCY';await assert.rejects(service.register(agency,registration()),{code:'MOBILE_CONTEXT_DENIED'});
    await assert.rejects(service.register(request(actor),{...registration(),authUserId:randomUUID()}));
    assert.throws(()=>mobileApplications({MOBILE_APPLICATIONS_JSON:JSON.stringify([{...appConfig,environment:'PRODUCTION',redirectUri:'ksos://callback'}])}),{code:'MOBILE_NOT_CONFIGURED'});
    assert.throws(()=>mobileApplications({MOBILE_APPLICATIONS_JSON:JSON.stringify([{...appConfig,redirectUri:'https://mobile.example.test/callback?token=x'}])}),{code:'MOBILE_NOT_CONFIGURED'});
    for (const redirectUri of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,test', 'file:///callback', 'http://mobile.example.test/callback', 'unrelated.app:/callback']) {
      assert.throws(() => mobileApplications({ MOBILE_APPLICATIONS_JSON: JSON.stringify([{ ...appConfig, redirectUri }]) }), { code: 'MOBILE_NOT_CONFIGURED' });
    }
    assert.equal(mobileApplications({ MOBILE_APPLICATIONS_JSON: JSON.stringify([{ ...appConfig, redirectUri: 'test.ksos.mobile:/callback' }]) })[0].redirectUri, 'test.ksos.mobile:/callback');
  });
  await t.test('separate devices cannot substitute one another even for the same account', async () => {
    const first=await seed(),second=await anotherSession(first),one=await service.register(request(first),registration()),two=await service.register(request(second),registration());
    assert.notEqual(one.id,two.id);
    await assert.rejects(requireMobileDevice(request(first,'TENANT',String(two.id)),f.db),{code:'MOBILE_SESSION_REQUIRED'});
    await assert.rejects(requireMobileDevice(request(first),f.db),{code:'MOBILE_SESSION_REQUIRED'});
    const list=await service.list(request(first));assert.equal(list.data.length,2);assert.equal(list.data.filter(d=>d.current).length,1);
  });
  await t.test('background checks survive access expiry but foreground APIs require a fresh JWT and hard expiry never extends', async () => {
    const actor=await seed(),device=await service.register(request(actor),registration());
    await f.pg.query("UPDATE application_sessions SET expires_at=now()-interval '1 minute' WHERE auth_session_id=$1",[actor.sessionId]);
    const current=await validateMobileDeviceSession(f.db,{deviceId:String(device.id),authUserId:actor.authUserId,context:'TENANT'});assert.equal(current.authSessionId,actor.sessionId);
    await assert.rejects(requireMobileDevice(request({...actor,expiresAt:new Date(Date.now()-1000).toISOString()},'TENANT',String(device.id)),f.db),{code:'MOBILE_SESSION_REQUIRED'});
    assert.equal((await requireMobileDevice(request(actor,'TENANT',String(device.id)),f.db)).deviceId,device.id);
    await assert.rejects(f.pg.query("UPDATE application_sessions SET hard_expires_at=hard_expires_at+interval '1 day' WHERE auth_session_id=$1",[actor.sessionId]),/hard expiry is immutable/);
    const expired=await f.seed();await f.pg.query("UPDATE application_sessions SET hard_expires_at=now()-interval '1 second' WHERE auth_session_id=$1",[expired.sessionId]);
    await assert.rejects(service.register(request(expired),registration()),{code:'MOBILE_SESSION_REQUIRED'});
  });
  await t.test('specific revocation removes provider renewal and every context, preserving other devices', async () => {
    const actor=await seed(),other=await anotherSession(actor),one=await service.register(request(actor),registration()),two=await service.register(request(other),registration());
    await f.pg.query("INSERT INTO application_sessions(auth_session_id,auth_user_id,application_context,expires_at,hard_expires_at) VALUES($1,$2,'CUSTOMER',$3,now()+interval '1 day')",[other.sessionId,other.authUserId,other.expiresAt]);
    await service.revoke(request(actor),String(two.id));
    assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[other.sessionId])).rows[0].n,0);
    assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM application_sessions WHERE auth_session_id=$1 AND revoked_at IS NOT NULL',[other.sessionId])).rows[0].n,2);
    await assert.rejects(service.register(request({...other,issuedAt:new Date().toISOString()}),registration()),{code:'MOBILE_SESSION_REQUIRED'});
    await assert.rejects(checkRegisteredMobileSession(f.db,{authUserId:other.authUserId,authSessionId:other.sessionId,context:'TENANT',issuedAt:other.issuedAt,expiresAt:other.expiresAt}),{code:'MOBILE_SESSION_REQUIRED'});
    assert.equal((await requireMobileDevice(request(actor,'TENANT',String(one.id)),f.db)).deviceId,one.id);
    await assert.rejects(f.pg.query('UPDATE mobile_devices SET revoked_at=NULL WHERE id=$1',[two.id]),/immutable/);
  });
  await t.test('provider sign-out, account cutoff and application revocation fail closed independently', async () => {
    for(const cause of ['provider','account','application']) {
      const actor=await seed(),device=await service.register(request(actor),registration());
      if(cause==='provider')await f.pg.query('DELETE FROM auth.sessions WHERE id=$1',[actor.sessionId]);
      if(cause==='account')await f.pg.query('UPDATE users SET sessions_valid_after=now() WHERE id=$1',[actor.userId]);
      if(cause==='application')await f.pg.query('UPDATE application_sessions SET revoked_at=now() WHERE auth_session_id=$1',[actor.sessionId]);
      await assert.rejects(requireMobileDevice(request({...actor,issuedAt:new Date().toISOString()},'TENANT',String(device.id)),f.db),{code:'MOBILE_SESSION_REQUIRED'});
    }
  });
  await t.test('customer device access never becomes staff access and checks account status', async () => {
    const {identity:actor,accountId}=await f.seedCustomer();await f.pg.query("UPDATE application_sessions SET hard_expires_at=now()+interval '1 day' WHERE auth_session_id=$1",[actor.sessionId]);
    const device=await service.register(request(actor,'CUSTOMER'),registration());
    await assert.rejects(requireMobileDevice(request(actor,'TENANT',String(device.id)),f.db),{code:'MOBILE_SESSION_REQUIRED'});
    await f.pg.query("UPDATE customer_accounts SET status='SUSPENDED' WHERE id=$1",[accountId]);
    await assert.rejects(validateMobileDeviceSession(f.db,{deviceId:String(device.id),authUserId:actor.authUserId,context:'CUSTOMER'}),{code:'MOBILE_SESSION_REQUIRED'});
  });
  await t.test('refresh cannot revive a revoked workspace while another workspace remains valid', async () => {
    const actor = await seed(), secondUserId = randomUUID();
    await f.pg.query("INSERT INTO users(id,tenant_id,auth_user_id,name,role) VALUES($1,$2,$3,'Second workspace','owner')", [secondUserId,f.other.tenantId,actor.authUserId]);
    const device = await service.register(request(actor),registration());
    const refreshed = {...actor,issuedAt:new Date().toISOString()};
    const cutoff = new Date(Date.parse(actor.issuedAt)+500).toISOString();
    await f.pg.query('UPDATE users SET sessions_valid_after=$1 WHERE id=$2',[cutoff,actor.userId]);
    assert.equal(await registeredMobileSessionStartedAt(f.db,{authUserId:actor.authUserId,authSessionId:actor.sessionId}),actor.issuedAt);
    // Device management remains available through the unaffected membership.
    assert.equal((await validateMobileDeviceSession(f.db,{deviceId:String(device.id),authUserId:actor.authUserId,context:'TENANT'})).deviceId,device.id);
    const auth = new CommunicationsAuthorization(f.db);
    await assert.rejects(auth.authenticate(refreshed),{code:'AUTH_REQUIRED'});
    const selected = Object.assign(request(refreshed,'TENANT',String(device.id)),{auth:{tenantUserId:actor.userId,tenantId:actor.tenantId}}) as FastifyRequest;
    await assert.rejects(requireMobileDevice(selected,f.db),{code:'MOBILE_SESSION_REQUIRED'});
    await f.pg.query('UPDATE application_sessions SET selected_tenant_user_id=$1 WHERE auth_session_id=$2',[secondUserId,actor.sessionId]);
    assert.equal((await auth.authenticate({...refreshed,tenantId:f.other.tenantId,userId:secondUserId})).userId,secondUserId);
    const fresh = await anotherSession({...actor,issuedAt:new Date().toISOString()});
    await service.register(request(fresh),registration());
    assert.equal((await auth.authenticate(fresh)).userId,actor.userId,'A new provider sign-in after the cutoff may regain the active membership');
  });
  await t.test('customer account cutoff uses provider sign-in time after access-token renewal', async () => {
    const {identity:actor,accountId}=await f.seedCustomer();
    const device=await service.register(request(actor,'CUSTOMER'),registration());
    const startedAt=await registeredMobileSessionStartedAt(f.db,{authUserId:actor.authUserId,authSessionId:actor.sessionId});
    await f.pg.query('UPDATE customer_accounts SET sessions_valid_after=$1 WHERE id=$2',[startedAt,accountId]);
    await assert.rejects(requireMobileDevice(request({...actor,issuedAt:new Date(Date.now()+1000).toISOString()},'CUSTOMER',String(device.id)),f.db),{code:'MOBILE_SESSION_REQUIRED'});
  });
  await t.test('revoke others affects only owned mobile sessions and requires the current device binding', async () => {
    const actor=await seed(),second=await anotherSession(actor),browser=await anotherSession(actor),stranger=await seed();
    const one=await service.register(request(actor),registration()),two=await service.register(request(second),registration()),foreign=await service.register(request(stranger),registration());
    await assert.rejects(service.revoke(request(actor),String(foreign.id)),{code:'MOBILE_DEVICE_NOT_FOUND'});
    await assert.rejects(service.revokeOthers(request(actor)),{code:'MOBILE_SESSION_REQUIRED'});
    assert.deepEqual(await service.revokeOthers(request(actor,'TENANT',String(one.id))),{revoked:1,scope:'OTHER_MOBILE_DEVICES'});
    assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id IN ($1,$2,$3)',[actor.sessionId,browser.sessionId,stranger.sessionId])).rows[0].n,3);
    await assert.rejects(requireMobileDevice(request(second,'TENANT',String(two.id)),f.db),{code:'MOBILE_SESSION_REQUIRED'});
  });
  await t.test('database grants and immutable binding prevent direct principal retargeting', async () => {
    const actor=await seed(),other=await seed(),device=await service.register(request(actor),registration());
    assert.equal((await f.pg.query('SELECT public.revoke_mobile_device($1,$2,$3) AS revoked',[device.id,other.authUserId,'forged'])).rows[0].revoked,false);
    await assert.rejects(f.pg.query('UPDATE mobile_devices SET auth_user_id=$1 WHERE id=$2',[other.authUserId,device.id]),/immutable/);
    const grants=await f.pg.query("SELECT has_table_privilege('authenticated','mobile_devices','SELECT') AS readable,has_function_privilege('anon','public.revoke_mobile_device(uuid,uuid,text)','EXECUTE') AS revoke,has_function_privilege('service_role','public.mobile_provider_session(uuid,uuid)','EXECUTE') AS provider");
    assert.deepEqual(grants.rows[0],{readable:false,revoke:false,provider:true});
  });
  await t.test('HTTP rejects account spoofing and does not reveal other users devices', async () => {
    const actor=await seed(),other=await seed(),foreign=await service.register(request(other),registration()),app=Fastify();
    app.addHook('onRequest',async req=>{const principal=req.headers.authorization==='Bearer second'?other:actor;Object.assign(req,{applicationContext:'TENANT',authIdentity:request(principal).requireIdentity(),requireIdentity:request(principal).requireIdentity});});
    app.setErrorHandler((error, _req, reply)=>reply.status(error instanceof ZodError?400:((error as {statusCode?:number}).statusCode??500)).send({code:(error as {code?:string}).code??'INVALID_INPUT'}));
    await app.register(rateLimit,{global:false});
    await app.register(mobileDeviceRoutes,{service});await app.ready();
    try {
      const forged=await app.inject({method:'POST',url:'/api/v1/auth/mobile/session',payload:{...registration(),authUserId:other.authUserId}});assert.equal(forged.statusCode,400);
      const input=registration(),created=await app.inject({method:'POST',url:'/api/v1/auth/mobile/session',payload:input});assert.equal(created.statusCode,200,created.body);assert.equal(created.headers['cache-control'],'no-store');
      const removed=await app.inject({method:'DELETE',url:`/api/v1/auth/mobile/devices/${foreign.id}`});assert.equal(removed.statusCode,404);
      const listed=await app.inject({method:'GET',url:'/api/v1/auth/mobile/devices'});assert.equal(listed.statusCode,200);assert.equal(listed.json().data.length,1);
      const statuses:number[]=[];for(let index=0;index<10;index++)statuses.push((await app.inject({method:'POST',url:'/api/v1/auth/mobile/session',remoteAddress:`192.0.2.${index+1}`,payload:input})).statusCode);assert.ok(statuses.includes(429),'Changing IP must not bypass the authenticated account limit');
      assert.notEqual((await app.inject({method:'POST',url:'/api/v1/auth/mobile/session',headers:{authorization:'Bearer second'},payload:registration()})).statusCode,429,'A different account has a separate limit');
    } finally {await app.close();}
  });
});
