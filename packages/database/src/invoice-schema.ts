import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  timestamp,
} from "drizzle-orm/pg-core";
import { tenants, clients, users, checkoutTransactions } from "./schema.js";
const created = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const invoiceSettings = pgTable("invoice_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  termsDays: integer("terms_days").default(30).notNull(),
  prefix: varchar("prefix", { length: 10 }).default("INV").notNull(),
  footer: text("footer").default("").notNull(),
  nextNumber: bigint("next_number", { mode: "bigint" }).default(1n).notNull(),
});
export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicReference: uuid("public_reference").defaultRandom().notNull().unique(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "restrict" }),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  status: varchar("status", { length: 10 }).default("DRAFT").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  subtotalMinor: integer("subtotal_minor").notNull(),
  taxMinor: integer("tax_minor").notNull(),
  totalMinor: integer("total_minor").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  memo: text("memo").default("").notNull(),
  footer: text("footer").default("").notNull(),
  sourceQuoteId: uuid("source_quote_id"),
  sourceOpportunityId: uuid("source_opportunity_id"),
  sourceWorkItemId: uuid("source_work_item_id"),
  sourceAppointmentId: uuid("source_appointment_id"),
  idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: created(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  description: varchar("description", { length: 1000 }).notNull(),
  quantity: integer("quantity").notNull(),
  unitAmountMinor: integer("unit_amount_minor").notNull(),
  taxRateBasisPoints: integer("tax_rate_basis_points").notNull(),
  subtotalMinor: integer("subtotal_minor").notNull(),
  taxMinor: integer("tax_minor").notNull(),
  totalMinor: integer("total_minor").notNull(),
  position: integer("position").notNull(),
});
export const invoicePaymentAllocations = pgTable(
  "invoice_payment_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicReference: uuid("public_reference")
      .defaultRandom()
      .unique()
      .notNull(),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    paymentId: uuid("payment_id")
      .unique()
      .notNull()
      .references(() => checkoutTransactions.id, { onDelete: "restrict" }),
    amountMinor: integer("amount_minor").notNull(),
    createdAt: created(),
  },
);
export const checkoutPaymentReversals = pgTable("checkout_payment_reversals", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicReference: uuid("public_reference").defaultRandom().unique().notNull(),
  tenantId: uuid("tenant_id").notNull(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => checkoutTransactions.id, { onDelete: "restrict" }),
  amountMinor: integer("amount_minor").notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: created(),
});
export const invoiceActivity = pgTable("invoice_activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicReference: uuid("public_reference").defaultRandom().unique().notNull(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "restrict" }),
  activityType: varchar("activity_type", { length: 40 }).notNull(),
  amountMinor: integer("amount_minor"),
  createdAt: created(),
});
