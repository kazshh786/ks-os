# Observability and alerting

Pino emits structured completion/error records with service, environment, request/correlation IDs, tenant/agency actor when safe, route template, method, status and duration. URLs, credentials, tokens, cookies, recipients, medical/form/payment content and response bodies are redacted. Correlation IDs are validated, returned to clients and must be copied into queued job metadata and provider call logs.

`/health/live` proves the process loop; `/health/ready` performs a two-second database probe and returns 503 when unavailable. Public checks expose no credentials or SQL detail. Hosted monitoring should collect request count/latency/errors, pool usage/query latency, queue depth/oldest age, worker success/retry/failure, webhook verified/invalid/duplicate/failure, booking/payment outcomes, authentication failures/rate limits, privacy/export durations and backup results. OpenTelemetry/Sentry credentials and sampling remain external configuration; never send PII in user context or breadcrumbs.

Proposed alerts: availability <99.9%/5 min (SEV-1); error rate >5%/5 min or p95 >1 s/10 min (SEV-2); DB unavailable or pool >90%/5 min (SEV-1); oldest queue >5 min, failed worker/schedule, webhook failure >5%, payment/booking failure spike (SEV-2); backup missed, certificate <14 days, disk >85%, failed logins/rate limits >3x baseline (SEV-2/3). Route alerts to the on-call channel and incident commander; link each to `incident-runbooks.md`.

Dashboards: application/API health; database/pool/slow queries; queue/workers; booking funnel; payments/refunds/payouts; webhook verification/backlog; security/auth/audit; privacy SLA/exports/deletions; infrastructure/storage/certificates. Separate staging and production datasets and annotate deployments with `RELEASE_VERSION`.

