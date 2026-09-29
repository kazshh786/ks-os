import { sql, type SQL } from "drizzle-orm";
import { getDatabase } from "@ks-os/database";
import {
  canUseProfileModule,
  resolveBusinessProfile,
  type InvoiceSourceSchema,
} from "@ks-os/contracts";
import type { z } from "zod";
export type InvoiceActor = {
  tenantId: string;
  userId: string;
  role: "owner" | "staff";
  permissions: readonly string[];
};
export type Executor = { execute(query: SQL): Promise<{ rows: any[] }> };
export const can = (a: InvoiceActor, p: string) =>
  a.role === "owner" || a.permissions.includes(p);
export const fail = (statusCode: number, message: string) =>
  Object.assign(new Error(message), {
    statusCode,
    code: "INVOICE_UNAVAILABLE",
  });
export const iso = (v: Date | string) => new Date(v).toISOString();
export async function rows(db: Executor, q: SQL) {
  return (await db.execute(q)).rows;
}
export async function one(db: Executor, q: SQL) {
  return (await rows(db, q))[0];
}
export async function transaction<T>(
  fn: (db: Executor) => Promise<T>,
): Promise<T> {
  return getDatabase().transaction(async (db) => {
    await db.execute(sql`set local statement_timeout='4s'`);
    await db.execute(sql`set local lock_timeout='3s'`);
    return fn(db);
  });
}
export async function access(
  db: Executor,
  a: InvoiceActor,
  capability = "INVOICES_VIEW",
) {
  const tenant = await one(
    db,
    sql`select business_type,business_profile,currency from tenants where id=${a.tenantId}::uuid`,
  );
  if (!tenant) throw fail(404, "Workspace not found.");
  const profile = resolveBusinessProfile(
    tenant.business_type,
    tenant.business_profile,
  );
  if (
    !can(a, "INVOICES_VIEW") ||
    !can(a, capability) ||
    !canUseProfileModule(profile, "invoices", a)
  )
    throw fail(403, "You cannot use invoices in this workspace.");
  return { profile, currency: tenant.currency };
}
export const sourceColumn = {
  QUOTE: "source_quote_id",
  WORK: "source_work_item_id",
  BOOKING: "source_appointment_id",
  SALE: "source_opportunity_id",
} as const;
export type Source = z.infer<typeof InvoiceSourceSchema>;
/** Source visibility is checked independently of invoice access, including own/all scope. */
export async function resolveSource(
  db: Executor,
  a: InvoiceActor,
  source: Source,
) {
  const { profile } = await access(db, a);
  const module =
    source.kind === "WORK"
      ? "work"
      : source.kind === "BOOKING"
        ? "bookings"
        : "sales";
  if (
    !canUseProfileModule(profile, module, a) ||
    (source.kind === "QUOTE" && !can(a, "QUOTES_VIEW"))
  )
    throw fail(404, "Source not available.");
  const table =
    source.kind === "WORK"
      ? "work_items"
      : source.kind === "BOOKING"
        ? "appointments"
        : source.kind === "QUOTE"
          ? "sales_quotes"
          : "sales_opportunities";
  const visibility =
    module === "work"
      ? sql`(${can(a, "WORK_VIEW_ALL")} or s.assigned_user_id=${a.userId}::uuid)`
      : module === "bookings"
        ? sql`(${can(a, "BOOKINGS_VIEW_ALL")} or s.user_id=${a.userId}::uuid)`
        : sql`(${can(a, "SALES_VIEW_ALL")} or ${source.kind === "QUOTE" ? sql`o.owner_user_id` : sql`s.owner_user_id`}=${a.userId}::uuid)`;
  const sourceRow = await one(
    db,
    sql`select s.*,c.public_reference as client_reference,c.name as customer_name
  from ${sql.identifier(table)} s join clients c on c.id=s.client_id and c.tenant_id=s.tenant_id
  ${source.kind === "QUOTE" ? sql`join sales_opportunities o on o.id=s.opportunity_id and o.tenant_id=s.tenant_id and o.client_id=s.client_id` : sql``}
  where s.tenant_id=${a.tenantId}::uuid and s.public_reference=${source.reference}::uuid and ${visibility}
  ${source.kind === "BOOKING" ? sql`and not s.is_internal and not s.is_test and s.status<>'BLOCKED'` : sql``} for share of s,c`,
  );
  if (!sourceRow) throw fail(404, "Source not available.");
  return sourceRow;
}
export async function activity(
  db: Executor,
  a: InvoiceActor,
  id: string,
  type: string,
  amount: number | null = null,
) {
  await db.execute(
    sql`insert into invoice_activity(tenant_id,invoice_id,activity_type,amount_minor) values(${a.tenantId}::uuid,${id}::uuid,${type},${amount})`,
  );
}
export async function invoiceRow(
  db: Executor,
  a: InvoiceActor,
  reference: string,
  lock = false,
) {
  if (lock)
    await db.execute(
      sql`select id from invoices where tenant_id=${a.tenantId}::uuid and public_reference=${reference}::uuid for update`,
    );
  const result = await one(
    db,
    sql`select i.*,c.public_reference as client_reference from invoice_balances i join clients c on c.id=i.client_id and c.tenant_id=i.tenant_id where i.tenant_id=${a.tenantId}::uuid and i.public_reference=${reference}::uuid`,
  );
  if (!result) throw fail(404, "Invoice not found.");
  return result;
}
