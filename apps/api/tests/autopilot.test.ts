import { reconcileAutopilot } from "../src/modules/automations/autopilot-reconciliation.js";
import Fastify from "fastify";
import {
  agencyAutopilotRoutes,
  autopilotRoutes,
} from "../src/modules/automations/autopilot.routes.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as database from "@ks-os/database";
import {
  BusinessEventSchema,
  AutomationActionSchema,
  ApprovalDecisionSchema,
  actionPolicy,
  managedHealth,
  resolveBusinessProfile,
} from "@ks-os/contracts";
import { AutomationService } from "../src/modules/automations/automation.service.js";
import {
  AutopilotService,
  requireAutopilotOwner,
  actionLabel,
} from "../src/modules/automations/autopilot.service.js";
import {
  BusinessEventsService,
  stableEventId,
} from "../src/modules/automations/business-events.service.js";
import {
  playbooksForProfile,
  installManagedPlaybooks,
} from "../src/modules/automations/managed-playbooks.js";
import { detectAutopilotConditions } from "../src/modules/automations/autopilot-detectors.js";
import {
  resolveAutomationContext,
  sourceStillApplies,
} from "../src/modules/automations/automation-context.js";
import { automationDeliveryState } from "../src/modules/automations/automation-delivery.js";

const id = randomUUID;
test("Autopilot strict contracts reject payload, policy, action and route injection", () => {
  const event = {
    id: "QUOTE_SENT:stable",
    tenantId: id(),
    type: "QUOTE_SENT",
    sourceType: "quote",
    sourceId: id(),
    occurredAt: new Date().toISOString(),
    payload: { version: 1 },
  };
  assert.ok(BusinessEventSchema.safeParse(event).success);
  for (const field of [
    "notes",
    "answers",
    "body",
    "token",
    "sql",
    "url",
    "providerSecret",
  ])
    assert.equal(
      BusinessEventSchema.safeParse({
        ...event,
        payload: { [field]: "private" },
      }).success,
      false,
    );
  assert.equal(
    AutomationActionSchema.safeParse({ type: "REVIEW_FOLLOW_UP", risk: "AUTO" })
      .success,
    false,
  );
  assert.equal(
    AutomationActionSchema.safeParse({
      type: "SEND_EMAIL",
      templateKey: "arbitrary",
    }).success,
    false,
  );
  assert.equal(
    ApprovalDecisionSchema.safeParse({ decision: "APPROVED", tenantId: id() })
      .success,
    false,
  );
  assert.equal(actionPolicy("REVIEW_FOLLOW_UP"), "APPROVAL_REQUIRED");
  assert.equal(actionPolicy("CREATE_TASK"), "AUTO");
  assert.equal(actionPolicy("REFUND"), "HUMAN_ONLY");
  assert.equal(
    stableEventId("QUOTE_SENT", "source", "v1"),
    stableEventId("QUOTE_SENT", "source", "v1"),
  );
});
test("Profiles select relevant internal defaults; simple health and truthful delivery labels", () => {
  assert.ok(
    playbooksForProfile(resolveBusinessProfile("PLUMBING")).some(
      (p) => p.key === "sales.quote-review",
    ),
  );
  assert.ok(
    !playbooksForProfile(resolveBusinessProfile("SALON_BARBER")).some(
      (p) => p.module === "sales" || p.module === "work",
    ),
  );
  assert.ok(
    playbooksForProfile(resolveBusinessProfile("AGENCY")).some(
      (p) => p.module === "invoices",
    ),
  );
  const clear = {
    critical: 0,
    failures: 0,
    approvals: 0,
    overdueApprovals: 0,
    issues: 0,
    stopped: false,
  };
  assert.equal(managedHealth(clear).state, "HEALTHY");
  assert.equal(managedHealth({ ...clear, critical: 1 }).state, "DEGRADED");
  assert.equal(
    managedHealth({ ...clear, overdueApprovals: 1 }).state,
    "ACTION_REQUIRED",
  );
  assert.equal(
    actionLabel("SEND_EMAIL", "SUCCEEDED"),
    "Customer message queued",
  );
  assert.equal(
    actionLabel("SEND_EMAIL", "SUCCEEDED", true),
    "Customer message sent",
  );
  assert.throws(() =>
    requireAutopilotOwner({ tenantId: id(), userId: id(), role: "staff" }),
  );
  assert.throws(() =>
    requireAutopilotOwner({
      tenantId: id(),
      userId: id(),
      role: "owner",
      supportMode: true,
    }),
  );
  assert.equal(
    sourceStillApplies("QUOTE_WAITING", { status: "ACCEPTED" }),
    false,
  );
});

