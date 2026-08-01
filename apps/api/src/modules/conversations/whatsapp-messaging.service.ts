import { sql } from 'drizzle-orm';
import { getDatabase } from '@ks-os/database';
import type {
  SendConversationMessage,
  UpdateWhatsAppMarketingConsent,
  WhatsAppSendPolicy,
  WhatsAppTemplate,
} from '@ks-os/contracts';
import { decryptSecret } from '../integrations/integration-security.js';

const FREQUENCY_CAP_DAYS = 7;
const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const normaliseTier = (value: unknown): WhatsAppSendPolicy['packageTier'] => {
  const tier = String(value || 'core').toUpperCase();
  return tier === 'SCALE' ? 'SCALE' : tier === 'GROWTH' ? 'GROWTH' : 'CORE';
};
const normalisePhone = (value: unknown) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `+${digits}` : '';
};
const accessTokenFrom = (ciphertext: string | null) => {
  if (!ciphertext) return '';
  const secret = decryptSecret<Record<string, unknown>>(ciphertext);
  return String(secret.accessToken || secret.access_token || secret.token || '');
};

export class WhatsAppMessagingService {
  private db = getDatabase();

  async policy(tenantId: string, conversationId: string): Promise<WhatsAppSendPolicy> {
    const context = await this.db.execute(sql`
      select c.client_id "clientId",
             c.customer_phone "customerPhone",
             c.whatsapp_service_window_expires_at "serviceWindowExpiresAt",
             t.package_tier "packageTier"
      from conversations c
      join tenants t on t.id=c.tenant_id
      where c.id=${conversationId}::uuid and c.tenant_id=${tenantId}::uuid
      limit 1
    `);
    const row = context.rows[0] as any;
    if (!row) throw fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');

    let expiresAt = row.serviceWindowExpiresAt ? new Date(row.serviceWindowExpiresAt) : null;
    if (!expiresAt) {
      const latestInbound = await this.db.execute(sql`
        select max(created_at) "lastInboundAt"
        from conversation_messages
        where tenant_id=${tenantId}::uuid
          and conversation_id=${conversationId}::uuid
          and channel_type='WHATSAPP'
          and direction='INBOUND'
      `);
      const lastInboundAt = (latestInbound.rows[0] as any)?.lastInboundAt;
      if (lastInboundAt) expiresAt = new Date(new Date(lastInboundAt).getTime() + 24 * 60 * 60 * 1000);
    }

    const phone = normalisePhone(row.customerPhone);
    const consent = phone ? await this.db.execute(sql`
      select status
      from whatsapp_marketing_consents
      where tenant_id=${tenantId}::uuid and recipient_phone=${phone}
      limit 1
    `) : { rows: [] } as any;
    const consentStatus = String((consent.rows[0] as any)?.status || 'UNKNOWN') as WhatsAppSendPolicy['marketingConsentStatus'];

    const fallbackRows = await this.db.execute(sql`
      select distinct channel_type "channelType"
      from communication_channels
      where tenant_id=${tenantId}::uuid
        and channel_type in ('SMS','EMAIL')
        and status='CONNECTED'
    `);
    const fallbackChannels = fallbackRows.rows
      .map((item: any) => String(item.channelType))
      .filter((value): value is 'SMS' | 'EMAIL' => value === 'SMS' || value === 'EMAIL');

    const packageTier = normaliseTier(row.packageTier);
    const serviceWindowOpen = Boolean(expiresAt && expiresAt.getTime() > Date.now());
    return {
      packageTier,
      serviceWindowOpen,
      serviceWindowExpiresAt: iso(expiresAt),
      freeformAllowed: serviceWindowOpen,
      utilityTemplatesAllowed: packageTier === 'GROWTH' || packageTier === 'SCALE',
      marketingTemplatesAllowed: packageTier === 'SCALE',
      marketingConsentStatus: consentStatus,
      fallbackChannels,
    };
  }

