import { z } from "zod";
const reference = z.string().uuid();
const money = z.number().int().min(0).max(2_147_483_647);
export const InvoiceLineInputSchema = z
  .object({
    description: z.string().trim().min(1).max(1000),
    quantity: z.number().int().min(1).max(100000),
    unitAmount: money,
    taxRateBasisPoints: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const InvoiceSourceSchema = z
  .object({ kind: z.enum(["QUOTE", "WORK", "BOOKING", "SALE"]), reference })
  .strict();
export const CreateInvoiceSchema = z
  .object({
    clientReference: reference.optional(),
    source: InvoiceSourceSchema.optional(),
    title: z.string().trim().min(1).max(255),
    currency: z.string().regex(/^[A-Z]{3}$/),
    dueAt: z.string().datetime(),
    memo: z.string().trim().max(2000).default(""),
    items: z.array(InvoiceLineInputSchema).min(1).max(100),
    idempotencyKey: reference,
  })
  .strict()
  .refine((v) => v.clientReference || v.source, "Choose a customer or source");
export type CreateInvoice = z.infer<typeof CreateInvoiceSchema>;
export const UpdateInvoiceSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    dueAt: z.string().datetime(),
    memo: z.string().trim().max(2000),
    items: z.array(InvoiceLineInputSchema).min(1).max(100),
  })
  .strict();
export const ConvertQuoteInvoiceSchema = z
  .object({ dueAt: z.string().datetime().optional() })
  .strict();
export const RecordInvoicePaymentSchema = z
  .object({
    amount: money.refine((v) => v > 0),
    method: z.enum(["CASH", "BANK_TRANSFER", "EXTERNAL_CARD"]),
    reference: z.string().trim().max(120).default(""),
    idempotencyKey: reference,
  })
  .strict();
export const AllocateInvoicePaymentSchema = z
  .object({ paymentReference: reference })
  .strict();
export const ReverseInvoicePaymentSchema = z
  .object({
    paymentReference: reference,
    amount: money.refine((v) => v > 0),
    reason: z.string().trim().min(3).max(500),
    idempotencyKey: reference,
  })
  .strict();
export const InvoiceListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z
      .string()
      .max(1000)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    filter: z.enum(["ALL", "OWED", "OVERDUE", "DRAFT", "PAID"]).default("OWED"),
    clientReference: reference.optional(),
    source: InvoiceSourceSchema.shape.kind.optional(),
    sourceReference: reference.optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.source) === Boolean(v.sourceReference),
    "Choose a source type and reference",
  );
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;
export const InvoiceSettingsSchema = z
  .object({
    termsDays: z
      .union([z.literal(0), z.literal(7), z.literal(14), z.literal(30)])
      .default(30),
    prefix: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9-]{0,9}$/)
      .default("INV"),
    footer: z.string().trim().max(2000).default(""),
  })
  .strict();
export const InvoiceSchema = z
  .object({
    reference,
    number: z.string(),
    title: z.string(),
    customer: z.object({ reference, name: z.string() }),
    currency: z.string(),
    status: z.enum([
      "DRAFT",
      "ISSUED",
      "PARTIALLY_PAID",
      "PAID",
      "OVERDUE",
      "VOID",
    ]),
    subtotal: money,
    tax: money,
    total: money,
    paid: money,
    due: money,
    dueAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    issuedAt: z.string().datetime().nullable(),
    memo: z.string(),
    footer: z.string(),
    items: z.array(
      InvoiceLineInputSchema.extend({
        subtotal: money,
        tax: money,
        total: money,
      }),
    ),
    sources: z.array(InvoiceSourceSchema),
    activity: z.array(
      z.object({
        reference,
        type: z.string(),
        amount: money.nullable(),
        at: z.string().datetime(),
      }),
    ),
    payments: z.array(
      z.object({
        reference,
        amount: money,
        net: money,
        method: z.string(),
        at: z.string().datetime(),
        canReverse: z.boolean(),
      }),
    ),
    actions: z.object({
      manage: z.boolean(),
      recordPayment: z.boolean(),
      void: z.boolean(),
    }),
  })
  .strict();
export type Invoice = z.infer<typeof InvoiceSchema>;
export function calculateInvoice(
  items: z.infer<typeof InvoiceLineInputSchema>[],
) {
  let subtotal = 0n,
    tax = 0n;
  const bounded = (v: bigint) => {
    if (v < 0n || v > 2147483647n)
      throw new Error("Invoice amount exceeds the supported range.");
    return Number(v);
  };
  const lines = items.map((input) => {
    const item = InvoiceLineInputSchema.parse(input);
    const sub = BigInt(item.quantity) * BigInt(item.unitAmount);
    const vat = (sub * BigInt(item.taxRateBasisPoints) + 5000n) / 10000n;
    subtotal += sub;
    tax += vat;
    return {
      ...item,
      subtotal: bounded(sub),
      tax: bounded(vat),
      total: bounded(sub + vat),
    };
  });
  return {
    items: lines,
    subtotal: bounded(subtotal),
    tax: bounded(tax),
    total: bounded(subtotal + tax),
  };
}
export function invoiceState(
  status: string,
  total: number,
  paid: number,
  dueAt: string,
  now = new Date(),
) {
  if (status === "DRAFT" || status === "VOID") return status;
  if (paid >= total) return "PAID";
  if (Date.parse(dueAt) < now.getTime()) return "OVERDUE";
  return paid > 0 ? "PARTIALLY_PAID" : "ISSUED";
}
