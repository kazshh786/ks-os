import { sql } from 'drizzle-orm';
import { getDatabase } from '@ks-os/database';
import { encryptSecret } from './integration-security.js';

type MetaConnectInput = {
  code: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
};

type MetaTokenDebug = {
  app_id?: string;
  is_valid?: boolean;
  user_id?: string;
  expires_at?: number;
  scopes?: string[];
  granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>;
};

type MetaPage = {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string; name?: string };
};

const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const version = () => process.env.META_GRAPH_VERSION || '';
const safeProviderMessage = (value: unknown) => String(value || 'Meta request failed').replace(/[\r\n\t]+/g, ' ').slice(0, 300);

export class MetaConnectionsService {
  private db = getDatabase();

  private config() {
    const appId = process.env.META_APP_ID || '';
    const appSecret = process.env.META_APP_SECRET || '';
    const graphVersion = version();
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || '';
    const configId = process.env.META_LOGIN_CONFIG_ID || '';
    return {
      appId,
      appSecret,
      graphVersion,
      verifyToken,
      configId,
      platformConfigured: Boolean(appId && appSecret && graphVersion && verifyToken),
      onboardingConfigured: Boolean(appId && appSecret && graphVersion && verifyToken && configId),
    };
  }

  private async graph<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
    const graphVersion = version();
    if (!graphVersion) throw fail(503, 'META_GRAPH_VERSION_NOT_CONFIGURED', 'Meta Graph API version is not configured.');
    const response = await fetch(`https://graph.facebook.com/${graphVersion}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok || payload?.error) {
      const providerCode = String(payload?.error?.code || response.status || 'UNKNOWN').replace(/[^A-Z0-9_-]/gi, '_');
      throw fail(response.status >= 400 && response.status < 500 ? 400 : 502, `META_${providerCode}`, safeProviderMessage(payload?.error?.message));
    }
    return payload as T;
  }

  private async exchangeCode(code: string) {
    const { appId, appSecret, graphVersion } = this.config();
    if (!appId || !appSecret || !graphVersion) throw fail(503, 'META_PLATFORM_NOT_CONFIGURED', 'Meta platform credentials are not configured.');
    const query = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/oauth/access_token?${query.toString()}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok || !payload.access_token) {
      throw fail(400, 'META_CODE_EXCHANGE_FAILED', safeProviderMessage(payload?.error?.message || 'Meta did not return an access token.'));
    }
    return { accessToken: String(payload.access_token), expiresIn: Number(payload.expires_in || 0) };
  }

  private async debugToken(accessToken: string) {
    const { appId, appSecret } = this.config();
    const query = new URLSearchParams({ input_token: accessToken });
    const payload = await this.graph<{ data?: MetaTokenDebug }>(`/debug_token?${query.toString()}`, `${appId}|${appSecret}`);
    if (!payload.data?.is_valid || payload.data.app_id !== appId) {
      throw fail(400, 'META_ACCESS_TOKEN_INVALID', 'Meta returned an invalid token for this KS OS app.');
    }
    return payload.data;
  }

  private async upsertCredential(input: {
    tenantId: string;
    userId: string;
    provider: string;
    externalAccountId?: string | null;
    externalResourceId: string;
    externalResourceName: string;
    accessToken: string;
    tokenExpiresAt: Date | null;
    scopes: string[];
    settings: Record<string, unknown>;
    providerMetadata: Record<string, unknown>;
  }) {
    const existing = await this.db.execute(sql`
      select id
      from integration_connections
      where tenant_id=${input.tenantId}::uuid
        and kind='MESSAGING'
        and provider=${input.provider}
        and external_resource_id=${input.externalResourceId}
      order by created_at desc
      limit 1
    `);
    const ciphertext = encryptSecret({ accessToken: input.accessToken });
    const settings = JSON.stringify(input.settings);
    const providerMetadata = JSON.stringify(input.providerMetadata);
    const existingId = (existing.rows[0] as { id?: string } | undefined)?.id;
    if (existingId) {
      const updated = await this.db.execute(sql`
        update integration_connections
        set external_account_id=${input.externalAccountId || null},
            external_resource_name=${input.externalResourceName},
            token_ciphertext=${ciphertext},
            token_expires_at=${input.tokenExpiresAt},
            granted_scopes=${input.scopes}::text[],
            status='CONNECTED',
            sync_direction='BIDIRECTIONAL',
            settings=${settings}::jsonb,
            provider_metadata=${providerMetadata}::jsonb,
            last_sync_error=null,
            disconnected_at=null,
            connected_by_user_id=${input.userId}::uuid,
            updated_at=now()
        where id=${existingId}::uuid and tenant_id=${input.tenantId}::uuid
        returning id
      `);
      return String((updated.rows[0] as { id: string }).id);
    }
    const inserted = await this.db.execute(sql`
      insert into integration_connections(
        tenant_id, connected_user_id, kind, provider, external_account_id,
        external_resource_id, external_resource_name, token_ciphertext,
        token_expires_at, granted_scopes, status, sync_direction, settings,
        provider_metadata, connected_by_user_id, last_successful_sync_at,
        last_attempted_sync_at
      ) values (
        ${input.tenantId}::uuid, ${input.userId}::uuid, 'MESSAGING', ${input.provider},
        ${input.externalAccountId || null}, ${input.externalResourceId}, ${input.externalResourceName},
        ${ciphertext}, ${input.tokenExpiresAt}, ${input.scopes}::text[], 'CONNECTED',
        'BIDIRECTIONAL', ${settings}::jsonb, ${providerMetadata}::jsonb,
        ${input.userId}::uuid, now(), now()
      ) returning id
    `);
    return String((inserted.rows[0] as { id: string }).id);
  }

  private async upsertChannel(input: {
    tenantId: string;
    channelType: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM';
    displayName: string;
    externalAccountId: string;
    credentialId: string;
    capabilities: string[];
    metadata: Record<string, unknown>;
  }) {
    const metadata = JSON.stringify(input.metadata);
    await this.db.execute(sql`
      insert into communication_channels(
        tenant_id, channel_type, provider, display_name, external_account_id,
        status, capabilities, credentials_reference, metadata_json,
        connected_at, last_health_check_at, created_at, updated_at
      ) values (
        ${input.tenantId}::uuid, ${input.channelType}, 'META', ${input.displayName},
        ${input.externalAccountId}, 'CONNECTED', ${input.capabilities}::text[],
        ${input.credentialId}::uuid, ${metadata}::jsonb, now(), now(), now(), now()
      )
      on conflict (tenant_id, channel_type, external_account_id)
      do update set
        provider='META',
        display_name=excluded.display_name,
        status='CONNECTED',
        capabilities=excluded.capabilities,
        credentials_reference=excluded.credentials_reference,
        metadata_json=excluded.metadata_json,
        connected_at=coalesce(communication_channels.connected_at, now()),
        last_health_check_at=now(),
        updated_at=now()
    `);
  }

  private async discoverWabaIds(accessToken: string, debug: MetaTokenDebug, input: MetaConnectInput) {
    const ids = new Set<string>();
    if (input.wabaId) ids.add(input.wabaId);
    for (const grant of debug.granular_scopes || []) {
      if (grant.scope === 'whatsapp_business_management' || grant.scope === 'whatsapp_business_messaging') {
        for (const targetId of grant.target_ids || []) ids.add(String(targetId));
      }
    }
    if (ids.size) return [...ids];
    try {
      const fields = 'id,name,owned_whatsapp_business_accounts.limit(100){id,name},client_whatsapp_business_accounts.limit(100){id,name}';
      const query = new URLSearchParams({ fields, limit: '100' });
      const businesses = await this.graph<{ data?: any[] }>(`/me/businesses?${query.toString()}`, accessToken);
      for (const business of businesses.data || []) {
        for (const account of business.owned_whatsapp_business_accounts?.data || []) ids.add(String(account.id));
        for (const account of business.client_whatsapp_business_accounts?.data || []) ids.add(String(account.id));
      }
    } catch {
      // Messenger-only and Instagram-only authorisations may not include WhatsApp assets.
    }
    return [...ids];
  }

  async status(tenantId: string) {
    const config = this.config();
    const channels = await this.db.execute(sql`
      select id, channel_type "channelType", display_name "displayName",
             external_account_id "externalAccountId", status,
             connected_at "connectedAt", last_health_check_at "lastHealthCheckAt"
      from communication_channels
      where tenant_id=${tenantId}::uuid and provider='META'
      order by channel_type, display_name
    `);
    return {
      providerConfigured: config.platformConfigured,
      onboardingConfigured: config.onboardingConfigured,
      appId: config.appId || null,
      configId: config.configId || null,
      graphVersion: config.graphVersion || null,
      billingModel: 'CUSTOMER_OWNED',
      channels: channels.rows,
    };
  }

  async connect(tenantId: string, userId: string, input: MetaConnectInput) {
    const config = this.config();
    if (!config.onboardingConfigured) {
      throw fail(503, 'META_ONBOARDING_NOT_CONFIGURED', 'Meta Login for Business configuration is not configured.');
    }
    const exchanged = await this.exchangeCode(input.code);
    const debug = await this.debugToken(exchanged.accessToken);
    const scopes = (debug.scopes || []).map(String);
    const tokenExpiresAt = debug.expires_at
      ? new Date(Number(debug.expires_at) * 1000)
      : exchanged.expiresIn > 0 ? new Date(Date.now() + exchanged.expiresIn * 1000) : null;
    const connected: Array<{ channel: string; id: string; name: string }> = [];

    const wabaIds = await this.discoverWabaIds(exchanged.accessToken, debug, input);
    for (const wabaId of wabaIds) {
      try {
        const fields = new URLSearchParams({ fields: 'id,name,currency,timezone_id,account_review_status,primary_funding_id,owner_business_info' });
        const waba = await this.graph<any>(`/${encodeURIComponent(wabaId)}?${fields.toString()}`, exchanged.accessToken);
        const phoneFields = new URLSearchParams({ fields: 'id,display_phone_number,verified_name,quality_rating,status', limit: '100' });
        const phones = await this.graph<{ data?: any[] }>(`/${encodeURIComponent(wabaId)}/phone_numbers?${phoneFields.toString()}`, exchanged.accessToken);
        await this.graph(`/${encodeURIComponent(wabaId)}/subscribed_apps`, exchanged.accessToken, { method: 'POST' });
        const credentialId = await this.upsertCredential({
          tenantId,
          userId,
          provider: 'META_WHATSAPP',
          externalAccountId: input.businessId || waba.owner_business_info?.id || debug.user_id || null,
          externalResourceId: String(waba.id || wabaId),
          externalResourceName: String(waba.name || 'WhatsApp Business Account'),
          accessToken: exchanged.accessToken,
          tokenExpiresAt,
          scopes,
          settings: { billingResponsibility: 'CUSTOMER', wabaCurrency: waba.currency || null },
          providerMetadata: {
            wabaId: String(waba.id || wabaId),
            reviewStatus: waba.account_review_status || null,
            fundingConfigured: Boolean(waba.primary_funding_id),
            timezoneId: waba.timezone_id || null,
          },
        });
        for (const phone of phones.data || []) {
          if (input.phoneNumberId && String(phone.id) !== input.phoneNumberId) continue;
          await this.upsertChannel({
            tenantId,
            channelType: 'WHATSAPP',
            displayName: String(phone.verified_name || phone.display_phone_number || waba.name || 'WhatsApp'),
            externalAccountId: String(phone.id),
            credentialId,
            capabilities: ['MESSAGES', 'TEMPLATES', 'BOOKING_LINKS', 'FORMS', 'PAYMENTS'],
            metadata: {
              wabaId: String(waba.id || wabaId),
              displayPhoneNumber: phone.display_phone_number || null,
              qualityRating: phone.quality_rating || null,
              providerStatus: phone.status || null,
            },
          });
          connected.push({ channel: 'WHATSAPP', id: String(phone.id), name: String(phone.verified_name || phone.display_phone_number || 'WhatsApp') });
        }
      } catch (cause) {
        if (input.wabaId) throw cause;
      }
    }

    try {
      const pageFields = new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account{id,username,name}', limit: '100' });
      const pages = await this.graph<{ data?: MetaPage[] }>(`/me/accounts?${pageFields.toString()}`, exchanged.accessToken);
      for (const page of pages.data || []) {
        if (!page.id || !page.access_token) continue;
        let pageSubscriptionReady: boolean = false;
        try {
          const query = new URLSearchParams({ subscribed_fields: 'messages,messaging_postbacks,message_deliveries,message_reads' });
          await this.graph(`/${encodeURIComponent(page.id)}/subscribed_apps?${query.toString()}`, page.access_token, { method: 'POST' });
          pageSubscriptionReady = true;
        } catch {
          pageSubscriptionReady = false;
        }
        const credentialId = await this.upsertCredential({
          tenantId,
          userId,
          provider: 'META_FACEBOOK',
          externalAccountId: input.businessId || debug.user_id || null,
          externalResourceId: String(page.id),
          externalResourceName: String(page.name || 'Facebook Page'),
          accessToken: page.access_token,
          tokenExpiresAt,
          scopes,
          settings: { billingResponsibility: 'CUSTOMER' },
          providerMetadata: { pageId: page.id, pageSubscriptionReady },
        });
        await this.upsertChannel({
          tenantId,
          channelType: 'FACEBOOK',
          displayName: String(page.name || 'Facebook Page'),
          externalAccountId: String(page.id),
          credentialId,
          capabilities: ['MESSAGES', 'COMMENTS', 'PUBLISHING', 'BOOKING_LINKS'],
          metadata: { pageId: page.id, pageSubscriptionReady },
        });
        connected.push({ channel: 'FACEBOOK', id: String(page.id), name: String(page.name || 'Facebook Page') });

        const instagram = page.instagram_business_account;
        if (instagram?.id) {
          let instagramSubscriptionReady: boolean = false;
          try {
            const query = new URLSearchParams({ subscribed_fields: 'messages,messaging_postbacks' });
            await this.graph(`/${encodeURIComponent(instagram.id)}/subscribed_apps?${query.toString()}`, page.access_token, { method: 'POST' });
            instagramSubscriptionReady = true;
          } catch {
            instagramSubscriptionReady = false;
          }
          await this.upsertChannel({
            tenantId,
            channelType: 'INSTAGRAM',
            displayName: String(instagram.username ? `@${instagram.username}` : instagram.name || 'Instagram'),
            externalAccountId: String(instagram.id),
            credentialId,
            capabilities: ['MESSAGES', 'COMMENTS', 'PUBLISHING', 'BOOKING_LINKS'],
            metadata: { pageId: page.id, instagramAccountId: instagram.id, instagramSubscriptionReady },
          });
          connected.push({ channel: 'INSTAGRAM', id: String(instagram.id), name: String(instagram.username ? `@${instagram.username}` : instagram.name || 'Instagram') });
        }
      }
    } catch {
      // WhatsApp-only authorisations do not necessarily include Page permissions.
    }

    if (!connected.length) {
      throw fail(409, 'META_NO_MESSAGING_ASSETS', 'No WhatsApp number, Facebook Page, or Instagram professional account was authorised.');
    }

    await this.db.execute(sql`
      insert into platform_audit_events(
        tenant_id, action, target_type, target_id, outcome, event_category,
        description, environment, source_component, metadata
      ) values (
        ${tenantId}::uuid, 'META_MESSAGING_CONNECTED', 'TENANT', ${tenantId},
        'SUCCESS', 'INTEGRATION', 'Meta messaging assets connected',
        ${process.env.NODE_ENV || 'development'}, 'meta-connections',
        jsonb_build_object('tenantUserId', ${userId}, 'connectedCount', ${connected.length})
      )
    `);
    return { connected, status: await this.status(tenantId) };
  }

  async disconnect(tenantId: string, userId: string) {
    await this.db.execute(sql`
      update communication_channels
      set status='DISCONNECTED', credentials_reference=null, updated_at=now()
      where tenant_id=${tenantId}::uuid and provider='META'
    `);
    await this.db.execute(sql`
      update integration_connections
      set status='DISCONNECTED', token_ciphertext=null, disconnected_at=now(), updated_at=now()
      where tenant_id=${tenantId}::uuid and provider like 'META_%'
    `);
    await this.db.execute(sql`
      insert into platform_audit_events(
        tenant_id, action, target_type, target_id, outcome, event_category,
        description, environment, source_component, metadata
      ) values (
        ${tenantId}::uuid, 'META_MESSAGING_DISCONNECTED', 'TENANT', ${tenantId},
        'SUCCESS', 'INTEGRATION', 'Meta messaging assets disconnected',
        ${process.env.NODE_ENV || 'development'}, 'meta-connections',
        jsonb_build_object('tenantUserId', ${userId})
      )
    `);
    return this.status(tenantId);
  }
}
