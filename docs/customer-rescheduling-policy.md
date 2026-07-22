# Customer Rescheduling Policy

## Eligibility and limits

Online rescheduling requires a `PENDING` or `CONFIRMED` appointment, tenant enablement, a time strictly before the reschedule deadline, an active authorized access path, a current appointment version, and remaining customer reschedules.

`customer_reschedule_count` records only changes made through customer or guest management. Staff/owner/system appointment changes do not increment it, and moving an appointment does not reset it.

## Preserved booking context

Phase 10.2 never accepts browser control of tenant, client, service, channel, location, resource, authoritative amount, or refund. Those values are loaded from the authorized appointment.

The customer may select a new start time and, where safe, an eligible staff public reference. A different staff member must be active in the same tenant, assigned to the same service, enabled for booking, scheduled for the preserved channel/location, and available. Staff-specific duration and final price must exactly match the existing appointment.

## Availability

Both authenticated and guest availability endpoints call the canonical booking availability service. The current appointment is excluded from conflict detection while other active appointments, unexpired payment holds, approved leave, channel schedules, location eligibility, preserved resource use, duration, buffer, price, and tenant timezone remain enforced.

Responses contain ISO slot times, safe staff references/names, and current-staff preference only. Internal IDs, schedules, resources, pricing internals, and private staff data are excluded. Failures never substitute mock slots.

## Atomic mutation

The final reschedule transaction:

1. authorizes the customer or token;
2. locks and reloads the appointment;
3. re-evaluates state and policy;
4. checks the supplied version;
5. locks the target staff and preserved resource with transaction advisory locks;
6. recalculates canonical availability inside the same transaction;
7. applies a status/version-guarded update;
8. increments the customer-only count;
9. records old/new time and staff history;
10. shifts pending form reminders without duplicating assignments;
11. cancels old appointment reminders and schedules the configured replacements;
12. cancels superseded automation actions;
13. emits one `BOOKING_RESCHEDULED` event; and
14. inserts deterministic email/SMS outbox rows.

The appointment version trigger also increments revisions for staff-side updates, allowing a page loaded before a salon edit to fail safely.

## Timezones

The requested start is an ISO instant. Calendar dates and human-readable times are derived with the appointment tenant's IANA timezone. Canonical availability constructs local-day UTC boundaries using the next local calendar midnight, including 23- and 25-hour DST days.
