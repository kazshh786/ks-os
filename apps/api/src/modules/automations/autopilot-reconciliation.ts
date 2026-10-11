import { sql } from "drizzle-orm";
import { getDatabase } from "@ks-os/database";
import { OperationsIssueReporter } from "../operations/operations.issue-service.js";

export async function reconcileAutopilot(db: any = getDatabase()) {
  const reporter = new OperationsIssueReporter();
  // Reuse website worker evidence. Never inspect job payloads or publish a website.
  const failed = (
    await db.execute(
      sql`select j.id,j.tenant_id from site_jobs j where j.status in ('FAILED','DEAD_LETTER') and (j.retryable=false or j.attempt_count>=j.max_attempts or j.status='DEAD_LETTER') and not exists(select 1 from operations_issues i where i.tenant_id=j.tenant_id and i.deduplication_key='AUTOPILOT_SITE:'||j.id) order by j.updated_at,j.id limit 50`,
    )
  ).rows as any[];
  for (const job of failed)
    await reporter.report(
      {
        tenantId: job.tenant_id,
        category: "SYSTEM",
        issueType: "SYSTEM_FAILURE",
        severity: "CRITICAL",
        title: "Website build needs review",
        message:
          "Review the failed website job in the managed service workspace.",
        sourceType: "SYSTEM",
        sourceId: job.id,
        deduplicationKey: `AUTOPILOT_SITE:${job.id}`,
        metadata: { source: "site_job" },
      },
      db,
    );
  const resolved =
    await db.execute(sql`update operations_issues i set status='RESOLVED',resolved_at=now(),updated_at=now() where i.id in (
  select i.id from operations_issues i where i.status in ('OPEN','ACKNOWLEDGED') and (
   (i.deduplication_key like 'AUTOPILOT_SITE:%' and exists(select 1 from site_jobs j where j.id::text=i.source_id and j.tenant_id=i.tenant_id and j.status='SUCCEEDED'))
   or (i.deduplication_key like 'AUTOPILOT_ATTENTION:%' and exists(select 1 from automation_action_runs ar join automation_runs r on r.id=ar.automation_run_id and r.tenant_id=ar.tenant_id where ar.id::text=i.source_id and ar.tenant_id=i.tenant_id and (
    (r.trigger_type='WORK_BLOCKED' and exists(select 1 from work_items w where w.id=r.source_id and w.tenant_id=r.tenant_id and w.status<>'BLOCKED'))
    or (r.trigger_type='WORK_OVERDUE' and exists(select 1 from work_items w where w.id=r.source_id and w.tenant_id=r.tenant_id and (w.status in ('COMPLETED','CANCELLED') or w.due_at>=now() or w.due_at is null)))
    or (r.trigger_type='TASK_OVERDUE' and exists(select 1 from tasks t where t.id=r.source_id and t.tenant_id=r.tenant_id and (t.status in ('COMPLETED','CANCELLED') or t.due_at>=now() or t.due_at is null)))
   )))
  ) order by i.updated_at for update skip locked limit 100) returning id`);
  // Invalidate waiting work on source changes without requiring the owner to click it first.
  const invalid = (
    await db.execute(
      sql`select p.id,p.automation_action_run_id from automation_approval_requests p join automation_runs r on r.id=p.automation_run_id and r.tenant_id=p.tenant_id join automation_action_runs a on a.id=p.automation_action_run_id and a.tenant_id=p.tenant_id where p.status in ('PENDING','APPROVED') and a.status in ('WAITING_APPROVAL','PENDING','SCHEDULED') and r.source_type='quote' and not exists(select 1 from sales_quotes q where q.id=r.source_id and q.tenant_id=r.tenant_id and q.status='SENT' and (q.valid_until is null or q.valid_until>now())) order by p.requested_at for update of a skip locked limit 100`,
    )
  ).rows as any[];
  for (const p of invalid) {
    await db.execute(
      sql`update automation_approval_requests set status='CANCELLED',resolved_at=now() where id=${p.id}::uuid`,
    );
    await db.execute(
      sql`update automation_action_runs set status='SKIPPED',completed_at=now(),last_error_code='AUTOMATION_STATE_CHANGED' where id=${p.automation_action_run_id}::uuid`,
    );
  }
  await db.execute(
    sql`update automation_runs r set status=case when exists(select 1 from automation_action_runs a where a.automation_run_id=r.id and a.status='FAILED') then 'PARTIALLY_FAILED' else 'SUCCEEDED' end,completed_at=now() where r.id in(select r.id from automation_runs r where r.status='PENDING' and not exists(select 1 from automation_action_runs a where a.automation_run_id=r.id and a.status in ('PENDING','SCHEDULED','RUNNING','WAITING_APPROVAL')) order by r.created_at for update skip locked limit 100)`,
  );
  return {
    siteIssues: failed.length,
    resolved: resolved.rows.length,
    invalidated: invalid.length,
  };
}
