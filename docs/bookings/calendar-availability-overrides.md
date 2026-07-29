# Calendar availability and booking-hour overrides

Availability is managed from the Booking Calendar rather than a separate settings destination.

## Schedule layers

1. **Normal weekly hours** define the recurring in-shop or mobile booking window for each team member.
2. **Date overrides** replace the recurring rule for one staff member, channel and calendar date.

A date override can:

- open a day that is normally unavailable;
- close a day that is normally available;
- use different start and end times for one date;
- define mobile hours outside the in-shop opening window.

For example, an owner who normally takes Monday off can add an open Monday override for 09:00–17:00 and a closed Thursday override. The following week automatically returns to the recurring schedule.

## Precedence

For a requested date and booking channel, availability uses the date override when one exists. Otherwise it falls back to the recurring weekly channel schedule. Existing appointment conflicts, service eligibility, location eligibility, resources, buffers and approved time off are still applied after the effective schedule is resolved.

## Deployment

The change includes an additive `booking_schedule_overrides` migration. Apply it through the normal reviewed database migration process before deploying the API and web changes.
