import { sql } from "drizzle-orm";
import { getDatabase } from "@ks-os/database";

/** Each indexed candidate scan excludes already-emitted versions before LIMIT (no first-page starvation). */
const detectors = [
  {
    table: "sales_quotes",
    source: "quote",
    type: "QUOTE_WAITING",
    anchor: "sent_at",
    condition:
      "status='SENT' and sent_at<=now()-interval '7 days' and (valid_until is null or valid_until>now())",
  },
  {
    table: "tasks",
    source: "task",
    type: "TASK_OVERDUE",
    anchor: "due_at",
    condition: "status in ('OPEN','IN_PROGRESS') and due_at<now()",
  },
  {
    table: "work_items",
    source: "work_item",
    type: "WORK_OVERDUE",
    anchor: "due_at",
    condition: "status not in ('COMPLETED','CANCELLED') and due_at<now()",
  },
  {
    table: "form_assignments",
    source: "form_assignment",
    type: "FORM_OVERDUE",
    anchor: "created_at",
    condition:
      "status in ('PENDING','OPENED') and created_at<=now()-interval '2 days' and expires_at>now()",
  },
  {
    table: "checkout_transactions",
    source: "payment",
    type: "PAYMENT_FAILED",
    anchor: "created_at",
    condition:
      "payment_status='FAILED' and created_at<=now()-interval '1 hour'",
  },
  {
    table: "invoice_balances",
    source: "invoice",
    type: "INVOICE_DUE_SOON",
    anchor: "due_at",
    condition:
      "status='ISSUED' and due_minor>0 and due_at>=now() and due_at<=now()+interval '3 days'",
  },
  {
    table: "invoice_balances",
    source: "invoice",
    type: "INVOICE_OVERDUE",
    anchor: "due_at",
    condition: "status='ISSUED' and due_minor>0 and due_at<now()",
  },
] as const;
export async function detectAutopilotConditions(
  limit = 50,
  db: any = getDatabase(),
) {
  let created = 0;
  for (const d of detectors) {
    const key = sql.raw(
      `'${d.type}:'||s.id||':threshold-v1:'||extract(epoch from s.${d.anchor})::text`,
    );
    const result =
      await db.execute(sql`insert into business_events(id,tenant_id,event_type,source_type,source_id,payload_json,occurred_at)
   select ${key},s.tenant_id,${d.type},${d.source},s.id,'{"version":1}'::jsonb,now()
   from ${sql.raw(d.table)} s where ${sql.raw(d.condition)}
   and exists(select 1 from automation_rules r where r.tenant_id=s.tenant_id and r.trigger_type=${d.type} and r.status='ACTIVE')
   and not exists(select 1 from business_events e where e.id=${key})
   ${d.type === "PAYMENT_FAILED" ? sql`and not exists(select 1 from business_events e where e.tenant_id=s.tenant_id and e.source_id=s.id and e.source_type='payment' and e.event_type='PAYMENT_FAILED')` : sql``}
   order by s.${sql.raw(d.anchor)},s.id limit ${Math.max(1, Math.min(limit, 100))} on conflict do nothing returning id`);
    created += result.rows.length;
  }
  return { created };
}
