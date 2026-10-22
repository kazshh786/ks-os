# Communications Phase 6: business meetings and guest admission

Phase 6 extends the Phase 5 self-hosted LiveKit integration into tenant-owned scheduled internal and customer meetings. It reuses the existing users, tenants, clients, appointments, capabilities, email outbox, branding and communications event stream. Each meeting has its own opaque LiveKit room on the shared service. No production migration or deployment is part of this implementation.

The development stack depends on Phase 5 at `ff73acc5035c45b0ca184a93bc843a4744a2d4a7` and its unmerged Phase 1–4 ancestry. Keep the Phase 6 changes reviewable against Phase 5. **Verification is pending until the final GitHub checks pass**; the test inventory below is not a claim that every case has passed.

## Product surfaces

- `/app/meetings` provides upcoming, today, active, completed and cancelled views, title search, host/customer/date/status filters and pagination.
- Meeting creation and details support internal/external audience, separate audio/video type, host, co-hosts, explicit staff attendees, customer and optional appointment, UTC-backed scheduling, rescheduling, cancellation, start/join, attendance history and guest controls.
- Customer details link to the same tenant-scoped meetings and their details; this is a meeting history panel, not a second CRM or calendar.
- `/meet` provides the public business-branded landing page, local device preview, name entry, waiting status and admitted media interface without KSOS workspace navigation or account creation.
- Workspace updates use the existing communications connection and authorized replay. The public waiting session polls its narrow session endpoint; guests do not receive the internal event stream.

## Persistence and lifecycle

Migration **94**, [`20261022220000_communications_client_meetings.sql`](../packages/database/migrations/20261022220000_communications_client_meetings.sql), builds on migrations 89–93. It is registered in the existing manifest and has not been applied to production.

| Resource | Phase 6 changes |
| --- | --- |
| `communication_meetings` | Nullable conversation for independently scheduled meetings; audience, description, host, UTC schedule, IANA timezone, canonical client/appointment references, appointment version, optimistic version, mandatory waiting-room policy, guest screen-sharing policy and request fingerprint. Existing room identity and actual attendance timestamps remain authoritative. |
| `communication_meeting_participants` | Existing stable participant UUIDs support internal users and guest display names. Internal roles are organizer, co-host or participant; guest principals have a separate guest role. |
| `communication_meeting_invitations` | Individual random invitation UUID, hash of the complete derived bearer token, optional bound delivery email, expiry, revocation and claim audit, plus idempotency request ID. |
| `communication_meeting_guests` | One waiting/admission session per individual invitation, guest participant identity, hash of its credential, expiry, decision state and deciding staff member. |
| `communication_meeting_sessions` | Existing provider identities and connection history gain an exclusive internal-user or guest-session principal. Composite foreign keys bind guest, participant, meeting and tenant together. |
| `communication_events` | Optional meeting relationship for scheduled-meeting and guest lifecycle invalidations without a conversation. |

New guest/invitation tables enable RLS and revoke direct `anon`/`authenticated` access. Access runs through the tenant-aware API. Existing meeting user-scope validation is extended to host, customer and appointment references; composite keys protect the principal relationships. Schedule, customer history, capacity, invitation, waiting-session and event-replay indexes support the added query paths. No existing customer data is copied into a new customer model.

| Stored status | Meaning |
| --- | --- |
| `SCHEDULED` | Scheduled record; no room or attendance implied. |
| `CREATED` | A capacity slot is reserved while LiveKit room creation is in progress. |
| `RINGING` | Room is ready to join. This reuses the Phase 5 state rather than adding a competing READY field. |
| `ACTIVE` | Authorized provider participation has been observed; actual start is recorded. |
| `ENDED` | Completed meeting with end time/reason and retained history. |
| `CANCELLED`, `FAILED`, `EXPIRED` | Terminal closure, provider failure or expired access window. |

Starting and opening the waiting room are permitted from 30 minutes before the scheduled start. The meeting access window ends 30 minutes after the scheduled end. Scheduling accepts 5–480 minute meetings within the next year, subject to the canonical appointment when linked. Tokens and previews do not mark participation. Signed provider webhooks and the existing reconciliation loop observe attendance, remove unauthorized participants and retry room cleanup.

## Authorization and tenant isolation

The authenticated session supplies the tenant and staff identity. Requests cannot choose an arbitrary tenant. `MEETINGS_VIEW_OWN`, `MEETINGS_VIEW_ALL`, `MEETINGS_CREATE` and `MEETINGS_MANAGE_ALL` extend the existing capability/profile/override system. Owners have all capabilities; practitioner defaults permit their own meetings and creation, while receptionist/manager defaults also permit viewing all tenant meetings. Meeting-wide management can be explicitly granted through the existing overrides.

