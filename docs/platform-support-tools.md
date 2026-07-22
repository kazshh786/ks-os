# Platform support tools

The support overview combines tenant lifecycle counts, failed jobs, open incidents, GoCardless webhook processing and failed communication counts without exposing message bodies or credentials.

`platform_failed_jobs` records a safe retry kind. The API only retries an allowlist: automation action, email delivery, SMS delivery, report export, reputation sync and GoCardless event. Retry uses a conditional failed-state update, increments attempts, queues work and emits a reasoned audit event. It does not directly repeat arbitrary external calls from the browser.

Agency support notes are always `AGENCY_ONLY`. Do not place health, financial, medical, form-answer or customer credential data in support notes. Incidents are tenant-scoped when appropriate and otherwise platform-wide.

Operators should investigate the source record before retrying, avoid duplicate customer communications, and escalate unknown/non-idempotent jobs instead of bypassing the allowlist.

