import { getDatabase, appointments, services, users, clients } from '@ks-os/database';
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';

export class BookingRepository {
  async getBookingsByDateRange(tenantId: string, from: Date, to: Date, limit: number) {
    const db = getDatabase();
    return db.select({
      id: appointments.id,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      serviceName: services.name,
      staffName: users.name,
      clientNameFallback: appointments.clientName,
      crmClientName: clients.name
    })
    .from(appointments)
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .leftJoin(users, eq(appointments.userId, users.id))
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        gte(appointments.startTime, from),
        lte(appointments.endTime, to)
      )
    )
    .orderBy(desc(appointments.startTime))
    .limit(limit);
  }

  async getBookingById(tenantId: string, bookingId: string, tx?: any) {
    const dbOrTx = tx || getDatabase();
    const [booking] = await dbOrTx.select({
      id: appointments.id,
      serviceId: appointments.serviceId,
      status: appointments.status,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      userId: appointments.userId,
      tenantId: appointments.tenantId,
      clientName: clients.name,
      clientEmail: clients.email,
      clientId: clients.id,
      clientPhone: clients.phone,
      clientNameFallback: appointments.clientName,
      serviceName: services.name,
      staffName: users.name,
      bookingChannel: appointments.bookingChannel,
      mobileAddress: appointments.mobileAddress
    })
    .from(appointments)
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .leftJoin(users, eq(appointments.userId, users.id))
    .where(and(eq(appointments.id, bookingId), eq(appointments.tenantId, tenantId)))
    .limit(1);
    
    return booking;
  }

  async createBookingUsingDbFunction(
    tenantId: string,
    serviceId: string,
    staffId: string,
    startTime: string, // ISO string
    client: { name: string; email?: string; phone?: string },
    paymentMode: string,
    payNow: boolean,
    idempotencyKey: string,
    bookingChannel: string,
    mobileAddress?: any,
    resourceId?: string | null,
    tx?: any
  ) {
    const dbOrTx = tx || getDatabase();
    const result = await dbOrTx.execute(sql`
      SELECT * FROM create_public_booking(
        ${tenantId}::uuid,
        ${serviceId}::uuid,
        ${staffId}::uuid,
        ${startTime}::timestamptz,
        ${client.name}::text,
        ${client.email || ''}::text,
        ${client.phone || ''}::text,
        ${paymentMode}::text,
        ${payNow}::boolean,
        ${idempotencyKey}::uuid,
        ${bookingChannel}::text,
        ${mobileAddress ? JSON.stringify(mobileAddress) : null}::jsonb,
        ${resourceId || null}::uuid
      )
    `);

    return result.rows[0] as any;
  }

  async updateBookingStatus(tenantId: string, bookingId: string, newStatus: string, tx?: any) {
    const dbOrTx = tx || getDatabase();
    await dbOrTx.update(appointments)
      .set({ status: newStatus as any, updatedAt: new Date() })
      .where(and(eq(appointments.id, bookingId), eq(appointments.tenantId, tenantId)));
  }

  async getOverlappingAppointments(
    tenantId: string,
    staffId: string,
    excludeBookingId: string,
    startTime: Date,
    endTime: Date
  ) {
    const db = getDatabase();
    return db.select({ id: appointments.id })
      .from(appointments)
      .where(and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.userId, staffId),
        sql`${appointments.id} != ${excludeBookingId}::uuid`,
        sql`${appointments.startTime} < ${endTime.toISOString()}::timestamptz`,
        sql`${appointments.endTime} > ${startTime.toISOString()}::timestamptz`,
        sql`${appointments.status} NOT IN ('CANCELLED', 'NO_SHOW')`
      )).limit(1);
  }

  async rescheduleBooking(
    tenantId: string,
    bookingId: string,
    staffId: string,
    newStart: Date,
    newEnd: Date,
    tx?: any
  ) {
    const dbOrTx = tx || getDatabase();
    await dbOrTx.update(appointments)
      .set({ startTime: newStart, endTime: newEnd, userId: staffId, updatedAt: new Date() })
      .where(and(eq(appointments.id, bookingId), eq(appointments.tenantId, tenantId)));
  }
}
