# Phase 8.1 KPI definitions

- **Bookings:** appointments starting in the tenant-local period, excluding `BLOCKED`. Completed, cancelled, and no-show counts use their exact statuses.
- **Cancellation/no-show rate:** status count divided by appointments in `CONFIRMED`, `CHECKED_IN`, `IN_SERVICE`, `AWAITING_PAYMENT`, `COMPLETED`, `CANCELLED`, or `NO_SHOW`. `PENDING` and `BLOCKED` are excluded from the denominator.
- **Recorded revenue:** checkout totals whose transaction occurred in the period and whose status is `SUCCEEDED` or `REFUNDED`. `REFUNDED` is retained as historical gross revenue so completed refunds can be deducted exactly once.
- **Refunded amount:** Stripe refund amounts with `status=SUCCEEDED` and `completed_at` in the period.
- **Net recorded revenue:** recorded revenue minus completed refunds. This is not profit, net income, or bank balance.
- **Outstanding:** positive `quoted_amount` less successful checkout totals for appointments starting in the period and currently `AWAITING_PAYMENT`. Cancelled, no-show, blocked, paid, and refunded appointments are excluded.
- **Average transaction:** recorded revenue divided by the number of successful or historically successful (`REFUNDED`) transactions, rounded in integer minor units.
- **Unique clients:** distinct clients with an eligible appointment in the period. New clients have no earlier eligible tenant appointment; returning clients do.
- **Staff utilisation:** eligible appointment duration divided by scheduled wall-clock minutes from `staff_schedules`. Cancelled, no-show, pending, and blocked time is excluded. Missing schedules return `null`, never an invented percentage.
