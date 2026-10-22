import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LiveKitProvider } from '../src/modules/communications/communications.livekit.js';
import { CommunicationsMeetings } from '../src/modules/communications/communications.meetings.js';
import { createMeetingFixture } from './helpers/meetings-fixture.js';

test('real self-hosted LiveKit: two-user audio, video, screen, reconnect and room lifecycle', {
  skip: process.env.COMMUNICATIONS_MEDIA_TEST !== '1', timeout: 240000,
}, async t => {
  // Defense in depth: this test must never connect to the configured production media host.
  assert.equal(process.env.LIVEKIT_URL, 'ws://127.0.0.1:7880');
  assert.equal(process.env.LIVEKIT_API_KEY, 'ksos-test-key');
  assert.equal(process.env.LIVEKIT_API_SECRET, 'ksos-isolated-test-secret-never-production-2026');
  const { db, owner, member, service } = await createMeetingFixture(t);
  const conversation = await service.create(owner, { type: 'PRIVATE_CHANNEL', name: `Real media ${randomUUID()}`, memberUserIds: [member.userId] });
  const meetings = new CommunicationsMeetings(db, new LiveKitProvider({ ...process.env, NODE_ENV: 'test', LIVEKIT_ENABLED: 'true' }));
  const { verifyMeetingMedia } = await import('./helpers/meetings-media-browser.mjs');
  const result = await verifyMeetingMedia({ meetings, owner, member, conversationId: String(conversation.id) });
  assert.equal(result.evidence.length, 9);
});
