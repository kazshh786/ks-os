import { getDatabase, clients, appointments, services, users } from '@ks-os/database';
import { eq, and, or, ilike, desc, count, inArray } from 'drizzle-orm';

export class ClientRepository {
  async getClientsDirectory(tenantId: string, limit: number, offset: number, search?: string) {
    const db = getDatabase();
    const conditions = [eq(clients.tenantId, tenantId)];

    if (search) {
      conditions.push(
        or(
          ilike(clients.name, `%${search}%`),
          ilike(clients.email, `%${search}%`),
          ilike(clients.phone, `%${search}%`)
        ) as any
      );
    }

    const totalRows = await db.select({ value: count() }).from(clients).where(and(...conditions));
    const total = totalRows[0].value;

    const tenantClients = await db.select()
      .from(clients)
      .where(and(...conditions))
      .orderBy(desc(clients.updatedAt))
      .limit(limit)
      .offset(offset);

    const clientIds = tenantClients.map(c => c.id);
    let countsMap: Record<string, { upcoming: number, total: number }> = {};
    
    if (clientIds.length > 0) {
      const allAppts = await db.select({
        clientId: appointments.clientId,
        startTime: appointments.startTime
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          inArray(appointments.clientId, clientIds)
        )
      );

      const now = new Date();
      countsMap = clientIds.reduce((acc, id) => {
        acc[id] = { upcoming: 0, total: 0 };
        return acc;
      }, {} as Record<string, { upcoming: number, total: number }>);

      for (const appt of allAppts) {
        if (appt.clientId && countsMap[appt.clientId]) {
          countsMap[appt.clientId].total += 1;
          if (new Date(appt.startTime) >= now) {
            countsMap[appt.clientId].upcoming += 1;
          }
        }
      }
    }

    return { total, tenantClients, countsMap };
  }

  async getClientProfile(tenantId: string, clientId: string) {
    const db = getDatabase();
    const clientRows = await db.select()
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.tenantId, tenantId)
        )
      )
      .limit(1);

    if (clientRows.length === 0) {
      return null;
    }

    const client = clientRows[0];

    const historyRows = await db.select({
      id: appointments.id,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      quotedAmount: appointments.quotedAmount,
      serviceName: services.name,
      staffName: users.name
    })
    .from(appointments)
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .leftJoin(users, eq(appointments.userId, users.id))
    .where(
      and(
        eq(appointments.clientId, clientId),
        eq(appointments.tenantId, tenantId)
      )
    )
    .orderBy(desc(appointments.startTime));

    return { client, historyRows };
  }
}