  private async assertMarketingCapacity(tenantId: string, conversationId: string) {
    const result = await this.db.execute(sql`
      select tenant.whatsapp_marketing_monthly_message_limit "monthlyLimit",
             conversation.customer_phone "customerPhone",
             (
               select count(*)::int
               from conversation_messages message
               where message.tenant_id=tenant.id
                 and message.channel_type='WHATSAPP'
                 and message.direction='OUTBOUND'
                 and message.status<>'FAILED'
                 and message.metadata_json#>>'{whatsappTemplate,category}'='MARKETING'
                 and message.created_at>=date_trunc('month', now())
                 and message.created_at<date_trunc('month', now()) + interval '1 month'
             ) "usedThisMonth"
      from conversations conversation
      join tenants tenant on tenant.id=conversation.tenant_id
      where conversation.id=${conversationId}::uuid
        and conversation.tenant_id=${tenantId}::uuid
      limit 1
    `);
    const row = result.rows[0] as any;
    if (!row) throw fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
    const monthlyLimit = Math.max(1, Number(row.monthlyLimit || 500));
    if (Number(row.usedThisMonth || 0) >= monthlyLimit) {
      throw fail(409, 'WHATSAPP_MARKETING_MONTHLY_LIMIT_REACHED', 'The workspace has reached its monthly WhatsApp marketing limit.');
    }

    const phone = normalisePhone(row.customerPhone);
    if (!phone) throw fail(409, 'WHATSAPP_PHONE_REQUIRED', 'A customer phone number is required for WhatsApp marketing.');
    const recent = await this.db.execute(sql`
      select 1
      from conversation_messages message
      join conversations conversation
        on conversation.id=message.conversation_id and conversation.tenant_id=message.tenant_id
      where message.tenant_id=${tenantId}::uuid
        and message.channel_type='WHATSAPP'
        and message.direction='OUTBOUND'
        and message.status<>'FAILED'
        and message.metadata_json#>>'{whatsappTemplate,category}'='MARKETING'
        and conversation.customer_phone=${phone}
        and message.created_at>=now()-${FREQUENCY_CAP_DAYS} * interval '1 day'
      limit 1
    `);
    if (recent.rows[0]) {
      throw fail(409, 'WHATSAPP_MARKETING_FREQUENCY_CAP', `This customer has already received WhatsApp marketing within the last ${FREQUENCY_CAP_DAYS} days.`);
    }
  }

  async validateSend(tenantId: string, conversationId: string, input: SendConversationMessage) {
    const channel = input.channel || 'WHATSAPP';
    if (channel !== 'WHATSAPP') return { metadata: { source: 'KS_OS_INBOX' } };

    const policy = await this.policy(tenantId, conversationId);
    if (!input.whatsappTemplate) {
      if (!policy.freeformAllowed) {
        throw fail(409, 'WHATSAPP_SERVICE_WINDOW_CLOSED', 'The 24-hour WhatsApp service window is closed. Use an approved template, SMS or email.');
      }
      return { metadata: { source: 'KS_OS_INBOX', whatsappMessageKind: 'FREEFORM' }, policy };
    }

    const requested = input.whatsappTemplate;
    if (requested.category === 'MARKETING') {
      if (!policy.marketingTemplatesAllowed) {
        throw fail(403, 'WHATSAPP_MARKETING_REQUIRES_SCALE', 'WhatsApp marketing templates are available on the Scale plan.');
      }
      if (policy.marketingConsentStatus !== 'OPTED_IN') {
        throw fail(409, 'WHATSAPP_MARKETING_CONSENT_REQUIRED', 'Recorded WhatsApp marketing consent is required before this template can be sent.');
      }
      await this.assertMarketingCapacity(tenantId, conversationId);
    } else if (!policy.utilityTemplatesAllowed) {
      throw fail(403, 'WHATSAPP_TEMPLATES_REQUIRE_GROWTH', 'WhatsApp utility and authentication templates are available on the Growth plan and above.');
    }

    const templateRows = await this.db.execute(sql`
      select id, channel_id "channelId", name, language, category, status,
             components, quality_score "qualityScore", last_synced_at "lastSyncedAt"
      from whatsapp_message_templates
      where tenant_id=${tenantId}::uuid
        and name=${requested.name}
        and language=${requested.language}
        and category=${requested.category}
        and status='APPROVED'
      order by last_synced_at desc
      limit 1
    `);
    const template = templateRows.rows[0] as any;
    if (!template) throw fail(409, 'WHATSAPP_TEMPLATE_NOT_APPROVED', 'This WhatsApp template is not approved or has not been synced from Meta.');

    return {
      metadata: {
        source: 'KS_OS_INBOX',
        whatsappMessageKind: 'TEMPLATE',
        whatsappTemplate: {
          id: String(template.id),
          name: requested.name,
          language: requested.language,
          category: requested.category,
          components: requested.components || [],
        },
      },
      policy,
    };
  }

  async listTemplates(tenantId: string, conversationId: string): Promise<{ data: WhatsAppTemplate[]; policy: WhatsAppSendPolicy }> {
    const policy = await this.policy(tenantId, conversationId);
    const categories = policy.marketingTemplatesAllowed
      ? ['UTILITY', 'AUTHENTICATION', 'MARKETING']
      : policy.utilityTemplatesAllowed ? ['UTILITY', 'AUTHENTICATION'] : [];
    if (!categories.length) return { data: [], policy };

    const rows = await this.db.execute(sql`
      select id, channel_id "channelId", name, language, category, status,
             components, quality_score "qualityScore", last_synced_at "lastSyncedAt"
      from whatsapp_message_templates
      where tenant_id=${tenantId}::uuid
        and status='APPROVED'
        and category=any(${categories}::text[])
      order by category, name, language
    `);
    return {
      policy,
      data: rows.rows.map((row: any) => ({
        id: String(row.id),
        channelId: String(row.channelId),
        name: String(row.name),
        language: String(row.language),
        category: String(row.category) as WhatsAppTemplate['category'],
        status: String(row.status),
        components: Array.isArray(row.components) ? row.components : [],
        qualityScore: row.qualityScore ? String(row.qualityScore) : null,
        lastSyncedAt: iso(row.lastSyncedAt)!,
      })),
    };
  }

