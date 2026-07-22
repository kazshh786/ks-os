# Phase 7.3 task architecture

Tasks are private, tenant-scoped operational follow-ups. `tasks` holds current state and `task_activity` is append-only lifecycle history. The API is the only data path; browser database roles have no table privileges. List responses omit descriptions and notes. Keyset pagination uses `(updated_at, id)`, while actionable due work uses a partial index. Automation uses the action-run idempotency key, and the overdue worker atomically claims rows before notifying.
