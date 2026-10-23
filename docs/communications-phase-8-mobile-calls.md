# Phase 8 — Native call and customer meeting integration

This phase prepares the existing KSOS API and self-hosted LiveKit service for native clients. It does not ship an iOS/Android application, enable real push credentials, configure production infrastructure, or demonstrate operating-system incoming-call behavior. The Phase 8 pull request records the reviewed commit and GitHub verification results. Source preparation and the test cases below are not claims that all checks have passed.

## Existing media service and identity boundaries

Native clients obtain their LiveKit URL and short-lived join token from the same authorized API used by the web application. They must never construct room names, participant identities, grants or tokens. A media identity is a server-generated `ksos_<session UUID>` for one connection; it is not the user ID, customer relationship ID, device registration ID or email. The media grant remains scoped to one room, permits publishing/subscribing, and excludes room administration, recording, data publishing and self-metadata changes. Customer screen sharing follows the existing host-controlled meeting permission.

The implementation retains the reviewed server v1.13.10, backend SDK 2.19.1 and web SDK 2.23.0. No native SDK is installed by this phase. Deployment topology, private API URL, TURN, ports, capacity, `room.auto_create: false` and operational approval remain governed by the [Phase 5 report](communications-phase-5.md) and its linked infrastructure guide. No LiveKit Cloud service is introduced.

## Instant call response contract

The existing staff root is `/api/v1/communications/conversations`. Requests use the verified TENANT bearer session and the existing business context. A native application also registers its installation through the Phase 8 device API and sends `x-ks-device-id`; request authorization validates any supplied device binding and rejects a revoked registered session. Device identifiers in JSON are not authorization evidence.

| Request | Behavior |
| --- | --- |
| `GET /meetings/config` | Enabled state, participant limit and initial token lifetime. |
| `POST /:conversationId/meetings` with `{type,requestId}` | Creates or recovers the existing call for the authorized conversation. `type` is `AUDIO` or `VIDEO`. |
| `GET /meetings/incoming` | Current unexpired invitations, filtered by incoming-call, conversation, direct-message and DND preferences. Mobile-only push preferences are supported. |
| `GET /meetings/:meetingId` | Current authorized call state and participants. |
| `POST /meetings/:meetingId/invitation` with `{accept,requestId?}` | Atomically accepts or declines. Native clients should retain one request UUID for retries. The optional field preserves existing web callers. |
| `POST /meetings/:meetingId/join` with `{requestId}` | Returns `{token,url,identity,sessionId,expiresIn,meeting}` only after current authorization and capacity checks. |
| `POST /meetings/:meetingId/leave` with `{sessionId}` | Leaves only the caller's connection bound to its authentication session. |
| `POST /meetings/:meetingId/end` | Organizer or authorized conversation manager ends the call. |

The response adds `callState` and `answeredOnThisSession` without changing the existing meeting status model. `callState` projects `RINGING`, `ACCEPTED`, `DECLINED`, `MISSED`, `CANCELLED`, `ENDED` or `EXPIRED` for the requesting participant. `EXPIRED` can be observed before reconciliation records an unanswered invitation as `MISSED`; `call.missed` publishes that persisted change for a still-running group call. The existing `CREATED/RINGING/ACTIVE/ENDED/CANCELLED/FAILED` meeting status and end reasons remain authoritative for the room lifecycle.

Migration 99 adds `response_auth_session_id` and `response_request_id` to the existing participant and widens its invitation-state constraint with `MISSED`. Existing global-media and tenant transaction locks serialize competing responses. The first accepting authentication session wins; the same session can retry its accepted response. A different session receives `CALL_ANSWERED_ELSEWHERE` and cannot acquire ownership by calling Join. A declined or missed invitation cannot be silently overwritten by Join. Direct-call decline still cancels the room, and unanswered direct calls time out even if the caller connected first. The caller's initial acceptance is bound to its creating session.

Two connections within the winning authentication session remain allowed by the existing instant-call capacity policy, for example two tabs. This is not a call-transfer feature. Scheduled staff meetings retain their separate existing two-connection policy. Distinct native installations must authenticate separately; cloning one provider session into multiple installations is not supported. Provider and application-session revocation, participant removal and current conversation membership are rechecked during token issuance and media reconciliation.

## Canonical notifications and safe opening

