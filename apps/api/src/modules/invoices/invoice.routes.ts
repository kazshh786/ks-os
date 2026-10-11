import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  ConvertQuoteInvoiceSchema,
  InvoiceListQuerySchema,
  InvoiceSettingsSchema,
  RecordInvoicePaymentSchema,
  AllocateInvoicePaymentSchema,
  ReverseInvoicePaymentSchema,
  InvoiceSourceSchema,
} from "@ks-os/contracts";
import { InvoiceService } from "./invoice.service.js";
import { InvoicePaymentService } from "./invoice-payments.service.js";
import type { InvoiceActor } from "./invoice.repository.js";
function actor(r: FastifyRequest): InvoiceActor {
  r.requireAuth();
  return {
    tenantId: r.auth!.tenantId,
    userId: r.auth!.tenantUserId,
    role: r.auth!.role,
    permissions: r.auth!.permissions as string[],
  };
}
const ref = (r: FastifyRequest) =>
  z.object({ reference: z.string().uuid() }).strict().parse(r.params).reference;
export async function invoiceRoutes(app: FastifyInstance) {
  const invoices = new InvoiceService(),
    payments = new InvoicePaymentService();
  app.get("/", async (r) => ({
    data: await invoices.list(actor(r), InvoiceListQuerySchema.parse(r.query)),
  }));
  app.post("/", async (r) => ({
    data: await invoices.create(actor(r), CreateInvoiceSchema.parse(r.body)),
  }));
  app.get("/settings", async (r) => ({
    data: await invoices.settings(actor(r)),
  }));
  app.put("/settings", async (r) => ({
    data: await invoices.settings(
      actor(r),
      InvoiceSettingsSchema.parse(r.body),
    ),
  }));
  app.get("/context", async (r) => {
    const q = z
      .object({
        kind: InvoiceSourceSchema.shape.kind.optional(),
        reference: z.string().uuid().optional(),
        clientReference: z.string().uuid().optional(),
        search: z.string().trim().max(100).optional(),
      })
      .strict()
      .refine((v) => Boolean(v.kind) === Boolean(v.reference))
      .parse(r.query);
    return {
      data: await invoices.context(
        actor(r),
        q.kind && q.reference
          ? { kind: q.kind, reference: q.reference }
          : undefined,
        q.clientReference,
        q.search,
      ),
    };
  });
  app.post("/from-quote/:reference", async (r) => ({
    data: await invoices.fromQuote(
      actor(r),
      ref(r),
      ConvertQuoteInvoiceSchema.parse(r.body).dueAt,
    ),
  }));
  app.get("/:reference", async (r) => ({
    data: await invoices.get(actor(r), ref(r)),
  }));
  app.patch("/:reference", async (r) => ({
    data: await invoices.update(
      actor(r),
      ref(r),
      UpdateInvoiceSchema.parse(r.body),
    ),
  }));
  app.post("/:reference/issue", async (r) => ({
    data: await invoices.transition(actor(r), ref(r), "ISSUED"),
  }));
  app.post("/:reference/void", async (r) => ({
    data: await invoices.transition(actor(r), ref(r), "VOID"),
  }));
  app.get("/:reference/payments/available", async (r) => ({
    data: await payments.available(actor(r), ref(r)),
  }));
  app.post("/:reference/payments", async (r) => ({
    data: await payments.record(
      actor(r),
      ref(r),
      RecordInvoicePaymentSchema.parse(r.body),
    ),
  }));
  app.post("/:reference/allocations", async (r) => ({
    data: await payments.allocate(
      actor(r),
      ref(r),
      AllocateInvoicePaymentSchema.parse(r.body).paymentReference,
    ),
  }));
  app.post("/:reference/refunds", async (r) => ({
    data: await payments.reverse(
      actor(r),
      ref(r),
      ReverseInvoicePaymentSchema.parse(r.body),
    ),
  }));
}
