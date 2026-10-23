# Phase 8 push delivery and release operations

## Architecture and API

Existing `internal_notifications` is the only notification source of truth. Migration 97 enqueues eligible deliveries inside its insert transaction. A registration is an encrypted APNs/FCM credential bound to a verified device, platform, application and environment. An explicit device context selects one currently authorized staff membership or customer relationship; having a multi-business account does not opt every business into push.

Under `/api/v1/mobile/push`, all operations require the bearer session, explicit application context and validated `X-KS-Device-Id`:

| Route | Input/output |
| --- | --- |
| `GET /capabilities` | `{data:{enabled,voip}}` for this device/application/environment. |
| `GET /registrations` | Safe DTOs for this device, never tokens/hashes/ciphertext. |
| `PUT /registrations` | `{provider:"APNS"|"FCM",channel:"ALERT"|"VOIP",token}`. Re-register on foreground/token rotation. Same token refreshes activity; changed/revoked tokens advance version. |
| `DELETE /registrations/:id` | Revoke this device's registration and cancel pending work. |
| `GET /contexts` | Explicitly enrolled contexts on this device. |
| `POST /contexts` | `{}` for selected TENANT membership or `{relationshipId}` for CUSTOMER. Revalidates identity, current authority and security version; maximum 50 enabled contexts/device. |
| `DELETE /contexts/:id` | Disable only the owned context and cancel its queue. |

Inputs and safe response DTOs are exported from `packages/contracts/src/mobile-push.ts`. Device registration is separate under `/api/v1/auth/mobile`; see the authentication guide. Push defaults off in server preferences and requires explicit opt-in, provider configuration and OS permission. Web settings expose push, meetings, incoming calls and preview choice alongside existing DND/direct/channel settings. Server preference does not grant OS permission. Browser alerts remain the existing foreground implementation; service-worker Web Push is not added.

Dispatch checks current canonical notification, device/provider session and hard app expiry, account/security cutoff, active tenant/membership or customer relationship, exact conversation/meeting grant, preferences, message deletion/read cursor, call expiry and meeting version. It checks again after OAuth preparation immediately before delivery. Muted conversations, DND, mentions-only and direct-message preferences apply. Content previews default off; opting in adds only a sanitized conversation label. No message/document body, attachment URL, email, LiveKit token, access/refresh credential or signing key enters a push payload.

`push.types.ts` whitelists versioned opaque references: notificationId, tenantId, context, kind, optional relationshipId/conversationId/meetingId, and expiresAt. Native clients authenticate and resolve those references, fetch current state and reconcile badges. Chat, mentions, replies and file-sharing messages reuse chat events. Meeting invitations/updates/cancellations and incoming/missed calls reuse canonical meeting notices. MEETING_REMINDER has a delivery contract but there is no new reminder scheduler in this phase.

## Actual provider adapters

APNs uses TLS HTTP/2 and a cached ES256 provider JWT with the configured key/team. Bundle and SANDBOX/PRODUCTION environment must match the registered device. ALERT uses the bundle topic and `alert` push type; legitimate CALL_INCOMING can use the separately enabled `.voip` topic, `voip` type and zero expiry. Ordinary chat cannot use VOIP. Invalid-token responses are scoped to the original token version and, when supplied, APNs invalidation time. Retrying a provider error never logs its raw response or token. See [APNs request protocol](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns).

