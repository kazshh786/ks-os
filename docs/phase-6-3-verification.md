# Phase 6.3 verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. Apply migration `0005_phase_6_3_transactional_sms.sql` to a non-production database, then exercise the worker with Twilio test credentials. Verify one confirmation, reschedule replacement reminders, cancellation, form link delivery, signed delivery progression, STOP suppression, START transactional restoration, tenant isolation, masked history, and that provider failure never rolls back the booking. Use fictitious UK mobile recipients only.
