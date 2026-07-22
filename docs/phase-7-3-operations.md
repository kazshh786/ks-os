# Phase 7.3 operations

Set `TASK_WORKER_SECRET` and schedule the overdue endpoint. A task is overdue only when its due time is earlier than now and status is `OPEN` or `IN_PROGRESS`. `overdue_notified_at` prevents repeats; changing the due date or reopening resets eligibility. Assignment, reassignment, urgent creation, and overdue detection create internal notifications.
