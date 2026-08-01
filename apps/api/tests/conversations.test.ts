import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConversationListQuerySchema,
  ConversationMessageSchema,
  CreateWhatsAppCampaignSchema,
  SendConversationMessageSchema,
  UpdateConversationSchema,
  UpdateWhatsAppMarketingConsentSchema,
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

test('WhatsApp template input is typed and restricted to the WhatsApp channel', () => {
  const parsed = SendConversationMessageSchema.parse({
    body: 'Your appointment is tomorrow.',
    channel: 'WHATSAPP',
    whatsappTemplate: {
      name: 'appointment_reminder',
      language: 'en_GB',
      category: 'UTILITY',
      components: [],
    },
  });
  assert.equal(parsed.whatsappTemplate?.category, 'UTILITY');
  assert.throws(() => SendConversationMessageSchema.parse({
    body: 'Sale now on',
    channel: 'EMAIL',
    whatsappTemplate: { name: 'sale', language: 'en_GB', category: 'MARKETING', components: [] },
  }));
  assert.deepEqual(UpdateWhatsAppMarketingConsentSchema.parse({ status: 'OPTED_IN', source: 'VERBAL', evidence: {} }), {
    status: 'OPTED_IN', source: 'VERBAL', evidence: {},
  });
  assert.throws(() => UpdateWhatsAppMarketingConsentSchema.parse({ status: 'UNKNOWN', source: 'VERBAL' }));
});

test('WhatsApp campaign input is bounded and audience typed', () => {
  const parsed = CreateWhatsAppCampaignSchema.parse({
    name: 'August rebooking',
    templateId: '11111111-1111-4111-8111-111111111111',
    audienceType: 'LAPSED_90_DAYS',
    templateParameters: ['20%'],
    recipientLimit: 250,
  });
  assert.equal(parsed.audienceType, 'LAPSED_90_DAYS');
  assert.equal(parsed.recipientLimit, 250);
  assert.throws(() => CreateWhatsAppCampaignSchema.parse({
    name: 'Campaign',
    templateId: '11111111-1111-4111-8111-111111111111',
    audienceType: 'EVERYONE',
  }));
  assert.throws(() => CreateWhatsAppCampaignSchema.parse({
    name: 'Campaign',
    templateId: '11111111-1111-4111-8111-111111111111',
    audienceType: 'ALL_OPTED_IN',
    recipientLimit: 1001,
  }));
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

test('WhatsApp messaging is enforced by package, service window and consent', () => {
  const policy = readFileSync(new URL('../src/modules/conversations/whatsapp-messaging.service.ts', import.meta.url), 'utf8');
  const delivery = readFileSync(new URL('../src/modules/conversations/conversation-delivery.service.ts', import.meta.url), 'utf8');
  const ingest = readFileSync(new URL('../src/modules/conversations/conversation-ingest.service.ts', import.meta.url), 'utf8');
  const controls = readFileSync(new URL('../../web/src/features/conversations/WhatsAppComposerControls.tsx', import.meta.url), 'utf8');
  const consoleSource = readFileSync(new URL('../../web/src/components/WhatsAppMessagingConsole.tsx', import.meta.url), 'utf8');

  assert.match(policy, /WHATSAPP_SERVICE_WINDOW_CLOSED/);
  assert.match(policy, /WHATSAPP_TEMPLATES_REQUIRE_GROWTH/);
  assert.match(policy, /WHATSAPP_MARKETING_REQUIRES_SCALE/);
  assert.match(policy, /WHATSAPP_MARKETING_CONSENT_REQUIRED/);
  assert.match(delivery, /WHATSAPP_MARKETING_CONSENT_REVOKED/);
  assert.match(delivery, /type: 'template'/);
  assert.match(delivery, /whatsappTemplate/);
  assert.match(ingest, /24 \* 60 \* 60 \* 1000/);
  assert.match(controls, /Core can reply on WhatsApp only during the 24-hour customer-service window/);
  assert.match(consoleSource, /Meta messaging fees billed by Meta to this business/);
});

test('Scale campaigns enforce consent, limits, frequency caps and protected dispatch', () => {
  const campaign = readFileSync(new URL('../src/modules/conversations/whatsapp-campaign.service.ts', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../src/modules/conversations/conversation.routes.ts', import.meta.url), 'utf8');
  const manager = readFileSync(new URL('../../web/src/components/WhatsAppCampaignManager.tsx', import.meta.url), 'utf8');

  assert.match(campaign, /WHATSAPP_MARKETING_REQUIRES_SCALE/);
  assert.match(campaign, /WHATSAPP_MARKETING_MONTHLY_LIMIT_REACHED/);
  assert.match(campaign, /FREQUENCY_CAP_DAYS = 7/);
  assert.match(campaign, /consent\.status='OPTED_IN'/);
  assert.match(campaign, /UPCOMING_BOOKING_30_DAYS/);
  assert.match(campaign, /LAPSED_90_DAYS/);
  assert.match(campaign, /processDueCampaigns/);
  assert.match(routes, /campaignService\.processDueCampaigns\(3\)/);
  assert.match(manager, /Meta fees billed directly to this business/);
  assert.match(manager, /seven-day frequency cap/);
});

test('omnichannel and WhatsApp messaging migrations are registered and API-only', () => {
  const omnichannel = MIGRATION_MANIFEST.find(item => item.filename === '20260730223000_omnichannel_conversations.sql');
  assert.equal(omnichannel?.order, 54);
  const omnichannelMigration = readFileSync(new URL('../../../packages/database/migrations/20260730223000_omnichannel_conversations.sql', import.meta.url), 'utf8');
  assert.match(omnichannelMigration, /'HARDWARE','COMMUNICATION'/);
  assert.match(omnichannelMigration, /credentials_reference uuid REFERENCES integration_connections\(id\)/);
  assert.match(omnichannelMigration, /attempt_count integer NOT NULL DEFAULT 0/);
  assert.match(omnichannelMigration, /next_attempt_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(omnichannelMigration, /conversation_messages_delivery_queue_idx/);
  assert.match(omnichannelMigration, /ALTER TABLE conversations ENABLE ROW LEVEL SECURITY/);
  assert.match(omnichannelMigration, /REVOKE ALL ON communication_channels, conversations, conversation_messages, conversation_attachments FROM anon, authenticated/);

  const tierMessaging = MIGRATION_MANIFEST.find(item => item.filename === '20260801033000_whatsapp_tier_messaging.sql');
  assert.equal(tierMessaging?.order, 57);
  const tierMigration = readFileSync(new URL('../../../packages/database/migrations/20260801033000_whatsapp_tier_messaging.sql', import.meta.url), 'utf8');
  assert.match(tierMigration, /whatsapp_service_window_expires_at/);
  assert.match(tierMigration, /whatsapp_marketing_monthly_message_limit/);
  assert.match(tierMigration, /whatsapp_message_templates/);
  assert.match(tierMigration, /whatsapp_marketing_consents/);
  assert.match(tierMigration, /whatsapp_marketing_campaigns/);
  assert.match(tierMigration, /whatsapp_marketing_campaign_recipients/);
  assert.match(tierMigration, /OPTED_IN/);
  assert.match(tierMigration, /ALTER TABLE whatsapp_marketing_campaigns ENABLE ROW LEVEL SECURITY/);
  assert.match(tierMigration, /whatsapp_marketing_campaign_recipients FROM anon, authenticated/);
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
