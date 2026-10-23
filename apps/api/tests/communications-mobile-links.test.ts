import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CommunicationLinks } from '../src/modules/communications/communications.links.js';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';

test('communication links contain only references and recheck access on opening', { timeout: 300000 }, async t => {
  const { pg, db, owner, outsider, other } = await createClientMeetingFixture(t);
  const links = new CommunicationLinks(db, () => 'https://mobile.example.test'), service = new CommunicationsService(db);
  const channel = await service.create(owner, { type: 'PRIVATE_CHANNEL', name: 'Links', memberUserIds: [outsider.userId] });
  const conversationId = String(channel.id), message = await service.post(owner, conversationId, { body: 'Confidential contents' });
  const target = { kind: 'MESSAGE' as const, tenantId: owner.tenantId, conversationId, messageId: message.id };
  const link = await links.create(owner, target);
  assert.equal(link.webPath, `/app/chat/${conversationId}?message=${message.id}`);
  assert.ok(!link.url.includes('Confidential')); assert.ok(!link.url.includes('token'));
  assert.deepEqual((await links.resolve(outsider, link.url)).target, target);
  await assert.rejects(links.resolve(other, link.url), { code: 'LINK_CONTEXT_MISMATCH' });
  for (const url of [link.url.replace('https:', 'http:'), link.url.replace('mobile.example.test', 'evil.example.test'),
    link.url.replace('/open?', '/app/admin?'), link.url + '&redirect=https://evil.example.test', link.url + '#access_token=hidden',
    link.url + '&tenantId=' + randomUUID(), link.url.replace('mobile.example.test', 'name:password@mobile.example.test')]) {
    await assert.rejects(links.resolve(owner, url), { code: 'INVALID_COMMUNICATION_LINK' });
  }
  const thread = await links.create(owner, { ...target, kind: 'THREAD' });
  assert.ok(thread.webPath.endsWith('&thread=' + message.id));
  const meetingId = randomUUID();
  await pg.query("INSERT INTO communication_meetings(id,tenant_id,conversation_id,created_by,request_id,title,type,provider_room_name,status) VALUES($1,$2,$3,$4,$5,'Private call','AUDIO',$6,'RINGING')", [meetingId, owner.tenantId, conversationId, owner.userId, randomUUID(), 'test-link-' + randomUUID()]);
  const callTarget = { kind: 'MEETING' as const, tenantId: owner.tenantId, meetingId };
  const callLink = await links.create(owner, callTarget);
  assert.equal(callLink.webPath, `/app/chat/${conversationId}?call=${meetingId}`, 'Unscheduled meeting links select the exact call in the existing pre-join screen');
  const resolvedCall = await links.resolve(outsider, callLink.url);
  assert.deepEqual(resolvedCall.target, callTarget); assert.equal(resolvedCall.webPath, callLink.webPath); assert.equal(resolvedCall.requiresAdmission, true);
  assert.equal(Number((await pg.query('SELECT count(*) AS total FROM communication_meeting_sessions WHERE meeting_id=$1', [meetingId])).rows[0].total), 0, 'Resolving a call link does not issue a media session');
  await service.removeMember(owner, conversationId, outsider.userId);
  await assert.rejects(links.resolve(outsider, link.url), { statusCode: 404 });
  await assert.rejects(links.resolve(outsider, callLink.url), { statusCode: 404 });
  await service.editMessage(owner, conversationId, message.id, null);
  await assert.rejects(links.resolve(owner, link.url), { code: 'LINK_UNAVAILABLE' });
  await pg.query('UPDATE application_sessions SET revoked_at=now() WHERE auth_session_id=$1', [owner.sessionId]);
  await assert.rejects(links.create(owner, { kind: 'CONVERSATION', tenantId: owner.tenantId, conversationId }), { code: 'AUTH_REQUIRED' });
});
