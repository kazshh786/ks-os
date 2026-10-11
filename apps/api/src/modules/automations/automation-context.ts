import { sql } from "drizzle-orm";
import { getDatabase } from "@ks-os/database";
import {
  AutomationSourceSchema,
  resolveBusinessProfile,
} from "@ks-os/contracts";

type Executor = Pick<ReturnType<typeof getDatabase>, "execute">;
export const sourceTables = {
  appointment: "appointments",
  sales_opportunity: "sales_opportunities",
  quote: "sales_quotes",
  work_item: "work_items",
  task: "tasks",
  client: "clients",
  form_assignment: "form_assignments",
  payment: "checkout_transactions",
  invoice: "invoices",
} as const;
/** Each adapter selects only an explicit projection. No notes, answers, tokens or provider rows. */
const projections = {
  appointment: sql.raw(
    `s.public_reference as reference,s.status,s.client_id,s.user_id as staff_id,s.start_time,s.service_id,s.booking_channel,s.payment_status,s.quoted_amount`,
  ),
  sales_opportunity: sql.raw(
    `s.public_reference as reference,(select category from sales_pipeline_stages where id=s.stage_id and tenant_id=s.tenant_id) as status,s.client_id,s.owner_user_id as staff_id`,
  ),
  quote: sql.raw(
    `s.public_reference as reference,s.status,s.client_id,s.sent_at,s.valid_until,s.total as amount_minor,s.currency`,
  ),
  work_item: sql.raw(
    `s.public_reference as reference,s.status,s.client_id,s.assigned_user_id as staff_id,s.due_at`,
  ),
  task: sql.raw(
    `s.public_reference as reference,s.status,s.client_id,s.assigned_user_id as staff_id,s.due_at`,
  ),
  client: sql.raw(
    `s.public_reference as reference,'ACTIVE' as status,s.id as client_id`,
  ),
  form_assignment: sql.raw(
    `s.public_reference as reference,s.status,s.client_id,s.appointment_id,s.expires_at,s.created_at`,
  ),
  payment: sql.raw(
    `s.public_reference as reference,s.payment_status as status,s.client_id,s.appointment_id,s.total_amount as amount_minor,s.currency`,
  ),
  invoice: sql.raw(
    `s.public_reference as reference,s.status,s.client_id,s.due_at,s.total_minor as amount_minor,s.currency,(select due_minor from invoice_balances b where b.id=s.id and b.tenant_id=s.tenant_id) as due_minor`,
  ),
};
export async function resolveAutomationContext(
  db: Executor,
  tenantId: string,
  sourceId: string,
  kind: string,
  lock = false,
): Promise<any> {
  const parsed = AutomationSourceSchema.safeParse(kind);
  if (!parsed.success) return null;
  const type = parsed.data;
  const result = await db.execute(
    sql`select s.id,${projections[type]} from ${sql.raw(sourceTables[type])} s where s.tenant_id=${tenantId}::uuid and s.id=${sourceId}::uuid ${lock ? sql`for no key update of s` : sql``}`,
  );
  const s = result.rows[0] as any;
  if (!s) return null;
  const tenant = (
    await db.execute(
      sql`select name,primary_color,reply_to_email,booking_confirmation_enabled,sms_enabled,timezone,currency,business_type,business_profile,is_active from tenants where id=${tenantId}::uuid`,
    )
  ).rows[0] as any;
  if (!tenant?.is_active) return null;
  const client = s.client_id
    ? ((
        await db.execute(
          sql`select id,name,email,phone from clients where tenant_id=${tenantId}::uuid and id=${s.client_id}::uuid`,
        )
      ).rows[0] as any)
    : null;
  if (s.client_id && !client) return null;
  const appointmentId = type === "appointment" ? s.id : s.appointment_id;
  const booking = appointmentId
    ? ((
        await db.execute(sql`select a.id,a.status,a.end_time,a.start_time,a.service_id,a.user_id,a.booking_channel,a.payment_status,a.quoted_amount,sv.name as service_name,u.name as staff_name,
 exists(select 1 from form_assignments f where f.tenant_id=a.tenant_id and f.appointment_id=a.id and f.status in ('PENDING','OPENED')) as incomplete
 from appointments a left join services sv on sv.id=a.service_id and sv.tenant_id=a.tenant_id left join users u on u.id=a.user_id and u.tenant_id=a.tenant_id
 where a.tenant_id=${tenantId}::uuid and a.id=${appointmentId}::uuid`)
      ).rows[0] as any)
    : null;
  return {
    sourceType: type,
    sourceId: s.id,
    reference: s.reference,
    status: s.status,
    clientId: client?.id,
    clientName: client?.name,
    email: client?.email,
    phone: client?.phone,
    staffId: s.staff_id ?? booking?.user_id,
    appointmentId: booking?.id,
    appointmentStatus: booking?.status,
    startTime: booking?.start_time ? new Date(booking.start_time) : undefined,
    endTime: booking?.end_time ? new Date(booking.end_time) : undefined,
    serviceId: booking?.service_id,
    serviceName: booking?.service_name,
    staffName: booking?.staff_name,
    bookingChannel: booking?.booking_channel,
    paymentStatus: booking?.payment_status,
    quotedAmount: booking?.quoted_amount,
    formIncomplete: booking
      ? booking.incomplete
      : type === "form_assignment" && ["PENDING", "OPENED"].includes(s.status),
    tenantName: tenant.name,
    primaryColor: tenant.primary_color,
    replyToEmail: tenant.reply_to_email,
    emailEnabled: tenant.booking_confirmation_enabled,
    smsEnabled: tenant.sms_enabled,
    timezone: tenant.timezone,
    currency: s.currency ?? tenant.currency,
    amountMinor: s.amount_minor,
    dueMinor: s.due_minor,
    dueAt: s.due_at ? new Date(s.due_at) : undefined,
    sentAt: s.sent_at ? new Date(s.sent_at) : undefined,
    validUntil: s.valid_until ? new Date(s.valid_until) : undefined,
    expiresAt: s.expires_at ? new Date(s.expires_at) : undefined,
    profile: resolveBusinessProfile(
      tenant.business_type,
      tenant.business_profile,
    ),
  };
}
export function sourceStillApplies(
  trigger: string,
  c: any,
  now = new Date(),
): boolean {
  if (!c) return false;
  const states: Record<string, string> = {
    WORK_READY: "READY",
    WORK_STARTED: "IN_PROGRESS",
    WORK_COMPLETED: "COMPLETED",
    WORK_CANCELLED: "CANCELLED",
    OPPORTUNITY_LOST: "LOST",
    QUOTE_SENT: "SENT",
    QUOTE_ACCEPTED: "ACCEPTED",
    QUOTE_DECLINED: "DECLINED",
    QUOTE_EXPIRED: "EXPIRED",
    TASK_COMPLETED: "COMPLETED",
    FORM_SUBMITTED: "SUBMITTED",
    APPOINTMENT_NO_SHOW: "NO_SHOW",
    APPOINTMENT_COMPLETED: "COMPLETED",
    BOOKING_CANCELLED: "CANCELLED",
    BOOKING_CONFIRMED: "CONFIRMED",
  };
  if (states[trigger]) return c.status === states[trigger];
  if (trigger === "INVOICE_PAID")
    return c.status === "ISSUED" && Number(c.dueMinor) === 0;
  if (trigger === "INVOICE_PARTIALLY_PAID")
    return (
      c.status === "ISSUED" &&
      Number(c.dueMinor) > 0 &&
      Number(c.dueMinor) < Number(c.amountMinor)
    );
  if (trigger === "PAYMENT_SUCCEEDED")
    return (c.paymentStatus ?? c.status) === "SUCCEEDED";
  if (trigger === "QUOTE_WAITING")
    return (
      c.status === "SENT" &&
      !!c.sentAt &&
      c.sentAt.getTime() <= now.getTime() - 7 * 86400000 &&
      (!c.validUntil || c.validUntil > now)
    );
  if (trigger === "WORK_BLOCKED") return c.status === "BLOCKED";
  if (trigger === "OPPORTUNITY_WON") return c.status === "WON";
  if (trigger === "PAYMENT_FAILED") return c.status === "FAILED";
  if (trigger === "FORM_OVERDUE")
    return ["PENDING", "OPENED"].includes(c.status) && c.expiresAt > now;
  if (["TASK_OVERDUE", "WORK_OVERDUE"].includes(trigger))
    return !["COMPLETED", "CANCELLED"].includes(c.status) && c.dueAt < now;
  if (["INVOICE_DUE_SOON", "INVOICE_OVERDUE"].includes(trigger))
    return (
      c.status === "ISSUED" &&
      Number(c.dueMinor) > 0 &&
      (trigger === "INVOICE_OVERDUE"
        ? c.dueAt < now
        : c.dueAt >= now && c.dueAt.getTime() <= now.getTime() + 3 * 86400000)
    );
  if (trigger === "SCHEDULED_BEFORE_APPOINTMENT")
    return ["CONFIRMED", "PENDING"].includes(c.status) && c.startTime > now;
  if (trigger === "SCHEDULED_AFTER_APPOINTMENT")
    return c.status === "COMPLETED";
  return true;
}

export function eventAnchorStillApplies(
  event: { id: string; type: string; payload: any },
  c: any,
): boolean {
  if (!c) return false;
  if (
    event.type === "SCHEDULED_BEFORE_APPOINTMENT" ||
    event.type === "SCHEDULED_AFTER_APPOINTMENT"
  ) {
    const anchor =
      event.type === "SCHEDULED_BEFORE_APPOINTMENT" ? c.startTime : c.endTime;
    return !!anchor && event.id.endsWith(":" + anchor.toISOString());
  }
  if (event.type === "BOOKING_RESCHEDULED") {
    const start = event.payload?.startTime ?? event.payload?.newTime;
    return !start || c.startTime?.toISOString() === start;
  }
  return true;
}
