import { sql } from 'drizzle-orm';
import { getDatabase } from '@ks-os/database';
import type {
  CreateWhatsAppCampaign,
  WhatsAppCampaignAudience,
  WhatsAppCampaignListResponse,
  WhatsAppTemplate,
} from '@ks-os/contracts';

const FREQUENCY_CAP_DAYS = 7;
const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const normaliseTier = (value: unknown) => String(value || 'core').toUpperCase();
const phoneDigits = (value: string) => value.replace(/\D/g, '');

const bodyComponent = (components: unknown) => Array.isArray(components)
  ? (components as Array<Record<string, unknown>>).find(component => String(component.type || '').toUpperCase() === 'BODY')
  : undefined;

const variableCount = (components: unknown) => {
  const text = String(bodyComponent(components)?.text || '');
  let maximum = 0;
  for (const match of text.matchAll(/\{\{(\d+)\}\}/g)) maximum = Math.max(maximum, Number(match[1] || 0));
  return maximum;
};

const preview = (name: string, components: unknown, parameters: string[]) => {
  let text = String(bodyComponent(components)?.text || name.replaceAll('_', ' '));
  parameters.forEach((value, index) => { text = text.replaceAll(`{{${index + 1}}}`, value); });
  return text.slice(0, 8000);
};

const templateComponents = (parameters: string[]) => parameters.length
  ? [{ type: 'body', parameters: parameters.map(text => ({ type: 'text', text })) }]
  : [];

export class WhatsAppCampaignService {
  private db = getDatabase();

  private async tenantPolicy(tenantId: string) {
    const result = await this.db.execute(sql`
      select package_tier "packageTier",
             whatsapp_marketing_monthly_message_limit "monthlyLimit"
      from tenants
      where id=${tenantId}::uuid
      limit 1
    `);
    const row = result.rows[0] as any;
    if (!row) throw fail(404, 'TENANT_NOT_FOUND', 'Business workspace not found.');
    return {
      packageTier: normaliseTier(row.packageTier),
      monthlyLimit: Math.max(1, Math.min(Number(row.monthlyLimit || 500), 100000)),
    };
  }

  private async requireScale(tenantId: string) {
    const policy = await this.tenantPolicy(tenantId);
    if (policy.packageTier !== 'SCALE') {
      throw fail(403, 'WHATSAPP_MARKETING_REQUIRES_SCALE', 'WhatsApp marketing campaigns are available on the Scale plan.');
    }
    return policy;
  }

  private async usedThisMonth(tenantId: string) {
    const result = await this.db.execute(sql`
      select count(*)::int value
      from whatsapp_marketing_campaign_recipients
      where tenant_id=${tenantId}::uuid
        and status='QUEUED'
        and created_at>=date_trunc('month', now())
        and created_at<date_trunc('month', now()) + interval '1 month'
    `);
    return Number((result.rows[0] as any)?.value || 0);
  }

  private async marketingTemplates(tenantId: string): Promise<WhatsAppTemplate[]> {
    const rows = await this.db.execute(sql`
      select id, channel_id "channelId", name, language, category, status,
             components, quality_score "qualityScore", last_synced_at "lastSyncedAt"
      from whatsapp_message_templates
      where tenant_id=${tenantId}::uuid
        and category='MARKETING'
        and status='APPROVED'
      order by name, language
    `);
    return rows.rows.map((row: any) => ({
      id: String(row.id),
      channelId: String(row.channelId),
      name: String(row.name),
      language: String(row.language),
      category: 'MARKETING' as const,
      status: String(row.status),
      components: Array.isArray(row.components) ? row.components : [],
      qualityScore: row.qualityScore ? String(row.qualityScore) : null,
      lastSyncedAt: iso(row.lastSyncedAt)!,
    }));
  }

