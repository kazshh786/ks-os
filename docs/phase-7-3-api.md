# Phase 7.3 API

Authenticated routes under `/api/v1/tasks` cover list, create, detail, update, activity, assignment, start, complete, reopen, and cancel. `POST /api/v1/operations/issues/:issueId/create-task` converts an issue explicitly. `POST /api/v1/internal/task-worker/overdue` requires `TASK_WORKER_SECRET`. Errors use stable `TASK_*` codes.