The same `internal_notifications` records now represent `CALL_INCOMING`, `CALL_MISSED`, `MEETING_INVITATION`, `MEETING_UPDATED` and `MEETING_CANCELLED`. One deterministic source reference per meeting/version/event and recipient uniqueness make retries idempotent. Calls use `CHAT` plus their conversation; scheduled staff notices without a conversation use `MEETING`; customer meeting notices always retain an explicit authorized `CHAT` channel. No reminder scheduler is added here.

Canonical records are independent of delivery preferences. Delivery evaluates current push, meeting/incoming-call, DND, direct-message and channel preferences and current authorization. Answering, declining, joining or ending a call expires its queued incoming-call notice; the delivery worker also rechecks its current participant and room state immediately before sending. A provider-accepted or already in-flight alert cannot be recalled. Cancellation and another-device acceptance are reconciled through authenticated state/realtime, not an extra VoIP push.

`communications.meeting-notifications.ts` provides the shared current-authority predicate for notifications, badges and links. It checks current business, user/capability or customer-account/relationship, membership and explicit meeting grants. Historical notices remain visible after a meeting ends only while that authority remains valid. Push has stricter version, invitation-state, join-window and terminal-state checks. Removing a meeting permission or customer grant removes future protected delivery and access.

A customer meeting link resolves to `/customer/collaboration/:relationshipId/meetings?meetingId=<uuid>`. The list API accepts the same `meetingId` filter and returns only the exact currently authorized meeting; an unauthorized or absent ID yields no list match. Link resolution does not create admission, bypass the waiting room or return a media token. The existing staff scheduled detail or conversation call history is used for staff links.

## Native customer admission

Customer meeting routes remain under `/api/v1/customer/collaboration/:relationshipId/meetings`:

| Request | Behavior |
| --- | --- |
| `GET /?conversationId=<uuid>&meetingId=<uuid>&after=<uuid>` | Optional bounded filters on the same explicit meeting-grant query. |
| `POST /:meetingId/request` with `{conversationId,requestId}` | Creates or recovers the caller's current waiting-room admission. |
| `GET /:meetingId/sessions/:sessionId` | Reads only the same relationship and authenticated provider-session binding. |
| `POST /:meetingId/sessions/:sessionId/join` with `{requestId}` | Requires host approval and current authorization before issuing the room credential. |
| `POST /:meetingId/sessions/:sessionId/leave` with `{}` | Revokes that admission and requests media removal. |

When `x-ks-device-id` is present, `requireMobileDevice` must validate its verified CUSTOMER bearer identity, provider session, application ledger, installation binding and expiry. Only that branch omits the browser Origin/cookie/CSRF requirement. A malformed, foreign, revoked or wrong-context device fails closed; it never falls back to browser credentials. The private guest verifier is derived server-side after the same exact ownership checks, is not returned in native JSON, and is not placed in a cookie for native requests.

Without the header, the existing browser Origin checks, scoped HttpOnly cookie and CSRF header remain required. Anonymous `/api/v1/public/meetings` routes retain their existing protections and cannot borrow the native exception. Both transports share admission, capacity, customer grant/membership, schedule-change, provider-session, expiry, leave and reconciliation rules. A new authentication session requires its own admission; an existing active admission on another session is not silently transferred.

The response still includes the existing browser `csrfToken` field for compatibility; this is not a media credential and native callers do not use it. An authenticated native request never needs to receive or persist the private guest verifier. Public invitation activation and native authentication handoff are separate from this meeting transport adapter.

## Native client integration references

