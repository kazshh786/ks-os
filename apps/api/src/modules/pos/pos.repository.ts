import { getDatabase, products, checkoutTransactions, appointments, services, clients, users } from '@ks-os/database';
import { eq, and, sql, inArray, ilike, or, SQL } from 'drizzle-orm';

export class PosRepository {
  private get db() {
    return getDatabase();
  }

  async getCheckoutCandidates(tenantId: string, roleFilter?: SQL) {
    const queryConditions = [
      eq(appointments.tenantId, tenantId),
      inArray(appointments.status, ['IN_SERVICE', 'AWAITING_PAYMENT', 'COMPLETED'])
    ];
    if (roleFilter) queryConditions.push(roleFilter);

    return this.db.select({
      appointment: appointments,
      clientName: clients.name,
      serviceName: services.name,
      staffName: users.name,
      checkout: checkoutTransactions.id,
    })
    .from(appointments)
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .leftJoin(users, eq(appointments.userId, users.id))
    .leftJoin(
      checkoutTransactions, 
      and(
        eq(appointments.id, checkoutTransactions.appointmentId),
        eq(checkoutTransactions.paymentStatus, 'SUCCEEDED')
      )
    )
    .where(and(...queryConditions));
  }

  async getAppointmentForPreview(tenantId: string, appointmentId: string, roleFilter?: SQL) {
    const previewConditions = [
      eq(appointments.id, appointmentId),
      eq(appointments.tenantId, tenantId)
    ];
    if (roleFilter) previewConditions.push(roleFilter);

    const [row] = await this.db.select({
      appointment: appointments,
      service: services
    })
    .from(appointments)
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .where(and(...previewConditions))
    .limit(1);

    return row;
  }

  async getProductForPreview(tenantId: string, productId: string) {
    const [product] = await this.db.select()
      .from(products)
      .where(
        and(
          eq(products.id, productId),
          eq(products.tenantId, tenantId)
        )
      )
      .limit(1);
    return product;
  }

  async getProducts(tenantId: string, limit: number, search?: string, inStockOnly?: boolean) {
    const conditions: SQL[] = [eq(products.tenantId, tenantId)];
    if (search) {
      conditions.push(or(ilike(products.name, `%${search}%`), ilike(products.sku, `%${search}%`))!);
    }
    if (inStockOnly) {
      conditions.push(sql`${products.stockQuantity} > 0`);
    }

    return this.db.select()
      .from(products)
      .where(and(...conditions))
      .limit(limit);
  }

  async getProductById(tenantId: string, productId: string) {
    const [product] = await this.db.select()
      .from(products)
      .where(
        and(
          eq(products.id, productId),
          eq(products.tenantId, tenantId)
        )
      )
      .limit(1);
    return product;
  }

  getRawDb() {
    return this.db;
  }
}
