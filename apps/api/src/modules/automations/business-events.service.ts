import { businessEvents, getDatabase } from "@ks-os/database";
import {
  BusinessEventSchema,
  type BusinessEvent,
  type BusinessEventType,
} from "@ks-os/contracts";

export const stableEventId = (
  type: BusinessEventType,
  sourceId: string,
  version: string | number,
) => `${type}:${sourceId}:${version}`;

export class BusinessEventsService {
  async emit(input: unknown, tx?: any) {
    const event = BusinessEventSchema.parse(input);
    const db = tx ?? getDatabase();
    await db
      .insert(businessEvents)
      .values({
        id: event.id,
        tenantId: event.tenantId,
        eventType: event.type,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        payloadJson: event.payload,
        occurredAt: new Date(event.occurredAt),
      })
      .onConflictDoNothing({ target: businessEvents.id });
  }
}
