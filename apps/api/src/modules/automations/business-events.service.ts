import { businessEvents, getDatabase } from '@ks-os/database';
import type { BusinessEvent, BusinessEventType } from '@ks-os/contracts';

export const stableEventId = (type: BusinessEventType, sourceId: string, version: string | number) => `${type}:${sourceId}:${version}`;

export class BusinessEventsService {
  async emit(event: BusinessEvent, tx?: any) {
    const db = tx ?? getDatabase();
    await db.insert(businessEvents).values({
      id: event.id, tenantId: event.tenantId, eventType: event.type, sourceType: event.sourceType,
      sourceId: event.sourceId, payloadJson: event.payload, occurredAt: new Date(event.occurredAt),
    }).onConflictDoNothing({ target: businessEvents.id });
  }
}
