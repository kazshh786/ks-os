import { sql } from "drizzle-orm";
import { getDatabase } from "@ks-os/database";
import { managedHealth, resolveBusinessProfile } from "@ks-os/contracts";
import { autopilotError } from "./automation-approvals.js";
import {
  resolveAutomationContext,
  sourceStillApplies,
} from "./automation-context.js";
import {
  installManagedPlaybooks,
  playbooksForProfile,
} from "./managed-playbooks.js";

export type AutopilotOwner = {
  tenantId: string;
  userId: string;
  role: string;
  supportMode?: unknown;
};
export const requireAutopilotOwner = (a: AutopilotOwner) => {
  if (a.role !== "owner" || a.supportMode)
    throw autopilotError(
      "AUTOPILOT_FORBIDDEN",
      "Business owner access is required.",
      403,
    );
};
const managed = sql.raw(
  `t.is_active=true and t.lifecycle_status in ('ONBOARDING','ACTIVE') and exists(select 1 from tenant_plan_assignments pa where pa.tenant_id=t.id and pa.status='ACTIVE' and pa.starts_at<=now() and (pa.ends_at is null or pa.ends_at>now()) and pa.assigned_by_agency_user_id is not null)`,
);
export const actionLabel = (
  type: string,
  status: string,
  delivered = false,
) => {
  if (status === "SKIPPED") return "Follow-up no longer needed";
  if (status === "FAILED") return "Follow-up needs attention";
  if (status === "WAITING_APPROVAL") return "Waiting for your decision";
  if (
    ["SEND_EMAIL", "SCHEDULE_EMAIL", "SEND_SMS", "SCHEDULE_SMS"].includes(type)
  )
    return delivered ? "Customer message sent" : "Customer message queued";
  return (
    (
      {
        CREATE_TASK: "Follow-up task created",
        REVIEW_FOLLOW_UP: "Approved follow-up task created",
        ASSIGN_FORM: "Form assigned",
        CREATE_INTERNAL_NOTIFICATION: "Team notified",
        CREATE_OPERATIONS_ISSUE: "Issue raised for review",
        HUMAN_REVIEW: "Human review requested",
        CANCEL_PENDING_REMINDERS: "Pending reminders cancelled",
        CANCEL_PENDING_FORM_ASSIGNMENTS: "Pending forms cancelled",
      } as Record<string, string>
    )[type] ?? "Routine action completed"
  );
};
export class AutopilotService {
  constructor(private db: any = getDatabase()) {}
  private async authorize(a: AutopilotOwner) {
    requireAutopilotOwner(a);
    const row = (
      await this.db.execute(
        sql`select id from users where id=${a.userId}::uuid and tenant_id=${a.tenantId}::uuid and role='owner' and account_status='ACTIVE'`,
      )
    ).rows[0];
    if (!row)
      throw autopilotError(
        "AUTOPILOT_FORBIDDEN",
        "Active business owner access is required.",
        403,
      );
  }

