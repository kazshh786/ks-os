import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ApprovalDecisionSchema,
  AutopilotControlsSchema,
} from "@ks-os/contracts";
import { AutopilotService } from "./autopilot.service.js";
import {
  AgencyAuditService,
  EntitlementService,
} from "../agency/agency.service.js";
const reference = z.object({ reference: z.string().uuid() }).strict();
const owner = (r: FastifyRequest) => {
  r.requireAuth();
  return {
    tenantId: r.auth!.tenantId,
    userId: r.auth!.tenantUserId,
    role: r.auth!.role,
    supportMode: r.auth!.supportMode,
  };
};
export async function autopilotRoutes(app: FastifyInstance) {
  const service = new AutopilotService();
  app.addHook("preHandler", async (r) => {
    r.requireAuth();
    await new EntitlementService().assertBoolean(
      r.auth!.tenantId,
      "automations.enabled",
    );
  });
  app.get("/", async (r) => ({ data: await service.summary(owner(r)) }));
  app.put("/controls", async (r) => {
    await service.controls(
      owner(r),
      AutopilotControlsSchema.parse(r.body).outboundPaused,
    );
    return { data: { saved: true } };
  });
  app.post("/approvals/:reference/decision", async (r) => ({
    data: await service.decide(
      owner(r),
      reference.parse(r.params).reference,
      ApprovalDecisionSchema.parse(r.body).decision,
    ),
  }));
}
export async function agencyAutopilotRoutes(app: FastifyInstance) {
  const service = new AutopilotService();
  app.get("/", async (r) => {
    r.requireAgency("fulfilment.read");
    return {
      data: await service.centre(
        z
          .object({
            offset: z.coerce.number().int().min(0).max(100000).default(0),
          })
          .strict()
          .parse(r.query).offset,
      ),
    };
  });
  app.put("/:reference/emergency-stop", async (r) => {
    const actor = r.requireAgency("fulfilment.manage");
    const { stopped } = z
      .object({ stopped: z.boolean() })
      .strict()
      .parse(r.body);
    const tenantId = await service.emergencyStop(
      reference.parse(r.params).reference,
      stopped,
    );
    await new AgencyAuditService().write(
      { agencyUserId: actor.agencyUserId, role: actor.role, requestId: r.id },
      stopped ? "AUTOPILOT_STOPPED" : "AUTOPILOT_RESUMED",
      "TENANT",
      tenantId,
      { tenantId },
    );
    return { data: { stopped } };
  });
}
