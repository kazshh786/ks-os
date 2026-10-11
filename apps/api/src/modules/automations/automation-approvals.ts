import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { ApprovalPreviewSchema } from "@ks-os/contracts";
export const approvalConfigHash = (action: unknown, ruleVersion: unknown) =>
  createHash("sha256")
    .update(JSON.stringify([action, ruleVersion]))
    .digest("hex");
export const autopilotError = (
  code: string,
  message: string,
  statusCode = 409,
) => Object.assign(new Error(message), { code, statusCode });

export async function approvalGate(
  db: any,
  actionRun: any,
  run: any,
  config: any,
  rule: any,
  c: any,
) {
  const hash = approvalConfigHash(config, rule.updatedAt);
  const preview = ApprovalPreviewSchema.parse({
    sourceType: c.sourceType,
    sourceReference: c.reference,
    effect: "CREATE_FOLLOW_UP_TASK",
  });
  await db.execute(sql`insert into automation_approval_requests(tenant_id,automation_run_id,automation_action_run_id,action_type,title,reason,safe_preview_json,config_hash,expires_at)
  values(${run.tenantId}::uuid,${run.id}::uuid,${actionRun.id}::uuid,'REVIEW_FOLLOW_UP','Review quote follow-up','Approve a task for your team to follow up. No customer message will be sent.',${JSON.stringify(preview)}::jsonb,${hash},now()+interval '3 days') on conflict do nothing`);
  const a = (
    await db.execute(
      sql`select status,expires_at,config_hash from automation_approval_requests where tenant_id=${run.tenantId}::uuid and automation_action_run_id=${actionRun.id}::uuid for update`,
    )
  ).rows[0] as any;
  if (
    a.config_hash !== hash ||
    new Date(a.expires_at) <= new Date() ||
    ["REJECTED", "EXPIRED", "CANCELLED"].includes(a.status)
  ) {
    await db.execute(
      sql`update automation_approval_requests set status=case when expires_at<=now() then 'EXPIRED' else 'CANCELLED' end,resolved_at=now() where automation_action_run_id=${actionRun.id}::uuid and status in ('PENDING','APPROVED')`,
    );
    throw autopilotError(
      "AUTOMATION_STATE_CHANGED",
      "Approval is no longer applicable.",
    );
  }
  return a.status === "APPROVED";
}
export async function expireApprovals(db: any) {
  const rows = (
    await db.execute(
      sql`select p.id,p.automation_action_run_id from automation_approval_requests p join automation_action_runs a on a.id=p.automation_action_run_id where p.status in ('PENDING','APPROVED') and p.expires_at<=now() and a.status in ('WAITING_APPROVAL','PENDING','SCHEDULED') order by p.expires_at for update of a skip locked limit 100`,
    )
  ).rows as any[];
  for (const r of rows) {
    await db.execute(
      sql`update automation_approval_requests set status='EXPIRED',resolved_at=now() where id=${r.id}::uuid`,
    );
    await db.execute(
      sql`update automation_action_runs set status='SKIPPED',last_error_code='APPROVAL_EXPIRED',completed_at=now() where id=${r.automation_action_run_id}::uuid`,
    );
  }
  return rows.length;
}