  async list(tenantId: string): Promise<WhatsAppCampaignListResponse> {
    const policy = await this.tenantPolicy(tenantId);
    const usedThisMonth = await this.usedThisMonth(tenantId);
    const campaigns = await this.db.execute(sql`
      select campaign.id,
             campaign.name,
             campaign.status,
             campaign.audience_type "audienceType",
             campaign.template_id "templateId",
             template.name "templateName",
             template.language "templateLanguage",
             campaign.scheduled_at "scheduledAt",
             campaign.recipient_limit "recipientLimit",
             count(recipient.id) filter (where recipient.status='QUEUED' and message.status='QUEUED')::int "queuedCount",
             count(recipient.id) filter (where recipient.status='QUEUED' and message.status='SENT')::int "sentCount",
             count(recipient.id) filter (where recipient.status='QUEUED' and message.status='DELIVERED')::int "deliveredCount",
             count(recipient.id) filter (where recipient.status='QUEUED' and message.status='READ')::int "readCount",
             count(recipient.id) filter (where recipient.status='QUEUED' and message.status='FAILED')::int "failedCount",
             count(recipient.id) filter (where recipient.status='SKIPPED')::int "skippedCount",
             campaign.failure_code "failureCode",
             campaign.created_at "createdAt"
      from whatsapp_marketing_campaigns campaign
      join whatsapp_message_templates template
        on template.id=campaign.template_id and template.tenant_id=campaign.tenant_id
      left join whatsapp_marketing_campaign_recipients recipient
        on recipient.campaign_id=campaign.id and recipient.tenant_id=campaign.tenant_id
      left join conversation_messages message
        on message.id=recipient.message_id and message.tenant_id=campaign.tenant_id
      where campaign.tenant_id=${tenantId}::uuid
      group by campaign.id, template.id
      order by campaign.created_at desc
      limit 100
    `);
    return {
      data: campaigns.rows.map((row: any) => ({
        id: String(row.id),
        name: String(row.name),
        status: String(row.status) as any,
        audienceType: String(row.audienceType) as any,
        templateId: String(row.templateId),
        templateName: String(row.templateName),
        templateLanguage: String(row.templateLanguage),
        scheduledAt: iso(row.scheduledAt)!,
        recipientLimit: Number(row.recipientLimit),
        queuedCount: Number(row.queuedCount || 0),
        sentCount: Number(row.sentCount || 0),
        deliveredCount: Number(row.deliveredCount || 0),
        readCount: Number(row.readCount || 0),
        failedCount: Number(row.failedCount || 0),
        skippedCount: Number(row.skippedCount || 0),
        failureCode: row.failureCode ? String(row.failureCode) : null,
        createdAt: iso(row.createdAt)!,
      })),
      meta: {
        packageTier: policy.packageTier === 'SCALE' ? 'SCALE' : policy.packageTier === 'GROWTH' ? 'GROWTH' : 'CORE',
        monthlyLimit: policy.monthlyLimit,
        usedThisMonth,
        remainingThisMonth: Math.max(0, policy.monthlyLimit - usedThisMonth),
        frequencyCapDays: FREQUENCY_CAP_DAYS,
        marketingTemplates: await this.marketingTemplates(tenantId),
      },
    };
  }

