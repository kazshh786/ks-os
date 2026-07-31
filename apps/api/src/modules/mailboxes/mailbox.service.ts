import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDatabase } from '@ks-os/database';
import { ConversationIngestService } from '../conversations/conversation-ingest.service.js';
import { decryptSecret, encryptSecret, signState, verifyState } from '../integrations/integration-security.js';

export type MailboxProvider = 'GOOGLE_MAIL' | 'ZOHO_MAIL';

type OAuthState = {
  tenantId: string;
  userId: string;
  provider: MailboxProvider;
  returnPath: string;
  nonce: string;
  exp: number;
};

type StoredMailboxToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
  accountsServer?: string;
  mailApiBase?: string;
};

type MailboxConnection = {
  id: string;
  tenant_id: string;
  connected_user_id: string | null;
  provider: MailboxProvider;
  external_account_id: string;
  external_resource_id: string | null;
  external_resource_name: string | null;
  token_ciphertext: string;
  granted_scopes: string[];
  status: string;
  settings: Record<string, unknown>;
  provider_metadata: Record<string, unknown>;
  connected_at: string | Date | null;
  last_successful_sync_at: string | Date | null;
  last_attempted_sync_at: string | Date | null;
  last_sync_error: string | null;
};

type SendConnectedEmailInput = {
  to: string;
  subject: string;
  body: string;
  senderName: string;
  conversationMetadata: Record<string, unknown>;
};

const db = () => getDatabase();
const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const json = (value: unknown) => JSON.stringify(value ?? {});
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];
const ZOHO_SCOPES = [
  'ZohoMail.accounts.READ',
  'ZohoMail.folders.READ',
  'ZohoMail.messages.READ',
  'ZohoMail.messages.CREATE',
];
const allowedZohoAccountsHosts = new Set([
  'accounts.zoho.com',
  'accounts.zoho.eu',
  'accounts.zoho.in',
  'accounts.zoho.com.au',
  'accounts.zoho.jp',
  'accounts.zohocloud.ca',
  'accounts.zoho.com.cn',
  'accounts.zoho.sa',
  'accounts.zoho.uk',
]);

const cleanHeader = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
const encodedHeader = (value: string) => /^[\x20-\x7E]*$/.test(value)
  ? cleanHeader(value)
  : `=?UTF-8?B?${Buffer.from(cleanHeader(value), 'utf8').toString('base64')}?=`;
const emailAddress = (value: string) => {
  const angle = value.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angle?.[1]) return angle[1].trim().toLowerCase();
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
};
const displayName = (value: string) => {
  const address = emailAddress(value);
  return value.replace(/<[^>]+>/g, '').replace(address, '').replace(/^["']|["']$/g, '').trim() || undefined;
};
const htmlToText = (value: string) => value
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#0?39;/gi, "'")
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
const decodeBase64Url = (value: string) => Buffer.from(value, 'base64url').toString('utf8');
const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : null;

async function requestJson(url: string, init: RequestInit, provider: string) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 500) }; }
  if (!response.ok) {
    const message = payload?.error_description || payload?.error?.message || payload?.message || `${provider} request failed`;
    throw fail(response.status === 401 ? 401 : 502, `${provider}_HTTP_${response.status}`, String(message));
  }
  return payload;
}

function googlePartBody(part: any): { text: string; attachments: number } {
  let attachments = part?.filename ? 1 : 0;
  if (part?.mimeType === 'text/plain' && part?.body?.data) return { text: decodeBase64Url(String(part.body.data)), attachments };
  if (Array.isArray(part?.parts)) {
    let html = '';
    for (const child of part.parts) {
      const result = googlePartBody(child);
      attachments += result.attachments;
      if (result.text && child?.mimeType === 'text/plain') return { text: result.text, attachments };
      if (result.text && !html) html = result.text;
    }
    return { text: html, attachments };
  }
  if (part?.mimeType === 'text/html' && part?.body?.data) return { text: htmlToText(decodeBase64Url(String(part.body.data))), attachments };
  if (part?.body?.data) return { text: decodeBase64Url(String(part.body.data)), attachments };
  return { text: '', attachments };
}

function googleHeader(payload: any, name: string) {
  return String((payload?.headers || []).find((header: any) => String(header?.name || '').toLowerCase() === name.toLowerCase())?.value || '');
}

