import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';

test('authoritative badges reconcile message and notification reads across devices', { timeout: 300000 }, async t => {
  const { db, pg, owner, outsider, other } = await createClientMeetingFixture(t), service = new CommunicationsService(db);
  const direct = await service.create(owner, { type: 'DIRECT', name: '', memberUserIds: [outsider.userId] });
  const invitation = (await service.discovery.notifications(outsider)).data.find(row => row.type === 'CHAT_INVITATION');
  assert.ok(invitation); await service.discovery.readNotification(outsider, invitation.id);
  const id = String(direct.id), first = await service.post(owner, id, { body: 'One' }), second = await service.post(owner, id, { body: 'Two' });
  assert.deepEqual(await service.badges.count(outsider), { unreadConversations: 1, unreadDirectMessages: 2, unreadClientConversations: 0, unreadNotifications: 2, missedCalls: 0 });
  assert.equal((await service.badges.count(owner)).unreadDirectMessages, 0);
  assert.equal((await service.badges.count(other)).unreadNotifications, 0);
  await service.read(outsider, id, second.id); await service.read(outsider, id, first.id);
  assert.equal((await service.badges.count(outsider)).unreadConversations, 0);
  assert.equal((await service.badges.count(outsider)).unreadNotifications, 2, 'A message read does not silently dismiss persistent notifications');
  const notification = (await service.discovery.notifications(outsider)).data[0];
  const events = async () => (await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM communication_events WHERE type='notification.read' AND resource_id=$1", [notification.id])).rows[0].count;
  const before = await events(); await service.discovery.readNotification(outsider, notification.id); await service.discovery.readNotification(outsider, notification.id);
  assert.equal(await events(), before + 1); assert.equal((await service.badges.count(outsider)).unreadNotifications, 1);
  await service.editMessage(owner, id, first.id, null);
  assert.equal((await service.badges.count(outsider)).unreadNotifications, 0, 'Deleted content does not leave a private unread badge');
  // Direct participants are intentionally fixed. Exercise membership removal
  // through a channel that supports it, while retaining the read direct thread.
  const channel = String((await service.create(owner, { type: 'PRIVATE_CHANNEL', name: 'Badge membership removal', memberUserIds: [outsider.userId] })).id);
  await service.post(owner, channel, { body: 'Visible until membership is removed' });
  assert.equal((await service.badges.count(outsider)).unreadConversations, 1);
  await service.removeMember(owner, channel, outsider.userId);
  assert.deepEqual(await service.badges.count(outsider), { unreadConversations: 0, unreadDirectMessages: 0, unreadClientConversations: 0, unreadNotifications: 0, missedCalls: 0 });
});