Use the official SDK for the chosen native stack. Research checked the published Swift 2.18.0, Android 2.29.1 and React Native 3.1.0 releases; these are research references, not a tested KSOS native compatibility matrix or new pinned dependencies. React Native 3.1.0 documents a compatible `livekit-client` range beginning at 2.20.0 and a native WebRTC dependency; the actual native build and device matrix still need validation. See the official [Swift releases](https://github.com/livekit/client-sdk-swift/releases), [Android releases](https://github.com/livekit/client-sdk-android/releases) and [React Native releases](https://github.com/livekit/client-sdk-react-native/releases).

- [LiveKit Swift setup](https://docs.livekit.io/transport/sdk-platforms/swift/) describes `Room.connect(url:token:)`, microphone/camera permission descriptions and the audio background mode. Keep room credentials in memory and store authentication credentials using platform secure storage.
- [LiveKit Android setup](https://docs.livekit.io/transport/sdk-platforms/android/) uses application-scoped `LiveKit.create` and `room.connect(url,token)`, with microphone/camera runtime permissions. Native lifecycle/background requirements remain part of the app implementation.
- [LiveKit React Native setup](https://docs.livekit.io/transport/sdk-platforms/react-native/) requires the native WebRTC setup, `registerGlobals()` and managed `AudioSession` startup/shutdown. A web-only or Expo Go run does not establish native-media support.
- [Screen sharing](https://docs.livekit.io/transport/media/screenshare/) requires native capture authorization. iOS full-device sharing uses a ReplayKit broadcast extension; Android uses its platform capture/foreground-service requirements. KSOS's server-side publish-source permission still applies.
- [Apple's PushKit guidance](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit) restricts VoIP wakeups to genuine incoming calls and recommends zero or very short APNs expiration. The native implementation must promptly report a required incoming call to the system while resolving authenticated current call state in parallel. Apple's [new delegate metadata](https://developer.apple.com/documentation/pushkit/pkpushregistrydelegate/pushregistry(_:didreceiveincomingvoippushwith:metadata:withcompletionhandler:)) distinguishes whether reporting is required; availability-gate that API and preserve the appropriate older callback. A received push is never authorization to join.
- [CallKit incoming-call reporting](https://developer.apple.com/documentation/CallKit/CXProvider/reportNewIncomingCall(with:update:completion:)) uses a stable call UUID, suitable call metadata and completion handling. Handle DND, blocked calls, expired invitations and already-answered-on-another-device responses. Do not use another VoIP push merely to cancel an existing call.
- [Android CallStyle](https://developer.android.com/develop/ui/compose/notifications/call-style) and [Telecom notification guidance](https://developer.android.com/develop/connectivity/telecom/voip-app/notifications) cover answer/decline/hang-up UI, high-importance incoming-call channels and applicable full-screen restrictions. [FCM priority guidance](https://firebase.google.com/docs/cloud-messaging/android-message-priority) reserves high priority for time-sensitive user-visible alerts and permits deprioritization when that contract is not honored. Permission, Doze, foreground service and lock-screen behavior require real-device testing.

## Reconnect and revocation limits

The initial KSOS media token lasts 60 seconds. That is not a 60-second absolute connection or replay lifetime. [LiveKit's token guidance](https://docs.livekit.io/frontends/reference/tokens-grants/) states that expiration affects initial connection, connected-client tokens are refreshed, and self-hosted participant removal/permission changes do not invalidate an already issued token as LiveKit Cloud's revocation does. A retained valid credential may reconnect before KSOS removes the identity again. KSOS denies fresh tokens after revocation, rechecks provider observations and removes unauthorized participants; `room.auto_create: false` prevents a retained token from recreating a deleted room. Outages, backlog and in-flight traffic preclude an instantaneous revocation guarantee. Native reconnect logic must revalidate current KSOS state and stop reconnecting after revocation/end; SDK reconnect alone is not authorization.

## GitHub evidence and outstanding device validation

The prepared regression suites cover persisted response ownership, same-session retries, competing real PostgreSQL accept operations, declined-invitation join denial, missed-call deduplication, current notification capability checks, provider logout eviction and exact customer meeting links. HTTP regressions use the real device guard against an isolated database and cover native request/state/join/leave, waiting-room approval, denial of wrong device/body spoofing, browser fallback and anonymous guest bypass. Media transport in these policy/HTTP suites is simulated while token signing and database behavior are real. Existing separate GitHub LiveKit suites exercise the pinned self-hosted server with Chromium and synthetic loopback media.

Passing those suites establishes backend behavior for the reviewed GitHub commit, not Swift/Android/React Native execution, real APNs/FCM delivery, PushKit/CallKit or Telecom UI, phone-network TURN, lock-screen wakeups, Bluetooth/audio routing or battery/background behavior. Those remain a separately approved native-device acceptance matrix. No local build, production migration, live push or production media connection is required or performed by this preparation.

Before an approved release, apply the reviewed migration chain through 99 and deploy the matching API/frontend together; deployment type is BOTH. Keep mobile push providers disabled until configuration, native app entitlements and device tests are approved. Migration 99 preserves call history and API-only table permissions. Rollback should disable new native/call entry points and use a forward fix; do not erase participant responses or assume disabling the feature disconnects active media.
