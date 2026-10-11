import { EntitlementService } from "../agency/agency.service.js";
import { isSmsConfigured } from "../../lib/twilio.js";
import {
  resolveAutomationContext,
  sourceStillApplies,
  eventAnchorStillApplies,
} from "./automation-context.js";
import { approvalGate, expireApprovals } from "./automation-approvals.js";
import {
  actionPolicy,
  outboundAction,
  BusinessEventSchema,
} from "@ks-os/contracts";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  appointments,
  automationActionRuns,
  automationRuleActions,
  automationRules,
  automationRuns,
  businessEvents,
  clients,
  emailOutbox,
  formAssignments,
  forms,
  getDatabase,
  internalNotifications,
  services,
  smsOutbox,
  tenants,
  users,
} from "@ks-os/database";
import {
  AutomationActionSchema,
  AutomationConditionSchema,
  CreateAutomationSchema,
  TriggerSchema,
  type AutomationAction,
  type AutomationCondition,
  type CreateAutomationInput,
} from "@ks-os/contracts";
import { EmailService } from "../email/email.service.js";
import { OperationsIssueReporter } from "../operations/operations.issue-service.js";
import { SmsService } from "../sms/sms.service.js";
import { FormsService } from "../forms/forms.service.js";
import { env } from "../../config/env.js";
import { TaskService } from "../tasks/task.service.js";
import { ReviewInvitationService } from "../reputation/review-invitation.service.js";

type Actor = { tenantId: string; userId: string; role: "owner" | "staff" };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const owner = (actor: Actor) => {
  if (actor.role !== "owner")
    throw fail(403, "AUTOMATION_ACCESS_DENIED", "Owner access is required.");
};
const notificationCopy: Record<string, [string, string]> = {
  FORM_COMPLETED: ["Form completed", "A client form was completed."],
  AUTOMATION_FAILED: [
    "Automation failed",
    "An automation action needs attention.",
  ],
  SMS_DELIVERY_FAILED: [
    "SMS delivery failed",
    "An SMS could not be delivered.",
  ],
  STRIPE_ACTION_REQUIRED: [
    "Stripe action required",
    "Your Stripe account needs attention.",
  ],
  PAYMENT_DISPUTE_ACTION_REQUIRED: [
    "Payment dispute action required",
    "A payment dispute needs attention.",
  ],
};

export class AutomationService {
  constructor(private db: ReturnType<typeof getDatabase> = getDatabase()) {}
  private issues = new OperationsIssueReporter();
  private reviewInvitations = new ReviewInvitationService();

