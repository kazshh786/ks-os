import { sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  RecordInvoicePaymentSchema,
  ReverseInvoicePaymentSchema,
} from "@ks-os/contracts";
import {
  access,
  activity,
  fail,
  invoiceRow,
  iso,
  one,
  rows,
  transaction,
  type Executor,
  type InvoiceActor,
} from "./invoice.repository.js";
import { InvoiceService } from "./invoice.service.js";
// Historical currency is accepted only from an exact successful provider attempt.
const evidence = sql`select p.*,coalesce(p.client_id,b.client_id) as evidence_client,
 coalesce(p.currency,upper(s.currency)) as evidence_currency,
 greatest(0,p.total_amount-coalesce((select sum(r.amount) from stripe_refunds r where r.tenant_id=p.tenant_id and r.checkout_transaction_id=p.id and r.status='SUCCEEDED'),0)-coalesce((select sum(r.amount_minor) from checkout_payment_reversals r where r.tenant_id=p.tenant_id and r.payment_id=p.id),0))::integer as net
 from checkout_transactions p left join appointments b on b.id=p.appointment_id and b.tenant_id=p.tenant_id
 left join stripe_payment_attempts s on s.tenant_id=p.tenant_id and s.stripe_payment_intent_id=p.stripe_payment_intent_id and s.appointment_id=p.appointment_id and s.amount=p.total_amount and s.status='SUCCEEDED'
 where p.stripe_payment_intent_id is null or not exists(select 1 from checkout_transactions duplicate where duplicate.tenant_id=p.tenant_id and duplicate.stripe_payment_intent_id=p.stripe_payment_intent_id and duplicate.id<>p.id)`;
