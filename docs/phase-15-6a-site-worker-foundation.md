# Phase 15.6A — site-worker and job-processing foundation

## Scope

Phase 15.6A introduces the durable, provider-neutral background-processing
foundation for the KS OS website platform. It does not implement AI generation,
site publication, domain provisioning, analytics synchronisation, image
generation, image optimisation, or monthly page production.

The runtime is a headless Node.js and TypeScript application in
`apps/site-worker`. It can be started independently with:

```text
pnpm --filter site-worker dev
pnpm --filter site-worker build
pnpm --filter site-worker start
```

It is suitable for later container packaging but this phase does not add a
Docker image, deployment configuration, or infrastructure-provider adapter.

## Relationship to the existing outbox model

The existing email and SMS outboxes established the repository's proven
patterns:

- durable PostgreSQL rows;
- server-derived idempotency;
- explicit state changes;
- retry counts and delayed availability;
- short `FOR UPDATE SKIP LOCKED` claims;
- failure codes rather than sensitive exception dumps.

Phase 15.6A generalises those ideas for longer-running website operations. It
extends the existing `site_jobs` record created in Phase 15.0–15.2 and does not
replace or modify email delivery. Email and SMS continue using their existing
workers and tables.

## Packages and responsibilities

### `packages/site-jobs`

This framework-neutral package owns:

- the controlled production job-type enum;
- test-only job types;
- explicit lifecycle statuses and allowed transitions;
- discriminated, strict Zod payload schemas;
- safe result and progress schemas;
- controlled failure codes;
- retry-policy contracts and backoff calculations;
- the compile-time handler interface and registry;
- the standard idempotency-key derivation function.

Unknown job types, unknown payload properties, mismatched discriminators, and
unsupported schema versions are rejected. Payloads cannot specify source files,
module paths, shell commands, JavaScript, or handler names.

### `apps/site-worker`

The application owns:

- validated environment configuration;
- the Postgres leasing repository;
- the deterministic handler registry;
- polling and controlled global concurrency;
- heartbeats and cooperative cancellation;
- retry classification;
- graceful shutdown;
- structured safe logs;
- internal liveness/readiness output.

No user interface or public worker API is included.

### `apps/api`

The existing agency API owns:

- agency-only job summaries and operational history;
- cancellation requests;
- authorised manual retries;
- platform audit events for agency actions;
- a server-only enqueue service for future domain services.

There is deliberately no generic browser endpoint that accepts an arbitrary
job type or JSON payload.

## Database model

The additive Phase 15.6A migration extends `site_jobs` with:

- relational blueprint and agency-actor references;
- payload schema version;
- priority and scheduling;
- source reference and SHA-256 digest;
- lease owner and lease-token digest;
- lease, expiry, and heartbeat timestamps;
- attempt and retry limits;
- progress fields;
- safe failure classification;
- cancellation and terminal timestamps.

It adds:

- `site_job_attempts` for one ordered record per processing attempt;
- `site_job_events` for append-only operational history.

Tenant, site, version, and blueprint ownership remain relational. Database
triggers reject cross-tenant relationships and mutation of a job's identity or
payload after creation. Status transitions are validated at both the shared
contract and database layers.

The tables use RLS as defence in depth. `anon` and `authenticated` have no
table grants. Only server-side roles receive the minimum table privileges;
deletion is not granted.

## Leasing

`PostgresSiteJobRepository.claimNext` uses one short transaction:

1. Select one eligible row ordered by priority, availability, creation time,
   and ID.
2. Lock it with `FOR UPDATE SKIP LOCKED`.
3. Atomically change it to `LEASED`.
4. Generate an unguessable token in the worker process.
5. Store only its SHA-256 digest.
6. Record the attempt and lease event.
7. Commit before handler execution begins.

Handler work never runs while the queue-row transaction is open.

Eligible records are:

- `PENDING`;
- due `SCHEDULED`;
- due `RETRY_DELAY`;
- abandoned `LEASED` or `PROCESSING` rows whose lease has expired.

