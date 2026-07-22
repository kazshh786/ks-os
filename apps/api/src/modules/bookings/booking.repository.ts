import { getDatabase, appointments, services, users, clients, locations } from '@ks-os/database';
import { eq, and, sql, gte, lte, lt, desc, asc, inArray, ilike, or, count } from 'drizzle-orm';
import type { BookingOperationsQuery } from '@ks-os/contracts';
import { calculateAvailability } from '../availability/availability.service.js';

export type BookingOperationsScope = {
  tenantId: string;
  ownStaffUserId?: string;
};

export class BookingRepository {
  private operationalConditions(scope: BookingOperationsScope, query: BookingOperationsQuery) {
    const conditions: any[] = [
      eq(appointments.tenantId, scope.tenantId),
      lt(appointments.startTime, new Date(query.to)),
      sql`${appointments.endTime} > ${new Date(query.from)}`,
    ];
    if (scope.ownStaffUserId) conditions.push(eq(appointments.userId, scope.ownStaffUserId));
    if (query.staffIds?.length) conditions.push(inArray(appointments.userId, query.staffIds));
    if (query.serviceIds?.length) conditions.push(inArray(appointments.serviceId, query.serviceIds));
    if (query.locationIds?.length) conditions.push(inArray(appointments.locationId, query.locationIds));
    if (query.statuses?.length) conditions.push(inArray(appointments.status, query.statuses));
    if (query.paymentStatuses?.length) conditions.push(inArray(appointments.paymentStatus, query.paymentStatuses));
    if (query.intakeStatuses?.length) conditions.push(inArray(appointments.intakeStatus, query.intakeStatuses));
    if (query.sources?.length) conditions.push(inArray(appointments.bookingSource, query.sources));
    if (query.requiresAttention) conditions.push(or(
      eq(appointments.status, 'PENDING'),
      inArray(appointments.paymentStatus, ['FAILED', 'PENDING', 'PARTIALLY_PAID']),
      inArray(appointments.intakeStatus, ['PENDING', 'IN_PROGRESS', 'OVERDUE']),
      sql`${appointments.attentionReason} IS NOT NULL`,
      sql`(${appointments.endTime} < now() AND ${appointments.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW'))`,
    ));
    if (query.search) {
      const pattern = `%${query.search.replace(/[%_]/g, '\\$&')}%`;
      conditions.push(or(
        ilike(clients.name, pattern),
        ilike(clients.email, pattern),
        ilike(clients.phone, pattern),
        ilike(appointments.clientName, pattern),
        ilike(services.name, pattern),
        ilike(users.name, pattern),
        ilike(locations.name, pattern),
        sql`${appointments.publicReference}::text ILIKE ${pattern}`,
      ));
    }
    return conditions;
  }

  private operationalBase(db: any, scope: BookingOperationsScope, query: BookingOperationsQuery) {
    return db.select({
      id: appointments.id,
      reference: appointments.publicReference,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      clientId: clients.id,
      clientName: clients.name,
      clientEmail: clients.email,
      clientPhone: clients.phone,
      clientNameFallback: appointments.clientName,
      serviceId: services.id,
      serviceName: services.name,
      serviceDuration: services.duration,
      staffId: users.id,
      staffName: users.name,
      locationId: locations.id,
      locationName: locations.name,
      bookingChannel: appointments.bookingChannel,
      paymentStatus: appointments.paymentStatus,
      quotedAmount: appointments.quotedAmount,
      intakeStatus: appointments.intakeStatus,
      bookingSource: appointments.bookingSource,
      notes: appointments.notes,
      customerNotes: appointments.customerNotes,
      attentionReason: appointments.attentionReason,
      createdAt: appointments.createdAt,
    })
      .from(appointments)
      .leftJoin(services, and(eq(appointments.serviceId, services.id), eq(services.tenantId, scope.tenantId)))
      .leftJoin(users, and(eq(appointments.userId, users.id), eq(users.tenantId, scope.tenantId)))
      .leftJoin(clients, and(eq(appointments.clientId, clients.id), eq(clients.tenantId, scope.tenantId)))
      .leftJoin(locations, and(eq(appointments.locationId, locations.id), eq(locations.tenantId, scope.tenantId)))
      .where(and(...this.operationalConditions(scope, query)));
  }

