import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gt, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import {
  appointments,
  clients,
  communicationChannels,
  conversationAttachments,
  conversationMessages,
  conversations,
  getDatabase,
  services,
  tenants,
  users,
} from '@ks-os/database';
import type { ConversationListQuery, SendConversationMessage, UpdateConversation } from '@ks-os/contracts';
import { StripeService } from '../integrations/stripe/stripe.service.js';

export type ConversationActor = {
  tenantId: string;
  userId: string;
  role: 'owner' | 'staff';
};

const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;

const bookingContext = (row: any) => row.appointmentId ? {
  appointmentId: row.appointmentId,
  serviceName: row.serviceName || 'Appointment',
  startTime: iso(row.appointmentStartTime)!,
  status: row.appointmentStatus,
} : null;

const listItem = (row: any) => ({
  id: row.id,
  clientId: row.clientId,
  customerName: row.customerName,
  customerEmail: row.customerEmail,
  customerPhone: row.customerPhone,
  channel: row.primaryChannel,
  status: row.status,
  priority: row.priority,
  subject: row.subject,
  preview: row.preview || '',
  unreadCount: row.unreadCount,
  assignedToUserId: row.assignedToUserId,
  assignedToName: row.assignedToName,
  lastMessageAt: iso(row.lastMessageAt)!,
  booking: bookingContext(row),
  tags: row.tags || [],
});

export class ConversationService {
  private db = getDatabase();

  private baseSelection() {
    return {
      id: conversations.id,
      clientId: conversations.clientId,
      customerName: conversations.customerDisplayName,
      customerEmail: conversations.customerEmail,
      customerPhone: conversations.customerPhone,
      primaryChannel: conversations.primaryChannel,
      status: conversations.status,
      priority: conversations.priority,
      subject: conversations.subject,
      preview: conversations.lastMessagePreview,
      unreadCount: conversations.unreadCount,
      assignedToUserId: conversations.assignedToUserId,
      assignedToName: users.name,
      lastMessageAt: conversations.lastMessageAt,
      tags: conversations.tags,
      appointmentId: appointments.id,
      appointmentStartTime: appointments.startTime,
      appointmentStatus: appointments.status,
      serviceName: services.name,
    };
  }

  private filters(actor: ConversationActor, query: ConversationListQuery) {
    const conditions: any[] = [eq(conversations.tenantId, actor.tenantId)];
    if (query.channel) conditions.push(eq(conversations.primaryChannel, query.channel));
    if (query.status) conditions.push(eq(conversations.status, query.status));
    if (query.assignment === 'MINE') conditions.push(eq(conversations.assignedToUserId, actor.userId));
    if (query.assignment === 'UNASSIGNED') conditions.push(isNull(conversations.assignedToUserId));
    if (query.cursor) conditions.push(lt(conversations.lastMessageAt, new Date(query.cursor)));
    if (query.q) {
      const term = `%${query.q}%`;
      conditions.push(or(
        ilike(conversations.customerDisplayName, term),
        ilike(conversations.customerEmail, term),
        ilike(conversations.customerPhone, term),
        ilike(conversations.lastMessagePreview, term),
        ilike(conversations.subject, term),
      ));
    }
    return and(...conditions);
  }

