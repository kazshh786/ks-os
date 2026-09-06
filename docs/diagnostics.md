# Diagnosing KS OS

## Start from the affected screen

Open **Diagnose this screen**. The tab keeps its latest 100 request, response-decoding and browser failure events. Copy the report before reloading. Match its request or correlation reference in **Agency → Operations → System issues**. Request IDs are server-generated UUIDs, unique across restarts; the browser carries a correlation ID through a session-refresh retry. Callers can supply a correlation ID to group related requests.

Browser evidence is intentionally tab-local and bounded. It is not a durable telemetry backend and does not automatically upload visitor activity. Reports retain status, timing, references, conservative failure categories and available application bundle locations. They omit page URLs, query values, request bodies, exception messages, credentials and customer details. An unknown category means there is insufficient evidence; it is not a root-cause conclusion. Missing source frames require investigation using the deployed bundle and browser developer tools.

## Explain missing results

Reader availability in both checkout flows distinguishes loading, a failed lookup, a successful empty result, options that fail readiness checks, and usable options. **Why is the reader option available or unavailable?** shows the expectation, observed state, reason and last successful check. Refreshing reader availability does not replay a payment. The shared `diagnoseResource` model also supports unknown and stale evidence for future consumers; stale status is not inferred from an arbitrary universal timeout.

An empty array must only represent a successful empty result. Optional dependency failures can leave the rest of a page usable, but must preserve failure evidence. Do not replace a failure with fabricated success data.

## Inspect a workflow

The System issues page includes **Inspect a website job's expected flow**. Enter the public job reference to view:

- recorded state and its expected next outcome;
- permitted transitions from the existing job state machine;
- lease expiry, last heartbeat, update age and eligibility delay;
- latest 20 events, with deterministic ordering;
- recovery guidance and explicit evidence limits.

The endpoint `/api/v1/agency/site-jobs/:jobReference/diagnostics` requires the existing `sites.jobs.read` capability before reading any job data. It exposes no payloads or lease credentials. The state and event reads are separate snapshots and can differ while a job advances. A queue delay over one minute is a triage signal, not an SLA violation or proof of worker failure. A completed generation job does not prove publication or display has completed. Never interpret cancellation requested as cancellation completed.

## API evidence and recovery

Thrown failures and direct error responses pass through central evidence capture, without duplicate inserts for thrown failures. Existing capture exclusions and support permissions remain in force. Source stacks are recorded only when available; a direct response is marked `HandledResponseError` rather than attributing its failure to the logging hook. Unmatched routes use a fixed label so credentials in URL paths are not copied into the ledger.

Evidence includes the sanitised cause chain (maximum five, cycle-safe), request and correlation references, expected request outcome and conservative recovery advice. Set `GIT_SHA` or `COMMIT_SHA` in the API runtime to associate records with a release; otherwise the release is explicitly `unknown`. No database migration is required: additions use the existing private context field. Existing records lack these additions and display honest fallbacks.

Capture waits at most 250 ms and allows at most eight outstanding inserts per application instance. Timed-out work retains its slot until it actually settles, preventing an outage from accumulating unbounded background work. A failed, timed-out or saturated capture emits `ERROR_EVIDENCE_UNAVAILABLE` with sanitised original evidence to application logs. A timeout does not cancel the database write; it may finish later. Monitor this event in the deployment's log service and retain those logs independently of the application database. This PR does not configure a hosted log sink or alert destination.

`retryable` is deliberately restricted to safe reads. Failed writes require checking their actual outcome; an idempotency key is not assumed merely because an operation has one in some other flow. Existing booking/payment idempotency and reconciliation rules remain authoritative. HTTP 409 calls for refreshing state, 429 for waiting, and session/permission errors have distinct actions. No automatic payment replay is introduced.

## Implementation conventions

- Keep existing `fetchWithAuth` Response semantics. It now records timing and references without consuming response bodies. Its header timeout defaults to 120 seconds and is configurable per request; caller cancellation continues to apply during body consumption.
- Prefer `requestJson` for non-streaming JSON operations. It bounds decoding time to 30 seconds and response size to 8 MiB, rejects malformed responses, and preserves structured error metadata. It does not perform domain payload validation: validate the expected shape or schema at the consumer boundary.
- Use `responseError(response, fallback, parsedBody)` when preserving an existing specialised parser. Legacy domain-code messages are preserved exactly. The data provider and both POS consumers now retain diagnostic references; public data-provider calls use a separate tracing wrapper carrying no auth/support information.
- Browser failures must never trigger a page refresh just because they contain a generic network error. Deployment recovery is limited to recognised module/chunk errors.
- Diagnostics are evidence, not authorisation. Existing server-side capabilities and tenant boundaries always control access and actions.

## Verification

Regression tests cover read/write recovery, request/correlation references, cancellation, header timeout, malformed responses, bounded/redacted browser evidence, reader races and workspace changes, render fallback, evidence timeout/concurrency recovery, cause cycles, direct-response capture and workflow capability enforcement. Keep API, web and shared-contract type checks, web build, existing error/job tests, and the UI copy audit passing.

Roll out additional domain-specific expectations using the actual domain rules, rather than inventing a second state machine in the diagnostics layer. Booking, publication, communications and authentication retain their existing workflow rules; this PR adds the shared instrumentation plus explicit reader and website-job inspectors, not a universal inferred root-cause engine.