Completed, cancelled, future-scheduled, and valid actively leased jobs cannot
be claimed. A uniqueness-preserving row lock prevents two workers from claiming
the same job.

The initial fairness rule permits one active job per tenant. This prevents one
tenant's backlog from occupying all worker slots. Later phases may add
per-job-type and configurable per-tenant limits without changing the durable
model.

## Lease ownership and heartbeats

Every processing mutation requires:

- the job ID;
- the worker instance identifier;
- the SHA-256 digest of the in-memory lease token;
- an unexpired lease;
- an eligible active status.

One worker cannot heartbeat, progress, complete, fail, or cancel another
worker's attempt.

Heartbeats extend the lease using database time. They also return whether the
agency requested cancellation. Heartbeats are not written as individual
operational events to avoid unnecessary database volume. Lost ownership aborts
the handler where cooperative cancellation is possible and prevents stale
completion.

## Handler registry

Handlers are registered in a compile-time `SiteJobHandlerRegistry`. Every
handler declares:

- a known job type;
- one payload schema version;
- a strict payload schema;
- a strict result schema;
- cancellation support;
- a default retry policy.

The database cannot name a module path. The worker performs no dynamic import,
`eval`, runtime code compilation, or command execution.

Phase 15.6A registers no production website handlers because none of the future
AI, publication, provider, analytics, optimisation, or audit operations is
implemented in this phase. A queued production type therefore fails with the
controlled `TERMINAL_HANDLER_NOT_IMPLEMENTED` classification.

Five deterministic internal test handlers exist for automated validation. They
are loaded only when `SITE_WORKER_ENABLE_TEST_HANDLERS=true`, and configuration
validation forbids that setting in production. Agency APIs exclude all
`TEST_%` records.

## Job lifecycle

The principal path is:

```text
PENDING or due SCHEDULED
  -> LEASED
  -> PROCESSING
  -> COMPLETED
```

Retryable failure uses:

```text
PROCESSING
  -> RETRY_DELAY
  -> LEASED
```

Terminal validation or permission failures use:

```text
PROCESSING
  -> FAILED
```

Exhausted retryable work uses:

```text
PROCESSING
  -> DEAD_LETTER
```

Manual retry is restricted to an authorised agency action:

```text
FAILED or DEAD_LETTER
  -> PENDING
```

Completed and cancelled jobs are terminal. Invalid transitions are rejected by
the database trigger and shared lifecycle contract.

## Idempotency

Future domain services derive an idempotency key from:

```text
tenant public reference
+ job type
+ target public reference
+ source-data SHA-256 digest
+ operation version
```

The result is a lowercase SHA-256 digest. `site_jobs.idempotency_key` remains
database-unique. The internal enqueue service also takes an advisory
transaction lock before its read-or-insert sequence.

An identical request returns the existing job. A changed source digest creates
a new job. Tenant identity is included in the derived material, so work is
never merged across tenants.

The Phase 15.6A enqueue service has an empty production allowlist by default.
A future domain module must install a real handler and explicitly allow its job
type before that type becomes enqueueable.

## Retry policy

Handlers define:

- maximum attempts;
- initial delay;
- backoff multiplier;
- maximum delay;
- optional bounded jitter.

Future handlers may pass a safe Retry-After duration. It is bounded by the
handler's maximum delay.

Validation, permission, missing-data, unsupported-type, and schema-version
failures are terminal. Retryable provider, contention, rate-limit, and
unexpected handler failures use delayed retry. A retryable failure that reaches
the attempt limit becomes `DEAD_LETTER` and creates
`SITE_JOB_DEAD_LETTERED` in the platform audit log.

## Progress and results

Progress updates require the current valid lease. `current` cannot decrease,
cannot exceed `total`, and the total cannot change after it is established.
Progress events contain only numeric progress and a bounded safe message; they
never copy the full payload.

Handler results must validate against both the handler result schema and the
shared safe result envelope. That envelope permits only:

- a bounded summary;
- public output references;
- numeric metrics.

## Cancellation

Agency users require `sites.jobs.cancel`.

