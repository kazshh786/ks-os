# Calendar and booking integrity patch

Prepared 7 September 2026. Local branch: `fix/booking-calendar-integrity`.
Base: latest fetched `origin/main`, `56b3490d7047355820737f3dbe8a772881334cab` (universal Work foundation, #230).
The patch is local; it has not been pushed, deployed, or applied to a production database.

## Changes, in audit priority order

| Audit issue | Implemented change | Regression evidence |
| --- | --- | --- |
| Payment retry response contract | Recovery page reads `payment.checkoutUrl` from the API's nested response and navigates to checkout. | PaymentRecovery button interaction. |
| Deposit retry amount | Persist original payment obligation and currency when creating a booking; retry uses that obligation, including deposits. Paid/partially paid/succeeded attempts cannot be charged again through this path. Unknown historical deposit obligations return an explicit conflict. | API retry of 2,000 against a 10,000 total; unknown legacy deposit rejection. |
| Post-commit Stripe failure | A committed booking remains a successful creation response (201), with its reference and recoverable failed-payment status if checkout creation subsequently fails. The public flow sends the customer to recovery. | Injected Stripe session failure preserves booking reference and deposit obligation. |
| Idempotency intent mismatch | Lock booking creation by tenant and idempotency key; persist a hash of submitted booking intent. Exact replay returns the original booking; changed intent returns 409 before consuming a hold or mutating booking metadata. The browser rotates its key when intent changes. The SQL creation function also rejects conflicting replay fields. | Same-intent replay creates no duplicate/session/hold consumption; changed intent returns 409. |
| Persisted occupied ranges/buffers | Save customer appointment times separately from occupied inventory times on appointments and holds. Compose multi-service buffers; availability and repository overlap checks use persisted occupancy. Appointment database trigger checks occupied conflicts and preserves buffer offset during moves. | Composed service/customer/occupied times; persisted buffer calculation; opt-in PostgreSQL overlap race and move test. |
| Active holds in canonical availability | Subtract ACTIVE, unexpired holds for staff and resources, with validated hold exclusion. Disable caching on exact and summary availability. Pending appointments remain blocking until their lifecycle status changes. | Active-hold subtraction; existing concurrency tests. |
| Overlapping hold locking | Hold creation locks tenant/staff rather than an exact start timestamp, plus the resource when present. Hold replay validates intent and active expiry. Consuming a hold sets a transaction-local validated hold ID for the appointment trigger. Database conflict errors map to slot-unavailable 409. | Different start times share a staff lock; database SLOT_UNAVAILABLE maps to 409. Live database serialization test is skipped locally. |
| Tenant-timezone date boundaries | Initialize and bound public booking dates using the tenant's timezone, including timezone changes; remove the calendar's previous-day workaround. Honor the configured future-day limit. | Kiritimati date boundary and existing public calendar-flow tests. |
| slotIntervalMinutes consistency | Exact availability, summary, hold validation, and calendar drag snapping use configured intervals. Generated slots align to the interval grid. Calendar dragging waits for settings. | Configured interval API tests and 20-minute calendar snapping test. |
| Availability errors versus zero availability | Public flow has an explicit availability-error state and Retry availability action instead of displaying an outage as no slots. | Failed request followed by successful retry. |
| Staff identity by name | Team detail exposes internal staffUserId alongside the existing public reference; calendar matching uses the internal ID. | Renamed staff with distinct public/internal identifiers. |
| Location lanes | Stop projecting generic team hours into location lanes as though they were verified location capacity; explain the missing location-specific availability. | Location-lane hours test. |
| Drag/drop location semantics | Main already disabled location-lane drag; preserve that behavior and add a handler guard. A location move is not silently treated as a staff reassignment. | Location-lane draggable=false regression. |
| 250-item truncation | Fetch all calendar pages until hasMore is false, deduplicate IDs, reject an empty continuing page, and ignore stale requests. Pagination uses rowCount including blocked rows while appointment summary counts exclude blocks. | Calendar loads item 251; repository projection coverage. |
| Truthful operational projections | Use persisted source, notes, customer notes and attention reason. Compose service labels from appointment service snapshots and duration from the full appointment span. Service filtering includes all component services. Derive intake status/filtering/counts from form assignments. | Drizzle projection and compiled SQL regression tests; booking operations tests. |
| Multi-service self-reschedule | Customer availability and mutation use the ordered appointment service composition. Operator moves preserve full appointment duration and occupied buffer offset. Existing quoted price/duration change restrictions remain. | Customer management service with a multi-service fixture returns composed 60-minute/1,500 slots; existing management tests. |
| Split shifts | Resolve every weekly and date-override window; reject overlapping windows and mixed closed/open overrides. Editors preserve and add/remove individual shifts. Extract reusable weekly editor from the team page. Update indexes to permit multiple start times per day. | Weekly/date override validation, split-break availability, calendar editor persistence and reusable editor interaction. |

## Required migrations

Run through the repository's migration runner in manifest order, after upstream order 81:

1. **82 — `20260906100000_booking_payment_obligation.sql`**: adds payment amount due, currency, and booking intent hash. Backfills amount/currency from the earliest recorded Stripe attempt. Non-deposit bookings without attempts use the stored quote or zero for pay-later/not-required. Deposits without historical attempts deliberately remain unknown and need operator review before retry.
2. **83 — `20260906101000_booking_occupied_ranges.sql`**: adds and backfills occupied ranges on appointments and holds, adds containment constraints/indexes, installs the appointment overlap trigger, and updates the public multi-service creation function. Historical buffers are reconstructed from currently available service definitions; original historical buffer values cannot be recovered if those definitions changed. Review existing overlapping inventory and reconstructed ranges before release.
3. **84 — `20260906102000_split_weekly_schedules.sql`**: replaces one-row-per-day indexes with indexes including start time for weekly schedules, channel schedules, and date overrides. Application contracts enforce overlap rules.

Manifest validation passed for all 84 migrations. This checks registration/checksums, not SQL execution. Apply the migrations before running code that queries the new columns; coordinate the application rollout and retain a database backup. Index replacement changes schedule cardinality and should be tested on a staging copy.

## Verification completed

- API regression selection: **78 tests, 77 passed, 0 failed, 1 skipped** across 14 test files.
- Web regression selection: **20 tests passed** across 6 files.
- Split-shift dialog recheck after a TypeScript inference correction: **2 tests passed** (already included in the 20 above, not additional unique tests).
- API TypeScript build: passed.
- Web production build: passed; bundler reported chunks larger than 500 kB.
- Shared dependency builds: passed.
- Migration manifest integrity: passed, 84 registered migrations.
- Git whitespace check: passed; Git emitted Windows line-ending conversion notices.
- Web typecheck: passed after correcting a flatMap boolean-literal inference issue with an explicit ScheduleRow type parameter.

Commands run from repository root (test runner arguments are intentionally explicit):

```text
pnpm --filter api exec node --import ./tests/test-environment.mjs --import tsx --test tests/availability-integrity-regression.test.ts tests/booking-integrity-regression.test.ts tests/booking-concurrency.test.ts tests/booking-payments.e2e.test.ts tests/customer-booking-management.test.ts tests/public-booking-calendar-flow.test.ts tests/booking-operations.test.ts tests/booking-occupancy.postgres.test.ts tests/operational-projection-regression.test.ts tests/availability-schedule.test.ts tests/team.contracts.test.ts tests/team-operations.test.ts tests/create-booking.e2e.test.ts tests/booking.e2e.test.ts
pnpm --filter web exec vitest run src/pages/book/PaymentRecovery.test.tsx src/features/bookings/PublicBookingFlow.test.tsx src/features/bookings/BookingOperationsCalendar.test.tsx src/features/bookings/BookingScheduleView.test.tsx src/features/bookings/CalendarAvailabilityDialog.test.tsx src/features/team/WeeklyScheduleEditor.test.tsx
pnpm --filter web exec vitest run src/features/bookings/CalendarAvailabilityDialog.test.tsx
pnpm --filter api build
pnpm --filter web typecheck
pnpm --filter web build
pnpm db:migrations:validate
git diff --check
```

API tests used a deliberately unreachable dummy DATABASE_URL and mocks. They are not evidence of a live database or Stripe integration run. The complete monorepo test suite was not run.

## Remaining release blockers and limits

- **Database validation remains required.** No disposable PostgreSQL instance is configured locally. Set BOOKING_INTEGRITY_TEST_DATABASE_URL to a disposable database and run the opt-in occupancy test; it creates and removes its own fixture schema. It tests the occupancy migration's trigger portion, not the complete migration sequence or full public SQL function. Also apply all three migrations on staging and exercise concurrent hold/create/move/resource conflicts there.
- **Historical data needs review.** Unknown legacy deposit obligations intentionally cannot retry. Reconstructed historical buffers need validation against existing bookings; migration cannot restore unavailable historical service settings.
- **Stripe recovery needs staging end-to-end verification.** No real Stripe session/webhook or browser-to-live-DB journey was executed. This patch corrects the response/amount/booking-commit semantics; it does not add a durable Stripe outbox or prove remote-session creation exactly once under ambiguous network failures or concurrent retries.
- **Location-specific capacity is still not modeled by generic staff hours.** Location lanes now avoid asserting availability they cannot substantiate; dragging between location lanes remains disabled.
- **Multi-service price/duration changes retain the current restriction.** Rescheduling does not automatically reprice an existing booking when catalog terms change.
- Direct SQL creation still checks time off against the customer service interval rather than extending that time-off check through the full buffer. Hold serialization relies on the authorized application route's locks; this patch does not install a database trigger on arbitrary direct hold inserts.
- Operational intake falls back to the stored snapshot when no active assignment aggregate exists, including all-cancelled assignments. No historical reconciliation job is added.

These limits prevent claiming production readiness solely from the passing local tests. No production migration or deployment was performed.
