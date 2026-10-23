# Communications Phase 8: native client foundation

Phase 8 extends the Phase 7 branch. Web and future iOS/Android clients share Supabase identity, KSOS tenant/customer authorization, conversations, files, canonical notifications and the existing self-hosted LiveKit server. No native app, new identity store, second messaging service, Redis, LiveKit Cloud or production deployment is included.

## Repository findings and implementation

The reviewed Phase 7 source already has bearer-authenticated staff/customer APIs, cursor-paginated messages, client-message deduplication, optimistic edits, monotonic read positions, scoped WebSocket tickets, multiple presence leases, private attachment streaming, client branding and explicit guest admission. Browser notifications use the foreground Notification API; there was no APNs/FCM service or durable mobile push queue. Customer media admission depended on browser cookies/Origin/CSRF. Existing realtime IDs alone did not guarantee commit-ordered catch-up, and call acceptance did not choose one provider session atomically.

The implementation adds provider-bound mobile devices, encrypted push registrations and an outbox derived from existing notifications, a commit-ordered sync cursor, badge reconciliation, authenticated link resolution, and atomic call answers. Native customers use their registered bearer session to access the same guest/waiting-room service. Browser controls remain compatible. Shared Zod contracts live in `packages/contracts`; the API retains its existing Fastify framework.

Read [authentication and device management](communications-phase-8-mobile-auth.md), [push and operations](communications-phase-8-push.md), and [native calls](communications-phase-8-mobile-calls.md) with this API guide. No Apple, Firebase, native signing or associated-domain values are invented.

## Native request contract

Use HTTPS and the existing bearer access JWT. Set `X-KS-Application-Context: TENANT` or `CUSTOMER` explicitly; send `X-KS-Device-Id` after registering the provider session. Use the current staff workspace membership selection flow, or the exact customer relationship path. Never derive authority from a tenant ID, device ID, link, cached role or notification.

Staff conversation prefix **S**: `/api/v1/communications/conversations`.
Customer conversation prefix **C**: `/api/v1/customer/collaboration/:relationshipId/chat`.
Both use the same services. Customer channels are explicitly granted external CLIENT channels; customers cannot discover internal channels or manage staff membership.

| Operation | Route under S or C | Contract |
| --- | --- | --- |
| Discover features | `GET /capabilities` | Existing entitlements plus `mobile.apiVersion=1`, incremental sync availability, badges, device sessions, links, idempotent submissions and atomic answers. Background WebSocket is not required. |
| List/get channels | `GET /`, `GET /:conversationId` | Existing `NativeConversationQuerySchema`; follow returned cursor. |
| List/get messages | `GET /:conversationId/messages`, `GET /:conversationId/messages/:messageId` | `NativeMessageQuerySchema`; positions are decimal strings, never floating-point JS numbers. `parentMessageId` retrieves a thread. |
| Send/retry | `POST /:conversationId/messages` | `CreateNativeMessageSchema`: stable client-generated UUID `clientMessageId`, body, optional parent/mentions/attachment IDs. Same operation returns the same message; changed content/files returns `409 RETRY_CONFLICT`. |
| Edit/delete | `PATCH`/`DELETE /:conversationId/messages/:messageId` | Edit includes `expectedUpdatedAt`; stale edit returns `409 MESSAGE_CHANGED`. Fetch current state and ask the user to resolve it. Delete is an authorized tombstone, not an offline merge. |
| Reactions/read | `PUT /:conversationId/messages/:messageId/reactions`, `POST /:conversationId/read` | Reaction `{emoji,active}`; read `{messageId}` advances monotonically. Duplicate read requests emit no duplicate progress event. |
| Notification history/read | `GET /notifications`, `POST /notifications/:notificationId/read` | Paginated canonical history; idempotent read. Meeting notices may have a null conversation ID and a `meetingId`. |
| Preferences | `GET`/`PUT /preferences`, `GET`/`PUT /:conversationId/notification-preference` | Existing preferences plus optional push, meetings, incomingCalls, contentPreviews. Omitted new fields preserve stored values for older web clients. Channel mode ALL/MENTIONS/NONE. |
| Reconnect | `GET /sync?cursor=...&limit=100` | Top-level `MobileSyncResponseSchema`, described below. |
| Badge reconciliation | `GET /badges` | `{data: MobileBadgesSchema}`; current authorized counts. |
| Links | `POST /links`, `POST /links/resolve` | `CommunicationLinkTargetSchema` / `{url}`; returns authorized target and same-site web fallback, no media token or admission. |