The creator, host and invited co-hosts can manage a meeting they can access. Viewing or managing a tenant meeting does not grant media attendance: staff must be explicit participants to obtain a token. Support-mode access is rejected. CRM details and customer-filtered history additionally require the relevant customer capability; appointment selection respects existing booking visibility. Public responses contain a narrow business/meeting projection, without private CRM details, the staff directory, internal invitations or a room name.

Capacity-changing operations use the same global-then-tenant transaction locks for Phase 5 conversation calls and Phase 6 scheduled meetings. Guest admission, revocation, cancellation and token issuance are serialized under these locks; issuance reloads current principal, invitation, meeting and appointment state. Database constraints supplement these service checks. The global lock favors correctness at the current scale; higher-throughput capacity reservation would require a measured redesign, not removal of the invariant.

## Individual invitations and guest sessions

The configured frontend serves `https://<approved-origin>/meet#invite=<id>.<mac>`. The UUID is random, the HMAC is domain-separated using the server-only `MEETING_INVITATION_SECRET`, and the database stores the complete token's SHA-256 hash. URLs do not contain tenant/customer names, room names or LiveKit tokens. The fragment is removed from browser history after the page reads it and is never sent as part of the frontend HTTP URL. Use only the server-configured `PUBLIC_MEETING_ORIGIN`; unverified custom domains are outside this phase.

Each invitation is an **individual claim**, not a reusable public room link. The first valid admission request creates one guest session; retrying the same request is idempotent, while a different claimant cannot consume it again. A typed display name and possession of the invitation are not proof of real-world or CRM identity. An email-bound invitation determines the delivery recipient; it does not implement an email-verification challenge.

The API installs a path-scoped, HttpOnly cookie with Secure in HTTPS environments and SameSite=Lax. Guest mutations also require the configured origin and a separate CSRF token. The frontend keeps only session ID, CSRF and request ID in tab-scoped session storage for refresh recovery; the usable cookie credential is not readable by JavaScript. Invitation tokens and media grants are not persisted in browser storage. Missing/expired credentials require a new invitation when the original has already been claimed.

Guest sessions begin as `WAITING`. They receive no LiveKit token and connect to no media room until an authorized host/co-host/manager admits them. The initial waiting expiry defaults to 15 minutes and is configurable. Approval extends the admission session to the meeting access-window end, still bounded by the invitation's expiry. Denial, invitation revocation, removal, cancellation and expiration prevent fresh tokens. Leaving the waiting room cancels that waiting session. Leaving after admission revokes the media connection but permits a new connection under the same still-valid admission; one guest media connection is allowed at a time. A removed or denied guest needs a replacement invitation and fresh admission.

Room-specific provider tokens have a 60-second issue window and opaque unique session identities. Guests receive no room administration grant, and screen sharing is off unless explicitly enabled for that meeting. Revocation removes connected identities and is enforced again during provider observation. Self-hosted LiveKit cannot cryptographically revoke every already-issued token: a retained token can remain usable briefly until expiry/eviction/reconciliation. `room.auto_create: false` prevents old credentials from recreating a deleted room. Higher-assurance immediate re-entry prevention would require room termination/rotation; do not describe participant removal alone as instantaneous token invalidation.

## Scheduling, appointment synchronization and branding

Local ISO wall time plus an IANA timezone resolves to UTC instants. A nonexistent daylight-saving time is rejected; a repeated time requires a matching explicit offset. For example, the two Europe/London occurrences of `2027-10-31T01:30` require `+01:00` or `+00:00`. The UI presents disambiguation choices. Duration is elapsed time in UTC. The existing tenant timezone supplies the default.

A linked appointment remains authoritative for time and host. The service compares its version during reads, invitation/admission/token boundaries and reconciliation. Missing/cancelled/no-show appointments or changed client relationships cancel the meeting. Time/host changes update a still-scheduled meeting and increment its version; once room preparation has started, they cancel it instead. Edits and appointment reschedules invalidate previous guest admissions, revoke old invitation links and create replacement links with the new schedule window. Email recipients receive the current replacement; copied invitations must be redistributed. The meeting service never writes back into the appointment, and the database prevents duplicate non-cancelled meetings for one appointment. See the [release plan](communications-phase-6-deployment.md) for operational sequencing.

Branding resolves from the meeting tenant's existing business/email/booking branding. Public responses include only display name, validated raster logo URL, validated colors and a derived welcome message. They do not expose contact/address settings. The interfaces retain readable foreground colors, fallback initials and KSOS privacy notices; HTML/SVG assets are not accepted as meeting logos. Existing template rendering escapes user text. No separate logo upload store or custom-domain onboarding has been added.

## APIs and integration points

All staff routes below are under `/api/v1/meetings`; public routes are under `/api/v1/public/meetings`.

