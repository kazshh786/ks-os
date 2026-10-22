# Phase 6 deployment and operations

This is an unapplied release plan. Deployment classification is **BOTH VPS + CLOUDFLARE**: VPS changes provide scheduling, guest sessions, admission, capacity enforcement and email delivery; Cloudflare serves the workspace and public meeting interfaces. Development publication remains on `codex/communications-phase-6` in [PR #251](https://github.com/kazshh786/ks-os/pull/251), targeting `codex/communications-phase-5`. Do not merge or invoke production workflows as part of verification.

## Dependencies and infrastructure boundary

Phase 6 extends the existing Phase 5 meeting records and the same shared self-hosted LiveKit service. It does not provision one server, API key or database per business. Preserve the required `room.auto_create: false` server setting, public signalling/private control split, and short-lived participant tokens. See [the Phase 5 infrastructure review](communications-phase-5-infrastructure.md) for ports, TURN, Plesk conflicts, DNS-only media endpoints, container pins, TLS, monitoring and outstanding capacity measurements. Phase 6 does not authorize production infrastructure changes or certify those prerequisites as complete.

The initial guest route uses the existing application origin: `https://<configured-application-origin>/meet#invite=<opaque-invitation>`. The hostname is server-configured, not request-derived. The invitation fragment is not transmitted in the HTTP request to the frontend host. No new DNS record or meeting subdomain is required when the existing frontend route serves `/meet`; custom meeting domains and domain onboarding are outside this phase. Guest cookies use `SameSite=Lax`: serve the frontend and API on the same site, or through the existing same-origin API proxy. An unrelated cross-site frontend origin is not supported merely by adding it to CORS. Do not route WebRTC or TURN through an ordinary Cloudflare HTTP proxy.

## Server configuration

Keep existing Phase 5 `LIVEKIT_*` variables. Add:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_MEETING_ORIGIN` | Exact approved HTTPS application origin, without path/query/fragment or credentials. HTTP is limited to loopback tests. Controls generated invitation links and the public guest origin policy. |
| `MEETING_INVITATION_SECRET` | Server-only high-entropy secret of at least 32 characters. Derives domain-separated invitation, guest-session and CSRF credentials. Never expose through `VITE_*`, logs, fixtures or source control. |
| `MEETING_WAITING_MINUTES` | Initial waiting-session lifetime in minutes, default `15`, bounded to `1`–`30`. Admission extends the session to the meeting access-window end, while invitation expiry still applies. |
| `MEETING_DEFAULT_CONCURRENT` | Default simultaneous room allowance per tenant; initially `3`, bounded to `50`. |
| `MEETING_DEFAULT_GUESTS` | Default guest connection allowance; initially the configured room limit minus one, bounded by room capacity. |
| `MEETING_INFRA_MAX_ROOMS` | Shared infrastructure room limit; initially `8`, bounded to `100`. |
| `MEETING_INFRA_MAX_CONNECTIONS` | Shared infrastructure connection limit; initially `32`, bounded to `800`. |

These defaults are software ceilings, not tested VPS capacity or commercial packages. Validate lower operational limits against measured resources before enabling customer meetings. Tenant entitlements `meetings.concurrent`, `meetings.participants` and `meetings.external_guests` use the existing active plan/override records; they do not override shared infrastructure limits. Capacity reservations must run under the documented global-then-tenant transaction locks for both internal calls and client meetings.

Secret rotation invalidates derived invitation and guest credentials. Coordinate a rotation with outstanding invitations and active guest sessions, create replacement invitations where needed, and communicate disruption through the normal release process. Do not claim that key rotation or invitation revocation cryptographically revokes already-issued self-hosted LiveKit tokens. Existing media participants require explicit eviction/room termination and reconciliation.

## Email delivery

Meeting invitations, reschedules and cancellations reuse the existing `email_outbox`, Resend integration, verified sender and suppression list. `RESEND_API_KEY`, `EMAIL_BOOKINGS_FROM`, `EMAIL_SUPPORT_REPLY_TO` where used, and the existing authenticated outbox worker must already be configured for delivery. Copying an individual invitation without an email address does not enqueue email and does not require a delivery provider. Supplying an email uses the existing durable queue; `emailQueued` confirms enqueueing, not delivery. No new paid provider or live test send is needed during development.

The meeting queue stores only meeting/invitation IDs, meeting version and notification kind in template metadata. The existing outbox necessarily retains its recipient email and delivery audit fields; it does not store the usable invitation URL, HMAC, LiveKit token, title or guest session credential. The worker checks tenant scope/activity, meeting version/state, invitation recipient, revocation and expiry, the derived credential against its stored hash, and suppression immediately before rendering. It resolves current schedule/host/branding and derives the fragment link only in memory. Cancellation messages may follow invitation revocation and contain no join link. The existing delivery key prevents retry duplication for the same meeting/invitation/version/kind.

Only the configured delivery provider and intended recipient receive the rendered email, which contains a bearer invitation link. Do not use link tracking or analytics that collect invitation fragments; verify sender-domain tracking configuration before enabling invitations. Existing email-history APIs expose masked recipients and delivery status, not template data. Retain outbox records only under the existing email audit/retention policy; do not copy rendered bodies into meeting logs. No external mailbox delivery, spam-folder placement or real-device email-client rendering is claimed by GitHub template tests.

## Scheduling and appointment synchronization

Scheduling accepts local ISO time plus an IANA timezone and stores UTC start/end instants with that zone. Nonexistent daylight-saving times fail validation. Repeated times require an explicit matching offset, such as `2027-10-31T01:30+01:00` versus `2027-10-31T01:30+00:00` in Europe/London. Duration is elapsed time, including across clock changes. The utility supports 1–1440 whole minutes; public API contracts may apply narrower product limits. It does not replace the existing appointment/availability engine.

Meetings reference canonical tenant-owned clients and appointments. The appointment remains the scheduling authority when linked. The service compares the canonical appointment version during reads, invitation/admission/token boundaries and reconciliation. Cancellation, no-show, deletion or a changed customer association closes the linked meeting. Before a meeting starts, changed appointment time/host updates the meeting, increments its version and invalidates old admissions and invitations. Email-bound invitations receive replacement links; copied links must be redistributed. Once room preparation has begun, a time/host change cancels the meeting instead of silently moving live participants. The meeting service never writes changes back to the appointment and the active-appointment uniqueness constraint prevents duplicate meetings. A typed guest name or email is not verified CRM identity and must not automatically create, merge or claim a customer account.

## Migration and release sequence

1. Confirm the final Phase 6 GitHub commit, test artifacts and stack dependencies. Recheck that development publication cannot promote production under current automation settings.
2. Compare the production migration ledger with the complete manifest. Phases 1–5 introduce migrations 89–93; Phase 6 adds migration **94**, `20261022220000_communications_client_meetings.sql`. Rehearse all pending migrations against an isolated representative database, including existing internal calls and customer references.
3. Back up the database and review foreign-key validation, lock duration, indexes and rollback compatibility. Apply through the repository's reviewed migration runner, never schema push. The normal automatic VPS deployment uses `APPLY_MIGRATIONS=0`; it does not apply the new schema. Only an explicitly approved migration release may enable migration application.
4. Set the approved server variables, deploy the VPS API/worker and Cloudflare frontend as one coordinated release, and preserve the shared LiveKit configuration. Confirm `/meet` serves the public route and guest APIs use the intended origin/session protections.
5. Verify two independent organizations and multiple rooms: cross-tenant denial, copied/email invitation, waiting without a media token, host admission/denial, cancellation, removal/rejoin, expiry, schedule changes and customer history. Check real TLS/NAT/forced TURN and supported physical/mobile browsers separately from runner tests.
6. Monitor failed guest requests/admissions, join/token rates, expired sessions, reconciliation age, active room/connection counts, capacity rejections and email cancellation/dead-letter counts. Existing media CPU/network/certificate monitoring remains required. Avoid credentials and unnecessary customer metadata in diagnostics.

All steps above require the later coordinated release approval. None is an instruction to deploy automatically.

## Rollback and verification limits

Stop new invitations/admissions, end or drain affected rooms through authorized controls, and restore the reviewed application release/configuration. Preserve meeting history and guest admission audit records. Do not automatically drop the additive tables/columns. Prefer a forward repair, or a separately reviewed database restore if necessary. Restoring old application code alone does not revoke guest credentials or stop live media.

Use [PR #251](https://github.com/kazshh786/ks-os/pull/251) for the final reviewed SHA and complete check/evidence links. Required GitHub gates include build, lint, typecheck, copy audit, unit/integration tests including successful fixture teardown, the migration plan, browser flows and real-media verification. [Run 39870223504](https://github.com/kazshh786/ks-os/actions/runs/39870223504) provides successful build/lint/typecheck/copy/browser/media evidence, including the six-browser/three-room/two-tenant LiveKit scenario. Automated axe evidence covers 11 captured screens; it is not a complete manual accessibility audit. Passing assertions do not override a failed job or replace verification of the final commit. See the [verification scope](communications-phase-6.md#files-and-verification-evidence).

The [Security run 39868482232](https://github.com/kazshh786/ks-os/actions/runs/39868482232) completed secret scanning and CodeQL analysis successfully, but CodeQL reported open alert #216 on the opaque guest-session cookie; see the [independent disposition and residual risks](communications-phase-6.md#codeql-alert-216-review). The alert remains unchanged pending reviewer approval. The existing production dependency graph failed audit with 63 findings (1 critical, 32 high, 26 moderate, 4 low). That is a release blocker, not a waived check or a passing security result. Phase 6 introduces no additional dependency.

Unit/database/browser tests, template rendering and loopback LiveKit media are separate evidence categories. Synthetic Chromium devices and runner-local networking do not prove production firewall/TLS/TURN, concurrency capacity, real cameras/microphones, physical mobile Safari behavior or email deliverability. No production migrations, service restarts, deployments, DNS/firewall changes or email sends have been executed for this work.
