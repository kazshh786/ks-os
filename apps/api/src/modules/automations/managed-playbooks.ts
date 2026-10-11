import { sql } from "drizzle-orm";
import { getDatabase } from "@ks-os/database";
import {
  resolveBusinessProfile,
  type BusinessProfile,
  type ModuleKey,
} from "@ks-os/contracts";

const task = {
  type: "CREATE_TASK",
  titleTemplateKey: "follow-up-client",
  assignTo: "OWNER",
  dueOffsetMinutes: 1440,
  priority: "NORMAL",
};
export const managedPlaybooks = [
  {
    key: "sales.enquiry-follow-up",
    version: "1.0.0",
    name: "New enquiry follow-up",
    module: "sales",
    trigger: "OPPORTUNITY_CREATED",
    action: task,
  },
  {
    key: "sales.quote-review",
    version: "1.0.0",
    name: "Quote waiting for a response",
    module: "sales",
    trigger: "QUOTE_WAITING",
    action: { type: "REVIEW_FOLLOW_UP" },
  },
  {
    key: "work.blocked",
    version: "1.0.0",
    name: "Blocked work needs a decision",
    module: "work",
    trigger: "WORK_BLOCKED",
    action: { type: "CREATE_OPERATIONS_ISSUE" },
  },
  {
    key: "work.overdue",
    version: "1.0.0",
    name: "Overdue work needs attention",
    module: "work",
    trigger: "WORK_OVERDUE",
    action: { type: "CREATE_OPERATIONS_ISSUE" },
  },
  {
    key: "work.completed-follow-up",
    version: "1.0.0",
    name: "Completed work follow-up",
    module: "work",
    trigger: "WORK_COMPLETED",
    action: task,
  },
  {
    key: "tasks.overdue",
    version: "1.0.0",
    name: "Overdue task escalation",
    module: "tasks",
    trigger: "TASK_OVERDUE",
    action: { type: "CREATE_OPERATIONS_ISSUE" },
  },
  {
    key: "forms.pending",
    version: "1.0.0",
    name: "Pending form follow-up",
    module: "forms",
    trigger: "FORM_OVERDUE",
    action: { ...task, titleTemplateKey: "review-form" },
  },
  {
    key: "payments.failed",
    version: "1.0.0",
    name: "Unresolved payment follow-up",
    module: "payments",
    trigger: "PAYMENT_FAILED",
    action: { ...task, titleTemplateKey: "resolve-payment" },
  },
  {
    key: "invoices.overdue",
    version: "1.0.0",
    name: "Overdue invoice follow-up",
    module: "invoices",
    trigger: "INVOICE_OVERDUE",
    action: { ...task, titleTemplateKey: "resolve-payment" },
  },
  {
    key: "bookings.no-show",
    version: "1.0.0",
    name: "Missed appointment follow-up",
    module: "bookings",
    trigger: "APPOINTMENT_NO_SHOW",
    action: task,
  },
] as const;
export function playbooksForProfile(profile: BusinessProfile) {
  return managedPlaybooks.filter(
    (p) =>
      profile.enabledModules.includes(p.module as ModuleKey) &&
      profile.enabledModules.includes("automations"),
  );
}
export async function installManagedPlaybooks(
  tenantId: string,
  db: any = getDatabase(),
) {
  // Creation provenance identifies the consenting owner; execution uses bounded service authority.
  const tenant = (
    await db.execute(
      sql`select t.business_type,t.business_profile,u.id as owner_id from tenants t join users u on u.tenant_id=t.id and u.role='owner' and u.account_status='ACTIVE' where t.id=${tenantId}::uuid and t.is_active=true order by u.id limit 1`,
    )
  ).rows[0] as any;
  if (!tenant) return;
  const profile = resolveBusinessProfile(
    tenant.business_type,
    tenant.business_profile,
  );
  for (const p of playbooksForProfile(profile)) {
    const rule = (
      await db.execute(sql`insert into automation_rules(tenant_id,name,description,status,trigger_type,created_by_user_id,updated_by_user_id,managed_template_key,managed_template_version,enabled_at)
   values(${tenantId}::uuid,${p.name},'Managed by KS OS. Internal service follow-up; no marketing messages.','ACTIVE',${p.trigger},${tenant.owner_id}::uuid,${tenant.owner_id}::uuid,${p.key},${p.version},now()) on conflict do nothing returning id`)
    ).rows[0] as any;
    if (rule) {
      const { type, ...config } = p.action;
      await db.execute(
        sql`insert into automation_rule_actions(tenant_id,automation_rule_id,position,action_type,action_config_json) values(${tenantId}::uuid,${rule.id}::uuid,0,${type},${JSON.stringify(config)}::jsonb)`,
      );
    }
  }
}