  async syncTemplates(tenantId: string) {
    const graphVersion = process.env.META_GRAPH_VERSION || '';
    if (!graphVersion) throw fail(503, 'META_GRAPH_VERSION_NOT_CONFIGURED', 'Meta Graph API version is not configured.');
    const channels = await this.db.execute(sql`
      select c.id "channelId", c.metadata_json "channelMetadata", i.token_ciphertext "tokenCiphertext"
      from communication_channels c
      join integration_connections i
        on i.id=c.credentials_reference and i.tenant_id=c.tenant_id
      where c.tenant_id=${tenantId}::uuid
        and c.channel_type='WHATSAPP'
        and c.status='CONNECTED'
        and i.status='CONNECTED'
    `);
    let synced = 0;
    for (const item of channels.rows as any[]) {
      const metadata = (item.channelMetadata || {}) as Record<string, unknown>;
      const wabaId = String(metadata.wabaId || '');
      const accessToken = accessTokenFrom(item.tokenCiphertext || null);
      if (!wabaId || !accessToken) continue;
      const fields = 'id,name,language,status,category,components,quality_score';
      const response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/message_templates?fields=${encodeURIComponent(fields)}&limit=250`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({})) as any;
      if (!response.ok || payload?.error) {
        throw fail(response.status >= 400 && response.status < 500 ? 400 : 502, 'META_TEMPLATE_SYNC_FAILED', String(payload?.error?.message || 'Meta template sync failed.').slice(0, 300));
      }
      for (const template of payload.data || []) {
        const components = JSON.stringify(template.components || []);
        await this.db.execute(sql`
          insert into whatsapp_message_templates(
            tenant_id, channel_id, provider_template_id, name, language, category,
            status, components, quality_score, last_synced_at, created_at, updated_at
          ) values (
            ${tenantId}::uuid, ${String(item.channelId)}::uuid, ${String(template.id || '') || null},
            ${String(template.name || '')}, ${String(template.language || '')}, ${String(template.category || '')},
            ${String(template.status || '')}, ${components}::jsonb, ${template.quality_score ? String(template.quality_score) : null},
            now(), now(), now()
          )
          on conflict (tenant_id, channel_id, name, language)
          do update set
            provider_template_id=excluded.provider_template_id,
            category=excluded.category,
            status=excluded.status,
            components=excluded.components,
            quality_score=excluded.quality_score,
            last_synced_at=now(),
            updated_at=now()
        `);
        synced += 1;
      }
    }
    return { synced };
  }

  async setMarketingConsent(tenantId: string, userId: string, conversationId: string, input: UpdateWhatsAppMarketingConsent) {
    const conversationRows = await this.db.execute(sql`
      select client_id "clientId", customer_phone "customerPhone"
      from conversations
      where id=${conversationId}::uuid and tenant_id=${tenantId}::uuid
      limit 1
    `);
    const conversation = conversationRows.rows[0] as any;
    if (!conversation) throw fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
    const phone = normalisePhone(conversation.customerPhone);
    if (!phone) throw fail(409, 'WHATSAPP_PHONE_REQUIRED', 'A customer phone number is required to record WhatsApp consent.');
    const evidence = JSON.stringify(input.evidence || {});
    const optedIn = input.status === 'OPTED_IN';
    await this.db.execute(sql`
      insert into whatsapp_marketing_consents(
        tenant_id, client_id, recipient_phone, status, source, evidence,
        consented_at, revoked_at, created_by_user_id, created_at, updated_at
      ) values (
        ${tenantId}::uuid, ${conversation.clientId || null}::uuid, ${phone}, ${input.status}, ${input.source}, ${evidence}::jsonb,
        ${optedIn ? new Date() : null}, ${optedIn ? null : new Date()}, ${userId}::uuid, now(), now()
      )
      on conflict (tenant_id, recipient_phone)
      do update set
        client_id=excluded.client_id,
        status=excluded.status,
        source=excluded.source,
        evidence=excluded.evidence,
        consented_at=excluded.consented_at,
        revoked_at=excluded.revoked_at,
        created_by_user_id=excluded.created_by_user_id,
        updated_at=now()
    `);
    return this.policy(tenantId, conversationId);
  }
}
