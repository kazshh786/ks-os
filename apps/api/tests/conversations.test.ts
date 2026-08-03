import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConversationListQuerySchema,
  ConversationMessageSchema,
  SendConversationMessageSchema,
  UpdateConversationSchema,
} from '@ks-os/contracts';
import { MIGRATION_MANIFEST } from '@ks-os/database';

test('conversation list queries are bounded and channel values are strict', () => {
  assert.equal(ConversationListQuerySchema.parse({ limit: '40' }).limit, 40);
  assert.throws(() => ConversationListQuerySchema.parse({ limit: 101 }));
  assert.throws(() => ConversationListQuerySchema.parse({ channel: 'TELEGRAM' }));
});

test('message sending cannot inject tenant or sender identity', () => {
  assert.deepEqual(SendConversationMessageSchema.parse({ body: 'Hello', channel: 'WHATSAPP' }), {
    body: 'Hello',
    channel: 'WHATSAPP',
  });
  assert.throws(() => SendConversationMessageSchema.parse({ body: 'Hello', tenantId: '11111111-1111-4111-8111-111111111111' }));
  assert.throws(() => SendConversationMessageSchema.parse({ body: '   ' }));
});

test('conversation updates require at least one controlled change', () => {
  assert.throws(() => UpdateConversationSchema.parse({}));
  assert.deepEqual(UpdateConversationSchema.parse({ markRead: true }), { markRead: true });
  assert.throws(() => UpdateConversationSchema.parse({ assignedToUserId: null, tenantId: '11111111-1111-4111-8111-111111111111' }));
});

test('message lifecycle responses include channel delivery state', () => {
  const parsed = ConversationMessageSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    conversationId: '22222222-2222-4222-8222-222222222222',
    channel: 'EMAIL',
    direction: 'OUTBOUND',
    senderType: 'STAFF',
    senderName: 'Alex',
    body: 'Your booking link is ready.',
    status: 'QUEUED',
    replyToMessageId: null,
    externalMessageId: null,
    attachments: [],
    createdAt: new Date().toISOString(),
  });
  assert.equal(parsed.status, 'QUEUED');
});

test('customer inbox refreshes live and immediately kicks queued delivery', () => {
  const routes = readFileSync(new URL('../src/modules/conversations/conversation.routes.ts', import.meta.url), 'utf8');
  const inbox = readFileSync(new URL('../../web/src/features/conversations/ConversationsInboxPage.tsx', import.meta.url), 'utf8');

  assert.match(routes, /deliveryService\.process\(20\)/);
  assert.match(routes, /Immediate conversation delivery kick failed/);
  assert.match(inbox, /10_000/);
  assert.match(inbox, /5_000/);
  assert.match(inbox, /visibilitychange/);
  assert.match(inbox, /useState<ConversationStatus \| ''>\(''\)/);
  assert.match(inbox, /silent: true/);
});

test('smart chat preserves context and surfaces new-message tools', () => {
  const inbox = readFileSync(new URL('../../web/src/features/conversations/ConversationsInboxPage.tsx', import.meta.url), 'utf8');

  assert.match(inbox, /ks-os:conversation-draft/);
  assert.match(inbox, /replyToMessageId: replyTo\?\.id/);
  assert.match(inbox, /Search this conversation/);
  assert.match(inbox, /Notification\.requestPermission/);
  assert.match(inbox, /New messages/);
  assert.match(inbox, /message\.attachments\.map/);
  assert.match(inbox, /Send again/);
  assert.match(inbox, /Ctrl\/⌘ \+ Enter/);
});

test('omnichannel migration is registered, durable and API-only', () => {
  const entry = MIGRATION_MANIFEST.find(item => item.filename === '20260730223000_omnichannel_conversations.sql');
  assert.equal(entry?.order, 54);
  const migration = readFileSync(new URL('../../../packages/database/migrations/20260730223000_omnichannel_conversations.sql', import.meta.url), 'utf8');
  assert.match(migration, /'HARDWARE','COMMUNICATION'/);
  assert.match(migration, /credentials_reference uuid REFERENCES integration_connections\(id\)/);
  assert.match(migration, /attempt_count integer NOT NULL DEFAULT 0/);
  assert.match(migration, /next_attempt_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(migration, /conversation_messages_delivery_queue_idx/);
  assert.match(migration, /ALTER TABLE conversations ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON communication_channels, conversations, conversation_messages, conversation_attachments FROM anon, authenticated/);
});

test('provider webhooks require signatures and worker execution is protected', () => {
  const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const metaSource = readFileSync(new URL('../src/modules/webhooks/meta/meta-webhook.routes.ts', import.meta.url), 'utf8');
  const conversationRoutes = readFileSync(new URL('../src/modules/conversations/conversation.routes.ts', import.meta.url), 'utf8');
  assert.match(appSource, /\/api\/v1\/webhooks\/meta/);
  assert.match(metaSource, /x-hub-signature-256/);
  assert.match(metaSource, /timingSafeEqual/);
  assert.match(conversationRoutes, /CONVERSATION_WORKER_SECRET/);
});
