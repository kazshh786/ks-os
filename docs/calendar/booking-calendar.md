# Booking Calendar operations guide

## Routes and API

- Staff calendar: `/app/calendar`
- Staff list: `/app/bookings`
- Operations query: `GET /api/v1/bookings`
- Single booking: `GET /api/v1/bookings/:id`
- CSV: `GET /api/v1/bookings/export.csv`
- Create: `POST /api/v1/bookings`
- Status: `PATCH /api/v1/bookings/:id/status`
- Reschedule: `PATCH /api/v1/bookings/:id/reschedule`
- Cancel: `POST /api/v1/bookings/:id/cancel`

The list endpoint requires ISO `from` and `to`, caps the range at 93 days and the page size at 250, and supports comma-separated staff, service, location, status, payment, intake, and source filters. Search is bounded and is applied only inside the authenticated tenant scope.

## View behavior

Day is optimized for running today; week and work-week show time across days; month shows density and selection; agenda is a 30-day operational list; staff and location create lanes for capacity checks. A compact/comfortable preference is stored in session storage. View, date and filters are represented in the URL so links remain shareable.

Cards show time, customer, service, staff, location, lifecycle status and attention markers. Status meaning never relies on color alone. Month and dense views reduce detail but retain accessible names.

## Mutations and conflicts

The client never treats a local drag or form edit as authoritative. Rescheduling recomputes the slot through the server availability engine, checks overlapping appointments, staff schedules, time off, service duration/buffer, location/resource constraints, and then writes the appointment and audit event in one transaction. A stale choice returns `SLOT_UNAVAILABLE`; the UI retains context so staff can choose another time.

Booking actions refresh the visible query after success. Background refresh occurs every 30 seconds and on focus/navigation. Polling is intentionally scoped to the active window; a future realtime subscription must use the same invalidation path.

## Permissions

Owners/admins and users with explicit booking capabilities can view all tenant bookings. Staff ownership is evaluated against the tenant-user ID, not the external auth-user ID. Creation, update, cancel, reschedule and export are individually capability-checked by the API. UI visibility is convenience only; the server remains authoritative.

## Performance and accessibility

- Query only the visible date window and paginate list/export requests.
- Preserve the calendar indexes defined in the booking operations migration.
- Keep buttons at usable touch sizes and support direct keyboard actions.
- Maintain visible focus, descriptive button labels, text status, and logical heading order.
- Announce errors next to the action and preserve the entered values after conflicts.
- Test daylight-saving boundaries in the business timezone when adding new time interactions.

## Troubleshooting

- Empty calendar: verify the URL date, filters, tenant timezone and user booking permissions.
- Missing location lanes: the current filter options are derived from records in the loaded range; a location-directory endpoint is a follow-up.
- Repeated conflict: verify staff schedule, service assignment, time off, location/resource assignment, buffers, active holds and overlapping appointments.
- Export denied: the account lacks the all-bookings/export capability.
- Stale view: refocus the window or use the refresh control; inspect the bookings API response before changing UI state.
