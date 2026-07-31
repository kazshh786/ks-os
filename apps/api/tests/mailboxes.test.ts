import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const mailboxService = readFileSync(new URL('../src/modules/mailboxes/mailbox.service.ts', import.meta.url), 'utf8');
const mailboxRoutes = readFileSync(new URL('../src/modules/mailboxes/mailbox.routes.ts', import.meta.url), 'utf8');
const integrationRoutes = readFileSync(new URL('../src/modules/integrations/integrations.routes.ts', import.meta.url), 'utf8');
const deliveryService = readFileSync(new URL('../src/modules/conversations/conversation-delivery.service.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const settingsPage = readFileSync(new URL('../../web/src/pages/settings/Integrations.tsx', import.meta.url), 'utf8');

test('Google and Zoho mailbox OAuth uses signed tenant state and offline access', () => {
  assert.match(mailboxService, /signState\(\{ tenantId, userId, provider, returnPath, nonce: randomUUID\(\) \}\)/);
  assert.match(mailboxService, /verifyState<OAuthState>/);
  assert.match(mailboxService, /https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly/);
  assert.match(mailboxService, /https:\/\/www\.googleapis\.com\/auth\/gmail\.send/);
  assert.match(mailboxService, /ZohoMail\.messages\.READ/);
  assert.match(mailboxService, /ZohoMail\.messages\.CREATE/);
  assert.match(mailboxService, /access_type: 'offline'/);
});

test('mailbox secrets are encrypted and never returned by listing routes', () => {
  assert.match(mailboxService, /token_ciphertext = \$\{encryptSecret\(input\.token\)\}/);
  assert.match(mailboxService, /decryptSecret<StoredMailboxToken>/);
  assert.doesNotMatch(mailboxRoutes, /token_ciphertext/);
  assert.doesNotMatch(mailboxRoutes, /refreshToken/);
  assert.match(mailboxRoutes, /request\.auth\.role !== 'owner'/);
});

test('connected mailbox routes and provider-native delivery are registered', () => {
  assert.match(integrationRoutes, /mailboxOauthCallbackRoutes/);
  assert.match(integrationRoutes, /mailboxRoutes/);
  assert.match(mailboxRoutes, /\/google\/callback/);
  assert.match(mailboxRoutes, /\/zoho\/callback/);
  assert.match(deliveryService, /channelProvider === 'GOOGLE_MAIL'/);
  assert.match(deliveryService, /channelProvider === 'ZOHO_MAIL'/);
  assert.match(deliveryService, /sendConnectedEmail/);
});

test('mailbox sync worker is bounded and overlap protected', () => {
  assert.match(server, /MAILBOX_SYNC_ENABLED/);
  assert.match(server, /MAILBOX_SYNC_INTERVAL_MS/);
  assert.match(server, /mailboxWorkerRunning/);
  assert.match(server, /Math\.max\(15_000/);
  assert.match(mailboxService, /LIMIT \$\{Math\.max\(1, Math\.min\(limit, 50\)\)\}/);
  assert.match(mailboxService, /syncOverlapSeconds/);
});

test('settings provide explicit Google and Zoho mailbox controls', () => {
  assert.match(settingsPage, /Google Workspace/);
  assert.match(settingsPage, /Zoho Mail/);
  assert.match(settingsPage, /Connect Google Workspace/);
  assert.match(settingsPage, /Connect Zoho Mail/);
  assert.match(settingsPage, /Sync now/);
  assert.match(settingsPage, /Reauthorise/);
  assert.match(settingsPage, /Disconnect/);
  assert.match(settingsPage, /Resend continues to handle automated notifications and marketing delivery/);
});
