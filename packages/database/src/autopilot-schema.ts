import {
  boolean,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  automationActionRuns,
  automationRuns,
  tenants,
  users,
} from "./schema.js";
// Composite tenant/run FKs and bounded CHECKs are enforced by migration 89.
export const automationTenantControls = pgTable("automation_tenant_controls", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  outboundPaused: boolean("outbound_paused").notNull().default(false),
  emergencyStopped: boolean("emergency_stopped").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const automationApprovalRequests = pgTable(
  "automation_approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicReference: uuid("public_reference")
      .notNull()
      .unique()
      .defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    automationRunId: uuid("automation_run_id")
      .notNull()
      .references(() => automationRuns.id),
    automationActionRunId: uuid("automation_action_run_id")
      .notNull()
      .unique()
      .references(() => automationActionRuns.id),
    actionType: varchar("action_type", { length: 60 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    riskLevel: varchar("risk_level", { length: 30 })
      .notNull()
      .default("APPROVAL_REQUIRED"),
    title: varchar("title", { length: 160 }).notNull(),
    reason: varchar("reason", { length: 300 }).notNull(),
    safePreviewJson: jsonb("safe_preview_json").notNull(),
    configHash: varchar("config_hash", { length: 64 }).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id),
  },
);
