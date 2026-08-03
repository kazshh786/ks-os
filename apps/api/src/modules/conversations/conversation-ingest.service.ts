import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { clients, conversationMessages, conversations, getDatabase } from '@ks-os/database';
import type { ConversationChannel } from '@ks-os/contracts';

export type InboundConversationMessage = {
  tenantId: string;
  channelId: string;
  channel: ConversationChannel;
  externalSenderId: string;
  externalMessageId: string;
  body: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  metadata?: Record<string, unknown>;
};

export class ConversationIngestService {
  private db = getDatabase();

  async ingest(input: InboundConversationMessage) {
    if (!input.externalMessageId || !input.externalSenderId || !input.body.trim()) return { accepted: false as const, duplicate: false as const, reason: 'INVALID_MESSAGE' as const };

    return this.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.tenantId}:${input.channel}:${input.externalSenderId}`}))`);

      const [duplicate] = await tx.select({ id: conversationMessages.id, conversationId: conversationMessages.conversationId })
        .from(conversationMessages)
        .where(and(
          eq(conversationMessages.tenantId, input.tenantId),
          eq(conversationMessages.channelType, input.channel),
          eq(conversationMessages.externalMessageId, input.externalMessageId),
        )).limit(1);
      if (duplicate) return { accepted: true as const, duplicate: true as const, conversationId: duplicate.conversationId, messageId: duplicate.id };

      const identityConditions: SQL[] = [];
      if (input.customerPhone) identityConditions.push(eq(clients.phoneE164, input.customerPhone));
      if (input.customerEmail) identityConditions.push(sql`lower(${clients.email}) = lower(${input.customerEmail})`);
      const clientRows = identityConditions.length > 0
        ? await tx.select({ id: clients.id, name: clients.name, email: clients.email, phone: clients.phoneE164 })
          .from(clients)
          .where(and(eq(clients.tenantId, input.tenantId), or(...identityConditions)))
          .limit(1)
        : [];
      const client = clientRows[0];

      const identityMatch = client?.id
        ? eq(conversations.clientId, client.id)
        : sql`${conversations.metadataJson}->>'externalRecipientId' = ${input.externalSenderId}`;
      let [conversation] = await tx.select({ id: conversations.id, metadata: conversations.metadataJson })
        .from(conversations)
        .where(and(
          eq(conversations.tenantId, input.tenantId),
          eq(conversations.primaryChannel, input.channel),
          inArray(conversations.status, ['OPEN', 'PENDING']),
          identityMatch,
        ))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(1);

      const now = new Date();
      const whatsappServiceWindowExpiresAt = input.channel === 'WHATSAPP'
        ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
        : undefined;
      if (!conversation) {
        [conversation] = await tx.insert(conversations).values({
          tenantId: input.tenantId,
          clientId: client?.id || null,
          primaryChannel: input.channel,
          status: 'OPEN',
          priority: 'NORMAL',
          unreadCount: 0,
          customerDisplayName: input.customerName || client?.name || `${input.channel.toLowerCase()} customer`,
          customerEmail: input.customerEmail || client?.email || null,
          customerPhone: input.customerPhone || client?.phone || null,
          lastMessagePreview: '',
          lastMessageAt: now,
          tags: [],
          metadataJson: { externalRecipientId: input.externalSenderId, ...(input.metadata || {}) },
          whatsappServiceWindowExpiresAt,
          createdAt: now,
          updatedAt: now,
        }).returning({ id: conversations.id, metadata: conversations.metadataJson });
      }

      const inserted = await tx.insert(conversationMessages).values({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        channelId: input.channelId,
        channelType: input.channel,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        senderName: input.customerName || client?.name || 'Customer',
        body: input.body.trim(),
        status: 'RECEIVED',
        externalMessageId: input.externalMessageId,
        attemptCount: 0,
        nextAttemptAt: now,
        metadataJson: input.metadata || {},
        createdAt: now,
      }).onConflictDoNothing().returning({ id: conversationMessages.id });
      if (!inserted[0]) {
        const [existing] = await tx.select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(and(
            eq(conversationMessages.tenantId, input.tenantId),
            eq(conversationMessages.channelType, input.channel),
            eq(conversationMessages.externalMessageId, input.externalMessageId),
          )).limit(1);
        return { accepted: true as const, duplicate: true as const, conversationId: conversation.id, messageId: existing?.id };
      }

      await tx.update(conversations).set({
        clientId: client?.id || undefined,
        customerDisplayName: input.customerName || client?.name || undefined,
        customerEmail: input.customerEmail || client?.email || undefined,
        customerPhone: input.customerPhone || client?.phone || undefined,
        status: 'OPEN',
        unreadCount: sql`${conversations.unreadCount} + 1`,
        lastMessagePreview: input.body.trim().slice(0, 280),
        lastMessageAt: now,
        metadataJson: { ...(conversation.metadata as Record<string, unknown>), externalRecipientId: input.externalSenderId, ...(input.metadata || {}) },
        ...(whatsappServiceWindowExpiresAt ? { whatsappServiceWindowExpiresAt } : {}),
        updatedAt: now,
      }).where(and(eq(conversations.id, conversation.id), eq(conversations.tenantId, input.tenantId)));

      return { accepted: true as const, duplicate: false as const, conversationId: conversation.id, messageId: inserted[0].id };
    });
  }
}