export class InvoicePaymentService {
  private invoices = new InvoiceService();
  private async allocateRow(db: Executor, a: InvoiceActor, i: any, p: any) {
    const previous = await one(
      db,
      sql`select invoice_id from invoice_payment_allocations where payment_id=${p.id}::uuid`,
    );
    if (previous) {
      if (previous.invoice_id === i.id) return;
      throw fail(409, "This payment is already allocated to another invoice.");
    }
    if (
      i.status !== "ISSUED" ||
      p.payment_status !== "SUCCEEDED" ||
      p.evidence_client !== i.client_id ||
      p.evidence_currency !== i.currency ||
      p.net <= 0 ||
      p.net > i.due_minor
    )
      throw fail(
        409,
        "Payment must belong to this customer and currency and fit the amount remaining.",
      );
    await db.execute(
      sql`update checkout_transactions set client_id=${i.client_id}::uuid,currency=${i.currency} where tenant_id=${a.tenantId}::uuid and id=${p.id}::uuid`,
    );
    await db.execute(
      sql`insert into invoice_payment_allocations(tenant_id,invoice_id,client_id,currency,payment_id,amount_minor) values(${a.tenantId}::uuid,${i.id}::uuid,${i.client_id}::uuid,${i.currency},${p.id}::uuid,${p.total_amount})`,
    );
    await activity(db, a, i.id, "PAYMENT_ALLOCATED", p.net);
    await activity(
      db,
      a,
      i.id,
      p.net === i.due_minor ? "PAID" : "PARTIALLY_PAID",
    );
  }
  async available(a: InvoiceActor, reference: string) {
    return transaction(async (db) => {
      await access(db, a, "INVOICES_RECORD_PAYMENT");
      const i = await invoiceRow(db, a, reference);
      const payments = await rows(
        db,
        sql`select e.public_reference as reference,e.total_amount as amount,e.net,e.payment_method as method,e.created_at as at from (${evidence}) e
   where e.tenant_id=${a.tenantId}::uuid and e.evidence_client=${i.client_id}::uuid and e.evidence_currency=${i.currency} and e.payment_status='SUCCEEDED' and e.net>0 and e.net<=${i.due_minor}
   and not exists(select 1 from invoice_payment_allocations a where a.payment_id=e.id) order by e.created_at desc,e.id limit 50`,
      );
      return payments.map((p) => ({ ...p, at: iso(p.at) }));
    });
  }
  async allocate(a: InvoiceActor, reference: string, paymentReference: string) {
    return transaction(async (db) => {
      await access(db, a, "INVOICES_RECORD_PAYMENT");
      const i = await invoiceRow(db, a, reference, true);
      await db.execute(
        sql`select id from checkout_transactions where tenant_id=${a.tenantId}::uuid and public_reference=${paymentReference}::uuid for update`,
      );
      const p = await one(
        db,
        sql`select * from (${evidence}) e where e.tenant_id=${a.tenantId}::uuid and e.public_reference=${paymentReference}::uuid`,
      );
      if (!p) throw fail(404, "Payment not found.");
      await this.allocateRow(db, a, i, p);
      return this.invoices.detail(db, a, reference);
    });
  }
  async record(
    a: InvoiceActor,
    reference: string,
    input: z.infer<typeof RecordInvoicePaymentSchema>,
  ) {
    return transaction(async (db) => {
      await access(db, a, "INVOICES_RECORD_PAYMENT");
      const i = await invoiceRow(db, a, reference, true),
        key = `invoice:${input.idempotencyKey}`;
      // Cross-invoice reuse of a key is serialized as well as same-invoice retries.
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${a.tenantId + key},0))`,
      );
      const previous = await one(
        db,
        sql`select p.*,c.external_reference from checkout_transactions p left join checkout_payment_components c on c.checkout_transaction_id=p.id and c.tenant_id=p.tenant_id where p.tenant_id=${a.tenantId}::uuid and p.idempotency_key=${key}`,
      );
      if (previous) {
        const allocation = await one(
          db,
          sql`select invoice_id from invoice_payment_allocations where tenant_id=${a.tenantId}::uuid and payment_id=${previous.id}::uuid`,
        );
        if (
          allocation?.invoice_id !== i.id ||
          previous.total_amount !== input.amount ||
          previous.payment_method !== input.method ||
          (previous.external_reference ?? "") !== input.reference
        )
          throw fail(409, "This payment request was already used.");
        return this.invoices.detail(db, a, reference);
      }
      if (i.status !== "ISSUED" || input.amount > i.due_minor)
        throw fail(
          409,
          "Payment exceeds the amount remaining, or the invoice is not issued.",
        );
      const p = await one(
        db,
        sql`insert into checkout_transactions(tenant_id,client_id,currency,total_amount,payment_status,payment_method,purpose,idempotency_key) values(${a.tenantId}::uuid,${i.client_id}::uuid,${i.currency},${input.amount},'SUCCEEDED',${input.method},'invoice_payment',${key}) returning *`,
      );
      await db.execute(
        sql`insert into checkout_payment_components(checkout_transaction_id,tenant_id,payment_method,amount_in_cents,external_reference,verification_source,staff_user_id) values(${p.id}::uuid,${a.tenantId}::uuid,${input.method},${input.amount},${input.reference},'STAFF_CONFIRMED',${a.userId}::uuid)`,
      );
      await this.allocateRow(db, a, i, {
        ...p,
        evidence_client: i.client_id,
        evidence_currency: i.currency,
        net: input.amount,
      });
      return this.invoices.detail(db, a, reference);
    });
  }
  async reverse(
    a: InvoiceActor,
    reference: string,
    input: z.infer<typeof ReverseInvoicePaymentSchema>,
  ) {
    return transaction(async (db) => {
      await access(db, a, "INVOICES_RECORD_PAYMENT");
      const i = await invoiceRow(db, a, reference, true);
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${a.tenantId + input.idempotencyKey},0))`,
      );
      const p = await one(
        db,
        sql`select p.* from checkout_transactions p join invoice_payment_allocations b on b.payment_id=p.id and b.tenant_id=p.tenant_id where p.tenant_id=${a.tenantId}::uuid and b.invoice_id=${i.id}::uuid and p.public_reference=${input.paymentReference}::uuid for update of p`,
      );
      if (!p) throw fail(404, "Allocated payment not found.");
      const previous = await one(
        db,
        sql`select * from checkout_payment_reversals where tenant_id=${a.tenantId}::uuid and idempotency_key=${input.idempotencyKey}::uuid`,
      );
      if (previous) {
        if (
          previous.payment_id !== p.id ||
          previous.amount_minor !== input.amount ||
          previous.reason !== input.reason
        )
          throw fail(409, "This refund request was already used.");
        return this.invoices.detail(db, a, reference);
      }
      const paid = await one(
        db,
        sql`select net_minor from invoice_allocation_balances where tenant_id=${a.tenantId}::uuid and payment_id=${p.id}::uuid`,
      );
      if (
        p.purpose !== "invoice_payment" ||
        p.stripe_payment_intent_id ||
        !["CASH", "BANK_TRANSFER", "EXTERNAL_CARD"].includes(
          p.payment_method,
        ) ||
        input.amount > paid.net_minor
      )
        throw fail(
          409,
          "Use the original payment provider, or enter an amount within the payment remaining.",
        );
      await db.execute(
        sql`insert into checkout_payment_reversals(tenant_id,payment_id,amount_minor,reason,idempotency_key,actor_user_id) values(${a.tenantId}::uuid,${p.id}::uuid,${input.amount},${input.reason},${input.idempotencyKey}::uuid,${a.userId}::uuid)`,
      );
      await activity(db, a, i.id, "REFUND", input.amount);
      return this.invoices.detail(db, a, reference);
    });
  }
}