  async list(actor: ConversationActor, query: ConversationListQuery) {
    const rows = await this.db.select(this.baseSelection())
      .from(conversations)
      .leftJoin(users, and(eq(users.id, conversations.assignedToUserId), eq(users.tenantId, actor.tenantId)))
      .leftJoin(appointments, and(eq(appointments.id, conversations.relatedAppointmentId), eq(appointments.tenantId, actor.tenantId)))
      .leftJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, actor.tenantId)))
      .where(this.filters(actor, query))
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      data: page.map(listItem),
      nextCursor: rows.length > query.limit ? iso(page.at(-1)!.lastMessageAt) : null,
    };
  }

  private async conversationRow(actor: ConversationActor, conversationId: string) {
    const [row] = await this.db.select(this.baseSelection())
      .from(conversations)
      .leftJoin(users, and(eq(users.id, conversations.assignedToUserId), eq(users.tenantId, actor.tenantId)))
      .leftJoin(appointments, and(eq(appointments.id, conversations.relatedAppointmentId), eq(appointments.tenantId, actor.tenantId)))
      .leftJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, actor.tenantId)))
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, actor.tenantId)))
      .limit(1);
    if (!row) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, code: 'CONVERSATION_NOT_FOUND' });
    return row;
  }

  async get(actor: ConversationActor, conversationId: string) {
    const row = await this.conversationRow(actor, conversationId);
    const messageRows = await this.db.select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      channel: conversationMessages.channelType,
      direction: conversationMessages.direction,
      senderType: conversationMessages.senderType,
      senderName: conversationMessages.senderName,
      body: conversationMessages.body,
      status: conversationMessages.status,
      replyToMessageId: conversationMessages.replyToMessageId,
      externalMessageId: conversationMessages.externalMessageId,
      createdAt: conversationMessages.createdAt,
    }).from(conversationMessages)
      .where(and(eq(conversationMessages.tenantId, actor.tenantId), eq(conversationMessages.conversationId, conversationId)))
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));

    const messageIds = messageRows.map(message => message.id);
    const attachmentRows = messageIds.length ? await this.db.select({
      id: conversationAttachments.id,
      messageId: conversationAttachments.messageId,
      fileName: conversationAttachments.fileName,
      mimeType: conversationAttachments.mimeType,
      fileSizeBytes: conversationAttachments.fileSizeBytes,
    }).from(conversationAttachments)
      .where(and(eq(conversationAttachments.tenantId, actor.tenantId), sql`${conversationAttachments.messageId} = ANY(${messageIds}::uuid[])`)) : [];
    const attachmentsByMessage = new Map<string, any[]>();
    for (const attachment of attachmentRows) {
      const current = attachmentsByMessage.get(attachment.messageId) || [];
      current.push({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSizeBytes: attachment.fileSizeBytes,
        downloadUrl: `/api/v1/conversations/attachments/${attachment.id}`,
      });
      attachmentsByMessage.set(attachment.messageId, current);
    }

    let totalBookings = 0;
    let completedBookings = 0;
    let upcomingBooking = bookingContext(row);
    let lastVisitAt: string | null = null;
    if (row.clientId) {
      const [counts] = await this.db.select({
        total: count(appointments.id),
        completed: sql<number>`count(*) filter (where ${appointments.status} = 'COMPLETED')::int`,
        lastVisit: sql<Date | null>`max(${appointments.startTime}) filter (where ${appointments.status} = 'COMPLETED')`,
      }).from(appointments).where(and(eq(appointments.tenantId, actor.tenantId), eq(appointments.clientId, row.clientId)));
      totalBookings = Number(counts?.total || 0);
      completedBookings = Number(counts?.completed || 0);
      lastVisitAt = iso(counts?.lastVisit);
      if (!upcomingBooking) {
        const [next] = await this.db.select({
          appointmentId: appointments.id,
          serviceName: services.name,
          startTime: appointments.startTime,
          status: appointments.status,
        }).from(appointments)
          .leftJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, actor.tenantId)))
          .where(and(
            eq(appointments.tenantId, actor.tenantId),
            eq(appointments.clientId, row.clientId),
            gt(appointments.startTime, new Date()),
            sql`${appointments.status} NOT IN ('CANCELLED','NO_SHOW','COMPLETED','BLOCKED')`,
          ))
          .orderBy(asc(appointments.startTime))
          .limit(1);
        if (next) upcomingBooking = {
          appointmentId: next.appointmentId,
          serviceName: next.serviceName || 'Appointment',
          startTime: iso(next.startTime)!,
          status: next.status,
        };
      }
    }

    return {
      conversation: listItem(row),
      customer: {
        clientId: row.clientId,
        name: row.customerName,
        email: row.customerEmail,
        phone: row.customerPhone,
        totalBookings,
        completedBookings,
        upcomingBooking,
        lastVisitAt,
      },
      messages: messageRows.map(message => ({
        ...message,
        createdAt: iso(message.createdAt)!,
        attachments: attachmentsByMessage.get(message.id) || [],
      })),
    };
  }

  async update(actor: ConversationActor, conversationId: string, input: UpdateConversation) {
    await this.conversationRow(actor, conversationId);
    if (input.assignedToUserId) {
      const [assignee] = await this.db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, input.assignedToUserId), eq(users.tenantId, actor.tenantId), eq(users.accountStatus, 'ACTIVE')))
        .limit(1);
      if (!assignee) throw Object.assign(new Error('Assignee is not an active team member'), { statusCode: 400, code: 'INVALID_ASSIGNEE' });
    }
    const now = new Date();
    await this.db.update(conversations).set({
      ...(input.status ? { status: input.status, resolvedAt: input.status === 'RESOLVED' ? now : null } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'assignedToUserId') ? { assignedToUserId: input.assignedToUserId } : {}),
      ...(input.markRead ? { unreadCount: 0 } : {}),
      updatedAt: now,
    }).where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, actor.tenantId)));
    return listItem(await this.conversationRow(actor, conversationId));
  }

  async send(actor: ConversationActor, conversationId: string, input: SendConversationMessage) {
    const conversation = await this.conversationRow(actor, conversationId);
    const channel = input.channel || conversation.primaryChannel;
    const [connectedChannel] = await this.db.select({ id: communicationChannels.id })
      .from(communicationChannels)
      .where(and(
        eq(communicationChannels.tenantId, actor.tenantId),
        eq(communicationChannels.channelType, channel),
        eq(communicationChannels.status, 'CONNECTED'),
      )).limit(1);
    if (!connectedChannel) throw Object.assign(new Error(`${channel.toLowerCase()} is not connected for this workspace`), { statusCode: 409, code: 'CHANNEL_NOT_CONNECTED' });
    const [sender] = await this.db.select({ name: users.name }).from(users)
      .where(and(eq(users.id, actor.userId), eq(users.tenantId, actor.tenantId))).limit(1);
    const now = new Date();
    const [message] = await this.db.insert(conversationMessages).values({
      tenantId: actor.tenantId,
      conversationId,
      channelId: connectedChannel.id,
      channelType: channel,
      direction: 'OUTBOUND',
      senderType: 'STAFF',
      senderUserId: actor.userId,
      senderName: sender?.name || 'Team member',
      body: input.body,
      status: 'QUEUED',
      replyToMessageId: input.replyToMessageId || null,
      metadataJson: { source: 'KS_OS_INBOX' },
      createdAt: now,
    }).returning();
    await this.db.update(conversations).set({
      primaryChannel: channel,
      status: 'PENDING',
      unreadCount: 0,
      lastMessagePreview: input.body.slice(0, 280),
      lastMessageAt: now,
      updatedAt: now,
    }).where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, actor.tenantId)));
    return {
      id: message.id,
      conversationId: message.conversationId,
      channel: message.channelType,
      direction: message.direction,
      senderType: message.senderType,
      senderName: message.senderName,
      body: message.body,
      status: message.status,
      replyToMessageId: message.replyToMessageId,
      externalMessageId: message.externalMessageId,
      attachments: [],
      createdAt: iso(message.createdAt)!,
    };
  }

  async createPaymentLink(actor: ConversationActor, conversationId: string) {
    const conversation = await this.conversationRow(actor, conversationId);
    if (!conversation.appointmentId) throw Object.assign(new Error('Link this conversation to a booking before requesting payment'), { statusCode: 409, code: 'BOOKING_REQUIRED' });
    const [paymentContext] = await this.db.select({
      publicReference: appointments.publicReference,
      amount: appointments.quotedAmount,
      currency: tenants.currency,
    }).from(appointments)
      .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
      .where(and(eq(appointments.id, conversation.appointmentId), eq(appointments.tenantId, actor.tenantId)))
      .limit(1);
    if (!paymentContext || paymentContext.amount <= 0) throw Object.assign(new Error('This booking has no amount available to collect'), { statusCode: 409, code: 'PAYMENT_AMOUNT_REQUIRED' });
    const result = await new StripeService().createBookingPaymentSession(
      actor.tenantId,
      conversation.appointmentId,
      paymentContext.publicReference,
      `conversation-payment-${conversationId}-${randomUUID()}`,
      paymentContext.amount,
      paymentContext.currency,
    );
    if (!result.url) throw Object.assign(new Error('Stripe did not return a payment URL'), { statusCode: 502, code: 'PAYMENT_LINK_UNAVAILABLE' });
    return { url: result.url, appointmentId: conversation.appointmentId, amount: paymentContext.amount, currency: paymentContext.currency };
  }
}
