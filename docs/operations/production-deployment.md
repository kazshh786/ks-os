# Production deployment and rollback

Development, test, staging and production require separate Supabase projects, databases, private buckets, worker secrets, provider credentials/webhooks, sender configuration, monitoring environments, URLs and callback allowlists. Production startup rejects development auth, missing critical variables, placeholder values and non-HTTPS public origins. Set `TRUST_PROXY=true` only when direct API access is firewalled and the controlled reverse proxy overwrites forwarded headers.

Before release: approve change/migration, confirm encrypted backup/PITR and capacity, run frozen install, lint, typecheck, tests, build, security scans, migration plan/checksums and staging smoke/load checks. Use additive expand-contract migrations; deploy readers tolerant of both schemas before writers, backfill in batches, then contract in a later release. Never run automatic schema push.

Deploy API/web/workers with unique `RELEASE_VERSION`. Apply reviewed production migrations under advisory lock with timeout monitoring. Start API, then consumers/schedules. Readiness controls traffic; graceful shutdown drains requests. Verify liveness/readiness, authentication, agency access, tenant isolation, availability, safe test booking, queue worker, webhook endpoint, private Storage and test email without real charges/customers. Annotate monitoring and observe for at least 30 minutes.

Required process types: API; web; email/SMS/automation/report/task/agency/privacy workers; retention scheduler; webhook consumers; backup verification. Start with one consumer per queue and scale when oldest age exceeds 60 seconds or utilisation exceeds 70%, preserving idempotent claims.

Rollback criteria include sustained elevated errors/latency, failed smoke tests, integrity mismatch or security regression. Remove the release from traffic, stop its workers, restore the previous application/configuration release and verify health. Database changes use a reviewed forward fix unless a separately restored database is promoted. Record decisions, owners, release IDs and customer communications.

External steps: configure DNS/API/admin hostnames, automatic TLS renewal and HTTP→HTTPS canonical redirects; restrict inbound API to proxy; provision Supabase PITR/private buckets; configure worker schedules and hosted monitoring/error/tracing; add CI environment protection and manual production approval; install alert receivers and backup-failure notifications.