  async list(actor: Actor) {
    owner(actor);
    return this.db
      .select()
      .from(automationRules)
      .where(eq(automationRules.tenantId, actor.tenantId))
      .orderBy(desc(automationRules.updatedAt));
  }
  async get(actor: Actor, id: string) {
    owner(actor);
    const [rule] = await this.db
      .select()
      .from(automationRules)
      .where(
        and(
          eq(automationRules.id, id),
          eq(automationRules.tenantId, actor.tenantId),
        ),
      )
      .limit(1);
    if (!rule) throw fail(404, "AUTOMATION_NOT_FOUND", "Automation not found.");
    const actions = await this.db
      .select()
      .from(automationRuleActions)
      .where(
        and(
          eq(automationRuleActions.automationRuleId, id),
          eq(automationRuleActions.tenantId, actor.tenantId),
        ),
      )
      .orderBy(asc(automationRuleActions.position));
    return {
      ...rule,
      trigger: { type: rule.triggerType, config: rule.triggerConfigJson },
      conditions: rule.conditionsJson,
      actions: actions.map((a) => ({
        id: a.id,
        type: a.actionType,
        ...(a.actionConfigJson as object),
      })),
    };
  }
  async create(actor: Actor, value: unknown) {
    owner(actor);
    const input = CreateAutomationSchema.parse(value);
    const id = await this.db.transaction(async (tx) => {
      const [rule] = await tx
        .insert(automationRules)
        .values({
          tenantId: actor.tenantId,
          name: input.name,
          description: input.description,
          status: "DRAFT",
          triggerType: input.trigger.type,
          triggerConfigJson: input.trigger.config,
          conditionsJson: input.conditions,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        })
        .returning();
      await tx.insert(automationRuleActions).values(
        input.actions.map((action, position) => {
          const { type, ...config } = action;
          return {
            tenantId: actor.tenantId,
            automationRuleId: rule.id,
            position,
            actionType: type,
            actionConfigJson: config,
          };
        }),
      );
      return rule.id;
    });
    return this.get(actor, id);
  }
  async update(actor: Actor, id: string, value: unknown) {
    owner(actor);
    const current = await this.get(actor, id);
    if (current.managedTemplateKey)
      throw fail(
        409,
        "MANAGED_RULE_FIXED",
        "Managed playbooks can be paused. Create a custom rule to change behaviour.",
      );
    if (current.status !== "DRAFT" && current.status !== "PAUSED")
      throw fail(
        409,
        "AUTOMATION_ALREADY_ACTIVE",
        "Pause the automation before editing it.",
      );
    const base = {
      name: current.name,
      description: current.description,
      trigger: current.trigger,
      conditions: current.conditions,
      actions: current.actions.map(({ id: _, ...action }: any) => action),
    };
    const merged = CreateAutomationSchema.parse({
      ...base,
      ...(value as object),
    });
    await this.db.transaction(async (tx) => {
      await tx
        .update(automationRules)
        .set({
          name: merged.name,
          description: merged.description,
          triggerType: merged.trigger.type,
          triggerConfigJson: merged.trigger.config,
          conditionsJson: merged.conditions,
          updatedByUserId: actor.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(automationRules.id, id),
            eq(automationRules.tenantId, actor.tenantId),
          ),
        );
      await tx
        .delete(automationRuleActions)
        .where(
          and(
            eq(automationRuleActions.automationRuleId, id),
            eq(automationRuleActions.tenantId, actor.tenantId),
          ),
        );
      await tx.insert(automationRuleActions).values(
        merged.actions.map((action, position) => {
          const { type, ...config } = action;
          return {
            tenantId: actor.tenantId,
            automationRuleId: id,
            position,
            actionType: type,
            actionConfigJson: config,
          };
        }),
      );
    });
    return this.get(actor, id);
  }
  async activate(actor: Actor, id: string) {
    owner(actor);
    const rule = await this.get(actor, id);
    if (rule.status === "ACTIVE")
      throw fail(
        409,
        "AUTOMATION_ALREADY_ACTIVE",
        "Automation is already active.",
      );
    const summary = await this.validate(actor, rule);
    if (!summary.valid)
      throw fail(
        409,
        "AUTOMATION_REFERENCE_NOT_FOUND",
        summary.errors.join(" "),
      );
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(automationRules)
      .where(
        and(
          eq(automationRules.tenantId, actor.tenantId),
          eq(automationRules.status, "ACTIVE"),
          sql`${automationRules.managedTemplateKey} is null`,
        ),
      );
    if (!rule.managedTemplateKey && count >= 25)
      throw fail(
        409,
        "AUTOMATION_LIMIT_REACHED",
        "Maximum active automation rules reached.",
      );
    await this.db
      .update(automationRules)
      .set({
        status: "ACTIVE",
        enabledAt: new Date(),
        disabledAt: null,
        updatedAt: new Date(),
        updatedByUserId: actor.userId,
      })
      .where(
        and(
          eq(automationRules.id, id),
          eq(automationRules.tenantId, actor.tenantId),
        ),
      );
    return summary;
  }
  async setStatus(actor: Actor, id: string, status: "PAUSED" | "ARCHIVED") {
    owner(actor);
    const rule = await this.get(actor, id);
    if (status === "PAUSED" && rule.status !== "ACTIVE")
      throw fail(409, "AUTOMATION_NOT_ACTIVE", "Automation is not active.");
    await this.db
      .update(automationRules)
      .set({
        status,
        disabledAt: new Date(),
        updatedAt: new Date(),
        updatedByUserId: actor.userId,
      })
      .where(
        and(
          eq(automationRules.id, id),
          eq(automationRules.tenantId, actor.tenantId),
        ),
      );
  }
  async validate(actor: Actor, rule: any) {
    const errors: string[] = [];
    try {
      TriggerSchema.parse(rule.trigger);
      (rule.conditions as unknown[]).forEach((x) =>
        AutomationConditionSchema.parse(x),
      );
      (rule.actions as any[]).forEach(({ id: _, ...x }) =>
        AutomationActionSchema.parse(x),
      );
    } catch {
      errors.push("Configuration schema is invalid.");
    }
    for (const condition of rule.conditions as any[]) {
      if (
        condition.serviceId &&
        !(await this.exists(
          services,
          services.id,
          condition.serviceId,
          actor.tenantId,
        ))
      )
        errors.push("Referenced service was not found.");
      if (
        condition.staffId &&
        !(await this.exists(users, users.id, condition.staffId, actor.tenantId))
      )
        errors.push("Referenced staff member was not found.");
    }
    for (const action of rule.actions as any[]) {
      if (
        action.formId &&
        !(await this.exists(forms, forms.id, action.formId, actor.tenantId))
      )
        errors.push("Referenced form was not found.");
      if (
        ["SEND_EMAIL", "SCHEDULE_EMAIL"].includes(action.type) &&
        ["form-assigned", "form-reminder"].includes(action.templateKey)
      )
        errors.push(
          "Form emails require a secure assignment link and must be sent by the form-assignment workflow.",
        );
      if (
        action.type === "CREATE_TASK" &&
        action.assignTo === "SPECIFIC_USER" &&
        (!action.specificUserId ||
          !(await this.exists(
            users,
            users.id,
            action.specificUserId,
            actor.tenantId,
          )))
      )
        errors.push("Referenced task assignee was not found.");
    }
    return { valid: errors.length === 0, errors };
  }
  private async exists(
    table: any,
    idColumn: any,
    id: string,
    tenantId: string,
  ) {
    const [row] = await this.db
      .select({ id: idColumn })
      .from(table)
      .where(and(eq(idColumn, id), eq(table.tenantId, tenantId)))
      .limit(1);
    return !!row;
  }
  async runs(actor: Actor, automationId: string) {
    owner(actor);
    await this.get(actor, automationId);
    return this.db
      .select()
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.automationRuleId, automationId),
          eq(automationRuns.tenantId, actor.tenantId),
        ),
      )
      .orderBy(desc(automationRuns.createdAt))
      .limit(100);
  }
  async runDetail(actor: Actor, runId: string) {
    owner(actor);
    const [run] = await this.db
      .select()
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.id, runId),
          eq(automationRuns.tenantId, actor.tenantId),
        ),
      )
      .limit(1);
    if (!run)
      throw fail(404, "AUTOMATION_RUN_NOT_FOUND", "Automation run not found.");
    const actions = await this.db
      .select()
      .from(automationActionRuns)
      .where(
        and(
          eq(automationActionRuns.automationRunId, runId),
          eq(automationActionRuns.tenantId, actor.tenantId),
        ),
      )
      .orderBy(asc(automationActionRuns.createdAt));
    return { ...run, actions };
  }

  async processEvents(limit = 20) {
    const exhausted = await this.db.execute(
      sql`update business_events set status='FAILED',last_error_code='AUTOMATION_EXECUTION_FAILED' where id in(select id from business_events where status='PROCESSING' and attempt_count>=5 and claimed_at<now()-interval '10 minutes' order by claimed_at for update skip locked limit 100) returning *`,
    );
    for (const event of exhausted.rows as any[])
      await this.issues.report({
        tenantId: event.tenant_id,
        category: "AUTOMATION",
        issueType: "SYSTEM_FAILURE",
        severity: "CRITICAL",
        title: "Automation event needs review",
        message: "An event exhausted its processing attempts.",
        sourceType: "SYSTEM",
        sourceId: event.source_id,
        deduplicationKey: `AUTOPILOT_EVENT:${event.id}`,
        metadata: { errorCode: "AUTOMATION_EXECUTION_FAILED" },
      });
    const claimed = await this.db.execute(
      sql`UPDATE business_events SET status='PROCESSING',claimed_at=now(),attempt_count=attempt_count+1 WHERE id IN (SELECT id FROM business_events WHERE (status='PENDING' OR (status='PROCESSING' AND claimed_at<now()-interval '10 minutes')) AND attempt_count<5 AND next_attempt_at<=now() ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT ${Math.max(1, Math.min(limit, 100))}) RETURNING *`,
    );
    for (const event of claimed.rows as any[]) {
      try {
        BusinessEventSchema.parse({
          id: event.id,
          tenantId: event.tenant_id,
          type: event.event_type,
          sourceType: event.source_type,
          sourceId: event.source_id,
          occurredAt: new Date(event.occurred_at).toISOString(),
          payload: event.payload_json,
        });
        const eventContext = await this.context(
          event.tenant_id,
          event.source_id,
          event.source_type,
        );
        if (
          event.event_type === "APPOINTMENT_COMPLETED" &&
          event.source_type === "appointment"
        )
          await this.reviewInvitations.scheduleFromCompletion(
            event.tenant_id,
            event.source_id,
            new Date(event.occurred_at),
          );
        const scheduledRuleId = (event.payload_json as any)?.automationRuleId;
        const rules = await this.db
          .select()
          .from(automationRules)
          .where(
            and(
              eq(automationRules.tenantId, event.tenant_id),
              eq(automationRules.status, "ACTIVE"),
              eq(automationRules.triggerType, event.event_type),
              scheduledRuleId
                ? eq(automationRules.id, scheduledRuleId)
                : undefined,
            ),
          );
        for (const rule of rules)
          await this.startRun(rule, event, eventContext);
        await this.db
          .update(businessEvents)
          .set({
            status: "PROCESSED",
            processedAt: new Date(),
            lastErrorCode: null,
          })
          .where(eq(businessEvents.id, event.id));
      } catch (error: any) {
        const attempts = Number(event.attempt_count);
        const terminal = attempts >= 5 || error?.name === "ZodError";
        await this.db
          .update(businessEvents)
          .set({
            status: terminal ? "FAILED" : "PENDING",
            nextAttemptAt: new Date(
              Date.now() + Math.min(2 ** attempts, 60) * 60000,
            ),
            lastErrorCode: "AUTOMATION_EXECUTION_FAILED",
          })
          .where(eq(businessEvents.id, event.id));
        if (terminal)
          await this.issues.report({
            tenantId: event.tenant_id,
            category: "AUTOMATION",
            issueType: "SYSTEM_FAILURE",
            severity: "CRITICAL",
            title: "Automation event needs review",
            message: "An event could not be processed after five attempts.",
            sourceType: "SYSTEM",
            sourceId: event.source_id,
            deduplicationKey: `AUTOPILOT_EVENT:${event.id}`,
            metadata: { errorCode: "AUTOMATION_EXECUTION_FAILED" },
          });
      }
    }
    return { claimed: claimed.rows.length };
  }
  async generateScheduledEvents(limit = 100) {
    const result = await this.db.execute(sql`with candidates as (
      select r.id as rule_id,r.tenant_id,r.trigger_type,a.id as appointment_id,
        case when r.trigger_type='SCHEDULED_BEFORE_APPOINTMENT' then a.start_time else a.end_time end as anchor,
        (r.trigger_config_json->>'offsetMinutes')::int as offset_minutes
      from automation_rules r join appointments a on a.tenant_id=r.tenant_id
      where r.status='ACTIVE' and r.trigger_type in ('SCHEDULED_BEFORE_APPOINTMENT','SCHEDULED_AFTER_APPOINTMENT')
        and r.trigger_config_json->>'offsetMinutes' in ('120','1440','2880')
        and ((r.trigger_type='SCHEDULED_BEFORE_APPOINTMENT' and a.status='CONFIRMED' and a.start_time>now() and a.start_time<=now()+interval '2 days')
          or (r.trigger_type='SCHEDULED_AFTER_APPOINTMENT' and a.status='COMPLETED'))
    ), due as (select *,trigger_type||':'||rule_id||':'||appointment_id||':'||to_char(anchor at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as event_id,
      anchor+interval '1 minute'*offset_minutes*case when trigger_type='SCHEDULED_BEFORE_APPOINTMENT' then -1 else 1 end as due_at from candidates)
    insert into business_events(id,tenant_id,event_type,source_type,source_id,payload_json,occurred_at)
    select event_id,tenant_id,trigger_type,'appointment',appointment_id,jsonb_build_object('automationRuleId',rule_id,'appointmentId',appointment_id,'offsetMinutes',offset_minutes),due_at from due
    where due_at<=now() and not exists(select 1 from business_events e where e.id=due.event_id)
    order by due_at,event_id limit ${Math.max(1, Math.min(limit, 100))} on conflict do nothing returning id`);
    return { created: result.rows.length };
  }
  private async startRun(rule: any, event: any, context: any) {
    return this.db.transaction(async (tx: any) => {
      if (
        !eventAnchorStillApplies(
          { id: event.id, type: event.event_type, payload: event.payload_json },
          context,
        ) ||
        !sourceStillApplies(event.event_type, context) ||
        !this.matches(rule.conditionsJson as AutomationCondition[], context)
      )
        return;
      const [run] = await tx
        .insert(automationRuns)
        .values({
          tenantId: event.tenant_id,
          automationRuleId: rule.id,
          triggerType: event.event_type,
          triggerEventId: event.id,
          sourceType: event.source_type,
          sourceId: event.source_id,
          status: "RUNNING",
          startedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [
            automationRuns.automationRuleId,
            automationRuns.triggerEventId,
          ],
        })
        .returning();
      if (!run) return;
      const actions = await tx
        .select()
        .from(automationRuleActions)
        .where(
          and(
            eq(automationRuleActions.automationRuleId, rule.id),
            eq(automationRuleActions.tenantId, event.tenant_id),
          ),
        )
        .orderBy(asc(automationRuleActions.position));
      for (const action of actions) {
        const config = AutomationActionSchema.parse({
          ...(action.actionConfigJson as object),
          type: action.actionType,
        });
        const scheduledFor = this.schedule(config, context.startTime);
        await tx.insert(automationActionRuns).values({
          tenantId: event.tenant_id,
          automationRunId: run.id,
          automationRuleActionId: action.id,
          status: scheduledFor > new Date() ? "SCHEDULED" : "PENDING",
          idempotencyKey: `automation:${rule.id}:${event.id}:${action.id}`,
          scheduledFor,
          nextAttemptAt: scheduledFor,
        });
      }
      await tx
        .update(automationRuns)
        .set({ status: "PENDING" })
        .where(eq(automationRuns.id, run.id));
    });
  }
  private schedule(action: AutomationAction, startTime?: Date) {
    if (
      (action.type === "SCHEDULE_EMAIL" || action.type === "SCHEDULE_SMS") &&
      startTime
    )
      return new Date(startTime.getTime() - action.offsetMinutes * 60000);
    return new Date();
  }
  private matches(conditions: AutomationCondition[], c: any) {
    return conditions.every((x: any) =>
      x.type === "SERVICE_EQUALS"
        ? c.serviceId === x.serviceId
        : x.type === "BOOKING_CHANNEL_EQUALS"
          ? c.bookingChannel === x.bookingChannel
          : x.type === "STAFF_EQUALS"
            ? c.staffId === x.staffId
            : x.type === "APPOINTMENT_STATUS_EQUALS"
              ? (c.appointmentStatus ?? c.status) === x.status
              : x.type === "PAYMENT_STATUS_EQUALS"
                ? c.paymentStatus === x.status
                : x.type === "CLIENT_HAS_EMAIL"
                  ? !!c.email
                  : x.type === "CLIENT_HAS_SMS_NUMBER"
                    ? !!c.phone
                    : x.type === "FORM_IS_INCOMPLETE"
                      ? c.formIncomplete
                      : x.type === "TENANT_EMAIL_ENABLED"
                        ? c.emailEnabled
                        : x.type === "TENANT_SMS_ENABLED"
                          ? c.smsEnabled
                          : false,
    );
  }
  private async context(
    tenantId: string,
    sourceId: string,
    sourceType = "appointment",
    lock = false,
  ) {
    return resolveAutomationContext(
      this.db,
      tenantId,
      sourceId,
      sourceType,
      lock,
    );
  }
  async processActions(limit = 20) {
    let claimed = 0;
    await this.db.transaction(async (tx: any) => expireApprovals(tx));
    for (let i = 0; i < Math.min(limit, 100); i++) {
      const found = await this.db.transaction(async (tx: any) => {
        const row = (
          await tx.execute(sql`select ar.* from automation_action_runs ar
          join automation_runs runs on runs.id=ar.automation_run_id and runs.tenant_id=ar.tenant_id
          join automation_rules r on r.id=runs.automation_rule_id and r.tenant_id=ar.tenant_id
          where ar.status in ('PENDING','SCHEDULED') and ar.attempt_count<5 and ar.scheduled_for<=now() and ar.next_attempt_at<=now() and r.status='ACTIVE'
          order by ar.scheduled_for,ar.id for update of ar skip locked limit 1`)
        ).rows[0] as any;
        if (!row) return false;
        await tx.execute(
          sql`update automation_action_runs set status='RUNNING',started_at=now(),attempt_count=attempt_count+1 where id=${row.id}::uuid`,
        );
        try {
          const executed = await tx.transaction(async (inner: any) =>
            new AutomationService(inner).executeAction(row),
          );
          if (executed === false) {
            await tx.execute(
              sql`update automation_action_runs set status='WAITING_APPROVAL',attempt_count=greatest(attempt_count-1,0) where id=${row.id}::uuid`,
            );
          } else {
            await tx.execute(
              sql`update automation_action_runs set status='SUCCEEDED',completed_at=now(),last_error_code=null where id=${row.id}::uuid`,
            );
            await this.issues.resolve(
              row.tenant_id,
              `AUTOMATION_ACTION_FAILED:${row.id}`,
              tx,
            );
          }
        } catch (error: any) {
          const stale = error?.code === "AUTOMATION_STATE_CHANGED";
          const paused = error?.code === "AUTOMATION_PAUSED";
          const permanent =
            error?.code === "AUTOMATION_INVALID_CONFIGURATION" ||
            error?.name === "ZodError" ||
            [400, 403, 404].includes(error?.statusCode) ||
            String(error?.code || "").endsWith("NOT_QUEUED");
          const failed = permanent || Number(row.attempt_count) + 1 >= 5;
          await tx.execute(sql`update automation_action_runs set status=${stale ? "SKIPPED" : paused ? "SCHEDULED" : failed ? "FAILED" : "PENDING"},attempt_count=case when ${paused} then greatest(attempt_count-1,0) else attempt_count end,
            next_attempt_at=now()+interval '1 minute'*${paused ? 5 : Math.min(2 ** (Number(row.attempt_count) + 1), 60)},completed_at=case when ${stale} then now() else null end,
            failed_at=case when ${failed && !stale && !paused} then now() else null end,last_error_code=${stale ? "AUTOMATION_STATE_CHANGED" : paused ? "AUTOMATION_PAUSED" : permanent ? "AUTOMATION_INVALID_CONFIGURATION" : "AUTOMATION_EXECUTION_FAILED"} where id=${row.id}::uuid`);
          if (stale)
            await tx.execute(
              sql`update automation_approval_requests set status='CANCELLED',resolved_at=now() where automation_action_run_id=${row.id}::uuid and status in ('PENDING','APPROVED')`,
            );
          if (failed && !stale && !paused)
            await this.issues.report(
              {
                tenantId: row.tenant_id,
                category: "AUTOMATION",
                issueType: "AUTOMATION_ACTION_FAILED",
                severity: "CRITICAL",
                title: "Automation needs attention",
                message: permanent
                  ? "Check the automation configuration and connected provider."
                  : "An automation action exhausted its retry attempts.",
                sourceType: "AUTOMATION_ACTION_RUN",
                sourceId: row.id,
                deduplicationKey: `AUTOMATION_ACTION_FAILED:${row.id}`,
                metadata: {
                  errorCode: permanent
                    ? "AUTOMATION_INVALID_CONFIGURATION"
                    : "AUTOMATION_EXECUTION_FAILED",
                },
              },
              tx,
            );
        }
        await new AutomationService(tx).finishRun(row.automation_run_id);
        return true;
      });
      if (!found) break;
      claimed++;
    }
    return { claimed };
  }
  private async executeAction(actionRun: any) {
    const [action] = await this.db
      .select()
      .from(automationRuleActions)
      .where(
        and(
          eq(automationRuleActions.id, actionRun.automation_rule_action_id),
          eq(automationRuleActions.tenantId, actionRun.tenant_id),
        ),
      )
      .limit(1);
    const [run] = await this.db
      .select()
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.id, actionRun.automation_run_id),
          eq(automationRuns.tenantId, actionRun.tenant_id),
        ),
      )
      .limit(1);
    if (!action || !run)
      throw fail(409, "AUTOMATION_STATE_CHANGED", "Automation state changed.");
    await this.db.execute(
      sql`select id from automation_rules where id=${run.automationRuleId}::uuid and tenant_id=${run.tenantId}::uuid for share`,
    );
    const [rule] = await this.db
      .select()
      .from(automationRules)
      .where(
        and(
          eq(automationRules.id, run.automationRuleId),
          eq(automationRules.tenantId, run.tenantId),
        ),
      )
      .limit(1);
    if (!rule)
      throw fail(409, "AUTOMATION_STATE_CHANGED", "Rule is unavailable.");
    const config = AutomationActionSchema.parse({
      ...(action.actionConfigJson as object),
      type: action.actionType,
    }) as any;
    await this.db.execute(
      sql`insert into automation_tenant_controls(tenant_id) values(${run.tenantId}::uuid) on conflict do nothing`,
    );
    const controls = (
      await this.db.execute(
        sql`select outbound_paused,emergency_stopped from automation_tenant_controls where tenant_id=${run.tenantId}::uuid for share`,
      )
    ).rows[0] as any;
    if (
      rule.status !== "ACTIVE" ||
      controls.emergency_stopped ||
      (controls.outbound_paused && outboundAction(config.type))
    )
      throw fail(409, "AUTOMATION_PAUSED", "Automation is paused.");
    const c = await this.context(
      run.tenantId,
      run.sourceId,
      run.sourceType,
      true,
    );
    if (
      !sourceStillApplies(run.triggerType, c) ||
      !this.matches(rule.conditionsJson as AutomationCondition[], c)
    )
      throw fail(409, "AUTOMATION_STATE_CHANGED", "Source state changed.");
    const sourceEvent = (
      await this.db
        .select()
        .from(businessEvents)
        .where(
          and(
            eq(businessEvents.id, run.triggerEventId),
            eq(businessEvents.tenantId, run.tenantId),
          ),
        )
        .limit(1)
    )[0];
    if (
      !sourceEvent ||
      !eventAnchorStillApplies(
        {
          id: sourceEvent.id,
          type: sourceEvent.eventType,
          payload: sourceEvent.payloadJson,
        },
        c,
      )
    )
      throw fail(409, "AUTOMATION_STATE_CHANGED", "Source timing changed.");
    const module = (
      {
        quote: "sales",
        sales_opportunity: "sales",
        work_item: "work",
        invoice: "invoices",
        task: "tasks",
        form_assignment: "forms",
        appointment: "bookings",
        payment: "payments",
        client: "crm",
      } as Record<string, string>
    )[run.sourceType];
    if (
      !c.profile.enabledModules.includes(module) ||
      !c.profile.enabledModules.includes("automations")
    )
      throw fail(
        409,
        "AUTOMATION_STATE_CHANGED",
        "This workflow is no longer enabled for the business.",
      );
    if (
      ["CANCEL_PENDING_REMINDERS", "CANCEL_PENDING_FORM_ASSIGNMENTS"].includes(
        config.type,
      ) &&
      !c.appointmentId
    )
      throw fail(
        409,
        "AUTOMATION_INVALID_CONFIGURATION",
        "This action requires a booking.",
      );
    if (outboundAction(config.type) && !c.appointmentId)
      throw fail(
        409,
        "AUTOMATION_INVALID_CONFIGURATION",
        "This template requires a booking.",
      );
    if (
      ["SCHEDULE_EMAIL", "SCHEDULE_SMS"].includes(config.type) &&
      ["CANCELLED", "COMPLETED", "NO_SHOW"].includes(
        c.appointmentStatus ?? c.status,
      )
    )
      throw fail(409, "AUTOMATION_STATE_CHANGED", "Booking state changed.");
    try {
      await new EntitlementService().assertBoolean(
        run.tenantId,
        "automations.enabled",
      );
    } catch (e: any) {
      if (e.code === "ENTITLEMENT_REQUIRED")
        throw fail(
          409,
          "AUTOMATION_PAUSED",
          "Automation is not included in the current plan.",
        );
      throw e;
    }
    if (
      ["SEND_SMS", "SCHEDULE_SMS"].includes(config.type) &&
      !isSmsConfigured()
    )
      throw fail(
        409,
        "AUTOMATION_INVALID_CONFIGURATION",
        "SMS provider is not configured.",
      );
    const policy = actionPolicy(config.type);
    if (policy === "HUMAN_ONLY" || config.type === "CREATE_OPERATIONS_ISSUE") {
      await this.issues.report(
        {
          tenantId: run.tenantId,
          category: "AUTOMATION",
          issueType: "AUTOMATION_ACTION_FAILED",
          severity: "WARNING",
          title: "Business follow-up needs attention",
          message:
            policy === "HUMAN_ONLY"
              ? "This action needs a human decision."
              : "Review the linked work or overdue item before continuing.",
          sourceType: "AUTOMATION_ACTION_RUN",
          sourceId: actionRun.id,
          deduplicationKey: `AUTOPILOT_ATTENTION:${run.triggerType}:${run.sourceType}:${run.sourceId}`,
          metadata: {
            sourceType: run.sourceType,
            sourceReference: c.reference,
          },
        },
        this.db,
      );
      return true;
    }
    if (policy === "APPROVAL_REQUIRED") {
      if (run.sourceType !== "quote" || !["SENT"].includes(c.status))
        throw fail(
          409,
          "AUTOMATION_STATE_CHANGED",
          "Quote no longer awaits a response.",
        );
      if (!(await approvalGate(this.db, actionRun, run, config, rule, c)))
        return false;
      const task = await new TaskService().createManagedFollowUp({
        tenantId: run.tenantId,
        automationRunId: run.id,
        idempotencyKey: actionRun.idempotency_key,
        clientId: c.clientId,
      });
      await this.db
        .update(automationActionRuns)
        .set({ resultReferenceType: "task", resultReferenceId: task.id })
        .where(eq(automationActionRuns.id, actionRun.id));
      return true;
    }
    const bookingDate = c.startTime
      ? new Intl.DateTimeFormat("en-GB", {
          dateStyle: "medium",
          timeZone: c.timezone || "Europe/London",
        }).format(c.startTime)
      : "";
    const bookingTime = c.startTime
      ? new Intl.DateTimeFormat("en-GB", {
          timeStyle: "short",
          timeZone: c.timezone || "Europe/London",
        }).format(c.startTime)
      : "";
    const data = {
      tenantName: c.tenantName,
      tenantPrimaryColor: c.primaryColor,
      clientName: c.clientName,
      customerName: c.clientName,
      recipientName: c.clientName,
      serviceName: c.serviceName || "your appointment",
      staffName: c.staffName || "our team",
      startTime: c.startTime?.toISOString(),
      appointmentDateTime: c.startTime?.toISOString(),
      timezone: c.timezone,
      bookingDate,
      bookingTime,
      amount: (Number(c.quotedAmount || 0) / 100).toFixed(2),
      currency: c.currency || "GBP",
      status: c.paymentStatus || "PENDING",
      message: `Appointment update: ${c.serviceName || "your appointment"} on ${bookingDate} at ${bookingTime}.`,
    };
    if (config.type === "SEND_EMAIL" || config.type === "SCHEDULE_EMAIL") {
      if (["form-assigned", "form-reminder"].includes(config.templateKey))
        throw fail(
          409,
          "AUTOMATION_INVALID_CONFIGURATION",
          "Use secure form assignment delivery.",
        );
      if (!c.email)
        throw fail(409, "AUTOMATION_STATE_CHANGED", "Client has no email.");
      const result = await new EmailService().enqueueEmail(
        {
          tenantId: run.tenantId,
          recipientEmail: c.email,
          recipientName: c.clientName || undefined,
          replyToEmail: c.replyToEmail || undefined,
          templateKey: config.templateKey,
          templateDataJson: data,
          idempotencyKey: actionRun.idempotency_key,
          relatedEntityType: "appointment",
          relatedEntityId: c.appointmentId,
          scheduledFor: new Date(),
        },
        this.db,
      );
      if (!result.queued)
        throw fail(
          409,
          ["SUPPRESSED", "INVALID_RECIPIENT"].includes(result.reason)
            ? "AUTOMATION_STATE_CHANGED"
            : "AUTOMATION_EMAIL_NOT_QUEUED",
          `Email was not queued: ${result.reason}.`,
        );
    } else if (config.type === "SEND_SMS" || config.type === "SCHEDULE_SMS") {
      if (["form-assigned", "form-reminder"].includes(config.templateKey))
        throw fail(
          409,
          "AUTOMATION_INVALID_CONFIGURATION",
          "Use secure form assignment delivery.",
        );
      if (!c.smsEnabled)
        throw fail(
          409,
          "AUTOMATION_STATE_CHANGED",
          "SMS automation is disabled.",
        );
      if (!c.phone)
        throw fail(
          409,
          "AUTOMATION_STATE_CHANGED",
          "Client has no mobile number.",
        );
      const queued = await new SmsService().enqueue(
        {
          tenantId: run.tenantId,
          clientId: c.clientId || undefined,
          appointmentId: c.appointmentId,
          recipientPhone: c.phone,
          templateKey: config.templateKey,
          templateData: {
            appointmentDateTime: new Intl.DateTimeFormat("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: c.timezone || "Europe/London",
            }).format(c.startTime),
          },
          idempotencyKey: actionRun.idempotency_key,
          validUntil: c.startTime || undefined,
        },
        this.db,
      );
      if (!queued)
        throw fail(
          409,
          "AUTOMATION_STATE_CHANGED",
          "SMS recipient is unavailable or suppressed.",
        );
    } else if (config.type === "CANCEL_PENDING_REMINDERS") {
      await this.db
        .update(emailOutbox)
        .set({ status: "CANCELLED" })
        .where(
          and(
            eq(emailOutbox.tenantId, run.tenantId),
            eq(emailOutbox.relatedEntityId, c.appointmentId),
            inArray(emailOutbox.status, ["PENDING", "DELAYED", "PROCESSING"]),
          ),
        );
      await new SmsService().cancelAppointmentReminders(
        run.tenantId,
        c.appointmentId,
      );
      await this.db.execute(
        sql`UPDATE automation_action_runs ar SET status='CANCELLED' WHERE ar.tenant_id=${run.tenantId}::uuid AND ar.status IN ('PENDING','SCHEDULED') AND ar.id<>${actionRun.id}::uuid AND ar.automation_run_id IN (SELECT id FROM automation_runs WHERE tenant_id=${run.tenantId}::uuid AND source_id=${c.appointmentId}::uuid)`,
      );
    } else if (config.type === "CANCEL_PENDING_FORM_ASSIGNMENTS") {
      await this.db
        .update(formAssignments)
        .set({
          status: "CANCELLED",
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(formAssignments.tenantId, run.tenantId),
            eq(formAssignments.appointmentId, c.appointmentId),
            inArray(formAssignments.status, ["PENDING", "OPENED"]),
          ),
        );
    } else if (config.type === "ASSIGN_FORM") {
      if (!c.clientId)
        throw fail(409, "AUTOMATION_STATE_CHANGED", "Booking has no client.");
      const [existing] = await this.db
        .select({ id: formAssignments.id })
        .from(formAssignments)
        .where(
          and(
            eq(formAssignments.tenantId, run.tenantId),
            eq(formAssignments.formId, config.formId),
            eq(formAssignments.clientId, c.clientId),
            config.linkToAppointment
              ? eq(formAssignments.appointmentId, c.appointmentId)
              : undefined,
            inArray(formAssignments.status, ["PENDING", "OPENED"]),
          ),
        )
        .limit(1);
      const assigned =
        existing ||
        (await new FormsService().createAssignment(
          {
            tenantId: run.tenantId,
            userId: await this.ruleOwner(run.automationRuleId),
            role: "owner",
          },
          {
            formId: config.formId,
            formVersionId: config.formVersionId,
            clientId: c.clientId,
            appointmentId: config.linkToAppointment
              ? c.appointmentId
              : undefined,
            deliveryMethod: "COPY_LINK",
          },
          env.FORM_ASSIGNMENT_EXPIRY_DAYS,
        ));
      await this.db
        .update(automationActionRuns)
        .set({
          resultReferenceType: "form_assignment",
          resultReferenceId: assigned.id,
        })
        .where(eq(automationActionRuns.id, actionRun.id));
    } else if (config.type === "CREATE_INTERNAL_NOTIFICATION") {
      const [title, message] = notificationCopy[config.notificationType];
      await this.db
        .insert(internalNotifications)
        .values({
          automationActionRunId: actionRun.id,
          tenantId: run.tenantId,
          recipientRole: "owner",
          type: config.notificationType,
          title,
          message,
          sourceType: run.sourceType,
          sourceId: run.sourceId,
        })
        .onConflictDoNothing();
    } else if (config.type === "CREATE_TASK") {
      const createdByUserId = await this.ruleOwner(run.automationRuleId);
      const task = rule.managedTemplateKey
        ? await new TaskService().createManagedFollowUp({
            tenantId: run.tenantId,
            automationRunId: run.id,
            idempotencyKey: actionRun.idempotency_key,
            clientId: c.clientId,
            titleTemplateKey: config.titleTemplateKey,
          })
        : await new TaskService().createAutomationTask({
            tenantId: run.tenantId,
            automationRunId: run.id,
            idempotencyKey: actionRun.idempotency_key ?? actionRun.id,
            createdByUserId,
            appointmentId: c.appointmentId ?? undefined,
            clientId: c.clientId ?? undefined,
            appointmentStaffId: c.staffId ?? undefined,
            titleTemplateKey: config.titleTemplateKey,
            assignTo: config.assignTo,
            specificUserId: config.specificUserId ?? undefined,
            dueOffsetMinutes: config.dueOffsetMinutes,
            priority: config.priority,
          });
      await this.db
        .update(automationActionRuns)
        .set({ resultReferenceType: "task", resultReferenceId: task.id })
        .where(eq(automationActionRuns.id, actionRun.id));
    }
    return true;
  }
  private async ruleOwner(ruleId: string) {
    const [rule] = await this.db
      .select({ id: users.id })
      .from(automationRules)
      .innerJoin(
        users,
        and(
          eq(users.id, automationRules.createdByUserId),
          eq(users.tenantId, automationRules.tenantId),
          eq(users.role, "owner"),
          eq(users.accountStatus, "ACTIVE"),
        ),
      )
      .where(eq(automationRules.id, ruleId));
    if (!rule)
      throw fail(
        409,
        "AUTOMATION_INVALID_CONFIGURATION",
        "The rule owner is unavailable.",
      );
    return rule.id;
  }
  private async finishRun(runId: string) {
    const rows = await this.db
      .select({ status: automationActionRuns.status })
      .from(automationActionRuns)
      .where(eq(automationActionRuns.automationRunId, runId));
    if (
      rows.some((x) =>
        ["PENDING", "SCHEDULED", "RUNNING", "WAITING_APPROVAL"].includes(
          x.status,
        ),
      )
    )
      return;
    const failed = rows.filter((x) => x.status === "FAILED").length;
    await this.db
      .update(automationRuns)
      .set({
        status:
          failed === rows.length
            ? "FAILED"
            : failed
              ? "PARTIALLY_FAILED"
              : "SUCCEEDED",
        completedAt: new Date(),
        failedAt: failed ? new Date() : null,
        lastErrorCode: failed ? "AUTOMATION_EXECUTION_FAILED" : null,
      })
      .where(eq(automationRuns.id, runId));
  }
  async retry(actor: Actor, actionRunId: string) {
    owner(actor);
    const [row] = await this.db
      .select()
      .from(automationActionRuns)
      .where(
        and(
          eq(automationActionRuns.id, actionRunId),
          eq(automationActionRuns.tenantId, actor.tenantId),
        ),
      )
      .limit(1);
    if (!row || row.status !== "FAILED")
      throw fail(
        409,
        "AUTOMATION_ACTION_NOT_RETRYABLE",
        "Action cannot be retried.",
      );
    await this.db
      .update(automationActionRuns)
      .set({
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: new Date(),
        failedAt: null,
        lastErrorCode: null,
      })
      .where(eq(automationActionRuns.id, actionRunId));
  }
}