FCM uses a scoped service-account RS256 OAuth exchange and HTTP v1 `projects/{project}/messages:send`, not the legacy send API. OAuth refresh is cached/coalesced. Android package/environment match is mandatory. Ordinary notifications use NORMAL priority; incoming calls use HIGH, zero TTL and data-only references for the native calling handler. UNREGISTERED invalidates a token; generic INVALID_ARGUMENT does not. See [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api) and [error handling](https://firebase.google.com/docs/cloud-messaging/error-codes).

Provider transport tests generate ephemeral keys in GitHub and verify signatures, topics, environment, payloads, OAuth scope, priority, expiry and error classification through injected transports. They perform no real provider request. Actual delivery/lock-screen behavior requires approved app identifiers, entitlements, credentials and physical-device tests.

## Queue behavior, limits and privacy

The API's bounded worker runs every five seconds only when enabled and configured. It claims at most 20 rows with SKIP LOCKED, uses four concurrent sends and three-minute leases, and records attempts. HTTP/OAuth runs outside database transactions. Expired leases recover after restart. At most six attempts use exponential backoff with jitter and provider Retry-After; expired work is discarded. Generic messages expire after 24 hours, call expiry is shorter and rechecked. Token registration/version changes cannot be erased by a late response for an older token. At most one canonical notification/registration delivery exists.

This is best-effort delivery. APNs/FCM acceptance is not display, receipt or read proof. A crash after provider acceptance but before acknowledgement can retry; client deduplication uses notificationId, and providers receive stable notification/collapse references where supported. A revoke between final authorization and external handoff cannot recall that in-flight request. Queued work is denied after revocation; provider-accepted or already displayed alerts cannot be remotely erased. Clients must reauthorize on open and never trust an alert as admission.

Per-account/context HTTP budgets supplement existing global abuse protection; message sends, uploads, call creation/join, sync, device and token/context changes have bounded rates. Existing tenant/message/file limits and queue concurrency bound resource use. The queue uses existing PostgreSQL, not a new broker. Test future production volumes and fairness before scaling worker counts. Presence and process-level rate limits need a shared adapter before a multi-process API rollout.

Push ciphertext uses existing AES-GCM `INTEGRATION_ENCRYPTION_KEY`; hashes deduplicate without exposing tokens. Device revoke clears ciphertext, disables contexts and cancels work atomically. Hourly maintenance revokes token registrations inactive for 90 days and deletes terminal deliveries/attempts after 30 days. Native apps should refresh registration when active. Device revocation tombstones remain to prevent old signed JWTs from becoming ordinary unregistered sessions; do not erase them independently of identity/session deletion. Device/queue FKs cascade on provider-account/tenant removal. Coordinate account deletion with existing identity erasure and retention policy; no claim of complete GDPR compliance is made.

API logs redact token/installation/device headers and retain existing auth/body privacy. Worker logs only numeric batch outcomes and sanitized internal codes. Provider references and attempts are API-role-only tables under RLS; no public metrics endpoint is introduced. Monitor through the existing privileged operations tooling: oldest due/processing age, pending/retry/failed/expired counts, accepted rate, invalid registrations, attempt counts, active devices, API latency/error codes for sync reset/auth/link/join, and provider refresh failures. Do not export user IDs/tokens/message content as metric labels. Alert on sustained queue age or configuration errors; acceptance counts are not delivery-rate claims.

## Reviewed deployment plan — not executed

Classification: **BOTH VPS + CLOUDFLARE**. The API/worker and migration functions need a VPS release; web settings and `/open` fallback need the matching Cloudflare asset/Worker release. Native domain association files will require a later approved domain change. Existing LiveKit server/TURN and private attachment infrastructure are reused. No VPS, database, Cloudflare setting, provider credential or production workflow has been changed by Phase 8.

Branch dependency: `codex/communications-phase-8` is based on `codex/communications-phase-7` (PR #252), preserving Phases 1–7. PR #253 targets Phase 7. Do not retarget/merge to main or dispatch production jobs as part of verification. The reviewed GitHub production workflow accepts main only; Cloudflare production branch is main and nonproduction builds use `wrangler versions upload`, which uploads an unassigned version. Recheck those controls if automation changes before further publishing. Vercel is obsolete and excluded.

Apply the entire reviewed prior-phase migration chain first, then these manifest entries in order during a separately approved release:

| Manifest | Migration | Main additions |
| --- | --- | --- |
| 96 | `20261023060000_mobile_device_sessions.sql` | Immutable app hard expiry; mobile device/session identity; owned provider-session lookup/revoke functions; private access and binding indexes. |
| 97 | `20261023070000_communications_mobile_push.sql` | Preference/meeting-notification fields; encrypted registrations, explicit contexts, durable deliveries/attempts; unique notification/registration and token indexes; queue/lease indexes; transactional enqueue and revoke triggers; RLS. |
| 98 | `20261023080000_mobile_sync.sql` | Commit-ordered journal position, tenant counter/replay floor, backfill/index and deletion floor trigger. |
| 99 | `20261023090000_communications_native_calls.sql` | Persisted answering provider session/request and MISSED participant outcome. |

These are additive reviewed source migrations, not applied production migrations. Rehearse with representative staging data and the actual Supabase Auth schema/function owner privileges. Verify no anon/authenticated execution of private functions or token-table access. Check lock/backfill duration and backup/restore procedures before scheduling release. GitHub migration-plan success alone does not validate provider table ownership on the production project.

| API environment | Requirement |
| --- | --- |
| `MOBILE_APPLICATIONS_JSON` | Explicit per-platform application/environment/callback allowlist; omit until actual IDs exist. |
| `MOBILE_SYNC_CURSOR_KEY` | Independent 32-byte random secret encoded as 64 hex characters; server-only, same on API replicas. Rotation invalidates cursors safely. |
| `MOBILE_LINK_ORIGIN` | Approved HTTPS web origin, no path/query/credentials. |
| `INTEGRATION_ENCRYPTION_KEY` | Existing 64-hex encryption key; preserve through releases. Rotation needs ciphertext migration or deliberate re-registration, not silent replacement. |
| `MOBILE_PUSH_ENABLED` | Default disabled; set true only after controlled provider/device validation is approved. |
| `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_ENVIRONMENT` | Actual Apple signing configuration; environment SANDBOX or PRODUCTION. No committed .p8 file. |
| `APNS_VOIP_ENABLED` | Enable only with a genuine native calling implementation and reviewed PushKit/CallKit integration. |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `FCM_APPLICATION_ID`, `FCM_ENVIRONMENT` | Least-privileged Firebase HTTP v1 service-account credentials and matching Android application/environment. No committed service-account JSON. |

The current config supports one APNs application/environment and one FCM application/environment per API deployment; isolate sandbox from production. Dynamic per-tenant provider accounts/white-label app fleets are not supported. No additional dependency packages or external paid queue products are required. All secrets remain on the API, never Cloudflare frontend variables. Permit API outbound TLS to APNs HTTP/2, Google OAuth and FCM; keep existing Supabase/LiveKit connectivity. Do not change firewall or credentials in development.

Approved rollout sequence: rehearse migrations and provider revocation on staging; retain push disabled; deploy compatible API then frontend; verify authorized staff/customer lists, preferences, sync reset/replay, links, badge reads, native waiting-room denial/admission and media revocation; configure app credentials/association files only after review; test explicit staging devices; enable narrowly and monitor queue lag/errors. No automatic real push or email smoke test is authorized by this document.

Rollback: disable `MOBILE_PUSH_ENABLED` first and stop new enrollment through allowlist removal if needed; preserve queue/history and additive database columns. Roll back frontend before incompatible API changes, or prefer a forward fix. Do not drop migrations, erase revocation tombstones, rotate encryption keys or delete provider sessions en masse to roll back. Disabling push does not revoke already issued media credentials or remove already displayed alerts. Use existing authorized session/meeting controls for a targeted incident, and retest before re-enabling.
