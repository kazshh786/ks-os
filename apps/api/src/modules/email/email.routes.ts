import { FastifyPluginAsync } from 'fastify';
import { getDatabase, tenants, emailOutbox } from '@ks-os/database';
import { eq, desc } from 'drizzle-orm';
import { UpdateCommunicationsSettingsSchema, EmailHistoryQuerySchema } from '@ks-os/contracts';
import { EmailService } from './email.service.js';

const maskEmail = (value: string) => {
  const [local, domain] = value.split('@');
  return `${local.slice(0, 1)}***@${domain ?? 'invalid'}`;
};

export const emailRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/settings', async (request, reply) => {
    request.requireAuth();
    const db = getDatabase();
    
    const tenantRows = await db.select()
      .from(tenants)
      .where(eq(tenants.id, request.auth!.tenantId))
      .limit(1);

    if (tenantRows.length === 0) {
      return reply.code(404).send({ error: 'Tenant not found' });
    }

    const tenant = tenantRows[0];
    
    return reply.send({
      replyToEmail: tenant.replyToEmail,
      senderDisplayName: tenant.senderDisplayName,
      bookingConfirmationEnabled: tenant.bookingConfirmationEnabled,
      bookingCancellationEnabled: tenant.bookingCancellationEnabled,
      bookingRescheduleEnabled: tenant.bookingRescheduleEnabled,
      appointmentRemindersEnabled: tenant.appointmentRemindersEnabled,
      formDeliveryEnabled: tenant.formDeliveryEnabled,
      formRemindersEnabled: tenant.formRemindersEnabled,
      paymentConfirmationEnabled: tenant.paymentConfirmationEnabled,
      formReminderTiming: tenant.formReminderTiming
    });
  });

  fastify.put('/settings', async (request, reply) => {
    request.requireAuth();
    if (request.auth!.role !== 'owner') {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const parseResult = UpdateCommunicationsSettingsSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid input', details: parseResult.error });
    }

    const db = getDatabase();
    await db.update(tenants)
      .set({
        ...parseResult.data,
        updatedAt: new Date()
      })
      .where(eq(tenants.id, request.auth!.tenantId));

    return reply.send({ success: true });
  });

  fastify.get('/email-history', async (request, reply) => {
    request.requireAuth();
    if (request.auth!.role !== 'owner') {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const db = getDatabase();
    const query = EmailHistoryQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query' });
    
    const historyRows = await db.select()
      .from(emailOutbox)
      .where(eq(emailOutbox.tenantId, request.auth!.tenantId))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(query.data.limit);

    return reply.send({ data: historyRows.map((row) => ({
      id: row.id,
      recipientEmailMasked: maskEmail(row.recipientEmail),
      templateKey: row.templateKey,
      status: row.status.toLowerCase(),
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
      lastErrorCode: row.lastErrorCode,
      relatedEntityType: row.relatedEntityType,
    })) });
  });

  fastify.post('/worker/run', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const expected = process.env.EMAIL_OUTBOX_WORKER_SECRET;
    if (!expected || supplied !== expected) return reply.code(401).send({ error: 'Unauthorized' });
    return reply.send(await new EmailService().processOutbox());
  });
};