Staff discovery/channel management, search, roster and meeting endpoints remain the Phase 2–7 APIs; permission failures are expected for customer principals. Read schemas in `native-communications.ts` and `client-meetings.ts` for full fields. API errors retain machine codes and HTTP status: 401 renew once or sign in; 403/404 purge inaccessible resources; 409 refresh and reconcile; 410 sync reset; 429 honor retry delay with jitter; 503 back off and show temporary unavailability. Disabled features must remain hidden until capability discovery succeeds. Do not turn authorization failures into endless retries.

## Snapshot, incremental sync and offline state

1. Authenticate/select context, then call `/sync` without a cursor. It returns `mode=SNAPSHOT_REQUIRED` and a fence cursor, with no message bodies.
2. Clear that context's cached authoritative lists. Paginate authorized conversations, recent messages, notifications and meetings using existing APIs. Preserve unsent drafts separately, encrypted and scoped to the account/context; never display them under another account.
3. Replay from the fence cursor until `hasMore=false`. Each change carries `id`, commit-ordered `position`, type, opaque resource IDs and `REFRESH` or `PURGE_CONVERSATION`. Fetch changed resources through authorized APIs; an absent/deleted resource is a removal. Purge a removed conversation including files/drafts pending explicit user handling. This closes the race between snapshot pagination and concurrent changes.
4. Store each returned cursor atomically with applied changes. Duplicate references are safe to reapply. An empty visible page can still have `hasMore=true`: advance the cursor because the server scans and filters a bounded tenant batch.
5. On foreground/network recovery, refresh credentials, reselect the context, obtain a new one-use realtime ticket, establish the authorized WebSocket, then sync and reconcile badges. Treat live events as refresh hints and debounce sync; never substitute a legacy WebSocket event ID for a sync cursor. Periodic sync while foregrounded repairs drops/duplicates.

Migration 98 serializes a per-tenant counter through event transaction commit. This avoids a late commit with a lower sequence ID falling behind an already issued cursor. It reuses `communication_events`; no second event store exists. Cursors use authenticated encryption, bind tenant/principal/auth identity/context and expire after seven days. They deliberately survive refresh/new sessions of the same authorized principal, but never confer access. Current membership and exact customer meeting grants are checked on every replay. Old hidden events advance the scanned cursor without exposing bodies or unrelated references.

`410 SYNC_RESET_REQUIRED` covers expired, tampered, key-rotated, pruned and impossible cursors. Discard the cursor and repeat the full snapshot flow. `403 SYNC_CONTEXT_MISMATCH` means the wrong account/business cache was selected. A whole-context 401/403 clears the context and disconnects subscriptions. Individual membership removals produce a purge hint where available; authorization is enforced even if the hint was missed.

Retain the event journal for at least seven days for normal catch-up. There is no new automatic journal purge; approved maintenance must use bounded DELETE batches, not TRUNCATE or disabled triggers. The deletion trigger advances a replay floor, forcing a safe reset if any required events were pruned. Monitor counter lock contention before increasing write throughput; shard/partition only after measuring. Backfill cost and index locking must be measured on staging before migration 98.

Pending offline sends keep one UUID and immutable payload until acknowledged. Retry timeouts with that UUID, not a newly generated one. Do not automatically resubmit edits/deletes after membership loss. Re-fetch message versions before editing; arbitrary offline edits are not conflict-free. A push delivery never marks a message or notification read. Mark a message read only when its conversation is actually shown.

Badge units are explicit: `unreadConversations` and `unreadClientConversations` count conversations; `unreadDirectMessages` counts unread messages in DIRECT/GROUP conversations; `unreadNotifications` and `missedCalls` count unread currently visible notification records. These counters overlap and must not be summed. Fetch counts on foreground, context switch and read/event changes. No blind local push increment is authoritative.

Presence remains the existing shared process registry: every foreground connection has a 45-second lease; any active lease makes the user ONLINE, surviving inactive leases are AWAY after five minutes, and no leases means OFFLINE. One device disconnecting does not clear other leases. Push registration contributes no presence. Background apps may close sockets; reconnect requires authorization. Multiple API processes require a shared presence adapter before rollout; the durable queue alone does not solve that existing limitation.

