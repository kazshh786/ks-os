# Phase 9.1 staff lifecycle

Statuses are `INVITED`, `ACTIVE`, `SUSPENDED`, and `DEACTIVATED`. Auth context requires `ACTIVE`. Suspension/deactivation disables new bookings but preserves profiles, schedules, services and every historic/future appointment. Owners receive future-appointment and service impact before an explicitly confirmed action. Reactivation restores access; removed service eligibility is never recreated automatically.

Only staff records can use lifecycle routes. Owners and self-targeted owner actions are protected.