  async listOperationalBookings(scope: BookingOperationsScope, query: BookingOperationsQuery) {
    const db = getDatabase();
    const order = query.sort === 'START_DESC' ? desc(appointments.startTime)
      : query.sort === 'CREATED_DESC' ? desc(appointments.createdAt)
        : asc(appointments.startTime);
    const rows = await this.operationalBase(db, scope, query)
      .orderBy(order, asc(appointments.id))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    const [aggregate] = await db.select({
      total: count(),
      confirmed: sql<number>`count(*) filter (where ${appointments.status} = 'CONFIRMED')::int`,
      completed: sql<number>`count(*) filter (where ${appointments.status} = 'COMPLETED')::int`,
      cancelled: sql<number>`count(*) filter (where ${appointments.status} = 'CANCELLED')::int`,
      noShow: sql<number>`count(*) filter (where ${appointments.status} = 'NO_SHOW')::int`,
      awaitingPayment: sql<number>`count(*) filter (where ${appointments.status} = 'AWAITING_PAYMENT' or ${appointments.paymentStatus} in ('PENDING','FAILED','PARTIALLY_PAID'))::int`,
      incompleteForms: sql<number>`count(*) filter (where ${appointments.intakeStatus} in ('PENDING','IN_PROGRESS','OVERDUE'))::int`,
      requiresAttention: sql<number>`count(*) filter (where ${appointments.status} = 'PENDING' or ${appointments.paymentStatus} in ('PENDING','FAILED','PARTIALLY_PAID') or ${appointments.intakeStatus} in ('PENDING','IN_PROGRESS','OVERDUE') or ${appointments.attentionReason} is not null or (${appointments.endTime} < now() and ${appointments.status} not in ('COMPLETED','CANCELLED','NO_SHOW')))::int`,
    })
      .from(appointments)
      .leftJoin(services, and(eq(appointments.serviceId, services.id), eq(services.tenantId, scope.tenantId)))
      .leftJoin(users, and(eq(appointments.userId, users.id), eq(users.tenantId, scope.tenantId)))
      .leftJoin(clients, and(eq(appointments.clientId, clients.id), eq(clients.tenantId, scope.tenantId)))
      .leftJoin(locations, and(eq(appointments.locationId, locations.id), eq(locations.tenantId, scope.tenantId)))
      .where(and(...this.operationalConditions(scope, query)));
    return { rows, aggregate: { ...aggregate, total: Number(aggregate?.total || 0) } };
  }

  async getOperationalBookingById(scope: BookingOperationsScope, bookingId: string) {
    const db = getDatabase();
    const query: BookingOperationsQuery = {
      from: new Date(0).toISOString(), to: new Date('9999-12-31T23:59:59.999Z').toISOString(), page: 1, limit: 1, sort: 'START_ASC',
    };
    const [row] = await this.operationalBase(db, scope, query).where(and(
      eq(appointments.tenantId, scope.tenantId),
      eq(appointments.id, bookingId),
      scope.ownStaffUserId ? eq(appointments.userId, scope.ownStaffUserId) : undefined,
    )).limit(1);
    return row;
  }
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
      mobileAddress: appointments.mobileAddress,
      locationId: appointments.locationId,
      resourceId: appointments.resourceId,
      paymentStatus: appointments.paymentStatus,
      quotedAmount: appointments.quotedAmount,
      intakeStatus: appointments.intakeStatus,
      bookingSource: appointments.bookingSource,
      publicReference: appointments.publicReference,
      notes: appointments.notes,
      customerNotes: appointments.customerNotes,
      createdAt: appointments.createdAt,
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

  async isRescheduleSlotAvailable(input: {
    tenantId: string;
    appointmentId: string;
    serviceId: string;
    staffId: string;
    startTime: Date;
    bookingChannel: 'in_shop' | 'mobile';
    timezone: string;
    locationId?: string | null;
    resourceId?: string | null;
  }, tx?: any) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(input.startTime);
    const result = await calculateAvailability({
      tenantId: input.tenantId,
      serviceId: input.serviceId,
      staffId: input.staffId,
      date,
      bookingChannel: input.bookingChannel,
      locationId: input.locationId || undefined,
      resourceId: input.resourceId || undefined,
    }, {
      excludeAppointmentId: input.appointmentId,
      locationId: input.locationId,
      resourceId: input.resourceId,
      database: tx,
    });
    return result.slots.some(slot => slot.staffId === input.staffId && slot.start === input.startTime.toISOString());
  }

  async rescheduleBooking(
    tenantId: string,
    bookingId: string,
    staffId: string,
    newStart: Date,
    newEnd: Date,
    tx?: any,
    options: { locationId?: string | null; resourceId?: string | null } = {},
  ) {
    const dbOrTx = tx || getDatabase();
    await dbOrTx.update(appointments)
      .set({
        startTime: newStart,
        endTime: newEnd,
        userId: staffId,
        ...(options.locationId !== undefined ? { locationId: options.locationId } : {}),
        ...(options.resourceId !== undefined ? { resourceId: options.resourceId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(appointments.id, bookingId), eq(appointments.tenantId, tenantId)));
  }
}