## Files and branding

Use `GET /file-policy`, reserve with `POST /:conversationId/files {name,size}`, upload raw bytes using `PUT /:conversationId/files/:fileId` and `application/octet-stream`, then attach the returned ready ID in message submission. Track native upload progress locally. Default maximum is 10 MiB, configurable up to 25 MiB; two uploads may be buffered per API process. Existing per-principal pending/hourly quotas remain. No multipart/resumable implementation is claimed. Retry the whole bounded upload against its reservation; if expired/removed or already consumed, fetch state before reserving again. Abort/cancel the transfer and delete an unused reservation when possible.

Private downloads and thumbnails use `GET /:conversationId/files/:fileId/content` (`?thumbnail=true` when available) with bearer authorization. There are no public permanent URLs or mobile storage credentials. Membership is checked again after storage I/O. File signatures, allowed types, size, image re-encoding and existing malware-scan readiness apply equally to native clients. Documents awaiting the configured scanner remain unavailable. Cached files must be encrypted per context and cleared on logout/revocation; already exported or viewed data cannot be reliably recalled.

Reuse staff workspace context and customer collaboration session/relationship branding, plus existing meeting branding. One KSOS app can select multiple businesses and independently authorized staff/customer roles. Do not cache a logo/name/role under only a user ID. White-label app distribution is outside this phase.

## Secure links and compatibility

Set `MOBILE_LINK_ORIGIN` to the approved HTTPS web origin. `/open` is the web fallback. The resolver allows only that exact origin/path and the strict target kinds CONVERSATION, MESSAGE, THREAD, MEETING and PORTAL; unknown/duplicate query keys, arbitrary paths, fragments, foreign origins or wrong context fail. Links contain only resource IDs. Native apps must parse, authenticate, select an actually authorized context and resolve before displaying content. Opening a meeting never grants admission or fetches a token automatically. Invitation activation remains the existing secure browser flow.

Review-only domain association templates are in `infra/mobile-links/`. After final app IDs, Apple team and Android signing fingerprints exist, publish exact HTTPS association files under `.well-known` on the approved domain, enable iOS associated domains and Android verified intent filters for `/open`, and verify installed/uninstalled fallback on physical devices. Templates are not served by this change. Follow [Apple associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains) and [Android verification](https://developer.android.com/training/app-links/verify-applinks).

API v1 changes are additive. The release policy for the future native project is to keep a published v1 contract compatible for at least 90 days after announcing a replacement; urgent security revocations take precedence. Do not remove fields/enum meanings without a versioned migration and release notice. This phase does not invent a minimum app version or remotely block an app that does not yet exist. Future clients must ignore unknown additive fields and use capabilities rather than parsing version strings. OS notification denial, tenant entitlement denial and disabled server push are distinct states.

## Verification and remaining release gates

All application verification runs in GitHub; no local build/install/test, real push, live provider login, native package signing or deployment is performed. Tests cover provider request signing/classification with injected transports; production migration SQL in isolated PGlite/PostgreSQL; tenant/customer/device/session revocation; queue/retry/token races; sync commit ordering/cursors/grant revocation; badges/deep links; atomic call acceptance; native customer HTTP admission; and web preference/navigation behavior. Existing CI also runs real Chromium communications and isolated self-hosted LiveKit media flows. These are browser media tests, not native-device evidence.

The PR records final commit-specific build/typecheck/lint/test/migration and security outcomes. Repository API lint is its existing placeholder script; passing it is not a claim of new API ESLint coverage. Dependency vulnerabilities inherited from Phase 7 must remain visible rather than being hidden by a green build.

Future native project acceptance requires: provider PKCE/refresh/logout staging validation; encrypted device storage/cache and atomic rotation; tenant/customer account switching; offline/delayed/duplicate sync; APNs sandbox and production plus FCM on signed physical apps; notification permission denial; locked/background/killed app behavior; CallKit/PushKit and Android call UI; microphone/camera/route changes and screen sharing; cellular/Wi-Fi transitions; two-device answer races; revoked session/relationship during calls; associated-link install/uninstall fallback; and accessibility testing. Full call transfer, white-label store apps, native offline UI and public app distribution are deferred.

Deployment classification: **BOTH VPS + CLOUDFLARE**, when separately approved. See the staged release and rollback plan in [push and operations](communications-phase-8-push.md). All phase branches remain unmerged.
