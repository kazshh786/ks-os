import { sql, type SQL } from 'drizzle-orm';
import { getDatabase } from '@ks-os/database';
import { canCreateBooking, canRescheduleBooking, type BookingAuthContext } from '@ks-os/auth';
import { canUseProfileModule, resolveBusinessProfile, RelatedSaleSchema, SalesAppointmentSchema, SalesBookingContextSchema, type SalesBookingContextQuerySchema, type RelatedSale, type SalesAppointment } from '@ks-os/contracts';
import type { z } from 'zod';

export type JourneyActor = { tenantId: string; userId: string; role: 'owner' | 'staff'; permissions: readonly string[] };
type Executor = { execute(query: SQL): Promise<{ rows: any[] }> };
export const journeyActor = (a: BookingAuthContext): JourneyActor => ({ tenantId: a.tenantId, userId: a.tenantUserId || a.authUserId, role: a.role, permissions: a.permissions ?? [] });
const authFor = (a: JourneyActor): BookingAuthContext => ({ ...a, authUserId: a.userId, tenantUserId: a.userId });
const can = (a: JourneyActor, p: string) => a.role === 'owner' || a.permissions.includes(p);
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode, code: 'SALES_BOOKING_UNAVAILABLE' });
const saleVisibility = (a: JourneyActor) => sql`(${can(a, 'SALES_VIEW_ALL')} or o.owner_user_id=${a.userId}::uuid)`;
const bookingVisibility = (a: JourneyActor) => sql`(${can(a, 'BOOKINGS_VIEW_ALL')} or b.user_id=${a.userId}::uuid)`;
const saleColumns = sql`o.public_reference as reference,o.title,s.name as stage,s.category as state,o.estimated_value as value,o.currency`;
const iso = (v: Date | string) => new Date(v).toISOString();

/** Bounded composition of the two canonical engines. No scheduling or Sales mutations. */
export class SalesBookingService {
  constructor(private readonly db: Executor = getDatabase()) {}
  async enabled(a: JourneyActor, db = this.db) {
    if (a.role !== 'owner' && (!a.permissions.some(p => ['SALES_VIEW_ALL','SALES_VIEW_OWN'].includes(p)) || !a.permissions.some(p => ['BOOKINGS_VIEW_ALL','BOOKINGS_VIEW_OWN'].includes(p)))) return false;
    const { rows } = await db.execute(sql`select business_type,business_profile from tenants where id=${a.tenantId}::uuid`);
    if (!rows[0]) return false;
    const profile = resolveBusinessProfile(rows[0].business_type, rows[0].business_profile);
    return canUseProfileModule(profile, 'sales', a) && canUseProfileModule(profile, 'bookings', a);
  }

  async resolveLink(a: JourneyActor, reference: string, clientReference: string | undefined, db = this.db) {
    if (!clientReference || !await this.enabled(a, db)) throw fail(403, 'This sale is not available for booking.');
    const { rows } = await db.execute(sql`select o.id,o.client_id from sales_opportunities o
      join clients c on c.id=o.client_id and c.tenant_id=o.tenant_id
      join sales_pipeline_stages s on s.id=o.stage_id and s.tenant_id=o.tenant_id
      where o.tenant_id=${a.tenantId}::uuid and o.public_reference=${reference}::uuid
        and c.public_reference=${clientReference}::uuid and s.category='OPEN' and ${saleVisibility(a)}
      for share of o,c,s`);
    if (!rows[0]) throw fail(404, 'This sale is not available for this customer.');
    return rows[0] as { id: string; client_id: string };
  }