- Pending, scheduled, and retry-delay jobs become `CANCELLED` immediately.
- Leased and processing jobs become `CANCEL_REQUESTED`.
- Heartbeats expose the request to the handler.
- Cancellable handlers receive an aborted signal.
- Completion performs a final cancellation check.
- Expired `CANCEL_REQUESTED` leases are recovered as `CANCELLED`.
- Completed and terminal jobs cannot be cancelled.

Agency requests create platform audit events. The high-volume worker history
remains in `site_job_events`.

## Concurrency and shutdown

Global concurrency is configured with `SITE_WORKER_CONCURRENCY`. The worker
does not lease beyond its available local slots.

`SIGINT` and `SIGTERM` trigger:

1. stop leasing;
2. mark health as draining;
3. wake the poll loop;
4. signal active handlers;
5. wait for the configured bounded shutdown period;
6. stop heartbeats with the handlers;
7. leave unfinished durable work recoverable by lease expiry;
8. close the health server and Postgres pool.

No broad process termination is used.

## Health and readiness

The internal Node health server binds to `SITE_WORKER_HEALTH_HOST`, which
defaults to `127.0.0.1`.

- `GET /health` reports process/poll-loop liveness.
- `GET /ready` additionally requires database access, the Phase 15.6A tables,
  a loaded registry, and a non-draining worker.

Responses contain no environment variables, connection strings, credentials,
payloads, tokens, or tenant data.

## Agency operations

Agency-only routes are:

```text
GET  /api/v1/agency/site-jobs
GET  /api/v1/agency/site-jobs/{jobReference}
GET  /api/v1/agency/site-jobs/{jobReference}/attempts
GET  /api/v1/agency/site-jobs/{jobReference}/events
POST /api/v1/agency/site-jobs/{jobReference}/cancel
POST /api/v1/agency/site-jobs/{jobReference}/retry
GET  /api/v1/agency/sites/{siteReference}/jobs
```

They use public references and capabilities:

- `sites.jobs.read`;
- `sites.jobs.manage`;
- `sites.jobs.retry`;
- `sites.jobs.cancel`.

List operations support site, status, and job-type filtering. Responses omit
internal IDs, payload JSON, idempotency material, source digests, and lease
tokens. Attempts and events are returned in deterministic chronological order.
Tenant application users cannot access these routes.

## Observability

The worker emits structured JSON logs with safe identifiers:

- worker ID;
- job public reference;
- controlled job type;
- tenant and site public references;
- attempt number;
- failure code;
- duration.

It does not log payloads, results, prompts, tokens, secrets, medical or booking
form content, customer data, template archives, or licence evidence. No paid
monitoring provider is introduced.

## Environment

The documented placeholders are:

```text
SITE_WORKER_ID=
SITE_WORKER_CONCURRENCY=2
SITE_WORKER_POLL_INTERVAL_MS=1000
SITE_WORKER_LEASE_SECONDS=120
SITE_WORKER_HEARTBEAT_SECONDS=30
SITE_WORKER_SHUTDOWN_TIMEOUT_SECONDS=30
SITE_WORKER_HEALTH_HOST=127.0.0.1
SITE_WORKER_HEALTH_PORT=8091
SITE_WORKER_LOG_LEVEL=info
SITE_WORKER_ENABLE_TEST_HANDLERS=false
```

The worker also requires the existing server-side `DATABASE_URL`. No database
credential is browser-visible.

## Deferred work

Later phases may add real handlers for:

- expert knowledge and structured AI generation;
- template analysis and blueprint execution;
- metadata and structured-data generation;
- image optimisation;
- SEO, UX, accessibility, and conversion audits;
- immutable snapshot creation;
- publication preparation;
- domain verification;
- analytics synchronisation;
- booking-link health checks;
- monthly opportunity and page generation.

Phase 15.6A does not call OpenAI, Gemini, Claude, NotebookLM, Google, Vercel,
Cloudflare, IONOS, Plausible, PostHog, Search Console, or any other external
provider. It does not generate copy or images, publish a site, provision DNS or
SSL, or run analytics synchronisation.