  async bootstrap(limit = 25) {
    // Once per tenant, with SKIP LOCKED; no all-tenant loop each worker cycle.
    return this.db.transaction(async (tx: any) => {
      const tenants = (
        await tx.execute(
          sql`select t.id from tenants t where t.is_active=true and not exists(select 1 from automation_tenant_controls c where c.tenant_id=t.id) and exists(select 1 from users u where u.tenant_id=t.id and u.role='owner' and u.account_status='ACTIVE') order by t.id for update of t skip locked limit ${Math.min(limit, 50)}`,
        )
      ).rows as any[];
      for (const t of tenants) {
        await installManagedPlaybooks(t.id, tx);
        await tx.execute(
          sql`insert into automation_tenant_controls(tenant_id) values(${t.id}::uuid) on conflict do nothing`,
        );
      }
      return { configured: tenants.length };
    });
  }
  async summary(a: AutopilotOwner) {
    await this.authorize(a);
    const [
      control,
      playbooks,
      approvals,
      issues,
      activity,
      counts,
      attention,
      tenant,
    ] = await Promise.all([
      this.db.execute(
        sql`select outbound_paused as "outboundPaused",emergency_stopped as "emergencyStopped" from automation_tenant_controls where tenant_id=${a.tenantId}::uuid`,
      ),
      this.db.execute(
        sql`select id,name,status,managed_template_key as key,managed_template_version as version from automation_rules where tenant_id=${a.tenantId}::uuid and managed_template_key is not null order by name limit 50`,
      ),
      this.db.execute(
        sql`select p.public_reference as reference,p.title,p.reason,p.status,p.requested_at as "requestedAt",p.expires_at as "expiresAt",p.safe_preview_json as preview,q.quote_number as "quoteNumber",c.name as "customerName",o.public_reference as "opportunityReference" from automation_approval_requests p join automation_runs r on r.id=p.automation_run_id and r.tenant_id=p.tenant_id left join sales_quotes q on q.id=r.source_id and q.tenant_id=p.tenant_id and r.source_type='quote' left join sales_opportunities o on o.id=q.opportunity_id and o.tenant_id=p.tenant_id left join clients c on c.id=q.client_id and c.tenant_id=p.tenant_id where p.tenant_id=${a.tenantId}::uuid and p.status='PENDING' and p.expires_at>now() order by p.requested_at limit 100`,
      ),
      this.db.execute(
        sql`select public_reference as reference,category,severity,occurred_at as "occurredAt" from operations_issues where tenant_id=${a.tenantId}::uuid and status in ('OPEN','ACKNOWLEDGED') order by case severity when 'CRITICAL' then 0 else 1 end,occurred_at limit 100`,
      ),
      this.db.execute(
        sql`select ar.id,ar.status,ar.completed_at as at,ac.action_type as type,r.name,exists(select 1 from email_outbox e where e.tenant_id=ar.tenant_id and e.idempotency_key=ar.idempotency_key and e.status in ('SENT','DELIVERED')) or exists(select 1 from sms_outbox s where s.tenant_id=ar.tenant_id and s.idempotency_key=ar.idempotency_key and s.status in ('SENT','DELIVERED')) as delivered from automation_action_runs ar join automation_rule_actions ac on ac.id=ar.automation_rule_action_id and ac.tenant_id=ar.tenant_id join automation_runs run on run.id=ar.automation_run_id and run.tenant_id=ar.tenant_id join automation_rules r on r.id=run.automation_rule_id and r.tenant_id=ar.tenant_id where ar.tenant_id=${a.tenantId}::uuid and ar.status in ('SUCCEEDED','SKIPPED','FAILED','WAITING_APPROVAL') order by coalesce(ar.completed_at,ar.created_at) desc limit 50`,
      ),
      this.db.execute(
        sql`select count(*) filter(where ar.status='SUCCEEDED')::int as handled,count(*) filter(where ar.status='SUCCEEDED' and ac.action_type in ('CREATE_TASK','REVIEW_FOLLOW_UP'))::int as tasks,count(*) filter(where ar.status='SUCCEEDED' and ac.action_type in ('SEND_EMAIL','SCHEDULE_EMAIL','SEND_SMS','SCHEDULE_SMS'))::int as queued from automation_action_runs ar join automation_rule_actions ac on ac.id=ar.automation_rule_action_id and ac.tenant_id=ar.tenant_id join tenants t on t.id=ar.tenant_id where ar.tenant_id=${a.tenantId}::uuid and ar.completed_at>=date_trunc('day',now() at time zone coalesce(t.timezone,'Europe/London')) at time zone coalesce(t.timezone,'Europe/London')`,
      ),
      this.db.execute(
        sql`select (select count(*)::int from operations_issues where tenant_id=${a.tenantId}::uuid and status in ('OPEN','ACKNOWLEDGED')) as issues,(select count(*)::int from automation_approval_requests where tenant_id=${a.tenantId}::uuid and status='PENDING' and expires_at>now()) as approvals`,
      ),
      this.db.execute(
        sql`select business_type,business_profile from tenants where id=${a.tenantId}::uuid`,
      ),
    ]);
    const profile = resolveBusinessProfile(
      tenant.rows[0]?.business_type,
      tenant.rows[0]?.business_profile,
    );
    const relevant = new Set<string>(
      playbooksForProfile(profile).map((p) => p.key),
    );
    return {
      attention: attention.rows[0],
      controls: control.rows[0] ?? {
        outboundPaused: false,
        emergencyStopped: false,
      },
      playbooks: playbooks.rows.filter((p: any) => relevant.has(p.key)),
      approvals: approvals.rows,
      issues: issues.rows,
      counts: counts.rows[0],
      activity: activity.rows.map((r: any) => ({
        at: r.at,
        label: actionLabel(r.type, r.status, r.delivered),
        playbook: r.name,
      })),
    };
  }
  async controls(a: AutopilotOwner, paused: boolean) {
    await this.authorize(a);
    await this.db.execute(
      sql`insert into automation_tenant_controls(tenant_id,outbound_paused) values(${a.tenantId}::uuid,${paused}) on conflict(tenant_id) do update set outbound_paused=excluded.outbound_paused,updated_at=now()`,
    );
  }
  async decide(
    a: AutopilotOwner,
    reference: string,
    decision: "APPROVED" | "REJECTED",
  ) {
    await this.authorize(a);
    return this.db.transaction(async (tx: any) => {
      // Lock in worker order: action first, then approval. Replays return the existing decision.
      const row = (
        await tx.execute(
          sql`select p.*,r.source_type,r.source_id,r.trigger_type from automation_approval_requests p join automation_action_runs ar on ar.id=p.automation_action_run_id and ar.tenant_id=p.tenant_id join automation_runs r on r.id=p.automation_run_id and r.tenant_id=p.tenant_id where p.tenant_id=${a.tenantId}::uuid and p.public_reference=${reference}::uuid for update of ar`,
        )
      ).rows[0] as any;
      if (!row)
        throw autopilotError("APPROVAL_NOT_FOUND", "Approval not found.", 404);
      const current = (
        await tx.execute(
          sql`select status from automation_approval_requests where id=${row.id}::uuid and tenant_id=${a.tenantId}::uuid for update`,
        )
      ).rows[0] as any;
      if (current.status !== "PENDING") return { status: current.status };
      const source = await resolveAutomationContext(
        tx,
        a.tenantId,
        row.source_id,
        row.source_type,
        true,
      );
      const expired = new Date(row.expires_at) <= new Date();
      const stale =
        !sourceStillApplies(row.trigger_type, source) ||
        source?.status !== "SENT";
      const status = expired ? "EXPIRED" : stale ? "CANCELLED" : decision;
      await tx.execute(
        sql`update automation_approval_requests set status=${status},resolved_at=now(),resolved_by_user_id=${a.userId}::uuid where id=${row.id}::uuid and tenant_id=${a.tenantId}::uuid and status='PENDING'`,
      );
      await tx.execute(
        sql`update automation_action_runs set status=${status === "APPROVED" ? "PENDING" : "SKIPPED"},next_attempt_at=now(),completed_at=case when ${status === "APPROVED"} then null else now() end,last_error_code=${status === "APPROVED" ? null : status} where id=${row.automation_action_run_id}::uuid and tenant_id=${a.tenantId}::uuid and status='WAITING_APPROVAL'`,
      );
      return { status };
    });
  }
  async centre(offset = 0) {
    const rows = (
      await this.db.execute(sql`select t.agency_reference as reference,t.name,
   coalesce(c.emergency_stopped,false) as stopped,
   (select count(*)::int from operations_issues i where i.tenant_id=t.id and i.status in ('OPEN','ACKNOWLEDGED')) as issues,
   (select count(*)::int from operations_issues i where i.tenant_id=t.id and i.status in ('OPEN','ACKNOWLEDGED') and i.severity='CRITICAL') as critical,
   (select count(*)::int from automation_action_runs a where a.tenant_id=t.id and a.status='FAILED') as failures,
   (select count(*)::int from automation_approval_requests p where p.tenant_id=t.id and p.status='PENDING' and p.expires_at>now()) as approvals,
   (select count(*)::int from automation_approval_requests p where p.tenant_id=t.id and p.status='PENDING' and p.expires_at>now() and p.requested_at<now()-interval '24 hours') as "overdueApprovals"
   from tenants t left join automation_tenant_controls c on c.tenant_id=t.id where ${managed}
   order by critical desc,failures desc,"overdueApprovals" desc,approvals desc,issues desc,t.id limit 50 offset ${offset}`)
    ).rows as any[];
    const queue = rows.length
      ? (
          await this.db
            .execute(sql`with scoped as (select t.id,t.name,t.agency_reference from tenants t where ${managed} and t.agency_reference in (${sql.join(
            rows.map((r) => sql`${r.reference}::uuid`),
            sql`,`,
          )}))
   select * from (select i.public_reference as reference,t.name as business,t.agency_reference as "businessReference",i.category,i.severity,
     case when i.category='AUTOMATION' then 'Automation needs review' when i.category in ('EMAIL','SMS','STRIPE') then 'Delivery or provider needs attention' when i.deduplication_key like 'AUTOPILOT_SITE:%' then 'Website build needs review' else 'Business issue needs review' end as reason,
     i.occurred_at as at,'Review the source and resolve the issue' as next from scoped t join operations_issues i on i.tenant_id=t.id where i.status in ('OPEN','ACKNOWLEDGED')
   union all select p.public_reference,t.name,t.agency_reference,'AUTOMATION','WARNING','Owner decision waiting',p.requested_at,'Ask the owner to review their Autopilot approval' from scoped t join automation_approval_requests p on p.tenant_id=t.id where p.status='PENDING' and p.expires_at>now()) q
   order by case severity when 'CRITICAL' then 0 else 1 end,at limit 100`)
        ).rows
      : [];
    return {
      businesses: rows.map((r) => ({ ...r, ...managedHealth(r) })),
      queue,
      nextOffset: rows.length === 50 ? offset + 50 : null,
    };
  }
  async emergencyStop(reference: string, stopped: boolean) {
    const t = (
      await this.db.execute(
        sql`select t.id from tenants t where t.agency_reference=${reference}::uuid and ${managed}`,
      )
    ).rows[0] as any;
    if (!t)
      throw autopilotError(
        "MANAGED_BUSINESS_NOT_FOUND",
        "Managed business not found.",
        404,
      );
    await this.db.execute(
      sql`insert into automation_tenant_controls(tenant_id,emergency_stopped) values(${t.id}::uuid,${stopped}) on conflict(tenant_id) do update set emergency_stopped=excluded.emergency_stopped,updated_at=now()`,
    );
    return t.id;
  }
}