  async context(a: JourneyActor, query: z.infer<typeof SalesBookingContextQuerySchema>) {
    if (!canCreateBooking(authFor(a))) throw fail(403, 'You cannot create bookings.');
    const enabled = await this.enabled(a);
    if (query.opportunityReference && !enabled) throw fail(404, 'This sale is not available for booking.');
    let selected: any;
    if (query.opportunityReference) {
      selected = (await this.db.execute(sql`select o.client_id,o.owner_user_id,o.public_reference from sales_opportunities o
        join sales_pipeline_stages s on s.id=o.stage_id and s.tenant_id=o.tenant_id
        where o.tenant_id=${a.tenantId}::uuid and o.public_reference=${query.opportunityReference}::uuid
          and s.category='OPEN' and ${saleVisibility(a)}`)).rows[0];
      if (!selected) throw fail(404, 'This sale is not available for booking.');
    } else if (!can(a, 'CLIENTS_VIEW_BASIC')) throw fail(403, 'You cannot view this customer.');
    const customer = (await this.db.execute(sql`select id,public_reference as reference,name,email,phone from clients
      where tenant_id=${a.tenantId}::uuid and ${selected ? sql`id=${selected.client_id}::uuid` : sql`public_reference=${query.clientReference}::uuid`} limit 1`)).rows[0];
    if (!customer) throw fail(404, 'Customer not found.');
    const sales = enabled ? (await this.db.execute(sql`select ${saleColumns} from sales_opportunities o
      join sales_pipeline_stages s on s.id=o.stage_id and s.tenant_id=o.tenant_id
      where o.tenant_id=${a.tenantId}::uuid and o.client_id=${customer.id}::uuid and s.category='OPEN' and ${saleVisibility(a)}
      order by (o.public_reference=${query.opportunityReference || null}::uuid) desc nulls last,o.updated_at desc,o.id limit 101`)).rows : [];
    return SalesBookingContextSchema.parse({ customer: { reference: customer.reference, name: customer.name, email: customer.email, phone: customer.phone }, sales: sales.slice(0,100).map(r => RelatedSaleSchema.parse(r)), selectedReference: selected?.public_reference ?? null, suggestedStaffId: selected?.owner_user_id ?? null, hasMore: sales.length > 100 });
  }

  async salesForBookings(a: JourneyActor, references: string[]): Promise<Map<string, RelatedSale>> {
    if (!references.length || !await this.enabled(a)) return new Map();
    const { rows } = await this.db.execute(sql`select b.public_reference as booking_reference,${saleColumns}
      from appointments b join sales_opportunities o on o.id=b.sales_opportunity_id and o.tenant_id=b.tenant_id and o.client_id=b.client_id
      join sales_pipeline_stages s on s.id=o.stage_id and s.tenant_id=o.tenant_id
      where b.tenant_id=${a.tenantId}::uuid and b.public_reference in (${sql.join(references.map(r => sql`${r}::uuid`),sql`,`)})
        and not b.is_internal and not b.is_test and ${saleVisibility(a)} and ${bookingVisibility(a)}`);
    return new Map(rows.map(({ booking_reference, ...row }) => [booking_reference, RelatedSaleSchema.parse(row)]));
  }

  async appointmentsForSales(a: JourneyActor, references: string[], now = new Date()): Promise<Map<string, SalesAppointment[]>> {
    if (!references.length || !await this.enabled(a)) return new Map();
    // Per-sale lateral limit prevents one busy customer from starving other cards.
    const { rows } = await this.db.execute(sql`select o.public_reference as sale_reference,b.*,t.timezone from sales_opportunities o
      join tenants t on t.id=o.tenant_id cross join lateral (
        select b.public_reference as reference,b.status,b.start_time,b.end_time,b.user_id,u.name as staff_name,
          coalesce(s.name,'Appointment') as title from appointments b
        left join services s on s.id=b.service_id and s.tenant_id=b.tenant_id
        left join users u on u.id=b.user_id and u.tenant_id=b.tenant_id
        where b.tenant_id=o.tenant_id and b.client_id=o.client_id and b.sales_opportunity_id=o.id
          and not b.is_internal and not b.is_test and b.status<>'BLOCKED' and ${bookingVisibility(a)}
        order by case when b.start_time>=${now.toISOString()}::timestamptz and b.status not in ('CANCELLED','NO_SHOW','COMPLETED') then 0 else 1 end,
          case when b.start_time>=${now.toISOString()}::timestamptz and b.status not in ('CANCELLED','NO_SHOW','COMPLETED') then b.start_time end asc,
          b.start_time desc,b.id limit 6
      ) b where o.tenant_id=${a.tenantId}::uuid and o.public_reference in (${sql.join(references.map(r=>sql`${r}::uuid`),sql`,`)}) and ${saleVisibility(a)}`);
    const result = new Map<string, SalesAppointment[]>();
    for (const row of rows) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: row.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(row.start_time));
      const item = SalesAppointmentSchema.parse({ reference: row.reference, title: row.title, status: row.status, startTime: iso(row.start_time), endTime: iso(row.end_time), timezone: row.timezone, staffName: row.staff_name,
        route: `/app/bookings?reference=${row.reference}&search=${row.reference}&view=day&date=${date}`,
        canReschedule: canRescheduleBooking(authFor(a), { tenantId: a.tenantId, staffId: row.user_id, status: row.status }) });
      result.set(row.sale_reference, [...(result.get(row.sale_reference) ?? []),item]);
    }
    return result;
  }
}
