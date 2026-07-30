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

test('omnichannel migration is registered and keeps data API-only', () => {
  const entry = MIGRATION_MANIFEST.find(item => item.filename === '20260730223000_omnichannel_conversations.sql');
  assert.equal(entry?.order, 53);
  const migration = readFileSync(new URL('../../../packages/database/migrations/20260730223000_omnichannel_conversations.sql', import.meta.url), 'utf8');
  assert.match(migration, /credentials_reference uuid REFERENCES integration_connections\(id\)/);
  assert.match(migration, /ALTER TABLE conversations ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON communication_channels, conversations, conversation_messages, conversation_attachments FROM anon, authenticated/);
});