| Method/path | Purpose |
| --- | --- |
| `GET /config`, `GET /` | Authorized configuration, eligible references, tenant meeting search/history and cursor pagination. |
| `POST /`, `GET /:meetingId`, `PATCH /:meetingId` | Idempotent creation, details and version-checked scheduled editing. |
| `POST /:meetingId/start`, `/cancel`, `/end` | Host lifecycle operations. |
| `POST /:meetingId/join`, `/leave` | Explicit staff participant media grants and connection departure. |
| `GET /:meetingId/waiting` | Authorized waiting-room management projection. |
| `POST /:meetingId/guests/:guestId/admission` | Idempotent approve/deny decision under current authorization. |
| `POST /:meetingId/participants/:participantId/remove` | Remove staff/guest attendance and evict provider sessions. |
| `POST /:meetingId/invitations`, `/:meetingId/invitations/:invitationId/revoke` | Create/copy/optionally email an individual invitation, or revoke it. |
| Public `POST /resolve`, `/request` | Validate invitation and create a limited waiting session. |
| Public `GET /sessions/:sessionId` | Current guest status and safe meeting projection. |
| Public `POST /sessions/:sessionId/join`, `/leave` | Approved guest media grants and departure with cookie/origin/CSRF checks. |

Existing Phase 5 conversation-call routes, the signed webhook endpoint and reconciliation remain shared. Workspace replay scopes meeting events to current tenant capability and meeting relationship; public guests receive no staff replay permission. Route/body limits, request-rate limits, per-participant token limits and invitation/waiting caps complement capacity enforcement.

Invitation, reschedule and cancellation email reuse `EmailService`, the durable outbox, suppression checks and existing sender branding. Queue metadata contains only meeting/invitation IDs, meeting version and notification kind. The worker rechecks authoritative tenant, recipient, state/version, revocation, expiry and key-derived hash before generating the bearer URL in memory. Cancellation carries no join URL. Copy-only invitation creation needs no email provider. Queue acceptance is not delivery confirmation. See [email setup and retention requirements](communications-phase-6-deployment.md#email-delivery).

## Capacity and future extension

Existing plan entitlements/tenant overrides provide `meetings.concurrent`, `meetings.participants` and `meetings.external_guests`. Tenant limits cannot exceed shared infrastructure or provider ceilings. Default tenant concurrency is 3 rooms, shared concurrency is 8 rooms and shared connection capacity is 32; the existing provider defaults to 4 connections per room with a hard maximum of 8. These are configurable ceilings, **not load-tested production capacity or a subscription packaging commitment**. Staff devices count separately and approved guests also have an admission cap. Pending unexpired media grants reserve connection capacity before media arrives.

Stable participant/session UUIDs, audience, principal constraints and canonical customer/appointment links preserve room for later verified guest identity, custom domains, reminders, usage billing and richer customer history. Those features require additional policy and tests. This phase does not implement recording, transcription, native push, verified customer identity, a customer portal, public booking/availability, payments, full external calendar synchronization, a separate media service per business or subscription billing for meetings.

## Files and verification evidence

Main implementation areas:

- API: `communications.client-meetings.ts`, its routes, and meeting time/secrets/policy/branding/delivery helpers; Phase 5 meeting observation/capacity and authorized communications replay integration.
- Persistence/auth: migration 94 and manifest/schema mappings, shared contracts and meeting capabilities.
- Frontend: `features/meetings/` dashboard/forms/details/invitations/waiting/public page/CRM panel; reuse of `features/calls/` devices and media window, workspace routing/navigation and communications events.
- Email: `meeting-email-policy.ts`, reference-only enqueue/worker integration, registered `meeting-notification` React Email template and accessible layout title/language support.
- Operations: this report and [`communications-phase-6-deployment.md`](communications-phase-6-deployment.md).

Prepared GitHub verification includes strict time/DST cases, outbox idempotency and secret minimization, template rendering/escaping, tenant-scoped service/database behavior, current authorization, waiting/admission/revocation/expiry, appointment synchronization, true PostgreSQL concurrency races, browser guest/workspace flows and isolated real LiveKit media across three simultaneous rooms in two organizations. Existing Phase 5 regression tests, typechecking, linting and builds must also pass on the final published commit. A skipped media/race test is not evidence of a pass.

At this report revision, those checks are **PENDING**. No local install/build/test or real email send has been used as verification. Runner-local synthetic Chromium media does not establish production TLS, NAT, TURN/firewall routing, hardware device behavior, mobile Safari quality, production capacity or mailbox deliverability. Keep those as explicit release acceptance work.

Deployment classification is **BOTH VPS + CLOUDFLARE**. The [release plan](communications-phase-6-deployment.md) records variables, cookie/origin requirements, pending migrations, LiveKit dependencies, rollout order, rollback and unverified infrastructure boundaries. Do not merge, apply migrations or deploy without the later explicit approval.
