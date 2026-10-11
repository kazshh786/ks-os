import { sql } from "drizzle-orm";
import { getDatabase } from "@ks-os/database";
import {
  resolveAutomationContext,
  sourceStillApplies,
  eventAnchorStillApplies,
} from "./automation-context.js";
/** Final outbox check: pausing also applies to messages already queued by this engine. */
export async function automationDeliveryState(
  tenantId: string,
  key: string,
  db: any = getDatabase(),
  templateKey?: string,
): Promise<"READY" | "PAUSED" | "STALE"> {
  const governed =
    key.startsWith("automation:") ||
    ["appointment-reminder", "review-invitation", "form-reminder"].includes(
      templateKey ?? "",
    );
  if (!governed) return "READY";
  const controls = (
    await db.execute(
      sql`select outbound_paused,emergency_stopped from automation_tenant_controls where tenant_id=${tenantId}::uuid`,
    )
  ).rows[0] as any;
  if (controls?.outbound_paused || controls?.emergency_stopped) return "PAUSED";
  if (!key.startsWith("automation:")) return "READY";
  const row = (
    await db.execute(sql`select e.id as event_id,e.payload_json,r.source_type,r.source_id,r.trigger_type,rule.status,c.outbound_paused,c.emergency_stopped from automation_action_runs ar
 join automation_runs r on r.id=ar.automation_run_id and r.tenant_id=ar.tenant_id join automation_rules rule on rule.id=r.automation_rule_id and rule.tenant_id=ar.tenant_id
 join business_events e on e.id=r.trigger_event_id and e.tenant_id=r.tenant_id
 left join automation_tenant_controls c on c.tenant_id=ar.tenant_id where ar.tenant_id=${tenantId}::uuid and ar.idempotency_key=${key}`)
  ).rows[0] as any;
  if (!row) return "STALE";
  if (row.status !== "ACTIVE" || row.outbound_paused || row.emergency_stopped)
    return "PAUSED";
  const context = await resolveAutomationContext(
    db,
    tenantId,
    row.source_id,
    row.source_type,
  );
  return sourceStillApplies(row.trigger_type, context) &&
    eventAnchorStillApplies(
      { id: row.event_id, type: row.trigger_type, payload: row.payload_json },
      context,
    )
    ? "READY"
    : "STALE";
}
