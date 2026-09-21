import { PaymentsRepository } from "../src/modules/payments/payments.repository.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID as id } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import Fastify from "fastify";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as database from "@ks-os/database";
import {
  CreateInvoiceSchema,
  InvoiceListQuerySchema,
  RecordInvoicePaymentSchema,
  calculateInvoice,
  invoiceState,
  resolveBusinessProfile,
} from "@ks-os/contracts";
import { effectiveCapabilities } from "@ks-os/auth";
import { InvoiceService } from "../src/modules/invoices/invoice.service.js";
import { InvoicePaymentService } from "../src/modules/invoices/invoice-payments.service.js";
import { invoiceRoutes } from "../src/modules/invoices/invoice.routes.js";
import { invoiceCustomerAdapter } from "../src/modules/customer-360/customer-invoices.adapter.js";
import { attentionFor } from "../src/modules/customer-360/customer-attention.service.js";
import { Customer360Service } from "../src/modules/customer-360/customer-360.service.js";
import type { InvoiceActor } from "../src/modules/invoices/invoice.repository.js";
const line = {
  description: "Website",
  quantity: 2,
  unitAmount: 12500,
  taxRateBasisPoints: 2000,
};
const request = () => ({
  clientReference: id(),
  title: "Website",
  currency: "GBP",
  dueAt: "2027-01-01T12:00:00.000Z",
  memo: "",
  items: [line],
  idempotencyKey: id(),
});
test("invoice contracts, integer totals, rounding, state and explicit staff access", () => {
  const v = request();
  assert.ok(CreateInvoiceSchema.safeParse(v).success);
  for (const extra of [
    { tenantId: id() },
    { paid: 0 },
    { clientId: id() },
    { currency: "gbp" },
    { currency: "EURO" },
    { dueAt: "tomorrow" },
    { items: [{ ...line, unitAmount: 1.1 }] },
    { items: [{ ...line, quantity: 0 }] },
    { items: [{ ...line, quantity: 1.5 }] },
    { items: [{ ...line, unitAmount: -1 }] },
  ])
    assert.equal(
      CreateInvoiceSchema.safeParse({ ...v, ...extra }).success,
      false,
    );
  assert.equal(InvoiceListQuerySchema.safeParse({ limit: 51 }).success, false);
  assert.equal(
    RecordInvoicePaymentSchema.safeParse({
      amount: 0,
      method: "CASH",
      idempotencyKey: id(),
    }).success,
    false,
  );
  assert.deepEqual(calculateInvoice([line]), {
    subtotal: 25000,
    tax: 5000,
    total: 30000,
    items: [{ ...line, subtotal: 25000, tax: 5000, total: 30000 }],
  });
  assert.equal(
    calculateInvoice([
      { ...line, quantity: 1, unitAmount: 5, taxRateBasisPoints: 1000 },
    ]).tax,
    1,
  );
  assert.throws(() =>
    calculateInvoice([{ ...line, quantity: 100000, unitAmount: 2147483647 }]),
  );
  const now = new Date("2026-09-21T12:00:00Z");
  assert.equal(
    invoiceState("ISSUED", 100, 20, "2026-09-20T00:00:00Z", now),
    "OVERDUE",
  );
  assert.equal(
    invoiceState("ISSUED", 100, 100, "2026-09-20T00:00:00Z", now),
    "PAID",
  );
  assert.equal(
    invoiceState("ISSUED", 100, 20, "2027-01-01T00:00:00Z", now),
    "PARTIALLY_PAID",
  );
  assert.equal(
    invoiceState("DRAFT", 100, 0, "2026-09-20T00:00:00Z", now),
    "DRAFT",
  );
  for (const type of [
    "PLUMBING",
    "AGENCY",
    "PROFESSIONAL_SERVICES",
    "LOGISTICS_COURIER",
  ])
    assert.ok(resolveBusinessProfile(type).enabledModules.includes("invoices"));
  assert.ok(
    !resolveBusinessProfile("SALON_BARBER").enabledModules.includes("invoices"),
  );
  assert.ok(
    !effectiveCapabilities("staff", "MANAGER").includes("INVOICES_VIEW"),
  );
  assert.ok(
    effectiveCapabilities("staff", "MANAGER", { INVOICES_VIEW: true }).includes(
      "INVOICES_VIEW",
    ),
  );
});
const url = process.env.INVOICES_TEST_DATABASE_URL;
test(
  "Invoices PostgreSQL: lifecycle, sources, allocations, races, refunds and Customer 360",
  { skip: !url },
  async (t) => {
    const parsed = new URL(url!);
    assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/invoices_test");
    const pool = new Pool({ connectionString: url, max: 1 }),
      c = await pool.connect(),
      schema = "invoices_" + id().replaceAll("-", "");
    await c.query(
      `create schema ${schema};set search_path to ${schema},public`,
    );
    const dbUrl = new URL(url!);
    dbUrl.searchParams.set("options", `-c search_path=${schema},public`);
    database.getDatabase(dbUrl.toString());
    const tables = [
      database.tenants,
      database.users,
      database.clients,
      database.services,
      database.appointments,
      database.salesOpportunities,
      database.salesPipelineStages,
      database.salesQuotes,
      database.salesQuoteItems,
      database.workItems,
      database.checkoutTransactions,
      database.checkoutPaymentComponents,
      database.stripePaymentAttempts,
      database.stripeRefunds,
    ];
    for (const table of tables) {
      const config = getTableConfig(table);
      await c.query(
        `create table "${config.name}" (${config.columns.map((col) => `"${col.name}" ${col.getSQLType()}${col.name === "id" ? " primary key default gen_random_uuid()" : col.name === "public_reference" ? " default gen_random_uuid()" : ["created_at", "updated_at"].includes(col.name) ? " default now()" : ["is_internal", "is_test"].includes(col.name) ? " default false" : ""}`).join(",")})`,
      );
    }
    await c.query(
      "alter table checkout_transactions add column idempotency_key varchar(255);create unique index checkout_idem on checkout_transactions(tenant_id,idempotency_key) where idempotency_key is not null",
    );
    const insert = async (table: string, row: Record<string, unknown>) => {
      const cols = Object.keys(row);
      return (
        await c.query(
          `insert into ${table} (${cols.join(",")}) values (${cols.map((_, i) => "$" + (i + 1)).join(",")}) returning *`,
          Object.values(row),
        )
      ).rows[0];
    };
    const tenant = id(),
      foreignTenant = id(),
      user = id(),
      otherUser = id(),
      customer = id(),
      otherCustomer = id(),
      clientRef = id(),
      otherClientRef = id(),
      foreignClientRef = id(),
      stage = id(),
      sale = id(),
      saleRef = id(),
      quote = id(),
      quoteRef = id(),
      work = id(),
      workRef = id(),
      booking = id(),
      bookingRef = id();
    const actor: InvoiceActor = {
      tenantId: tenant,
      userId: user,
      role: "owner",
      permissions: [],
    };
    const invoices = new InvoiceService(),
      payments = new InvoicePaymentService();
    const create = (extra: Record<string, unknown> = {}) =>
      invoices.create(
        actor,
        CreateInvoiceSchema.parse({
          ...request(),
          clientReference: clientRef,
          ...extra,
        }),
      );
    const issue = async (amount = 10000) => {
      const i = await create({
        items: [
          { ...line, quantity: 1, unitAmount: amount, taxRateBasisPoints: 0 },
        ],
      });
      return invoices.transition(actor, i.reference, "ISSUED");
    };
    try {
      for (const migration of [
        "20260921140000_sales_booking_relationship.sql",
        "20260921160000_universal_invoices.sql",
      ]) {
        const text = await readFile(
          new URL(
            "../../../packages/database/migrations/" + migration,
            import.meta.url,
          ),
          "utf8",
        );
        await c.query(text);
        await c.query(text);
      }
      const configured = {
        version: 1,
        completedAt: "2026-09-01T12:00:00Z",
        answers: {
          businessName: "Test trade",
          businessType: "PLUMBING",
          teamSize: "2-5",
          buying: ["appointments", "quotes"],
          delivery: ["jobs"],
          resources: ["staff"],
          payment: ["invoices"],
          manage: ["customers", "sales", "bookings"],
        },
      };
      await insert("tenants", {
        id: tenant,
        business_type: "PLUMBING",
        business_profile: configured,
        currency: "GBP",
      });
      await insert("tenants", {
        id: foreignTenant,
        business_type: "AGENCY",
        currency: "GBP",
      });
      for (const u of [user, otherUser])
        await insert("users", {
          id: u,
          tenant_id: tenant,
          name: "Invoice colleague",
        });
      await insert("clients", {
        id: customer,
        public_reference: clientRef,
        tenant_id: tenant,
        name: "Acme Ltd",
      });
      await insert("clients", {
        id: otherCustomer,
        public_reference: otherClientRef,
        tenant_id: tenant,
        name: "Other customer",
      });
      await insert("clients", {
        id: id(),
        public_reference: foreignClientRef,
        tenant_id: foreignTenant,
        name: "Foreign secret",
      });
      await insert("sales_pipeline_stages", {
        id: stage,
        tenant_id: tenant,
        category: "WON",
        name: "Won",
      });
      await insert("sales_opportunities", {
        id: sale,
        public_reference: saleRef,
        tenant_id: tenant,
        client_id: customer,
        owner_user_id: user,
        title: "Website sale",
        currency: "GBP",
        stage_id: stage,
      });
      await insert("sales_quotes", {
        id: quote,
        public_reference: quoteRef,
        tenant_id: tenant,
        client_id: customer,
        opportunity_id: sale,
        title: "Accepted website",
        status: "ACCEPTED",
        currency: "GBP",
        subtotal: 25000,
        tax_total: 5000,
        total: 30000,
      });
      await insert("sales_quote_items", {
        tenant_id: tenant,
        quote_id: quote,
        description: line.description,
        quantity: 2,
        unit_amount: 12500,
        tax_rate_basis_points: 2000,
        position: 0,
      });
      await insert("work_items", {
        id: work,
        public_reference: workRef,
        tenant_id: tenant,
        client_id: customer,
        source_opportunity_id: sale,
        source_quote_id: quote,
        title: "Website project",
        status: "IN_PROGRESS",
        assigned_user_id: user,
      });
      await insert("appointments", {
        id: booking,
        public_reference: bookingRef,
        tenant_id: tenant,
        client_id: customer,
        user_id: user,
        status: "CONFIRMED",
        sales_opportunity_id: sale,
      });
      await t.test(
        "explicit staff actions, owner defaults, profile gate and customer search",
        async () => {
          const i = await issue();
          const viewer = {
            ...actor,
            role: "staff" as const,
            permissions: ["INVOICES_VIEW"],
          };
          assert.equal(
            (await invoices.get(viewer, i.reference)).reference,
            i.reference,
          );
          await assert.rejects(
            invoices.create(viewer, {
              ...request(),
              clientReference: clientRef,
            }),
          );
          await assert.rejects(
            invoices.transition(viewer, i.reference, "VOID"),
          );
          await assert.rejects(
            payments.record(viewer, i.reference, {
              amount: 1,
              method: "CASH",
              reference: "",
              idempotencyKey: id(),
            }),
          );
          await assert.rejects(
            invoices.settings(viewer, {
              termsDays: 7,
              prefix: "TEST",
              footer: "",
            }),
          );
          const recorder = {
            ...viewer,
            permissions: ["INVOICES_VIEW", "INVOICES_RECORD_PAYMENT"],
          };
          assert.equal(
            (
              await payments.record(recorder, i.reference, {
                amount: 1,
                method: "CASH",
                reference: "",
                idempotencyKey: id(),
              })
            ).paid,
            1,
          );
          await invoices.settings(actor, {
            termsDays: 14,
            prefix: "ACME",
            footer: "Pay by bank transfer",
          });
          assert.equal((await invoices.settings(actor)).termsDays, 14);
          assert.ok((await create()).number.startsWith("ACME-"));
          assert.deepEqual(
            (
              await invoices.context(
                actor,
                undefined,
                undefined,
                "Other customer",
              )
            ).customers.map((c) => c.reference),
            [otherClientRef],
          );
          const salon = await insert("tenants", {
            business_type: "SALON_BARBER",
            currency: "GBP",
          });
          await assert.rejects(
            invoices.list(
              { ...actor, tenantId: salon.id },
              InvoiceListQuerySchema.parse({}),
            ),
          );
        },
      );
      await t.test(
        "draft editing, issuing, immutable totals and voiding",
        async () => {
          const same = { ...request(), clientReference: clientRef };
          const first = await invoices.create(actor, same);
          assert.equal(
            (await invoices.create(actor, same)).reference,
            first.reference,
          );
          await assert.rejects(
            invoices.create(actor, { ...same, title: "Changed retry" }),
          );
          const i = await create();
          assert.equal(i.total, 30000);
          assert.equal(i.due, 0);
          assert.equal(i.status, "DRAFT");
          const edited = await invoices.update(actor, i.reference, {
            title: "Updated",
            dueAt: i.dueAt,
            memo: "Reviewed",
            items: [{ ...line, quantity: 1 }],
          });
          assert.equal(edited.total, 15000);
          const issued = await invoices.transition(
            actor,
            i.reference,
            "ISSUED",
          );
          assert.equal(issued.due, 15000);
          await assert.rejects(
            invoices.update(actor, i.reference, {
              title: "bad",
              dueAt: i.dueAt,
              memo: "",
              items: [line],
            }),
          );
          await assert.rejects(
            c.query(
              "update invoices set total_minor=1 where public_reference=$1",
              [i.reference],
            ),
          );
          await assert.rejects(
            c.query(
              "update invoice_items set description=$1 where invoice_id=(select id from invoices where public_reference=$2)",
              ["rewritten", i.reference],
            ),
          );
          assert.equal(
            (await invoices.transition(actor, i.reference, "VOID")).status,
            "VOID",
          );
          await assert.rejects(
            invoices.transition(actor, i.reference, "ISSUED"),
          );
        },
      );
      await t.test(
        "accepted quote snapshot is idempotent and quote remains unchanged",
        async () => {
          const [a, b] = await Promise.all([
            invoices.fromQuote(actor, quoteRef),
            invoices.fromQuote(actor, quoteRef),
          ]);
          assert.equal(a.reference, b.reference);
          assert.equal(a.total, 30000);
          assert.equal(a.items[0].description, "Website");
          assert.equal(
            (
              await c.query("select status from sales_quotes where id=$1", [
                quote,
              ])
            ).rows[0].status,
            "ACCEPTED",
          );
          await c.query("update sales_quotes set status=$1 where id=$2", [
            "SENT",
            quote,
          ]);
          await assert.rejects(invoices.fromQuote(actor, quoteRef));
          await c.query("update sales_quotes set status=$1 where id=$2", [
            "ACCEPTED",
            quote,
          ]);
        },
      );
      await t.test(
        "multiple Work invoices, booking provenance and own/all source restrictions",
        async () => {
          const a = await create({
              source: { kind: "WORK", reference: workRef },
            }),
            b = await create({ source: { kind: "WORK", reference: workRef } });
          assert.notEqual(a.reference, b.reference);
          assert.deepEqual(a.sources.map((s) => s.kind).sort(), [
            "QUOTE",
            "SALE",
            "WORK",
          ]);
          const bookingInvoice = await create({
            source: { kind: "BOOKING", reference: bookingRef },
          });
          assert.ok(
            bookingInvoice.sources.some((s) => s.reference === bookingRef),
          );
          const restricted = {
            ...actor,
            userId: otherUser,
            role: "staff" as const,
            permissions: [
              "INVOICES_VIEW",
              "INVOICES_CREATE",
              "WORK_VIEW_OWN",
              "SALES_VIEW_OWN",
              "QUOTES_VIEW",
              "BOOKINGS_VIEW_OWN",
            ],
          };
          for (const [kind, reference] of [
            ["WORK", workRef],
            ["QUOTE", quoteRef],
            ["SALE", saleRef],
            ["BOOKING", bookingRef],
          ])
            await assert.rejects(
              invoices.context(restricted, { kind: kind as any, reference }),
            );
          const hidden = await invoices.get(
            { ...restricted, permissions: ["INVOICES_VIEW"] },
            a.reference,
          );
          assert.deepEqual(hidden.sources, []);
        },
      );
      await t.test(
        "foreign customer, source, invoice and HTTP tenant injection fail",
        async () => {
          await assert.rejects(create({ clientReference: foreignClientRef }));
          for (const [kind, table] of [
            ["WORK", "work_items"],
            ["QUOTE", "sales_quotes"],
            ["SALE", "sales_opportunities"],
            ["BOOKING", "appointments"],
          ]) {
            const foreign = await insert(table, {
              tenant_id: foreignTenant,
              client_id: customer,
              public_reference: id(),
            });
            await assert.rejects(
              create({ source: { kind, reference: foreign.public_reference } }),
            );
          }
          await assert.rejects(
            create({
              clientReference: otherClientRef,
              source: { kind: "WORK", reference: workRef },
            }),
          );
          const i = await create();
          await assert.rejects(
            invoices.get({ ...actor, tenantId: foreignTenant }, i.reference),
          );
          await assert.rejects(
            invoices.get(
              { ...actor, role: "staff", permissions: [] },
              i.reference,
            ),
          );
          const app = Fastify();
          let authenticated = false;
          app.decorateRequest("requireAuth", function () {
            if (!authenticated)
              throw Object.assign(new Error("Unauthenticated"), {
                statusCode: 401,
              });
          });
          app.addHook("preHandler", async (r) => {
            r.auth = {
              tenantId: tenant,
              tenantUserId: user,
              role: "owner",
              permissions: [],
            } as never;
          });
          app.setErrorHandler((e, _r, reply) =>
            reply
              .code(e.name === "ZodError" ? 400 : (e.statusCode ?? 500))
              .send({ error: e.message }),
          );
          await app.register(invoiceRoutes);
          try {
            assert.equal((await app.inject("/")).statusCode, 401);
            authenticated = true;
            assert.equal(
              (await app.inject("/?tenantId=" + foreignTenant)).statusCode,
              400,
            );
            assert.equal(
              (
                await app.inject({
                  method: "POST",
                  url: "/",
                  payload: {
                    ...request(),
                    clientReference: clientRef,
                    paid: 5,
                  },
                })
              ).statusCode,
              400,
            );
          } finally {
            await app.close();
          }
        },
      );
      await t.test(
        "partial/full payments, idempotence, refunds and overpayment protection",
        async () => {
          const i = await issue();
          const pay = {
            amount: 2500,
            method: "CASH" as const,
            reference: "cash receipt",
            idempotencyKey: id(),
          };
          const partial = await payments.record(actor, i.reference, pay);
          assert.equal(partial.paid, 2500);
          assert.equal(partial.due, 7500);
          assert.equal(partial.status, "PARTIALLY_PAID");
          assert.equal(
            (await payments.record(actor, i.reference, pay)).paid,
            2500,
          );
          await assert.rejects(
            payments.record(actor, i.reference, { ...pay, amount: 2501 }),
          );
          await assert.rejects(
            payments.record(actor, i.reference, {
              ...pay,
              amount: 8000,
              idempotencyKey: id(),
            }),
          );
          await assert.rejects(invoices.transition(actor, i.reference, "VOID"));
          const full = await payments.record(actor, i.reference, {
            ...pay,
            amount: 7500,
            idempotencyKey: id(),
          });
          assert.equal(full.status, "PAID");
          assert.equal(full.due, 0);
          const refund = {
            paymentReference: partial.payments[0].reference,
            amount: 1000,
            reason: "Returned cash",
            idempotencyKey: id(),
          };
          const refunded = await payments.reverse(actor, i.reference, refund);
          assert.equal(refunded.paid, 9000);
          assert.equal(refunded.due, 1000);
          const canonicalPayment = (
            await c.query(
              "select id from checkout_transactions where tenant_id=$1 and public_reference=$2",
              [tenant, refund.paymentReference],
            )
          ).rows[0];
          const history = await new PaymentsRepository().getPaymentDetail(
            tenant,
            canonicalPayment.id,
          );
          assert.equal(history?.clientDisplayName, "Acme Ltd");
          assert.equal(history?.currency, "GBP");
          assert.equal(history?.refundedAmount, 1000);
          assert.equal(history?.refundableAmount, 1500);
          assert.equal(
            await new PaymentsRepository().getPaymentDetail(
              foreignTenant,
              canonicalPayment.id,
            ),
            null,
          );
          assert.equal(
            (await payments.reverse(actor, i.reference, refund)).due,
            1000,
          );
          await assert.rejects(
            payments.reverse(actor, i.reference, {
              ...refund,
              amount: 9999,
              idempotencyKey: id(),
            }),
          );
          await assert.rejects(
            c.query(
              "delete from checkout_payment_reversals where idempotency_key=$1",
              [refund.idempotencyKey],
            ),
          );
          await assert.rejects(
            c.query(
              "update checkout_transactions set total_amount=1 where public_reference=$1",
              [refund.paymentReference],
            ),
          );
        },
      );
      await t.test(
        "concurrent payments cannot exceed total; same request produces one payment",
        async () => {
          const i = await issue(100);
          const outcomes = await Promise.allSettled([
            payments.record(actor, i.reference, {
              amount: 70,
              method: "CASH",
              reference: "",
              idempotencyKey: id(),
            }),
            payments.record(actor, i.reference, {
              amount: 70,
              method: "CASH",
              reference: "",
              idempotencyKey: id(),
            }),
          ]);
          assert.equal(
            outcomes.filter((o) => o.status === "fulfilled").length,
            1,
          );
          assert.equal((await invoices.get(actor, i.reference)).paid, 70);
          const j = await issue(),
            p = {
              amount: 100,
              method: "CASH" as const,
              reference: "",
              idempotencyKey: id(),
            };
          await Promise.all([
            payments.record(actor, j.reference, p),
            payments.record(actor, j.reference, p),
          ]);
          assert.equal(
            (await invoices.get(actor, j.reference)).payments.length,
            1,
          );
          const requests = await Promise.all(
            Array.from({ length: 8 }, () => create()),
          );
          assert.equal(new Set(requests.map((r) => r.number)).size, 8);
        },
      );
      await t.test(
        "exact historical deposit evidence, no guessing, cross-customer/currency and provider refunds",
        async () => {
          const i = await issue(1000),
            pi = "pi_" + id(),
            p = await insert("checkout_transactions", {
              tenant_id: tenant,
              appointment_id: booking,
              total_amount: 200,
              payment_status: "SUCCEEDED",
              payment_method: "STRIPE_ONLINE",
              stripe_payment_intent_id: pi,
              purpose: "booking_payment",
            });
          assert.ok(
            !(await payments.available(actor, i.reference)).some(
              (x) => x.reference === p.public_reference,
            ),
          );
          await assert.rejects(
            payments.allocate(actor, i.reference, p.public_reference),
          );
          await insert("stripe_payment_attempts", {
            tenant_id: tenant,
            appointment_id: booking,
            stripe_payment_intent_id: pi,
            amount: 200,
            currency: "gbp",
            status: "SUCCEEDED",
          });
          assert.ok(
            (await payments.available(actor, i.reference)).some(
              (x) => x.reference === p.public_reference,
            ),
          );
          const duplicate = await insert("checkout_transactions", {
            tenant_id: tenant,
            appointment_id: booking,
            total_amount: 200,
            payment_status: "SUCCEEDED",
            payment_method: "STRIPE_ONLINE",
            stripe_payment_intent_id: pi,
            purpose: "booking_payment",
          });
          assert.ok(
            !(await payments.available(actor, i.reference)).some(
              (x) => x.reference === p.public_reference,
            ),
          );
          await assert.rejects(
            payments.allocate(actor, i.reference, p.public_reference),
          );
          await c.query("delete from checkout_transactions where id=$1", [
            duplicate.id,
          ]);
          const allocated = await payments.allocate(
            actor,
            i.reference,
            p.public_reference,
          );
          assert.equal(allocated.paid, 200);
          assert.equal(
            (await payments.allocate(actor, i.reference, p.public_reference))
              .paid,
            200,
          );
          const j = await issue();
          await assert.rejects(
            payments.allocate(actor, j.reference, p.public_reference),
          );
          for (const extra of [
            { tenant_id: foreignTenant, client_id: customer, currency: "GBP" },
            { tenant_id: tenant, client_id: otherCustomer, currency: "GBP" },
            { tenant_id: tenant, client_id: customer, currency: "USD" },
          ]) {
            const bad = await insert("checkout_transactions", {
              ...extra,
              total_amount: 100,
              payment_status: "SUCCEEDED",
              payment_method: "CASH",
            });
            await assert.rejects(
              payments.allocate(actor, i.reference, bad.public_reference),
            );
          }
          const refund = await insert("stripe_refunds", {
            tenant_id: tenant,
            checkout_transaction_id: p.id,
            amount: 50,
            currency: "GBP",
            status: "PENDING",
          });
          assert.equal((await invoices.get(actor, i.reference)).paid, 200);
          await c.query(
            "update stripe_refunds set status='SUCCEEDED',completed_at=now() where id=$1",
            [refund.id],
          );
          assert.equal((await invoices.get(actor, i.reference)).paid, 150);
          await assert.rejects(
            insert("stripe_refunds", {
              tenant_id: tenant,
              checkout_transaction_id: p.id,
              amount: -1,
              currency: "GBP",
              status: "SUCCEEDED",
            }),
          );
          await assert.rejects(
            insert("stripe_refunds", {
              tenant_id: foreignTenant,
              checkout_transaction_id: p.id,
              amount: 1,
              currency: "GBP",
              status: "SUCCEEDED",
            }),
          );
          await assert.rejects(
            insert("stripe_refunds", {
              tenant_id: tenant,
              checkout_transaction_id: p.id,
              amount: 1,
              currency: "USD",
              status: "SUCCEEDED",
            }),
          );
          await assert.rejects(
            c.query("delete from stripe_refunds where id=$1", [refund.id]),
          );
          await assert.rejects(
            payments.reverse(actor, i.reference, {
              paymentReference: p.public_reference,
              amount: 50,
              reason: "Provider refund",
              idempotencyKey: id(),
            }),
          );
        },
      );
      await t.test(
        "bounded cursor pages, invoice-only summaries and Customer 360 canonical evidence",
        async () => {
          const past = await create({ dueAt: "2026-01-01T00:00:00.000Z" });
          await invoices.transition(actor, past.reference, "ISSUED");
          await payments.record(actor, past.reference, {
            amount: 100,
            method: "BANK_TRANSFER",
            reference: "",
            idempotencyKey: id(),
          });
          const first = await invoices.list(
              actor,
              InvoiceListQuerySchema.parse({ filter: "ALL", limit: 3 }),
            ),
            second = await invoices.list(
              actor,
              InvoiceListQuerySchema.parse({
                filter: "ALL",
                limit: 3,
                cursor: first.nextCursor,
              }),
            );
          assert.equal(first.items.length, 3);
          assert.ok(
            !first.items.some((a) =>
              second.items.some((b) => a.reference === b.reference),
            ),
          );
          assert.ok(first.summary.some((s) => Number(s.overdue) > 0));
          const dialect = new PgDialect(),
            adapters = invoiceCustomerAdapter({
              actor,
              clientId: customer,
              profile: resolveBusinessProfile("AGENCY"),
              now: new Date(),
            });
          assert.equal(adapters.length, 1);
          const compiled = dialect.sqlToQuery(adapters[0].current);
          const current = (await c.query(compiled.sql, compiled.params)).rows;
          const row = current.find((r) => r.reference === past.reference);
          assert.equal(row.amount, 29900);
          assert.equal(row.status, "OVERDUE");
          const signal = attentionFor(
            {
              key: "invoices:" + past.reference,
              source: "invoices",
              type: "INVOICE",
              reference: past.reference,
              title: row.title,
              status: "OVERDUE",
              subtitle: "overdue",
              occurredAt: new Date(row.occurred_at).toISOString(),
              dueAt: new Date(row.due_at).toISOString(),
              owner: null,
              amount: row.amount,
              currency: "GBP",
              attentionLevel: "INFO",
              action: null,
            },
            row,
            new Date(),
          );
          assert.equal(signal?.code, "INVOICE_OVERDUE");
          const dueSoon = {
            key: "invoice:soon",
            source: "invoices" as const,
            type: "INVOICE",
            reference: past.reference,
            title: "Due soon",
            status: "ISSUED",
            subtitle: "issued",
            occurredAt: new Date().toISOString(),
            dueAt: new Date(Date.now() + 86400000).toISOString(),
            owner: null,
            amount: 100,
            currency: "GBP",
            attentionLevel: "INFO" as const,
            action: null,
          };
          assert.equal(
            attentionFor(dueSoon, row, new Date())?.code,
            "INVOICE_DUE_SOON",
          );
          const timeline = dialect.sqlToQuery(adapters[0].timeline);
          assert.ok(
            (await c.query(timeline.sql, timeline.params)).rows.some(
              (r) => r.type === "PAYMENT_ALLOCATED",
            ),
          );
          const metrics = dialect.sqlToQuery(adapters[0].metrics!);
          assert.ok(
            (await c.query(metrics.sql, metrics.params)).rows.some(
              (r) => r.key === "invoice-due-GBP" && Number(r.value) > 0,
            ),
          );
          assert.equal(
            invoiceCustomerAdapter({
              actor: { ...actor, role: "staff", permissions: [] },
              clientId: customer,
              profile: resolveBusinessProfile("AGENCY"),
              now: new Date(),
            }).length,
            0,
          );
          // Staff granted invoices + CRM gets real overview without unrelated source permissions.
          const overview = await new Customer360Service().overview(
            {
              ...actor,
              role: "staff",
              permissions: ["CLIENTS_VIEW_BASIC", "INVOICES_VIEW"],
            },
            clientRef,
          );
          assert.equal(overview.diagnostics.length, 0);
          assert.ok(overview.now.some((n) => n.reference === past.reference));
          assert.ok(
            overview.attention.some((n) => n.code === "INVOICE_OVERDUE"),
          );
          assert.ok(overview.summary.some((m) => m.key === "invoice-due-GBP"));
        },
      );
    } finally {
      await database.closeDatabase();
      await c.query(`drop schema ${schema} cascade`);
      c.release();
      await pool.end();
    }
  },
);
