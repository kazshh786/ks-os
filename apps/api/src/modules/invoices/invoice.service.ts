import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  calculateInvoice,
  invoiceState,
  InvoiceSchema,
  type CreateInvoice,
  type InvoiceListQuery,
  type UpdateInvoiceSchema,
  type InvoiceSettingsSchema,
} from "@ks-os/contracts";
import {
  access,
  activity,
  can,
  fail,
  invoiceRow,
  iso,
  one,
  rows,
  resolveSource,
  sourceColumn,
  transaction,
  type Executor,
  type InvoiceActor,
  type Source,
} from "./invoice.repository.js";
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const totals = (items: CreateInvoice["items"]) => {
  try {
    const v = calculateInvoice(items);
    if (!v.total) throw new Error();
    return v;
  } catch {
    throw fail(
      400,
      "Enter valid items with a positive total within the supported range.",
    );
  }
};
async function settings(db: Executor, a: InvoiceActor) {
  const s = await one(
    db,
    sql`select * from invoice_settings where tenant_id=${a.tenantId}::uuid`,
  );
  return {
    termsDays: s?.terms_days ?? 30,
    prefix: s?.prefix ?? "INV",
    footer: s?.footer ?? "",
  };
}
async function lines(
  db: Executor,
  a: InvoiceActor,
  id: string,
  items: ReturnType<typeof calculateInvoice>["items"],
) {
  for (let position = 0; position < items.length; position++) {
    const i = items[position];
    await db.execute(
      sql`insert into invoice_items(tenant_id,invoice_id,description,quantity,unit_amount_minor,tax_rate_basis_points,subtotal_minor,tax_minor,total_minor,position) values(${a.tenantId}::uuid,${id}::uuid,${i.description},${i.quantity},${i.unitAmount},${i.taxRateBasisPoints},${i.subtotal},${i.tax},${i.total},${position})`,
    );
  }
}
export class InvoiceService {
  async settings(
    a: InvoiceActor,
    input?: z.infer<typeof InvoiceSettingsSchema>,
  ) {
    return transaction(async (db) => {
      await access(db, a);
      if (input) {
        if (a.role !== "owner")
          throw fail(403, "Only the owner can change invoice defaults.");
        await db.execute(
          sql`insert into invoice_settings(tenant_id,terms_days,prefix,footer) values(${a.tenantId}::uuid,${input.termsDays},${input.prefix},${input.footer}) on conflict(tenant_id) do update set terms_days=excluded.terms_days,prefix=excluded.prefix,footer=excluded.footer`,
        );
      }
      return settings(db, a);
    });
  }
  async context(
    a: InvoiceActor,
    source?: Source,
    clientReference?: string,
    search?: string,
  ) {
    return transaction(async (db) => {
      const t = await access(db, a, "INVOICES_CREATE");
      const defaults = await settings(db, a);
      const s = source ? await resolveSource(db, a, source) : null;
      if (!s && !can(a, "CLIENTS_VIEW_BASIC"))
        throw fail(403, "You cannot select customers.");
      const customers = s
        ? [{ reference: s.client_reference, name: s.customer_name }]
        : await rows(
            db,
            sql`select public_reference as reference,name from clients where tenant_id=${a.tenantId}::uuid ${clientReference ? sql`and public_reference=${clientReference}::uuid` : sql``} ${search ? sql`and name ilike ${"%" + search + "%"}` : sql``} order by name,id limit 100`,
          );
      let quote: any = null;
      if (source?.kind === "QUOTE") {
        if (s.status !== "ACCEPTED")
          throw fail(409, "Only accepted quotes can become invoices.");
        quote = s;
      }
      if (
        source?.kind === "WORK" &&
        s.source_quote_id &&
        can(a, "QUOTES_VIEW")
      ) {
        const q = await one(
          db,
          sql`select public_reference from sales_quotes where id=${s.source_quote_id}::uuid and tenant_id=${a.tenantId}::uuid and client_id=${s.client_id}::uuid and status='ACCEPTED'`,
        );
        if (q) {
          try {
            quote = await resolveSource(db, a, {
              kind: "QUOTE",
              reference: q.public_reference,
            });
          } catch (e) {
            if ((e as any).statusCode !== 404) throw e;
          }
        }
      }
      const items = quote
        ? await rows(
            db,
            sql`select description,quantity,unit_amount as "unitAmount",tax_rate_basis_points as "taxRateBasisPoints" from sales_quote_items where quote_id=${quote.id}::uuid and tenant_id=${a.tenantId}::uuid order by position limit 100`,
          )
        : [];
      return {
        customers,
        title: s?.title ?? (source?.kind === "BOOKING" ? "Appointment" : ""),
        currency: quote?.currency ?? t.currency ?? "GBP",
        items,
        defaults,
      };
    });
  }
  async create(a: InvoiceActor, input: CreateInvoice) {
    return transaction(async (db) => {
      await access(db, a, "INVOICES_CREATE");
      const s = input.source ? await resolveSource(db, a, input.source) : null;
      if (!s && !can(a, "CLIENTS_VIEW_BASIC"))
        throw fail(403, "You cannot select customers.");
      const customer = await one(
        db,
        sql`select id,name,public_reference from clients where tenant_id=${a.tenantId}::uuid and ${s ? sql`id=${s.client_id}::uuid` : sql`public_reference=${input.clientReference}::uuid`} for share`,
      );
      if (
        !customer ||
        (input.clientReference &&
          customer.public_reference !== input.clientReference)
      )
        throw fail(404, "Customer not available for this source.");
      let items = input.items,
        currency = input.currency;
      if (input.source?.kind === "QUOTE") {
        if (s.status !== "ACCEPTED")
          throw fail(409, "Only accepted quotes can become invoices.");
        items = await rows(
          db,
          sql`select description,quantity,unit_amount as "unitAmount",tax_rate_basis_points as "taxRateBasisPoints" from sales_quote_items where quote_id=${s.id}::uuid and tenant_id=${a.tenantId}::uuid order by position limit 101`,
        );
        if (items.length > 100) throw fail(400, "Quote has too many lines.");
        currency = s.currency;
      }
      const calculated = totals(items),
        key =
          input.source?.kind === "QUOTE"
            ? `quote:${s.id}`
            : input.idempotencyKey;
      const hash = fingerprint({ ...input, items, currency });
      // The tenant counter also serializes idempotent creation, without max(number) races.
      await db.execute(
        sql`insert into invoice_settings(tenant_id) values(${a.tenantId}::uuid) on conflict do nothing`,
      );
      const counter = await one(
        db,
        sql`select * from invoice_settings where tenant_id=${a.tenantId}::uuid for update`,
      );
      const previous = await one(
        db,
        sql`select public_reference,request_hash from invoices where tenant_id=${a.tenantId}::uuid and idempotency_key=${key}`,
      );
      if (previous) {
        if (input.source?.kind !== "QUOTE" && previous.request_hash !== hash)
          throw fail(
            409,
            "This request was already used for a different invoice.",
          );
        return this.detail(db, a, previous.public_reference);
      }
      const quote =
        input.source?.kind === "QUOTE"
          ? s.id
          : input.source?.kind === "WORK"
            ? s.source_quote_id
            : null;
      const sale =
        input.source?.kind === "SALE"
          ? s.id
          : input.source?.kind === "QUOTE"
            ? s.opportunity_id
            : input.source?.kind === "WORK"
              ? s.source_opportunity_id
              : input.source?.kind === "BOOKING"
                ? s.sales_opportunity_id
                : null;
      const number = `${counter.prefix}-${new Date().getUTCFullYear()}-${String(counter.next_number).padStart(6, "0")}`;
      await db.execute(
        sql`update invoice_settings set next_number=next_number+1 where tenant_id=${a.tenantId}::uuid`,
      );
      const created = await one(
        db,
        sql`insert into invoices(tenant_id,client_id,invoice_number,title,currency,subtotal_minor,tax_minor,total_minor,due_at,customer_name,memo,footer,source_quote_id,source_opportunity_id,source_work_item_id,source_appointment_id,idempotency_key,request_hash,created_by_user_id)
   values(${a.tenantId}::uuid,${customer.id}::uuid,${number},${input.title},${currency},${calculated.subtotal},${calculated.tax},${calculated.total},${input.dueAt}::timestamptz,${customer.name},${input.memo},${counter.footer},${quote ?? null}::uuid,${sale ?? null}::uuid,${input.source?.kind === "WORK" ? s.id : null}::uuid,${input.source?.kind === "BOOKING" ? s.id : null}::uuid,${key},${hash},${a.userId}::uuid) returning id,public_reference`,
      );
      await lines(db, a, created.id, calculated.items);
      await activity(db, a, created.id, "CREATED");
      return this.detail(db, a, created.public_reference);
    });
  }
  async fromQuote(a: InvoiceActor, reference: string, dueAt?: string) {
    const c = await this.context(a, { kind: "QUOTE", reference });
    return this.create(a, {
      source: { kind: "QUOTE", reference },
      title: c.title,
      currency: c.currency,
      items: c.items,
      memo: "",
      dueAt:
        dueAt ??
        new Date(Date.now() + c.defaults.termsDays * 86400000).toISOString(),
      idempotencyKey: randomUUID(),
    });
  }
  async get(a: InvoiceActor, reference: string) {
    return transaction(async (db) => {
      await access(db, a);
      return this.detail(db, a, reference);
    });
  }
  async detail(db: Executor, a: InvoiceActor, reference: string) {
    const i = await invoiceRow(db, a, reference);
    const items = await rows(
      db,
      sql`select description,quantity,unit_amount_minor as "unitAmount",tax_rate_basis_points as "taxRateBasisPoints",subtotal_minor as subtotal,tax_minor as tax,total_minor as total from invoice_items where tenant_id=${a.tenantId}::uuid and invoice_id=${i.id}::uuid order by position limit 100`,
    );
    const events = await rows(
      db,
      sql`select public_reference as reference,activity_type as type,amount_minor as amount,created_at as at from invoice_activity where tenant_id=${a.tenantId}::uuid and invoice_id=${i.id}::uuid order by created_at desc,id desc limit 100`,
    );
    const payments = await rows(
      db,
      sql`select p.public_reference as reference,b.amount_minor as amount,b.net_minor as net,p.payment_method as method,b.created_at as at,(p.purpose='invoice_payment' and p.stripe_payment_intent_id is null) as reversible from invoice_allocation_balances b join checkout_transactions p on p.id=b.payment_id and p.tenant_id=b.tenant_id where b.tenant_id=${a.tenantId}::uuid and b.invoice_id=${i.id}::uuid order by b.created_at desc limit 100`,
    );
    const refunds = await rows(
      db,
      sql`select r.public_reference as reference,'REFUND' as type,r.amount as amount,coalesce(r.completed_at,r.created_at) as at from stripe_refunds r join invoice_payment_allocations b on b.payment_id=r.checkout_transaction_id and b.tenant_id=r.tenant_id where b.tenant_id=${a.tenantId}::uuid and b.invoice_id=${i.id}::uuid and r.status='SUCCEEDED' order by r.created_at desc limit 100`,
    );
    const sources: Source[] = [];
    for (const kind of ["QUOTE", "WORK", "BOOKING", "SALE"] as const) {
      if (!i[sourceColumn[kind]]) continue;
      const table = {
        QUOTE: "sales_quotes",
        WORK: "work_items",
        BOOKING: "appointments",
        SALE: "sales_opportunities",
      }[kind];
      const ref = await one(
        db,
        sql`select public_reference from ${sql.identifier(table)} where tenant_id=${a.tenantId}::uuid and id=${i[sourceColumn[kind]]}::uuid`,
      );
      if (ref)
        try {
          await resolveSource(db, a, { kind, reference: ref.public_reference });
          sources.push({ kind, reference: ref.public_reference });
        } catch (e) {
          if ((e as any).statusCode !== 404) throw e;
        }
    }
    return InvoiceSchema.parse({
      ...this.card(i),
      items,
      memo: i.memo,
      footer: i.footer,
      sources,
      activity: [...events, ...refunds]
        .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
        .slice(0, 100)
        .map((r) => ({ ...r, at: iso(r.at) })),
      payments: payments.map((p) => ({
        reference: p.reference,
        amount: p.amount,
        net: p.net,
        method: p.method,
        at: iso(p.at),
        canReverse:
          can(a, "INVOICES_RECORD_PAYMENT") && p.reversible && p.net > 0,
      })),
      actions: {
        manage: can(a, "INVOICES_MANAGE"),
        recordPayment:
          can(a, "INVOICES_RECORD_PAYMENT") &&
          i.status === "ISSUED" &&
          i.due_minor > 0,
        void:
          can(a, "INVOICES_MANAGE") &&
          i.status !== "VOID" &&
          i.paid_minor === 0,
      },
    });
  }
  card(i: any) {
    return {
      reference: i.public_reference,
      number: i.invoice_number,
      title: i.title,
      customer: { reference: i.client_reference, name: i.customer_name },
      currency: i.currency,
      status: invoiceState(
        i.status,
        i.total_minor,
        i.paid_minor,
        iso(i.due_at),
      ),
      subtotal: i.subtotal_minor,
      tax: i.tax_minor,
      total: i.total_minor,
      paid: i.paid_minor,
      due: i.due_minor,
      dueAt: iso(i.due_at),
      createdAt: iso(i.created_at),
      issuedAt: i.issued_at ? iso(i.issued_at) : null,
    };
  }
  async update(
    a: InvoiceActor,
    reference: string,
    input: z.infer<typeof UpdateInvoiceSchema>,
  ) {
    return transaction(async (db) => {
      await access(db, a, "INVOICES_MANAGE");
      const i = await invoiceRow(db, a, reference, true);
      if (i.status !== "DRAFT") throw fail(409, "Only drafts can be edited.");
      const v = totals(input.items);
      await db.execute(
        sql`delete from invoice_items where tenant_id=${a.tenantId}::uuid and invoice_id=${i.id}::uuid`,
      );
      await lines(db, a, i.id, v.items);
      await db.execute(
        sql`update invoices set title=${input.title},memo=${input.memo},due_at=${input.dueAt}::timestamptz,subtotal_minor=${v.subtotal},tax_minor=${v.tax},total_minor=${v.total},updated_at=now() where tenant_id=${a.tenantId}::uuid and id=${i.id}::uuid`,
      );
      await activity(db, a, i.id, "DRAFT_UPDATED");
      return this.detail(db, a, reference);
    });
  }
  async transition(
    a: InvoiceActor,
    reference: string,
    state: "ISSUED" | "VOID",
  ) {
    return transaction(async (db) => {
      await access(db, a, "INVOICES_MANAGE");
      const i = await invoiceRow(db, a, reference, true);
      if (i.status === state) return this.detail(db, a, reference);
      if (
        (state === "ISSUED" && i.status !== "DRAFT") ||
        (state === "VOID" && (i.status === "VOID" || i.paid_minor > 0))
      )
        throw fail(
          409,
          "Refund allocated payments before voiding; only drafts can be issued.",
        );
      await db.execute(
        sql`update invoices set status=${state},issued_at=${state === "ISSUED" ? sql`now()` : sql`issued_at`},voided_at=${state === "VOID" ? sql`now()` : sql`voided_at`},updated_at=now() where tenant_id=${a.tenantId}::uuid and id=${i.id}::uuid`,
      );
      await activity(db, a, i.id, state);
      return this.detail(db, a, reference);
    });
  }
  async list(a: InvoiceActor, q: InvoiceListQuery) {
    return transaction(async (db) => {
      await access(db, a);
      const conditions = [sql`i.tenant_id=${a.tenantId}::uuid`];
      if (q.clientReference)
        conditions.push(sql`c.public_reference=${q.clientReference}::uuid`);
      if (q.source && q.sourceReference) {
        const s = await resolveSource(db, a, {
          kind: q.source,
          reference: q.sourceReference,
        });
        conditions.push(
          sql`${sql.raw("i." + sourceColumn[q.source])}=${s.id}::uuid`,
        );
      }
      if (q.filter === "OWED")
        conditions.push(sql`i.status='ISSUED' and i.due_minor>0`);
      if (q.filter === "OVERDUE")
        conditions.push(
          sql`i.status='ISSUED' and i.due_minor>0 and i.due_at<now()`,
        );
      if (q.filter === "PAID")
        conditions.push(sql`i.status='ISSUED' and i.due_minor=0`);
      if (q.filter === "DRAFT") conditions.push(sql`i.status='DRAFT'`);
      if (q.cursor) {
        try {
          const cursor = z
            .object({ at: z.string().datetime(), ref: z.string().uuid() })
            .strict()
            .parse(JSON.parse(Buffer.from(q.cursor, "base64url").toString()));
          conditions.push(
            sql`(i.due_at,i.public_reference)>(${cursor.at}::timestamptz,${cursor.ref}::uuid)`,
          );
        } catch {
          throw fail(400, "Invalid page cursor.");
        }
      }
      const result = await rows(
        db,
        sql`select i.*,c.public_reference as client_reference from invoice_balances i join clients c on c.id=i.client_id and c.tenant_id=i.tenant_id where ${sql.join(conditions, sql` and `)} order by i.due_at,i.public_reference limit ${q.limit + 1}`,
      );
      const page = result.slice(0, q.limit),
        last = page.at(-1);
      const summary = await rows(
        db,
        sql`select currency,sum(total_minor)::text as invoiced,sum(paid_minor)::text as paid,sum(due_minor)::text as owed,coalesce(sum(due_minor) filter(where due_at<now()),0)::text as overdue,coalesce(sum(due_minor) filter(where due_at>=now() and due_at<now()+interval '7 days'),0)::text as "dueThisWeek",count(distinct client_id) filter(where due_minor>0)::integer as customers from invoice_balances where tenant_id=${a.tenantId}::uuid and status='ISSUED' group by currency order by currency limit 100`,
      );
      return {
        items: page.map((i) => this.card(i)),
        nextCursor:
          result.length > q.limit
            ? Buffer.from(
                JSON.stringify({
                  at: iso(last.due_at),
                  ref: last.public_reference,
                }),
              ).toString("base64url")
            : null,
        summary,
        canCreate: can(a, "INVOICES_CREATE"),
      };
    });
  }
}
