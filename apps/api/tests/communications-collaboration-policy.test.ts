import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { collaborationHash, collaborationInvitationToken, collaborationOrigin, collaborationSecretMatches } from '../src/modules/communications/communications.collaboration-secrets.js';
import { collaborationEmailCancellationCode, type CollaborationEmailSnapshot } from '../src/modules/email/collaboration-email-policy.js';
import { validateEmailTemplateData } from '../src/modules/email/email-safety.js';

const id='a56f0175-d7e4-4b30-b584-c295e922fe95',env={CUSTOMER_COLLABORATION_SECRET:randomBytes(32).toString('base64url'),PUBLIC_CUSTOMER_PORTAL_ORIGIN:'https://portal.example.test'};
test('customer invitations use a purpose-specific secret and safe configured origin',()=>{
  const token=collaborationInvitationToken(id,env);
  assert.match(token,/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(collaborationSecretMatches(token,collaborationHash(token)),true);
  assert.equal(collaborationSecretMatches(token+'x',collaborationHash(token)),false);
  assert.notEqual(token,collaborationInvitationToken(id,{...env,CUSTOMER_COLLABORATION_SECRET:env.CUSTOMER_COLLABORATION_SECRET+'changed'}));
  assert.throws(()=>collaborationInvitationToken(id,{}),{code:'COLLABORATION_UNAVAILABLE'});
  for(const origin of ['http://portal.example.test','https://user:password@portal.example.test','https://portal.example.test/path','https://portal.example.test/?next=x','javascript:alert(1)'])assert.throws(()=>collaborationOrigin({...env,PUBLIC_CUSTOMER_PORTAL_ORIGIN:origin}));
  assert.equal(collaborationOrigin(env),env.PUBLIC_CUSTOMER_PORTAL_ORIGIN);
});
test('queued collaboration email contains only an invitation reference and rechecks current scope',()=>{
  assert.equal(validateEmailTemplateData('customer-collaboration-invitation',{invitationId:id},false).valid,true);
  for(const extra of [{invitationUrl:'https://example.test/#secret'},{invitationToken:'secret'},{tenantName:'stale'}])assert.equal(validateEmailTemplateData('customer-collaboration-invitation',{invitationId:id,...extra},false).valid,false);
  const row:CollaborationEmailSnapshot={id,tenantId:id,email:'customer@example.test',secretHash:'hash',status:'PENDING',expiresAt:'2030-01-01T00:00:00Z',revokedAt:null,archivedAt:null,external:true,tenantActive:true,tenantStatus:'ACTIVE',channelName:'Customer messages'};
  const message={invitationId:id,tenantId:id,recipient:row.email,derivedHash:'hash'},now=new Date('2026-10-23T00:00:00Z');
  assert.equal(collaborationEmailCancellationCode(row,message,now),null);
  for(const change of [{status:'ACCEPTED'},{revokedAt:now},{archivedAt:now},{external:false},{tenantActive:false},{tenantStatus:'SUSPENDED'},{email:'other@example.test'},{secretHash:'rotated'},{expiresAt:'2020-01-01'}])assert.ok(collaborationEmailCancellationCode({...row,...change},message,now));
});