function zohoMailBase(accountsServer: string) {
  const url = new URL(accountsServer);
  if (!allowedZohoAccountsHosts.has(url.hostname)) throw fail(400, 'ZOHO_DATA_CENTRE_INVALID', 'Zoho returned an unsupported data-centre host.');
  return `https://${url.hostname.replace(/^accounts\./, 'mail.')}`;
}

export class MailboxService {
  private ingest = new ConversationIngestService();

  providerConfigured(provider: MailboxProvider) {
    if (provider === 'GOOGLE_MAIL') return Boolean(process.env.GOOGLE_MAIL_CLIENT_ID && process.env.GOOGLE_MAIL_CLIENT_SECRET && process.env.GOOGLE_MAIL_REDIRECT_URI);
    return Boolean(process.env.ZOHO_MAIL_CLIENT_ID && process.env.ZOHO_MAIL_CLIENT_SECRET && process.env.ZOHO_MAIL_REDIRECT_URI);
  }

  oauthUrl(tenantId: string, userId: string, provider: MailboxProvider, returnPath: string) {
    if (!this.providerConfigured(provider)) throw fail(503, 'MAILBOX_PROVIDER_NOT_CONFIGURED', `${provider === 'GOOGLE_MAIL' ? 'Google Workspace' : 'Zoho Mail'} OAuth credentials are not configured.`);
    const state = signState({ tenantId, userId, provider, returnPath, nonce: randomUUID() });
    if (provider === 'GOOGLE_MAIL') {
      const query = new URLSearchParams({
        client_id: process.env.GOOGLE_MAIL_CLIENT_ID!,
        redirect_uri: process.env.GOOGLE_MAIL_REDIRECT_URI!,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
    }
    const query = new URLSearchParams({
      client_id: process.env.ZOHO_MAIL_CLIENT_ID!,
      redirect_uri: process.env.ZOHO_MAIL_REDIRECT_URI!,
      response_type: 'code',
      scope: ZOHO_SCOPES.join(','),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.zoho.com/oauth/v2/auth?${query}`;
  }

  async list(tenantId: string) {
    const result = await db().execute(sql`
      SELECT id, provider, external_account_id, external_resource_name, status, sync_direction,
             last_successful_sync_at, last_attempted_sync_at, last_sync_error, connected_at, disconnected_at
      FROM integration_connections
      WHERE tenant_id = ${tenantId}::uuid
        AND kind = 'COMMUNICATION'
        AND provider IN ('GOOGLE_MAIL', 'ZOHO_MAIL')
      ORDER BY connected_at DESC NULLS LAST, created_at DESC
    `);
    return (result.rows as any[]).map(row => ({
      id: row.id,
      provider: row.provider,
      emailAddress: row.external_account_id,
      displayName: row.external_resource_name,
      status: row.status,
      syncDirection: row.sync_direction,
      connectedAt: iso(row.connected_at),
      lastSuccessfulSyncAt: iso(row.last_successful_sync_at),
      lastAttemptedSyncAt: iso(row.last_attempted_sync_at),
      lastSyncError: row.last_sync_error,
      providerConfigured: this.providerConfigured(row.provider),
    }));
  }

  callbackRedirect(returnPath: string, values: Record<string, string>) {
    const origin = process.env.FRONTEND_ORIGIN || process.env.PUBLIC_APP_ORIGIN;
    if (!origin) throw fail(503, 'FRONTEND_ORIGIN_REQUIRED', 'Frontend origin is not configured.');
    const url = new URL(returnPath, origin);
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    return url.toString();
  }

  async completeGoogle(query: Record<string, unknown>) {
    const state = verifyState<OAuthState>(String(query.state || ''));
    if (state.provider !== 'GOOGLE_MAIL') throw fail(400, 'OAUTH_PROVIDER_MISMATCH', 'OAuth provider did not match the connection request.');
    if (query.error) throw fail(400, 'GOOGLE_OAUTH_DENIED', String(query.error_description || query.error));
    const code = String(query.code || '');
    if (!code) throw fail(400, 'GOOGLE_OAUTH_CODE_REQUIRED', 'Google did not return an authorization code.');
    const previous = await this.connectionByProvider(state.tenantId, 'GOOGLE_MAIL');
    const previousToken = previous?.token_ciphertext ? decryptSecret<StoredMailboxToken>(previous.token_ciphertext) : null;
    const token = await requestJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_MAIL_CLIENT_ID!,
        client_secret: process.env.GOOGLE_MAIL_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_MAIL_REDIRECT_URI!,
        grant_type: 'authorization_code',
      }),
    }, 'GOOGLE');
    const refreshToken = String(token.refresh_token || previousToken?.refreshToken || '');
    if (!refreshToken) throw fail(409, 'GOOGLE_REFRESH_TOKEN_REQUIRED', 'Google did not issue offline mailbox access. Reconnect and approve access again.');
    const storedToken: StoredMailboxToken = {
      accessToken: String(token.access_token),
      refreshToken,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      tokenType: String(token.token_type || 'Bearer'),
      scope: String(token.scope || GOOGLE_SCOPES.join(' ')),
    };
    const profile = await requestJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${storedToken.accessToken}` },
    }, 'GOOGLE');
    const email = String(profile.emailAddress || '').trim().toLowerCase();
    if (!email) throw fail(502, 'GOOGLE_MAILBOX_IDENTITY_REQUIRED', 'Google did not return the mailbox email address.');
    await this.saveConnection({
      tenantId: state.tenantId,
      userId: state.userId,
      provider: 'GOOGLE_MAIL',
      email,
      resourceId: email,
      displayName: email,
      token: storedToken,
      scopes: String(token.scope || '').split(' ').filter(Boolean),
      settings: { historyId: String(profile.historyId || ''), syncOverlapSeconds: 300 },
      metadata: { mailboxType: 'GMAIL', providerAccountId: email },
    });
    return this.callbackRedirect(state.returnPath, { mailbox: 'connected', provider: 'GOOGLE_MAIL' });
  }

  async completeZoho(query: Record<string, unknown>) {
    const state = verifyState<OAuthState>(String(query.state || ''));
    if (state.provider !== 'ZOHO_MAIL') throw fail(400, 'OAUTH_PROVIDER_MISMATCH', 'OAuth provider did not match the connection request.');
    if (query.error) throw fail(400, 'ZOHO_OAUTH_DENIED', String(query.error_description || query.error));
    const code = String(query.code || '');
    if (!code) throw fail(400, 'ZOHO_OAUTH_CODE_REQUIRED', 'Zoho did not return an authorization code.');
    const accountsServer = String(query['accounts-server'] || 'https://accounts.zoho.com');
    const mailApiBase = zohoMailBase(accountsServer);
    const previous = await this.connectionByProvider(state.tenantId, 'ZOHO_MAIL');
    const previousToken = previous?.token_ciphertext ? decryptSecret<StoredMailboxToken>(previous.token_ciphertext) : null;
    const token = await requestJson(`${accountsServer}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.ZOHO_MAIL_CLIENT_ID!,
        client_secret: process.env.ZOHO_MAIL_CLIENT_SECRET!,
        redirect_uri: process.env.ZOHO_MAIL_REDIRECT_URI!,
        grant_type: 'authorization_code',
      }),
    }, 'ZOHO');
    const refreshToken = String(token.refresh_token || previousToken?.refreshToken || '');
    if (!refreshToken) throw fail(409, 'ZOHO_REFRESH_TOKEN_REQUIRED', 'Zoho did not issue offline mailbox access. Reconnect and approve access again.');
    const storedToken: StoredMailboxToken = {
      accessToken: String(token.access_token),
      refreshToken,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      tokenType: String(token.token_type || 'Bearer'),
      scope: String(token.scope || ZOHO_SCOPES.join(',')),
      accountsServer,
      mailApiBase,
    };
    const accounts = await requestJson(`${mailApiBase}/api/accounts`, {
      headers: { Authorization: `Zoho-oauthtoken ${storedToken.accessToken}` },
    }, 'ZOHO');
    const account = Array.isArray(accounts.data) ? accounts.data[0] : accounts.data;
    const accountId = String(account?.accountId || account?.account_id || '');
    const email = String(account?.primaryEmailAddress || account?.primaryAddress || account?.emailAddress || account?.email || '').trim().toLowerCase();
    if (!accountId || !email) throw fail(502, 'ZOHO_MAILBOX_IDENTITY_REQUIRED', 'Zoho did not return a usable mail account.');
    const folders = await requestJson(`${mailApiBase}/api/accounts/${encodeURIComponent(accountId)}/folders`, {
      headers: { Authorization: `Zoho-oauthtoken ${storedToken.accessToken}` },
    }, 'ZOHO');
    const folderRows = Array.isArray(folders.data) ? folders.data : [];
    const inbox = folderRows.find((folder: any) => String(folder.folderType || folder.folderName || '').toLowerCase() === 'inbox');
    if (!inbox?.folderId) throw fail(502, 'ZOHO_INBOX_FOLDER_REQUIRED', 'Zoho did not return the Inbox folder.');
    await this.saveConnection({
      tenantId: state.tenantId,
      userId: state.userId,
      provider: 'ZOHO_MAIL',
      email,
      resourceId: accountId,
      displayName: String(account?.displayName || account?.accountDisplayName || email),
      token: storedToken,
      scopes: String(token.scope || ZOHO_SCOPES.join(',')).split(',').filter(Boolean),
      settings: { inboxFolderId: String(inbox.folderId), syncOverlapSeconds: 300 },
      metadata: { mailboxType: 'ZOHO', providerAccountId: accountId, dataCentre: String(query.location || '') },
    });
    return this.callbackRedirect(state.returnPath, { mailbox: 'connected', provider: 'ZOHO_MAIL' });
  }

  async disconnect(tenantId: string, userId: string, id: string) {
    const connection = await this.connectionById(id, tenantId);
    const token = decryptSecret<StoredMailboxToken>(connection.token_ciphertext);
    try {
      if (connection.provider === 'GOOGLE_MAIL') {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.refreshToken || token.accessToken)}`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
      } else if (token.accountsServer) {
        await fetch(`${token.accountsServer}/oauth/v2/token/revoke?token=${encodeURIComponent(token.refreshToken)}`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
      }
    } catch { /* Provider revocation is best effort; local access is removed below. */ }
    await db().transaction(async tx => {
      await tx.execute(sql`
        UPDATE integration_connections
        SET status = 'DISCONNECTED', token_ciphertext = NULL, disconnected_at = now(), updated_at = now()
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
      `);
      await tx.execute(sql`
        UPDATE communication_channels
        SET status = 'DISCONNECTED', updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND credentials_reference = ${id}::uuid
      `);
      await tx.execute(sql`
        INSERT INTO platform_audit_events(tenant_id, action, target_type, target_id, outcome, event_category, description, environment, source_component, metadata)
        VALUES(${tenantId}::uuid, 'MAILBOX_DISCONNECTED', 'INTEGRATION', ${id}, 'SUCCESS', 'INTEGRATION', 'connected mailbox disconnected', ${process.env.NODE_ENV || 'development'}, 'mailboxes', jsonb_build_object('tenantUserId', ${userId}))
      `);
    });
    return { id, status: 'DISCONNECTED' };
  }

  async syncDue(limit = 10) {
    const result = await db().execute(sql`
      SELECT id
      FROM integration_connections
      WHERE kind = 'COMMUNICATION'
        AND provider IN ('GOOGLE_MAIL', 'ZOHO_MAIL')
        AND status IN ('CONNECTED', 'DEGRADED')
        AND (last_attempted_sync_at IS NULL OR last_attempted_sync_at < now() - interval '20 seconds')
      ORDER BY last_attempted_sync_at NULLS FIRST
      LIMIT ${Math.max(1, Math.min(limit, 50))}
    `);
    let synced = 0;
    let messages = 0;
    let failed = 0;
    for (const row of result.rows as Array<{ id: string }>) {
      try {
        const outcome = await this.syncConnection(row.id);
        synced += 1;
        messages += outcome.messages;
      } catch {
        failed += 1;
      }
    }
    return { claimed: result.rows.length, synced, messages, failed };
  }

  async syncConnection(id: string, tenantId?: string) {
    const connection = await this.connectionById(id, tenantId);
    await db().execute(sql`UPDATE integration_connections SET last_attempted_sync_at = now(), updated_at = now() WHERE id = ${id}::uuid`);
    try {
      const token = await this.validToken(connection);
      const messages = connection.provider === 'GOOGLE_MAIL'
        ? await this.syncGoogle(connection, token)
        : await this.syncZoho(connection, token);
      await db().transaction(async tx => {
        await tx.execute(sql`
          UPDATE integration_connections
          SET status = 'CONNECTED', last_successful_sync_at = now(), last_sync_error = NULL, updated_at = now()
          WHERE id = ${id}::uuid
        `);
        await tx.execute(sql`
          UPDATE communication_channels
          SET status = 'CONNECTED', last_health_check_at = now(), updated_at = now()
          WHERE credentials_reference = ${id}::uuid
        `);
      });
      return { id, messages };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message.slice(0, 500) : 'Mailbox synchronisation failed';
      const reauthorise = (cause as any)?.statusCode === 401;
      await db().transaction(async tx => {
        await tx.execute(sql`
          UPDATE integration_connections
          SET status = ${reauthorise ? 'REAUTHORISATION_REQUIRED' : 'DEGRADED'}, last_sync_error = ${error}, updated_at = now()
          WHERE id = ${id}::uuid
        `);
        await tx.execute(sql`
          UPDATE communication_channels
          SET status = 'ATTENTION', last_health_check_at = now(), updated_at = now()
          WHERE credentials_reference = ${id}::uuid
        `);
      });
      throw cause;
    }
  }

  async sendConnectedEmail(connectionId: string, input: SendConnectedEmailInput) {
    const connection = await this.connectionById(connectionId);
    const token = await this.validToken(connection);
    if (connection.provider === 'GOOGLE_MAIL') return this.sendGoogle(connection, token, input);
    return this.sendZoho(connection, token, input);
  }

  private async saveConnection(input: {
    tenantId: string;
    userId: string;
    provider: MailboxProvider;
    email: string;
    resourceId: string;
    displayName: string;
    token: StoredMailboxToken;
    scopes: string[];
    settings: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }) {
    const existing = await this.connectionByProvider(input.tenantId, input.provider);
    let connectionId = existing?.id;
    await db().transaction(async tx => {
      if (connectionId) {
        await tx.execute(sql`
          UPDATE integration_connections
          SET connected_user_id = ${input.userId}::uuid,
              external_account_id = ${input.email}, external_resource_id = ${input.resourceId}, external_resource_name = ${input.displayName},
              token_ciphertext = ${encryptSecret(input.token)}, token_expires_at = ${new Date(input.token.expiresAt)}, granted_scopes = ${input.scopes}::text[],
              status = 'CONNECTED', sync_direction = 'TWO_WAY', settings = ${json(input.settings)}::jsonb, provider_metadata = ${json(input.metadata)}::jsonb,
              connected_by_user_id = ${input.userId}::uuid, connected_at = now(), disconnected_at = NULL,
              last_sync_error = NULL, updated_at = now()
          WHERE id = ${connectionId}::uuid AND tenant_id = ${input.tenantId}::uuid
        `);
      } else {
        const created = await tx.execute(sql`
          INSERT INTO integration_connections(
            tenant_id, connected_user_id, kind, provider, external_account_id, external_resource_id, external_resource_name,
            token_ciphertext, token_expires_at, granted_scopes, status, sync_direction, settings, provider_metadata,
            connected_by_user_id, connected_at
          ) VALUES(
            ${input.tenantId}::uuid, ${input.userId}::uuid, 'COMMUNICATION', ${input.provider}, ${input.email}, ${input.resourceId}, ${input.displayName},
            ${encryptSecret(input.token)}, ${new Date(input.token.expiresAt)}, ${input.scopes}::text[], 'CONNECTED', 'TWO_WAY', ${json(input.settings)}::jsonb, ${json(input.metadata)}::jsonb,
            ${input.userId}::uuid, now()
          ) RETURNING id
        `);
        connectionId = String((created.rows[0] as any).id);
      }
      await tx.execute(sql`
        UPDATE communication_channels
        SET status = 'DISCONNECTED', updated_at = now()
        WHERE tenant_id = ${input.tenantId}::uuid
          AND channel_type = 'EMAIL'
          AND (credentials_reference IS NULL OR credentials_reference <> ${connectionId}::uuid)
      `);
      const channel = await tx.execute(sql`
        SELECT id FROM communication_channels
        WHERE tenant_id = ${input.tenantId}::uuid AND channel_type = 'EMAIL' AND lower(external_account_id) = lower(${input.email})
        LIMIT 1
      `);
      if (channel.rows[0]) {
        await tx.execute(sql`
          UPDATE communication_channels
          SET provider = ${input.provider}, display_name = ${input.displayName || input.email}, status = 'CONNECTED',
              capabilities = ARRAY['MESSAGES','THREADS','BOOKING_LINKS','FORMS','PAYMENTS'], credentials_reference = ${connectionId}::uuid,
              metadata_json = ${json({ mailboxProvider: input.provider })}::jsonb, connected_at = now(), last_health_check_at = now(), updated_at = now()
          WHERE id = ${(channel.rows[0] as any).id}::uuid
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO communication_channels(
            tenant_id, channel_type, provider, display_name, external_account_id, status, capabilities, credentials_reference,
            metadata_json, connected_at, last_health_check_at
          ) VALUES(
            ${input.tenantId}::uuid, 'EMAIL', ${input.provider}, ${input.displayName || input.email}, ${input.email}, 'CONNECTED',
            ARRAY['MESSAGES','THREADS','BOOKING_LINKS','FORMS','PAYMENTS'], ${connectionId}::uuid,
            ${json({ mailboxProvider: input.provider })}::jsonb, now(), now()
          )
        `);
      }
      await tx.execute(sql`UPDATE tenants SET reply_to_email = ${input.email}, updated_at = now() WHERE id = ${input.tenantId}::uuid`);
      await tx.execute(sql`
        INSERT INTO platform_audit_events(tenant_id, action, target_type, target_id, outcome, event_category, description, environment, source_component, metadata)
        VALUES(${input.tenantId}::uuid, 'MAILBOX_CONNECTED', 'INTEGRATION', ${connectionId}, 'SUCCESS', 'INTEGRATION', 'business mailbox connected', ${process.env.NODE_ENV || 'development'}, 'mailboxes', jsonb_build_object('tenantUserId', ${input.userId}, 'provider', ${input.provider}))
      `);
    });
    return connectionId!;
  }

  private async connectionByProvider(tenantId: string, provider: MailboxProvider) {
    const result = await db().execute(sql`
      SELECT * FROM integration_connections
      WHERE tenant_id = ${tenantId}::uuid AND kind = 'COMMUNICATION' AND provider = ${provider}
      ORDER BY created_at DESC LIMIT 1
    `);
    return result.rows[0] as MailboxConnection | undefined;
  }

  private async connectionById(id: string, tenantId?: string) {
    const result = await db().execute(sql`
      SELECT * FROM integration_connections
      WHERE id = ${id}::uuid
        AND kind = 'COMMUNICATION'
        AND provider IN ('GOOGLE_MAIL', 'ZOHO_MAIL')
        AND (${tenantId || null}::uuid IS NULL OR tenant_id = ${tenantId || null}::uuid)
      LIMIT 1
    `);
    const row = result.rows[0] as MailboxConnection | undefined;
    if (!row || !row.token_ciphertext) throw fail(404, 'MAILBOX_CONNECTION_NOT_FOUND', 'Connected mailbox was not found.');
    return row;
  }

  private async validToken(connection: MailboxConnection) {
    const token = decryptSecret<StoredMailboxToken>(connection.token_ciphertext);
    if (token.accessToken && token.expiresAt > Date.now() + 60_000) return token;
    if (!token.refreshToken) throw fail(401, 'MAILBOX_REAUTHORISATION_REQUIRED', 'Mailbox authorization has expired.');
    let refreshed: any;
    if (connection.provider === 'GOOGLE_MAIL') {
      refreshed = await requestJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_MAIL_CLIENT_ID!,
          client_secret: process.env.GOOGLE_MAIL_CLIENT_SECRET!,
          refresh_token: token.refreshToken,
          grant_type: 'refresh_token',
        }),
      }, 'GOOGLE');
    } else {
      if (!token.accountsServer) throw fail(401, 'ZOHO_REAUTHORISATION_REQUIRED', 'Zoho data-centre information is missing.');
      refreshed = await requestJson(`${token.accountsServer}/oauth/v2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.ZOHO_MAIL_CLIENT_ID!,
          client_secret: process.env.ZOHO_MAIL_CLIENT_SECRET!,
          refresh_token: token.refreshToken,
          grant_type: 'refresh_token',
        }),
      }, 'ZOHO');
    }
    const updated: StoredMailboxToken = {
      ...token,
      accessToken: String(refreshed.access_token || ''),
      expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
      tokenType: String(refreshed.token_type || token.tokenType || 'Bearer'),
    };
    if (!updated.accessToken) throw fail(401, 'MAILBOX_REAUTHORISATION_REQUIRED', 'Mailbox access could not be refreshed.');
    await db().execute(sql`
      UPDATE integration_connections
      SET token_ciphertext = ${encryptSecret(updated)}, token_expires_at = ${new Date(updated.expiresAt)}, updated_at = now()
      WHERE id = ${connection.id}::uuid
    `);
    connection.token_ciphertext = encryptSecret(updated);
    return updated;
  }

  private async channelForConnection(connection: MailboxConnection) {
    const result = await db().execute(sql`
      SELECT id FROM communication_channels
      WHERE tenant_id = ${connection.tenant_id}::uuid AND channel_type = 'EMAIL' AND status = 'CONNECTED' AND credentials_reference = ${connection.id}::uuid
      LIMIT 1
    `);
    const row = result.rows[0] as { id: string } | undefined;
    if (!row) throw fail(409, 'MAILBOX_CHANNEL_NOT_CONNECTED', 'Mailbox email channel is not connected.');
    return row.id;
  }

  private async syncGoogle(connection: MailboxConnection, token: StoredMailboxToken) {
    const channelId = await this.channelForConnection(connection);
    const overlap = Number(connection.settings?.syncOverlapSeconds || 300);
    const base = connection.last_successful_sync_at || connection.connected_at || new Date();
    const since = Math.max(0, Math.floor((new Date(base).getTime() - overlap * 1000) / 1000));
    const query = new URLSearchParams({ maxResults: '50', q: `in:inbox after:${since}` });
    const list = await requestJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    }, 'GOOGLE');
    let accepted = 0;
    for (const item of Array.isArray(list.messages) ? list.messages : []) {
      const message = await requestJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(String(item.id))}?format=full`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      }, 'GOOGLE');
      if (!Array.isArray(message.labelIds) || !message.labelIds.includes('INBOX')) continue;
      const from = googleHeader(message.payload, 'From');
      const senderEmail = emailAddress(from);
      if (!senderEmail || senderEmail === connection.external_account_id.toLowerCase()) continue;
      const extracted = googlePartBody(message.payload);
      const content = extracted.text.trim() || String(message.snippet || '').trim() || (extracted.attachments ? '[Email attachment received]' : '[Email received]');
      const body = extracted.attachments ? `${content}\n\n[${extracted.attachments} attachment${extracted.attachments === 1 ? '' : 's'} received]` : content;
      const result = await this.ingest.ingest({
        tenantId: connection.tenant_id,
        channelId,
        channel: 'EMAIL',
        externalSenderId: senderEmail,
        externalMessageId: `gmail:${String(message.id)}`,
        body,
        customerName: displayName(from),
        customerEmail: senderEmail,
        metadata: {
          subject: googleHeader(message.payload, 'Subject'),
          gmailMessageId: String(message.id),
          gmailThreadId: String(message.threadId || ''),
          rfcMessageId: googleHeader(message.payload, 'Message-ID'),
          inReplyTo: googleHeader(message.payload, 'In-Reply-To'),
          providerTimestamp: message.internalDate || null,
          attachmentCount: extracted.attachments,
        },
      });
      if (result.accepted && !result.duplicate) accepted += 1;
    }
    return accepted;
  }

  private async syncZoho(connection: MailboxConnection, token: StoredMailboxToken) {
    if (!token.mailApiBase || !connection.external_resource_id) throw fail(401, 'ZOHO_REAUTHORISATION_REQUIRED', 'Zoho mailbox metadata is incomplete.');
    const channelId = await this.channelForConnection(connection);
    const inboxFolderId = String(connection.settings?.inboxFolderId || '');
    if (!inboxFolderId) throw fail(409, 'ZOHO_INBOX_FOLDER_REQUIRED', 'Zoho Inbox folder is not configured.');
    const overlap = Number(connection.settings?.syncOverlapSeconds || 300);
    const base = connection.last_successful_sync_at || connection.connected_at || new Date();
    const sinceMs = new Date(base).getTime() - overlap * 1000;
    const query = new URLSearchParams({ folderId: inboxFolderId, start: '1', limit: '100', sortBy: 'date', sortorder: 'false', includeto: 'true' });
    const list = await requestJson(`${token.mailApiBase}/api/accounts/${encodeURIComponent(connection.external_resource_id)}/messages/view?${query}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token.accessToken}` },
    }, 'ZOHO');
    let accepted = 0;
    for (const item of Array.isArray(list.data) ? list.data : []) {
      const receivedAt = Number(item.receivedTime || item.sentDateInGMT || 0);
      if (receivedAt && receivedAt < sinceMs) break;
      const senderEmail = emailAddress(String(item.fromAddress || ''));
      if (!senderEmail || senderEmail === connection.external_account_id.toLowerCase()) continue;
      const contentResult = await requestJson(
        `${token.mailApiBase}/api/accounts/${encodeURIComponent(connection.external_resource_id)}/folders/${encodeURIComponent(String(item.folderId || inboxFolderId))}/messages/${encodeURIComponent(String(item.messageId))}/content`,
        { headers: { Authorization: `Zoho-oauthtoken ${token.accessToken}` } },
        'ZOHO',
      );
      const body = htmlToText(String(contentResult?.data?.content || item.summary || '')) || '[Email received]';
      const result = await this.ingest.ingest({
        tenantId: connection.tenant_id,
        channelId,
        channel: 'EMAIL',
        externalSenderId: senderEmail,
        externalMessageId: `zoho:${String(item.messageId)}`,
        body,
        customerName: String(item.sender || '').trim() || undefined,
        customerEmail: senderEmail,
        metadata: {
          subject: String(item.subject || ''),
          zohoMessageId: String(item.messageId || ''),
          zohoThreadId: String(item.threadId || ''),
          zohoFolderId: String(item.folderId || inboxFolderId),
          providerTimestamp: String(item.receivedTime || item.sentDateInGMT || ''),
          attachmentCount: Number(item.hasAttachment || 0),
        },
      });
      if (result.accepted && !result.duplicate) accepted += 1;
    }
    return accepted;
  }

  private async sendGoogle(connection: MailboxConnection, token: StoredMailboxToken, input: SendConnectedEmailInput) {
    const metadata = input.conversationMetadata || {};
    const headers = [
      `From: ${encodedHeader(input.senderName)} <${cleanHeader(connection.external_account_id)}>`,
      `To: ${cleanHeader(input.to)}`,
      `Subject: ${encodedHeader(input.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
    ];
    if (metadata.rfcMessageId) {
      headers.push(`In-Reply-To: ${cleanHeader(String(metadata.rfcMessageId))}`);
      headers.push(`References: ${cleanHeader(String(metadata.rfcMessageId))}`);
    }
    const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${input.body}`, 'utf8').toString('base64url');
    const response = await requestJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw, ...(metadata.gmailThreadId ? { threadId: String(metadata.gmailThreadId) } : {}) }),
    }, 'GOOGLE');
    if (!response.id) throw fail(502, 'GOOGLE_MESSAGE_ID_MISSING', 'Google accepted the request without returning a message ID.');
    return String(response.id);
  }

  private async sendZoho(connection: MailboxConnection, token: StoredMailboxToken, input: SendConnectedEmailInput) {
    if (!token.mailApiBase || !connection.external_resource_id) throw fail(401, 'ZOHO_REAUTHORISATION_REQUIRED', 'Zoho mailbox metadata is incomplete.');
    const metadata = input.conversationMetadata || {};
    const payload = {
      fromAddress: connection.external_account_id,
      toAddress: input.to,
      subject: input.subject,
      content: input.body,
      mailFormat: 'plaintext',
      encoding: 'UTF-8',
    };
    const base = `${token.mailApiBase}/api/accounts/${encodeURIComponent(connection.external_resource_id)}/messages`;
    let response: any;
    if (metadata.zohoMessageId) {
      try {
        response = await requestJson(`${base}/${encodeURIComponent(String(metadata.zohoMessageId))}`, {
          method: 'POST',
          headers: { Authorization: `Zoho-oauthtoken ${token.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, action: 'reply' }),
        }, 'ZOHO');
      } catch (cause) {
        if ((cause as any)?.statusCode === 401) throw cause;
      }
    }
    if (!response) {
      response = await requestJson(base, {
        method: 'POST',
        headers: { Authorization: `Zoho-oauthtoken ${token.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 'ZOHO');
    }
    const messageId = response?.data?.messageId || response?.data?.mailId || response?.messageId;
    if (!messageId) throw fail(502, 'ZOHO_MESSAGE_ID_MISSING', 'Zoho accepted the request without returning a message ID.');
    return String(messageId);
  }
}
