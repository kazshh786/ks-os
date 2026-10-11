import { z } from "zod";

/** Version one contains identifiers and bounded facts, never domain records or message copy. */
export const UniversalEventTypes = [
  "REVIEW_REQUEST_SCHEDULED",
  "REVIEW_REQUEST_SENT",
  "REVIEW_RECEIVED",
  "CUSTOMER_CREATED",
  "CUSTOMER_LIFECYCLE_CHANGED",
  "OPPORTUNITY_CREATED",
  "OPPORTUNITY_STAGE_CHANGED",
  "OPPORTUNITY_WON",
  "OPPORTUNITY_LOST",
  "QUOTE_CREATED",
  "QUOTE_SENT",
  "QUOTE_ACCEPTED",
  "QUOTE_DECLINED",
  "QUOTE_EXPIRED",
  "QUOTE_WAITING",
  "WORK_CREATED",
  "WORK_READY",
  "WORK_STARTED",
  "WORK_BLOCKED",
  "WORK_COMPLETED",
  "WORK_CANCELLED",
  "WORK_REOPENED",
  "WORK_OVERDUE",
  "TASK_CREATED",
  "TASK_COMPLETED",
  "TASK_OVERDUE",
  "FORM_OPENED",
  "FORM_OVERDUE",
  "PAYMENT_FAILED",
  "INVOICE_ISSUED",
  "INVOICE_DUE_SOON",
  "INVOICE_OVERDUE",
  "INVOICE_PARTIALLY_PAID",
  "INVOICE_PAID",
  "APPOINTMENT_NO_SHOW",
] as const;
export const AutomationSourceSchema = z.enum([
  "appointment",
  "sales_opportunity",
  "quote",
  "work_item",
  "task",
  "client",
  "form_assignment",
  "payment",
  "invoice",
]);
export type AutomationSource = z.infer<typeof AutomationSourceSchema>;
const id = z.string().uuid();
const status = z.enum([
  "DRAFT",
  "OPEN",
  "READY",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_SERVICE",
  "AWAITING_PAYMENT",
  "NOT_REQUIRED",
  "SUCCEEDED",
  "FAILED",
  "REFUNDED",
  "SUBMITTED",
  "OPENED",
  "SENT",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "ISSUED",
  "PAID",
  "PARTIALLY_PAID",
  "VOID",
  "WON",
  "LOST",
  "LEAD",
  "PROSPECT",
  "CUSTOMER",
  "INACTIVE",
]);
export const SafeBusinessEventPayloadSchema = z
  .object({
    tenantId: id.optional(),
    bookingReference: id.optional(),
    changeSource: z.literal("CUSTOMER").optional(),
    previousTime: z.string().datetime().optional(),
    newTime: z.string().datetime().optional(),
    occurredAt: z.string().datetime().optional(),
    version: z.literal(1).optional(),
    reference: id.optional(),
    status: status.optional(),
    previousStatus: status.optional(),
    appointmentId: id.nullable().optional(),
    assignmentId: id.optional(),
    formId: id.optional(),
    refundId: id.optional(),
    paymentStatus: status.optional(),
    startTime: z.string().datetime().optional(),
    previousStartTime: z.string().datetime().optional(),
    automationRuleId: id.optional(),
    offsetMinutes: z.number().int().min(-10080).max(10080).optional(),
    dueAt: z.string().datetime().optional(),
    amountMinor: z.number().int().nonnegative().max(2147483647).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();
export const ApprovalDecisionSchema = z
  .object({ decision: z.enum(["APPROVED", "REJECTED"]) })
  .strict();
export const AutopilotControlsSchema = z
  .object({ outboundPaused: z.boolean() })
  .strict();
export const ApprovalPreviewSchema = z
  .object({
    sourceType: AutomationSourceSchema,
    sourceReference: id,
    effect: z.enum(["CREATE_FOLLOW_UP_TASK"]),
  })
  .strict();
export const AutopilotActionSchema = z.union([
  z.object({ type: z.literal("REVIEW_FOLLOW_UP") }).strict(),
  z.object({ type: z.literal("CREATE_OPERATIONS_ISSUE") }).strict(),
  z.object({ type: z.literal("HUMAN_REVIEW") }).strict(),
]);
export type ActionPolicy = "AUTO" | "APPROVAL_REQUIRED" | "HUMAN_ONLY";
/** Never take policy, confidence or approval authority from a browser/action config. */
export function actionPolicy(type: string): ActionPolicy {
  if (type === "REVIEW_FOLLOW_UP") return "APPROVAL_REQUIRED";
  if (
    [
      "CREATE_TASK",
      "CREATE_INTERNAL_NOTIFICATION",
      "CREATE_OPERATIONS_ISSUE",
      "ASSIGN_FORM",
      "SEND_EMAIL",
      "SCHEDULE_EMAIL",
      "SEND_SMS",
      "SCHEDULE_SMS",
      "CANCEL_PENDING_REMINDERS",
      "CANCEL_PENDING_FORM_ASSIGNMENTS",
    ].includes(type)
  )
    return "AUTO";
  return "HUMAN_ONLY";
}
export const outboundAction = (type: string) =>
  ["SEND_EMAIL", "SCHEDULE_EMAIL", "SEND_SMS", "SCHEDULE_SMS"].includes(type);
export function managedHealth(evidence: {
  critical: number;
  failures: number;
  approvals: number;
  overdueApprovals: number;
  issues: number;
  stopped: boolean;
}) {
  if (evidence.stopped)
    return { state: "DEGRADED", reason: "Managed automation is stopped" };
  if (evidence.critical || evidence.failures)
    return {
      state: "DEGRADED",
      reason: "A critical issue or failed action needs review",
    };
  if (evidence.overdueApprovals)
    return {
      state: "ACTION_REQUIRED",
      reason: "An approval has waited more than 24 hours",
    };
  if (evidence.issues || evidence.approvals)
    return {
      state: "ATTENTION",
      reason: "An issue or approval needs attention",
    };
  return {
    state: "HEALTHY",
    reason: "No open issues or pending approvals detected",
  };
}
