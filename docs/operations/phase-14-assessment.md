# Phase 14 production-readiness assessment

## Architecture and existing controls

KS OS is a pnpm TypeScript monorepo. The React/Vite web app calls a Fastify API; shared Zod contracts and a Drizzle/PostgreSQL package enforce request and persistence shapes. Supabase supplies PostgreSQL, Auth and private Storage. Tenant membership, customer identity and agency identity are deliberately separate. All sensitive decisions are server-side. Background work uses database-backed outboxes and `FOR UPDATE SKIP LOCKED` claims; worker routes use distinct shared secrets. Stripe, GoCardless, Resend and Twilio webhooks validate signatures and retain provider event identifiers for idempotency. Deployment targets a local-only Fastify service behind a reverse proxy.

Existing strengths include MFA for privileged agency roles, application-session revocation, support-mode audit, tenant-scoped repositories, bounded reporting exports, booking/payment idempotency, global and route-specific rate limits, structured Pino logging with redaction, append-only audit triggers, additive migrations, graceful shutdown and health checks.

## Gap and delivery matrix

| Phase | Item | Status |
|---|---|---|
| 14.1 | Agency/authentication append-only audit | Already implemented |
| 14.1 | Enriched categories, before/after, actor/session/component and recursive redaction | Implemented during this task |
| 14.1 | Filtered/paginated detailed audit UI and CSV export workflow | Implemented during this task |
| 14.1 | Versioned consent evidence | Implemented during this task |
| 14.1 | Business-wide mapping of every legacy mutation to a category | Partially implemented; continue route-by-route |
| 14.2 | Subject-access/deletion workflow, legal holds and private expiring JSON exports | Implemented during this task |
| 14.2 | Safe anonymisation/session revocation worker | Implemented during this task |
| 14.2 | External-integration deletion propagation and legal policy | Requires stakeholder decision/provider support |
| 14.2 | Versioned retention policies and idempotent dry-run queue | Implemented during this task |
| 14.2 | Category-specific live deletion processors | Partially implemented; manual review remains default |
| 14.3 | Backup/restore/DR and incident procedures | Implemented during this task as reproducible runbooks |
| 14.3 | Provider schedules, immutable secondary storage and alert destinations | Requires external infrastructure |
| 14.4 | Headers, CORS, request limits, rate limits, secret validation/redaction | Implemented/already implemented |
| 14.4 | Dependency, secret and CodeQL CI scanning | Implemented during this task |
| 14.4 | Independent penetration test | Requires external provider/stakeholder approval |
| 14.5 | Pagination, bounded exports and SKIP LOCKED workers | Already implemented |
| 14.5 | Repeatable k6 smoke/load harness and targets | Implemented during this task |
| 14.5 | Measured production baseline and capacity approval | Requires safe staging infrastructure/stakeholder approval |
| 14.6 | Structured redacted request logs and correlation propagation | Implemented during this task |
| 14.6 | Separate liveness/readiness | Implemented during this task |
| 14.6 | Hosted metrics/traces/error provider and notification channels | Requires external infrastructure |
| 14.7 | Environment validation, migration preflight, deployment script and CI | Implemented/already implemented |
| 14.7 | Staging/production approvals, DNS/TLS and provider secrets | Requires external infrastructure |

## Risks and assumptions

- The production migration ledger must be reconciled before Phase 14 migration application; never run an unreviewed full migration set against the partially baselined database.
- `trustProxy` is now opt-in. Production must set it only when the API is reachable solely through the controlled reverse proxy.
- Privacy exports reuse the private report-export bucket. Bucket access must remain private and object lifecycle cleanup must be enabled.
- Automated deletion deliberately supports only deactivation and anonymisation. Hard deletion of financially linked records requires an approved data map and legal retention schedule.
- Proposed RPO/RTO, retention periods, alert thresholds and legal bases require approval by the controller, counsel and infrastructure owner.