  async create(tenantId: string, userId: string, input: CreateWhatsAppCampaign) {
    const policy = await this.requireScale(tenantId);
    const used = await this.usedThisMonth(tenantId);
    if (used >= policy.monthlyLimit) {
      throw fail(409, 'WHATSAPP_MARKETING_MONTHLY_LIMIT_REACHED', 'The workspace has reached its monthly WhatsApp marketing limit.');
    }

    const templateRows = await this.db.execute(sql`
      select template.id,
             template.channel_id "channelId",
             template.name,
             template.language,
             template.components,
             channel.status "channelStatus"
      from whatsapp_message_templates template
      join communication_channels channel
        on channel.id=template.channel_id and channel.tenant_id=template.tenant_id
      where template.id=${input.templateId}::uuid
        and template.tenant_id=${tenantId}::uuid
        and template.category='MARKETING'
        and template.status='APPROVED'
        and channel.channel_type='WHATSAPP'
      limit 1
    `);
    const template = templateRows.rows[0] as any;
    if (!template || template.channelStatus !== 'CONNECTED') {
      throw fail(409, 'WHATSAPP_MARKETING_TEMPLATE_UNAVAILABLE', 'Select an approved marketing template from a connected WhatsApp account.');
    }
    const expectedParameters = variableCount(template.components);
    if (input.templateParameters.length !== expectedParameters || input.templateParameters.some(value => !value.trim())) {
      throw fail(400, 'WHATSAPP_TEMPLATE_PARAMETERS_INVALID', `This template requires ${expectedParameters} completed value${expectedParameters === 1 ? '' : 's'}.`);
    }

    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
      throw fail(400, 'WHATSAPP_CAMPAIGN_SCHEDULE_INVALID', 'Campaigns can be scheduled up to one year ahead.');
    }
    const parameters = JSON.stringify(input.templateParameters);
    const inserted = await this.db.execute(sql`
      insert into whatsapp_marketing_campaigns(
        tenant_id, channel_id, template_id, name, status, audience_type,
        template_parameters, scheduled_at, recipient_limit, created_by_user_id,
        created_at, updated_at
      ) values (
        ${tenantId}::uuid, ${String(template.channelId)}::uuid, ${input.templateId}::uuid,
        ${input.name}, 'SCHEDULED', ${input.audienceType}, ${parameters}::jsonb,
        ${scheduledAt}, ${Math.min(input.recipientLimit, policy.monthlyLimit - used)},
        ${userId}::uuid, now(), now()
      ) returning id
    `);
    const campaignId = String((inserted.rows[0] as any).id);
    await this.db.execute(sql`
      insert into platform_audit_events(
        tenant_id, action, target_type, target_id, outcome, event_category,
        description, environment, source_component, metadata
      ) values (
        ${tenantId}::uuid, 'WHATSAPP_MARKETING_CAMPAIGN_SCHEDULED', 'WHATSAPP_CAMPAIGN', ${campaignId},
        'SUCCESS', 'COMMUNICATION', 'WhatsApp marketing campaign scheduled',
        ${process.env.NODE_ENV || 'development'}, 'whatsapp-campaigns',
        jsonb_build_object('tenantUserId', ${userId}, 'audienceType', ${input.audienceType})
      )
    `);
    return { id: campaignId };
  }

  async cancel(tenantId: string, userId: string, campaignId: string) {
    const result = await this.db.execute(sql`
      update whatsapp_marketing_campaigns
      set status='CANCELLED', cancelled_at=now(), updated_at=now()
      where id=${campaignId}::uuid
        and tenant_id=${tenantId}::uuid
        and status='SCHEDULED'
      returning id
    `);
    if (!result.rows[0]) throw fail(409, 'WHATSAPP_CAMPAIGN_NOT_CANCELLABLE', 'Only a scheduled campaign can be cancelled.');
    await this.db.execute(sql`
      insert into platform_audit_events(
        tenant_id, action, target_type, target_id, outcome, event_category,
        description, environment, source_component, metadata
      ) values (
        ${tenantId}::uuid, 'WHATSAPP_MARKETING_CAMPAIGN_CANCELLED', 'WHATSAPP_CAMPAIGN', ${campaignId},
        'SUCCESS', 'COMMUNICATION', 'WhatsApp marketing campaign cancelled',
        ${process.env.NODE_ENV || 'development'}, 'whatsapp-campaigns',
        jsonb_build_object('tenantUserId', ${userId})
      )
    `);
    return { id: campaignId, status: 'CANCELLED' as const };
  }

  private audienceCondition(audienceType: WhatsAppCampaignAudience) {
    if (audienceType === 'UPCOMING_BOOKING_30_DAYS') return sql`
      exists (
        select 1 from appointments appointment
        where appointment.tenant_id=consent.tenant_id
          and appointment.client_id=consent.client_id
          and appointment.start_time>=now()
          and appointment.start_time<now()+interval '30 days'
          and appointment.status not in ('CANCELLED','NO_SHOW','COMPLETED','BLOCKED')
      )
    `;
    if (audienceType === 'LAPSED_90_DAYS') return sql`
      exists (
        select 1 from appointments historic
        where historic.tenant_id=consent.tenant_id
          and historic.client_id=consent.client_id
          and historic.status='COMPLETED'
          and historic.start_time<now()-interval '90 days'
      )
      and not exists (
        select 1 from appointments recent
        where recent.tenant_id=consent.tenant_id
          and recent.client_id=consent.client_id
          and recent.status='COMPLETED'
          and recent.start_time>=now()-interval '90 days'
      )
    `;
    return sql`true`;
  }

  private async dispatchCampaign(campaign: any) {
    const policy = await this.requireScale(String(campaign.tenantId));
    const used = await this.usedThisMonth(String(campaign.tenantId));
    const remaining = Math.max(0, policy.monthlyLimit - used);
    const capacity = Math.min(Number(campaign.recipientLimit || 500), remaining);
    if (capacity <= 0) throw fail(409, 'WHATSAPP_MARKETING_MONTHLY_LIMIT_REACHED', 'The workspace has reached its monthly WhatsApp marketing limit.');

    const audienceCondition = this.audienceCondition(String(campaign.audienceType) as WhatsAppCampaignAudience);
    const recipients = await this.db.execute(sql`
      select consent.id "consentId",
             consent.client_id "clientId",
             consent.recipient_phone "recipientPhone",
             coalesce(client.name, 'Customer') "customerName"
      from whatsapp_marketing_consents consent
      left join clients client
        on client.id=consent.client_id and client.tenant_id=consent.tenant_id
      where consent.tenant_id=${String(campaign.tenantId)}::uuid
        and consent.status='OPTED_IN'
        and ${audienceCondition}
        and not exists (
          select 1
          from whatsapp_marketing_campaign_recipients recent_recipient
          where recent_recipient.tenant_id=consent.tenant_id
            and recent_recipient.recipient_phone=consent.recipient_phone
            and recent_recipient.status='QUEUED'
            and recent_recipient.created_at>=now()-${FREQUENCY_CAP_DAYS} * interval '1 day'
        )
      order by consent.consented_at nulls last, consent.updated_at
      limit ${capacity}
    `);

    const parameters = Array.isArray(campaign.templateParameters)
      ? campaign.templateParameters.map(String)
      : [];
    const messageBody = preview(String(campaign.templateName), campaign.templateComponents, parameters);
    const components = templateComponents(parameters);

    for (const recipient of recipients.rows as any[]) {
      const reserved = await this.db.execute(sql`
        insert into whatsapp_marketing_campaign_recipients(
          tenant_id, campaign_id, consent_id, client_id, recipient_phone,
          customer_name, status, created_at, updated_at
        ) values (
          ${String(campaign.tenantId)}::uuid, ${String(campaign.id)}::uuid,
          ${String(recipient.consentId)}::uuid, ${recipient.clientId || null}::uuid,
          ${String(recipient.recipientPhone)}, ${String(recipient.customerName)},
          'QUEUED', now(), now()
        )
        on conflict (campaign_id, recipient_phone) do nothing
        returning id
      `);
      const recipientId = (reserved.rows[0] as any)?.id;
      if (!recipientId) continue;

      const existing = await this.db.execute(sql`
        select id, metadata_json "metadata"
        from conversations
        where tenant_id=${String(campaign.tenantId)}::uuid
          and primary_channel='WHATSAPP'
          and status in ('OPEN','PENDING')
          and (
            (${recipient.clientId || null}::uuid is not null and client_id=${recipient.clientId || null}::uuid)
            or customer_phone=${String(recipient.recipientPhone)}
          )
        order by last_message_at desc
        limit 1
      `);
      let conversationId = (existing.rows[0] as any)?.id as string | undefined;
      if (!conversationId) {
        const metadata = JSON.stringify({ externalRecipientId: phoneDigits(String(recipient.recipientPhone)) });
        const created = await this.db.execute(sql`
          insert into conversations(
            tenant_id, client_id, primary_channel, status, priority, unread_count,
            customer_display_name, customer_phone, last_message_preview,
            last_message_at, tags, metadata_json, created_at, updated_at
          ) values (
            ${String(campaign.tenantId)}::uuid, ${recipient.clientId || null}::uuid,
            'WHATSAPP', 'PENDING', 'NORMAL', 0, ${String(recipient.customerName)},
            ${String(recipient.recipientPhone)}, ${messageBody.slice(0, 280)}, now(),
            '{}'::text[], ${metadata}::jsonb, now(), now()
          ) returning id
        `);
        conversationId = String((created.rows[0] as any).id);
      }

      const metadata = JSON.stringify({
        source: 'KS_OS_WHATSAPP_CAMPAIGN',
        whatsappMessageKind: 'TEMPLATE',
        whatsappCampaignId: String(campaign.id),
        whatsappTemplate: {
          id: String(campaign.templateId),
          name: String(campaign.templateName),
          language: String(campaign.templateLanguage),
          category: 'MARKETING',
          components,
        },
      });
      const message = await this.db.execute(sql`
        insert into conversation_messages(
          tenant_id, conversation_id, channel_id, channel_type, direction,
          sender_type, sender_user_id, sender_name, body, status,
          attempt_count, next_attempt_at, metadata_json, created_at
        ) values (
          ${String(campaign.tenantId)}::uuid, ${conversationId}::uuid,
          ${String(campaign.channelId)}::uuid, 'WHATSAPP', 'OUTBOUND',
          'AUTOMATION', null, 'KS OS campaign', ${messageBody}, 'QUEUED',
          0, now(), ${metadata}::jsonb, now()
        ) returning id
      `);
      const messageId = String((message.rows[0] as any).id);
      await this.db.execute(sql`
        update whatsapp_marketing_campaign_recipients
        set conversation_id=${conversationId}::uuid, message_id=${messageId}::uuid, updated_at=now()
        where id=${String(recipientId)}::uuid and tenant_id=${String(campaign.tenantId)}::uuid
      `);
      await this.db.execute(sql`
        update conversations
        set status='PENDING', primary_channel='WHATSAPP', unread_count=0,
            last_message_preview=${messageBody.slice(0, 280)}, last_message_at=now(), updated_at=now()
        where id=${conversationId}::uuid and tenant_id=${String(campaign.tenantId)}::uuid
      `);
    }

    await this.db.execute(sql`
      update whatsapp_marketing_campaigns
      set status='DISPATCHED', dispatched_at=now(), updated_at=now(), failure_code=null
      where id=${String(campaign.id)}::uuid and tenant_id=${String(campaign.tenantId)}::uuid
    `);
  }

  async processDueCampaigns(limit = 3) {
    const claimed = await this.db.execute(sql`
      with candidates as (
        select id
        from whatsapp_marketing_campaigns
        where status='SCHEDULED' and scheduled_at<=now()
        order by scheduled_at, created_at
        for update skip locked
        limit ${Math.max(1, Math.min(limit, 10))}
      )
      update whatsapp_marketing_campaigns campaign
      set status='PROCESSING', started_at=now(), updated_at=now()
      from candidates
      where campaign.id=candidates.id
      returning campaign.id,
                campaign.tenant_id "tenantId",
                campaign.channel_id "channelId",
                campaign.template_id "templateId",
                campaign.audience_type "audienceType",
                campaign.template_parameters "templateParameters",
                campaign.recipient_limit "recipientLimit",
                (select name from whatsapp_message_templates where id=campaign.template_id) "templateName",
                (select language from whatsapp_message_templates where id=campaign.template_id) "templateLanguage",
                (select components from whatsapp_message_templates where id=campaign.template_id) "templateComponents"
    `);
    let dispatched = 0;
    let failed = 0;
    for (const campaign of claimed.rows as any[]) {
      try {
        await this.dispatchCampaign(campaign);
        dispatched += 1;
      } catch (cause) {
        const code = String((cause as any)?.code || (cause instanceof Error ? cause.message : cause) || 'WHATSAPP_CAMPAIGN_FAILED')
          .replace(/[^A-Z0-9_:-]/gi, '_').slice(0, 120).toUpperCase();
        await this.db.execute(sql`
          update whatsapp_marketing_campaigns
          set status='FAILED', failure_code=${code}, updated_at=now()
          where id=${String(campaign.id)}::uuid
        `);
        failed += 1;
      }
    }
    return { claimed: claimed.rows.length, dispatched, failed };
  }
}
