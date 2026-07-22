# Reminder scheduling

Owners choose none, 24 hours, 48 hours, or both. Appointment instants are stored and scheduled in UTC; customer-facing times use `tenant.timezone`. Confirmation creates future reminder jobs. Rescheduling cancels former jobs and creates new idempotency keys; cancellation suppresses all pending appointment reminders. The worker refuses expired jobs and rechecks tenant/client suppression before send. British Summer Time coverage is part of the timezone test suite/manual verification.
