# Communications Phase 5 — internal calling

## Review status and dependencies

Implementation is on `codex/communications-phase-5`, [PR #250](https://github.com/kazshh786/ks-os/pull/250), stacked on the unmerged Phase 4 branch, [PR #248](https://github.com/kazshh786/ks-os/pull/248). Phase 4 base commit is `8327608a31a3eba84d5e9c9ed2998797857e6fe8`. Phases 1–4 remain prerequisites. This change does not merge or deploy the stack.

Branch chain: `main` → `codex/communications-phase-1` (#241) → `codex/communications-phase-2` (#245) → `codex/communications-phase-3` (#246) → `codex/communications-phase-4` (#248) → `codex/communications-phase-5` (#250). All five PRs remain open and unmerged.

**Verification: PENDING.** The checks below describe committed verification, not passing results. Record the final reviewed commit and successful GitHub run before changing this status. No application build, dependency installation, media service, or migration was run on the developer's computer. Production infrastructure and databases were not modified.

Application deployment target: **BOTH VPS + CLOUDFLARE**. Self-hosted LiveKit installation is an additional, separately approved infrastructure operation. Calling defaults to disabled.

## Implementation

The existing React/Vite workspace gains voice/video actions for direct messages, group conversations and internal channels, incoming invitations, an explicit pre-join screen, native meeting controls and conversation call history. Microphone and camera start off. Participants can preview/select devices, mute, change cameras, select audio output where supported, share a browser-provided screen/window/tab, focus shared content, inspect participants, minimize the call, leave their connection, or end/remove participants when authorized. Chat remains in the existing KSOS conversation; minimizing keeps that workspace usable, and meeting information links to chat in another tab.

The UI uses official `livekit-client` **2.23.0** with KSOS React components. The Fastify API uses official `livekit-server-sdk` **2.19.1** behind `LiveKitProvider`/`MeetingMediaProvider`; KSOS owns permissions, meeting records and events. The review-only container is pinned to LiveKit Server **v1.13.10**. No LiveKit Cloud, recording, transcription, Ingress or Egress service is introduced. Video capture defaults to 640×360 at 24fps with simulcast, adaptive subscriptions and dynacast.

Lifecycle events are `call.created`, `call.invited`, `call.accepted`, `call.declined`, `call.cancelled`, `call.started`, `call.participant_joined`, `call.participant_left`, `call.ended` and `call.failed`.

Invitations use the existing authorized `communication_events` journal and workspace subscription, with a 15-second refresh fallback. Incoming UI honors Do Not Disturb, conversation notification settings, direct-message preferences, and in-app/browser/sound choices. Browser notifications require existing permission; ringtone depends on browser autoplay policy. BroadcastChannel and server invitation state synchronize answers across tabs. Notifications do not activate devices.

## API

All paths below are relative to `/api/v1/communications/conversations`. Browser operations require an authenticated KSOS tenant session; the webhook instead requires a verified LiveKit signature.

| Method and path | Purpose |
| --- | --- |
| `GET /meetings/config`, `GET /meetings/incoming` | Calling availability/limits and eligible pending invitations |
| `GET /:conversationId/meetings` | Authorized history, 20 records per cursor page |
| `POST /:conversationId/meetings` | Create/reuse a call using `type` and UUID `requestId` |
| `GET /meetings/:meetingId` | Current state and participant history |
| `POST /meetings/:meetingId/invitation` | Accept or decline an invitation |
| `POST /meetings/:meetingId/join` | Revalidate access and return a short-lived, room-scoped credential |
| `POST /meetings/:meetingId/leave` | Revoke/disconnect the specified session owned by this authenticated session |
| `POST /meetings/:meetingId/end` | Organizer/conversation-manager termination for everyone |
| `POST /meetings/:meetingId/participants/:userId/remove` | Authorized removal of all that user's meeting connections |
| `POST /meetings/webhook` | Verify the original `application/webhook+json` body and reconcile provider state |

Responses are `no-store`. Room names and identities are generated on the server; clients cannot select them. Join responses contain a participant token, never the API key/secret or administrative grants. History does not contain credentials.

## Data, authorization and state

Migration **93**, `20261022100000_communications_meetings.sql`, adds `communication_meetings`, `communication_meeting_participants`, `communication_meeting_sessions` and `communication_meeting_webhooks`. Meetings reference existing tenants, conversations and users. Participant records have stable UUID identities and one internal-user record per meeting; individual device/join sessions link to that participant. Composite foreign keys, tenant checks, unique retry keys, one-live-call-per-conversation indexing, RLS and revoked direct browser table privileges complement API authorization. Webhook receipts keep only event ID, body digest and processing time, with seven-day cleanup; audio/video is not stored.

Every credential request rechecks the current KSOS session, active tenant/user, conversation membership/post permission, meeting state and removal state. Support sessions are excluded. Only the organizer or a current conversation OWNER/ADMIN may end a call or remove another participant. The organizer cannot be removed through the participant-removal operation. Conversation removal revokes meeting connections. Provider observations also check authentication expiry/revocation, security version, tenant/user status and membership before retaining a connected identity.

Lifecycle is `CREATED → RINGING → ACTIVE → ENDED`, with `CANCELLED` and `FAILED` terminal outcomes. Room provisioning makes the call ring; confirmed eligible provider participation makes it active. Invitations expire after two minutes. Direct-call decline cancels the call, including when the caller has already connected; an unanswered direct call also times out with a connected caller. Empty rooms, failed provisioning, caller cancellation and organizer termination have distinct saved reasons. Attendance and duration use observed participation/state times; they are not inferred from clicking Join. Delayed reconciliation can delay those recorded times.

Tenant transaction locks and database uniqueness serialize retry/concurrent creation. One live call is reused within a conversation. Call creation is capped at three per minute and ten per hour per actor. Initial invitation fan-out is bounded to 200 members; other eligible conversation members may join from the active call. The default connection limit is four, configurable from two to eight; each user may hold at most two simultaneous device/tab sessions. These are connection limits, not proven production capacity. Each join has an opaque UUID identity, so separate tabs do not replace each other's LiveKit identity. New sessions and all token issuances, including retries, have server-side limits.

Initial join tokens expire after 60 seconds and grant only joining, publishing and subscribing in one room. Data publishing and self-metadata changes are disabled. **Self-hosted LiveKit does not instantly revoke issued tokens**; it also refreshes connected-client tokens, so the replay window is not bounded by KSOS's initial 60 seconds. KSOS denies fresh credentials, evicts removed identities and reconciles current state, but a retained valid credential can briefly reconnect before another eviction. `room.auto_create: false` is required to prevent a retained token recreating a terminated room. Do not present this as instantaneous revocation or end-to-end encryption; media uses encrypted transport.

Webhooks use the official receiver, original body, authorization validation and digest-based duplicate/conflict handling. They trigger a fresh provider snapshot, so delayed events do not reopen terminal meetings or overwrite a reconnect with old state. Failed processing remains retryable. A bounded reconciler runs every 15 seconds in the API; `apps/api/src/cli/reconcile-meetings.ts` provides an operator entry point. Missing events, room deletion failure and unauthorized/recreated rooms are repaired when the API and provider are available. This is eventual recovery, not a guaranteed 15-second deadline during outages or backlog.

## Verification boundaries

| GitHub check | Committed coverage | Result |
| --- | --- | --- |
| Repository `verify` | Frozen install; build; repository lint command; typecheck; tests; migration plan | **PENDING** |
| Meeting API/database tests | Real PGlite migrations/queries, tenant and role boundaries, retry/rate limits, token grants, raw webhook tampering, state/order/recovery, participant/session removal and HTTP validation | **PENDING** |
| Native calling UI | Component tests plus Chromium desktop/mobile viewport checks and screenshots; permission/device errors, explicit consent, controls, invitations and lifecycle | **PENDING** |
| Real media | Two Chromium contexts with KSOS-issued tokens and the pinned self-hosted server; audio RTP received both directions, decoded camera/screen frames, controls, signalling reconnect, invalid token rejection, leave/end behavior and retained-token room recreation rejection | **PENDING** |
| Infrastructure template | Isolated, network-disabled runner container with temporary credentials/test TLS; pinned server parses config and serves health/metrics | **PENDING** |

Meeting artifacts are uploaded as `communications-meetings`, including screenshots and `media-verification.json`. The real-media harness uses synthetic devices and loopback networking. Native UI browser checks use controlled API/SDK fixtures; they are separate from the real-media harness. These checks do not prove production TLS, NAT, TURN, bandwidth, physical devices, Safari/iOS/Android, packet-loss tolerance, or capacity. The existing API/web `lint` scripts are echo placeholders; a successful repository lint step is not evidence of ESLint coverage.

The repository dependency audit remains failing on existing dependency paths (63 findings in the October 22 run: one critical, 32 high, 26 moderate, four low), including Astro, Fastify, Axios and image/build dependencies. No LiveKit dependency appeared in the high/critical findings. This is a release blocker requiring dependency remediation; the audit was not weakened. The Vercel integration is account-blocked, also present on Phase 4. CodeQL and secret scanning passed on the initial implementation; final-head checks remain required.

## Environment and release requirements

| Server variable | Requirement |
| --- | --- |
| `LIVEKIT_ENABLED` | Defaults to `false`; enable only after coordinated release verification |
| `LIVEKIT_URL` | Browser signalling `wss://` origin; loopback `ws://` allowed only for isolated tests |
| `LIVEKIT_API_URL` | Optional private HTTPS admin/control origin, or same-host loopback HTTP; separate from the public signalling-only proxy |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Server-only matching credentials; secret at least 32 characters; never `VITE_*` or committed production values |
| `LIVEKIT_MAX_PARTICIPANTS` | Default `4`, bounded `2–8` connections per room |

See [the infrastructure review and release plan](communications-phase-5-infrastructure.md) for inventory gaps, port/TURN conflicts, DNS/TLS, resource limits, monitoring, secret handling, Compose files and rollback. Public signalling proxies only the required RTC path; the control API remains private. Media/TURN must not be routed through an ordinary Cloudflare HTTP proxy. Existing Plesk/other application listeners must be inventoried before reserving addresses or ports; no free-port or VPS-capacity assumption has been verified.

The approved future migration sequence is the pending communications chain in manifest order: **89 foundation → 90 channels → 91 direct conversations → 92 files/search/notifications → 93 meetings**, accounting for the actual production ledger first. Rehearse against an isolated database with representative existing data, back up production, review locks and compatibility, then apply using the repository migration procedure. Do not use schema push. The existing automatic VPS production path uses `APPLY_MIGRATIONS=0`; it cannot perform the first communications release by itself.

After explicit approval, provision and verify the media layer, apply approved additive migrations, and coordinate the VPS API and Cloudflare frontend release. Verify two real users, private authorization, forced TURN, reconnects, removal, termination and history before enabling broadly. Keep history on rollback; disable new calls, drain/end active rooms, restore the reviewed application/configuration and use a forward database fix where necessary. Merely disabling calling does not remove active LiveKit participants.

Read-only Cloudflare verification on October 22 found production branch `main`; non-production builds use `pnpm run deploy:cloudflare:preview` (`wrangler versions upload`) rather than promotion. No deployment settings were changed. GitHub's production workflow remains main/manual only. These observations justify development-branch review under the present configuration, not future unreviewed workflow changes.

## Limits and Phase 6

This phase is internal, immediate calling. It adds no scheduling, recording, transcription, public meeting links, guest joining, waiting room, native mobile push/background calling, telephony or remote desktop control. Browser capabilities govern output selection and screen capture. Keep the workspace open; minimizing is supported, while leaving its calling surface ends the local connection. There is no multi-node/high-availability or production load-test claim.

Stable meeting, participant and session IDs and the media-provider boundary allow additive Phase 6 work. **Guest access is not implemented.** Current participants and sessions require internal users and KSOS authentication. Phase 6 must add tenant-scoped guest principals/invitations, guest session grants and lifecycle/permission rules, then deliberately relax or extend the internal-user constraints. It must not repurpose anonymous requests as internal users or expose room control. The existing conversation and media session identities can be retained while adding those relationships.

