# Phase 7.2 data model

`operations_issues` is the durable private inbox. `(tenant_id, deduplication_key)` is unique. A recurrence updates the same row, increments `occurrence_count`, refreshes source copy and timestamps, reopens the issue, and clears prior acknowledgement/resolution/dismissal timestamps. `related_appointment_id` supports staff-safe appointment ownership checks.

Severity then recency determines default order. Cursor pagination uses `last_occurred_at` and is bounded to 100 rows.
