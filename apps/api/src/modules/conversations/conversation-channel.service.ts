import { asc, eq } from 'drizzle-orm';
import { communicationChannels, getDatabase } from '@ks-os/database';
import type { ConversationChannel } from '@ks-os/contracts';
import { isSmsConfigured } from '../../lib/twilio.js';

const channelDefinitions: Array<{
  channel: ConversationChannel;
  provider: string;
  displayName: string;
  capabilities: string[];
  configured: () => boolean;
}> = [
  {
    channel: 'EMAIL', provider: 'RESEND', displayName: 'Email',
    capabilities: ['MESSAGES', 'BOOKING_LINKS', 'FORMS', 'PAYMENTS'],
    configured: () => Boolean(process.env.EMAIL_BOOKINGS_FROM),
  },
  {
    channel: 'SMS', provider: 'TWILIO', displayName: 'SMS',
    capabilities: ['MESSAGES', 'BOOKING_LINKS', 'FORMS', 'PAYMENTS'],
    configured: () => isSmsConfigured(),
  },
  {
    channel: 'WHATSAPP', provider: 'META', displayName: 'WhatsApp',
    capabilities: ['MESSAGES', 'TEMPLATES', 'BOOKING_LINKS', 'FORMS', 'PAYMENTS'],
    configured: () => Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
  },
  {
    channel: 'INSTAGRAM', provider: 'META', displayName: 'Instagram',
    capabilities: ['MESSAGES', 'COMMENTS', 'PUBLISHING', 'BOOKING_LINKS'],
    configured: () => Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
  },
  {
    channel: 'FACEBOOK', provider: 'META', displayName: 'Facebook',
    capabilities: ['MESSAGES', 'COMMENTS', 'PUBLISHING', 'BOOKING_LINKS'],
    configured: () => Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
  },
];

const statusRank: Record<string, number> = { CONNECTED: 3, ATTENTION: 2, DISCONNECTED: 1 };
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;

export class ConversationChannelService {
  private db = getDatabase();

  async list(tenantId: string) {
    const rows = await this.db.select({
      id: communicationChannels.id,
      channel: communicationChannels.channelType,
      provider: communicationChannels.provider,
      displayName: communicationChannels.displayName,
      status: communicationChannels.status,
      capabilities: communicationChannels.capabilities,
      externalAccountId: communicationChannels.externalAccountId,
      connectedAt: communicationChannels.connectedAt,
      lastHealthCheckAt: communicationChannels.lastHealthCheckAt,
    }).from(communicationChannels)
      .where(eq(communicationChannels.tenantId, tenantId))
      .orderBy(asc(communicationChannels.channelType), asc(communicationChannels.createdAt));

    const activeByType = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      const existing = activeByType.get(row.channel);
      if (!existing || (statusRank[row.status] || 0) > (statusRank[existing.status] || 0)) activeByType.set(row.channel, row);
    }

    return channelDefinitions.map(definition => {
      const row = activeByType.get(definition.channel);
      const providerConfigured = definition.configured();
      const status = row?.status === 'CONNECTED' || row?.status === 'ATTENTION' ? row.status : 'DISCONNECTED';
      const setupMessage = status === 'CONNECTED'
        ? `${row?.displayName || definition.displayName} is connected and available to the inbox.`
        : status === 'ATTENTION'
          ? `${row?.displayName || definition.displayName} needs reauthorisation or a provider health check before messages can be sent.`
          : !providerConfigured
            ? `${definition.provider} platform credentials must be configured before a business can connect this channel.`
            : `The platform is ready for a business owner to connect ${definition.displayName}.`;
      return {
        id: row?.id || null,
        channel: definition.channel,
        provider: row?.provider || definition.provider,
        displayName: row?.displayName || definition.displayName,
        status,
        capabilities: row?.capabilities?.length ? row.capabilities : definition.capabilities,
        externalAccountId: row?.externalAccountId || null,
        connectedAt: iso(row?.connectedAt),
        lastHealthCheckAt: iso(row?.lastHealthCheckAt),
        providerConfigured,
        setupMessage,
      };
    });
  }
}