const url = process.env.AUTOPILOT_TEST_DATABASE_URL;
test(
  "Autopilot PostgreSQL: canonical events, concurrency, approvals, controls and tenant isolation",
  { skip: !url },
  async (t) => {
    const parsed = new URL(url!);
    assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/autopilot_test");
    const pool = new Pool({ connectionString: url });
    const c = await pool.connect();
    const schema = "autopilot_" + id().replaceAll("-", "");
    await c.query(
      `create schema ${schema};set search_path to ${schema},public`,
    );
    const dbUrl = new URL(url!);
    dbUrl.searchParams.set("options", `-c search_path=${schema},public`);
    const db = database.getDatabase(dbUrl.toString());
    const tables = [
      database.tenants,
      database.users,
      database.clients,
      database.services,
      database.appointments,
      database.clientSalesProfiles,
      database.salesOpportunities,
      database.salesPipelineStages,
      database.salesQuotes,
      database.workItems,
      database.tasks,
      database.taskActivity,
      database.formAssignments,
      database.checkoutTransactions,
      database.invoices,
      database.invoiceActivity,
      database.automationRules,
      database.automationRuleActions,
      database.automationRuns,
      database.automationActionRuns,
      database.businessEvents,
      database.internalNotifications,
      database.operationsIssues,
      database.emailOutbox,
      database.emailSuppressions,
      database.smsOutbox,
      database.tenantPlanAssignments,
      database.reviewInvitations,
      database.siteJobs,
      database.platformPlans,
      database.platformPlanVersions,
      database.platformPlanEntitlements,
      database.tenantEntitlementOverrides,
    ];
    const dialect = new PgDialect();
    for (const table of tables) {
      const cfg = getTableConfig(table);
      const cols = cfg.columns.map((col) => {
        let def = "";
        const value = col.default;
        if (value !== undefined) {
          if (value && typeof value === "object" && "queryChunks" in value)
            def = " default " + dialect.sqlToQuery(value as any).sql;
          else if (typeof value === "number" || typeof value === "boolean")
            def = " default " + value;
          else
            def =
              " default '" +
              (typeof value === "string"
                ? value
                : JSON.stringify(value)
              ).replaceAll("'", "''") +
              "'";
        }
        return `"${col.name}" ${col.getSQLType()}${def}${col.name === "id" ? " primary key" : ""}`;
      });
      await c.query(`create table "${cfg.name}" (${cols.join(",")})`);
    }
    await c.query(
      `create unique index rule_position on automation_rule_actions(automation_rule_id,position);create unique index rule_event on automation_runs(automation_rule_id,trigger_event_id);create unique index action_key on automation_action_runs(idempotency_key);create unique index task_key on tasks(tenant_id,deduplication_key);create unique index issue_key on operations_issues(tenant_id,deduplication_key);create unique index email_key on email_outbox(idempotency_key);create unique index sms_key on sms_outbox(idempotency_key);create view invoice_balances as select i.*,i.total_minor as due_minor from invoices i;`,
    );
    // Non-login Supabase roles exist only in this disposable server.
    await c.query(
      `do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;end $$`,
    );
    const migration = await readFile(
      new URL(
        "../../../packages/database/migrations/20261011120000_managed_service_autopilot.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await c.query(migration);
    await c.query(migration);
    const insert = async (table: string, row: Record<string, unknown>) => {
      const keys = Object.keys(row);
      return (
        await c.query(
          `insert into ${table}(${keys.join(",")}) values(${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning *`,
          Object.values(row),
        )
      ).rows[0];
    };
    const tenant = await insert("tenants", {
      name: "Test plumber",
      business_type: "PLUMBING",
      is_active: true,
      lifecycle_status: "ACTIVE",
    });
    const other = await insert("tenants", {
      name: "Unmanaged business",
      business_type: "SALON_BARBER",
      is_active: true,
      lifecycle_status: "ACTIVE",
    });
    const user = await insert("users", {
      tenant_id: tenant.id,
      name: "Owner",
      role: "owner",
      account_status: "ACTIVE",
    });
    const client = await insert("clients", {
      tenant_id: tenant.id,
      name: "Customer",
      email: "customer@example.com",
      medical_notes: "DO NOT LEAK",
    });
    const plan = await insert("platform_plans", {
      key: "GROWTH",
      name: "Growth",
    });
    const version = await insert("platform_plan_versions", {
      plan_id: plan.id,
      version: 1,
      name: "Growth",
    });
    await insert("platform_plan_entitlements", {
      plan_version_id: version.id,
      entitlement_key: "automations.enabled",
      value_json: { enabled: true },
    });
    await insert("tenant_plan_assignments", {
      tenant_id: tenant.id,
      plan_version_id: version.id,
      status: "ACTIVE",
      starts_at: new Date(Date.now() - 1000),
      assigned_by_agency_user_id: id(),
    });
    const owner = { tenantId: tenant.id, userId: user.id, role: "owner" };
    const api = new AutopilotService();
    const worker = new AutomationService();
    const quote = () =>
      insert("sales_quotes", {
        tenant_id: tenant.id,
        client_id: client.id,
        status: "SENT",
        sent_at: new Date(Date.now() - 8 * 86400000),
        title: "Private quote narrative",
        total: 2000,
        currency: "GBP",
      });
    const drain = async () => {
      for (let i = 0; i < 4; i++) {
        await worker.processEvents(100);
        await worker.processActions(100);
      }
    };
    try {
      await t.test(
        "transactional capture rolls back and events have only safe identifiers",
        async () => {
          await c.query("begin");
          const rolled = await insert("clients", {
            tenant_id: tenant.id,
            name: "Rollback",
          });
          assert.equal(
            (
              await c.query(
                "select count(*) from business_events where source_id=$1",
                [rolled.id],
              )
            ).rows[0].count,
            "1",
          );
          await c.query("rollback");
          assert.equal(
            (
              await c.query(
                "select count(*) from business_events where source_id=$1",
                [rolled.id],
              )
            ).rows[0].count,
            "0",
          );
          const event = (
            await c.query("select * from business_events where source_id=$1", [
              client.id,
            ])
          ).rows[0];
          assert.deepEqual(event.payload_json, { version: 1 });
          const e = {
            id: "CUSTOMER_CREATED:replay",
            tenantId: tenant.id,
            type: "CUSTOMER_CREATED",
            sourceType: "client",
            sourceId: client.id,
            occurredAt: new Date().toISOString(),
            payload: { version: 1 },
          };
          await Promise.all([
            new BusinessEventsService().emit(e),
            new BusinessEventsService().emit(e),
          ]);
          assert.equal(
            (
              await c.query(
                "select count(*) from business_events where id=$1",
                [e.id],
              )
            ).rows[0].count,
            "1",
          );
          await assert.rejects(() =>
            new BusinessEventsService().emit({
              ...e,
              payload: { notes: "secret" },
            }),
          );
        },
      );
      await t.test(
        "managed templates install once and preserve custom rules",
        async () => {
          const custom = await worker.create(owner as any, {
            name: "My custom rule",
            trigger: { type: "CUSTOMER_CREATED", config: {} },
            conditions: [],
            actions: [
              {
                type: "CREATE_INTERNAL_NOTIFICATION",
                notificationType: "AUTOMATION_FAILED",
              },
            ],
          });
          await db.transaction((tx) => installManagedPlaybooks(tenant.id, tx));
          await db.transaction((tx) => installManagedPlaybooks(tenant.id, tx));
          const rows = (
            await c.query(
              "select managed_template_key,count(*) from automation_rules where tenant_id=$1 group by managed_template_key",
              [tenant.id],
            )
          ).rows;
          assert.ok(rows.every((r) => r.count === "1"));
          assert.equal(
            (await worker.get(owner as any, custom.id)).name,
            "My custom rule",
          );
        },
      );
      let q: any, approval: any;
      await t.test(
        "concurrent detector and event workers create one pending approval",
        async () => {
          q = await quote();
          await Promise.all([
            detectAutopilotConditions(),
            detectAutopilotConditions(),
          ]);
          await Promise.all([
            worker.processEvents(100),
            new AutomationService().processEvents(100),
          ]);
          await Promise.all([
            worker.processActions(100),
            new AutomationService().processActions(100),
          ]);
          const rows = (
            await c.query(
              `select p.* from automation_approval_requests p join automation_runs r on r.id=p.automation_run_id where r.source_id=$1`,
              [q.id],
            )
          ).rows;
          assert.equal(rows.length, 1);
          approval = rows[0];
          assert.equal(approval.status, "PENDING");
          assert.deepEqual(Object.keys(approval.safe_preview_json).sort(), [
            "effect",
            "sourceReference",
            "sourceType",
          ]);
        },
      );
      await t.test(
        "wrong tenant, forged reference and staff cannot approve; concurrent replay creates one task",
        async () => {
          await assert.rejects(() =>
            api.decide(
              { ...owner, tenantId: other.id },
              approval.public_reference,
              "APPROVED",
            ),
          );
          await assert.rejects(() => api.decide(owner, id(), "APPROVED"));
          await assert.rejects(() =>
            api.decide(
              { ...owner, userId: id() },
              approval.public_reference,
              "APPROVED",
            ),
          );
          await assert.rejects(() =>
            api.decide(
              { ...owner, role: "staff" },
              approval.public_reference,
              "APPROVED",
            ),
          );
          await c.query(
            "update users set account_status='SUSPENDED' where id=$1",
            [owner.userId],
          );
          await assert.rejects(
            () => api.decide(owner, approval.public_reference, "APPROVED"),
            { code: "AUTOPILOT_FORBIDDEN" },
          );
          await c.query(
            "update users set account_status='ACTIVE' where id=$1",
            [owner.userId],
          );
          await Promise.all([
            api.decide(owner, approval.public_reference, "APPROVED"),
            api.decide(owner, approval.public_reference, "APPROVED"),
          ]);
          await Promise.all([
            worker.processActions(100),
            new AutomationService().processActions(100),
          ]);
          await worker.processActions(100);
          assert.equal(
            (
              await c.query(
                "select count(*) from tasks where automation_run_id=$1",
                [approval.automation_run_id],
              )
            ).rows[0].count,
            "1",
          );
          assert.equal(
            (
              await c.query(
                "select status from automation_action_runs where id=$1",
                [approval.automation_action_run_id],
              )
            ).rows[0].status,
            "SUCCEEDED",
          );
        },
      );
      await t.test(
        "approved follow-up skips if quote is accepted before execution",
        async () => {
          const next = await quote();
          await detectAutopilotConditions();
          await drain();
          const p = (
            await c.query(
              "select p.* from automation_approval_requests p join automation_runs r on r.id=p.automation_run_id where r.source_id=$1",
              [next.id],
            )
          ).rows[0];
          await api.decide(owner, p.public_reference, "APPROVED");
          await c.query(
            "update sales_quotes set status='ACCEPTED' where id=$1",
            [next.id],
          );
          await worker.processActions(100);
          assert.equal(
            (
              await c.query(
                "select status from automation_action_runs where id=$1",
                [p.automation_action_run_id],
              )
            ).rows[0].status,
            "SKIPPED",
          );
          assert.equal(
            (
              await c.query(
                "select count(*) from tasks where automation_run_id=$1",
                [p.automation_run_id],
              )
            ).rows[0].count,
            "0",
          );
        },
      );
      await t.test("reject and expire decisions never execute", async () => {
        for (const mode of ["reject", "expire"]) {
          const next = await quote();
          await detectAutopilotConditions();
          await drain();
          const p = (
            await c.query(
              "select p.* from automation_approval_requests p join automation_runs r on r.id=p.automation_run_id where r.source_id=$1",
              [next.id],
            )
          ).rows[0];
          if (mode === "reject")
            await api.decide(owner, p.public_reference, "REJECTED");
          else
            await c.query(
              "update automation_approval_requests set requested_at=now()-interval '5 days',expires_at=now()-interval '1 day' where id=$1",
              [p.id],
            );
          await worker.processActions(100);
          assert.equal(
            (
              await c.query(
                "select status from automation_action_runs where id=$1",
                [p.automation_action_run_id],
              )
            ).rows[0].status,
            "SKIPPED",
          );
        }
      });
      await t.test(
        "all adapters scope source and allowlist data; no notes in context",
        async () => {
          const rows = [
            ["client", client],
            ["quote", q],
            [
              "sales_opportunity",
              await insert("sales_opportunities", {
                tenant_id: tenant.id,
                client_id: client.id,
              }),
            ],
            [
              "work_item",
              await insert("work_items", {
                tenant_id: tenant.id,
                client_id: client.id,
                status: "READY",
              }),
            ],
            [
              "task",
              await insert("tasks", {
                tenant_id: tenant.id,
                client_id: client.id,
                status: "OPEN",
                created_by_user_id: user.id,
              }),
            ],
            [
              "appointment",
              await insert("appointments", {
                tenant_id: tenant.id,
                client_id: client.id,
                status: "CONFIRMED",
                start_time: new Date(Date.now() + 86400000),
              }),
            ],
            [
              "form_assignment",
              await insert("form_assignments", {
                tenant_id: tenant.id,
                client_id: client.id,
                status: "PENDING",
                expires_at: new Date(Date.now() + 86400000),
              }),
            ],
            [
              "payment",
              await insert("checkout_transactions", {
                tenant_id: tenant.id,
                client_id: client.id,
                payment_status: "SUCCEEDED",
              }),
            ],
            [
              "invoice",
              await insert("invoices", {
                tenant_id: tenant.id,
                client_id: client.id,
                status: "ISSUED",
                total_minor: 2000,
              }),
            ],
          ] as const;
          for (const [kind, row] of rows) {
            const context = await resolveAutomationContext(
              db,
              tenant.id,
              row.id,
              kind,
            );
            assert.equal(context.sourceId, row.id);
            assert.ok(!JSON.stringify(context).includes("DO NOT LEAK"));
            assert.equal(
              await resolveAutomationContext(db, other.id, row.id, kind),
              null,
            );
          }
        },
      );
      await t.test(
        "existing booking notifications, rule toggles, outbox pauses and reschedule freshness",
        async () => {
          await c.query(
            "update tenants set business_type='SALON_BARBER' where id=$1",
            [tenant.id],
          );
          const appt = await insert("appointments", {
            tenant_id: tenant.id,
            client_id: client.id,
            status: "CONFIRMED",
            start_time: new Date(Date.now() + 3600000),
            end_time: new Date(Date.now() + 7200000),
          });
          const custom = await worker.create(owner as any, {
            name: "Booking notice",
            trigger: { type: "BOOKING_CONFIRMED", config: {} },
            conditions: [{ type: "CLIENT_HAS_EMAIL" }],
            actions: [
              {
                type: "CREATE_INTERNAL_NOTIFICATION",
                notificationType: "FORM_COMPLETED",
              },
            ],
          });
          await worker.activate(owner as any, custom.id);
          await new BusinessEventsService().emit({
            id: "BOOKING_CONFIRMED:" + appt.id,
            tenantId: tenant.id,
            type: "BOOKING_CONFIRMED",
            sourceType: "appointment",
            sourceId: appt.id,
            occurredAt: new Date().toISOString(),
            payload: { appointmentId: appt.id, status: "CONFIRMED" },
          });
          await Promise.all([
            worker.processEvents(100),
            new AutomationService().processEvents(100),
          ]);
          await Promise.all([
            worker.processActions(100),
            new AutomationService().processActions(100),
          ]);
          const ar = (
            await c.query(
              "select a.* from automation_action_runs a join automation_runs r on r.id=a.automation_run_id where r.automation_rule_id=$1",
              [custom.id],
            )
          ).rows[0];
          assert.equal(ar.status, "SUCCEEDED");
          assert.equal(
            (
              await c.query(
                "select count(*) from internal_notifications where automation_action_run_id=$1",
                [ar.id],
              )
            ).rows[0].count,
            "1",
          );
          await api.controls(owner, true);
          assert.equal(
            await automationDeliveryState(tenant.id, ar.idempotency_key),
            "PAUSED",
          );
          assert.equal(
            await automationDeliveryState(
              tenant.id,
              "review:request",
              db,
              "review-invitation",
            ),
            "PAUSED",
          );
          await api.controls(owner, false);
          await worker.setStatus(owner as any, custom.id, "PAUSED");
          assert.equal(
            await automationDeliveryState(tenant.id, ar.idempotency_key),
            "PAUSED",
          );
          await worker.activate(owner as any, custom.id);
          assert.equal(
            await automationDeliveryState(tenant.id, ar.idempotency_key),
            "READY",
          );
          const reminder = await worker.create(owner as any, {
            name: "Reminder notice",
            trigger: {
              type: "SCHEDULED_BEFORE_APPOINTMENT",
              config: { offsetMinutes: 120 },
            },
            conditions: [],
            actions: [
              {
                type: "CREATE_INTERNAL_NOTIFICATION",
                notificationType: "FORM_COMPLETED",
              },
            ],
          });
          await worker.activate(owner as any, reminder.id);
          assert.equal((await worker.generateScheduledEvents()).created, 1);
          assert.equal((await worker.generateScheduledEvents()).created, 0);
          await worker.processEvents(100);
          await c.query(
            "update appointments set start_time=start_time+interval '1 day' where id=$1",
            [appt.id],
          );
          await worker.processActions(100);
          assert.equal(
            (
              await c.query(
                "select a.status from automation_action_runs a join automation_runs r on r.id=a.automation_run_id where r.automation_rule_id=$1",
                [reminder.id],
              )
            ).rows[0].status,
            "SKIPPED",
          );
          await c.query(
            "update tenants set business_type='PLUMBING' where id=$1",
            [tenant.id],
          );
        },
      );
      await t.test(
        "booking-linked form events retain email compatibility with confirmation emails disabled",
        async () => {
          await c.query(
            "update tenants set business_type='SALON_BARBER',booking_confirmation_enabled=false where id=$1",
            [tenant.id],
          );
          const appt = await insert("appointments", {
            tenant_id: tenant.id,
            client_id: client.id,
            status: "CONFIRMED",
            start_time: new Date(Date.now() + 3600000),
            end_time: new Date(Date.now() + 7200000),
          });
          const form = await insert("form_assignments", {
            tenant_id: tenant.id,
            client_id: client.id,
            appointment_id: appt.id,
            status: "SUBMITTED",
          });
          const rule = await worker.create(owner as any, {
            name: "Form submitted notice",
            trigger: { type: "FORM_SUBMITTED", config: {} },
            conditions: [],
            actions: [
              {
                type: "SEND_EMAIL",
                templateKey: "staff-operational-notification",
              },
            ],
          });
          await worker.activate(owner as any, rule.id);
          await new BusinessEventsService().emit({
            id: "FORM_SUBMITTED:" + form.id,
            tenantId: tenant.id,
            type: "FORM_SUBMITTED",
            sourceType: "form_assignment",
            sourceId: form.id,
            occurredAt: new Date().toISOString(),
            payload: {},
          });
          await drain();
          const result = (
            await c.query(
              "select a.status,a.last_error_code,a.idempotency_key from automation_action_runs a join automation_runs r on r.id=a.automation_run_id where r.automation_rule_id=$1",
              [rule.id],
            )
          ).rows[0];
          assert.equal(result.status, "SUCCEEDED", JSON.stringify(result));
          assert.equal(
            (
              await c.query(
                "select count(*) from email_outbox where idempotency_key=$1",
                [result.idempotency_key],
              )
            ).rows[0].count,
            "1",
          );
          await c.query(
            "update tenants set business_type='PLUMBING',booking_confirmation_enabled=true where id=$1",
            [tenant.id],
          );
        },
      );
      await t.test(
        "automatic escalation deduplicates and failures stop retrying",
        async () => {
          const work = await insert("work_items", {
            tenant_id: tenant.id,
            client_id: client.id,
            status: "READY",
          });
          await c.query("update work_items set status='BLOCKED' where id=$1", [
            work.id,
          ]);
          await drain();
          await drain();
          assert.equal(
            (
              await c.query(
                "select count(*) from operations_issues where deduplication_key like $1",
                ["AUTOPILOT_ATTENTION:%" + work.id],
              )
            ).rows[0].count,
            "1",
          );
          const ar = (
            await c.query(
              "select ar.* from automation_action_runs ar join automation_runs r on r.id=ar.automation_run_id where r.source_id=$1",
              [work.id],
            )
          ).rows[0];
          await c.query(
            'update automation_rule_actions set action_config_json=\'{"url":"https://invalid"}\' where id=$1',
            [ar.automation_rule_action_id],
          );
          await c.query(
            "update automation_action_runs set status='PENDING',attempt_count=0 where id=$1",
            [ar.id],
          );
          await worker.processActions(100);
          assert.equal(
            (
              await c.query(
                "select status from automation_action_runs where id=$1",
                [ar.id],
              )
            ).rows[0].status,
            "FAILED",
          );
          const attempts = (
            await c.query(
              "select attempt_count from automation_action_runs where id=$1",
              [ar.id],
            )
          ).rows[0].attempt_count;
          await worker.processActions(100);
          assert.equal(
            (
              await c.query(
                "select attempt_count from automation_action_runs where id=$1",
                [ar.id],
              )
            ).rows[0].attempt_count,
            attempts,
          );
        },
      );
      await t.test(
        "site failures reuse Operations Issues and resolve after canonical success",
        async () => {
          const job = await insert("site_jobs", {
            tenant_id: tenant.id,
            status: "DEAD_LETTER",
            attempt_count: 5,
            max_attempts: 5,
            retryable: false,
          });
          await db.transaction((tx) => reconcileAutopilot(tx));
          await db.transaction((tx) => reconcileAutopilot(tx));
          assert.equal(
            (
              await c.query(
                "select count(*) from operations_issues where deduplication_key=$1",
                ["AUTOPILOT_SITE:" + job.id],
              )
            ).rows[0].count,
            "1",
          );
          await c.query("update site_jobs set status='SUCCEEDED' where id=$1", [
            job.id,
          ]);
          await db.transaction((tx) => reconcileAutopilot(tx));
          assert.equal(
            (
              await c.query(
                "select status from operations_issues where deduplication_key=$1",
                ["AUTOPILOT_SITE:" + job.id],
              )
            ).rows[0].status,
            "RESOLVED",
          );
        },
      );
      await t.test(
        "owner summary is scoped and emergency stop rejects unmanaged businesses",
        async () => {
          const summary = await api.summary(owner);
          assert.ok(summary.counts.tasks >= 1);
          assert.ok(!JSON.stringify(summary).includes("DO NOT LEAK"));
          await assert.rejects(() =>
            api.emergencyStop(other.agency_reference, true),
          );

          const centre = await api.centre();
          assert.equal(centre.businesses.length, 1);
          assert.equal(centre.businesses[0].reference, tenant.agency_reference);
          await api.emergencyStop(tenant.agency_reference, true);
          assert.equal((await api.centre()).businesses[0].state, "DEGRADED");
          await api.controls(owner, true);
          assert.equal(
            (await api.summary(owner)).controls.outboundPaused,
            true,
          );
          assert.equal(
            await automationDeliveryState(tenant.id, "automation:forged"),
            "PAUSED",
          );
          assert.equal(
            await automationDeliveryState(tenant.id, "manual-message"),
            "READY",
          );
        },
      );
      await t.test(
        "HTTP boundaries enforce agency capabilities, owner identity and strict controls",
        async () => {
          const app = Fastify();
          app.decorateRequest("requireAuth", function (this: any) {
            if (!this.auth)
              throw Object.assign(new Error("Unauthorized"), {
                statusCode: 401,
              });
          });
          app.decorateRequest(
            "requireAgency",
            function (this: any, capability: string) {
              if (this.headers["x-agency-capability"] !== capability)
                throw Object.assign(new Error("Forbidden"), {
                  statusCode: 403,
                });
              return { agencyUserId: id(), role: "PLATFORM_OWNER" };
            },
          );
          app.decorateRequest("auth", null);
          app.addHook("preHandler", async (r: any) => {
            if (r.headers["x-test-role"])
              r.auth = {
                tenantId: tenant.id,
                tenantUserId: user.id,
                role: r.headers["x-test-role"],
                supportMode: r.headers["x-support"] === "yes",
              };
          });
          await app.register(autopilotRoutes, { prefix: "/owner" });
          await app.register(agencyAutopilotRoutes, { prefix: "/agency" });
          assert.equal((await app.inject({ url: "/agency" })).statusCode, 403);
          const centre = await app.inject({
            url: "/agency",
            headers: { "x-agency-capability": "fulfilment.read" },
          });
          assert.equal(centre.statusCode, 200);
          assert.equal(centre.json().data.businesses.length, 1);
          assert.equal(
            (
              await app.inject({
                method: "PUT",
                url: "/agency/" + tenant.agency_reference + "/emergency-stop",
                headers: { "x-agency-capability": "fulfilment.read" },
                payload: { stopped: false },
              })
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await app.inject({
                url: "/owner",
                headers: { "x-test-role": "staff" },
              })
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await app.inject({
                url: "/owner",
                headers: { "x-test-role": "owner", "x-support": "yes" },
              })
            ).statusCode,
            403,
          );
          assert.ok(
            (
              await app.inject({
                method: "PUT",
                url: "/owner/controls",
                headers: { "x-test-role": "owner" },
                payload: { outboundPaused: false, tenantId: other.id },
              })
            ).statusCode >= 400,
          );
          assert.equal(
            (
              await app.inject({
                url: "/owner",
                headers: { "x-test-role": "owner" },
              })
            ).statusCode,
            200,
          );
          await app.close();
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
