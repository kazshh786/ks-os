# Phase 7 — customer collaboration

Status: implementation under review; GitHub verification results will be recorded below. This phase is not deployed.

## Branch and dependency

`codex/communications-phase-7` is based on Phase 6 commit `0a04e64cc8d2919b149f4aa6d876c4fb661afdb2` on `codex/communications-phase-6` (PR #251). The preceding communications stack remains unmerged. Phase 7 must be reviewed against Phase 6, then delivered only after its dependencies in an explicitly approved release.

## Architecture and history policy

The existing conversations, messages, members, attachments, reactions, mentions, read cursors, notifications, journal, realtime tickets and LiveKit rooms remain canonical. No second message store or authentication provider is introduced.

An existing `CLIENT` type is not proof of external sharing: both old inbox rows and some native staff conversations use that value. New client channels require the immutable `external_client_channel` marker, `MEMBERS` access, `NATIVE` transport and a CRM customer belonging to the same business. Existing internal conversations cannot be converted. Explicitly invited members can read the entire history of these externally shared channels. Staff see a permanent external visibility warning before composing.

## Identity and invitations

Supabase passwordless authentication and the `CUSTOMER` application context are reused. A customer account is identity; a CRM customer is a business record; a collaboration relationship is an explicit communications grant between them. These are distinct concepts.

`customer_collaboration_relationships` supports several contacts representing a company, several CRM relationships for an account, and the same account in multiple businesses. It does not create or relax `customer_client_links`, whose existing one-to-one ownership semantics authorize legacy appointments, forms and payments. Matching an email or accepting a guest meeting invitation grants no collaboration relationship.

Customer requests require an explicit validated CUSTOMER context, live application session, current provider session, confirmed non-anonymous account, active business, active collaboration relationship and the requested conversation membership. The same rules apply to reconnect/replay and after slow storage operations. A narrowly scoped database function answers whether a provider session is current without exposing provider records to frontend roles.

Invitations bind an intended verified email, business, CRM customer and new external conversation. Only token hashes are stored. An expiring HttpOnly handoff allows the existing magic-link sign-in to complete without putting the invitation secret into an authentication redirect query. Acceptance verifies the current Auth user rather than trusting a stale email claim. Invitation email uses the existing email outbox and contains no private message history.

## Shared engine and customer permissions

The public principal ID is a staff user UUID or a collaboration relationship UUID. Database writes use separate, exclusive foreign keys; customer authors are never invented staff accounts. Sender names and principal IDs come from the server. Message retries, own-message editing/deletion, threads, mentions, reactions, read state and unread counts use that principal consistently.

The customer API exposes only member conversations and member rosters. Staff discovery, directory browsing, channel creation, self-join, ownership transfer and member administration remain server-restricted. List, search, notifications and file queries apply relationship membership in SQL. Selecting another relationship validates the authenticated account's grant before selecting a tenant.

Realtime retains single-use short-lived tickets, replay cursors, bounded connections, reconnect and duplicate handling. Staff and customer routes share an ephemeral process registry; customer presence and typing are restricted to the selected channel roster. Persisted events remain conversation-scoped or recipient-specific. Removed members cannot subscribe or receive subsequent protected events; revoked relationships and provider/application sessions invalidate existing sockets on their authorization poll. Bytes already delivered cannot be recalled.

## Files and notifications

Existing private Chat storage, upload reservations, progress, type/size checks, image re-encoding, document quarantine/scanning, attachment cards, previews and paginated file history are reused. A staged file belongs to its uploader and conversation. It cannot be bound by a different contact or linked across conversations. Downloads pass through the authenticated API, with authorization repeated after object-store reads. Phase 7 introduces no public file URL or customer signed download URL. Revocation prevents future API downloads; previously downloaded files and in-flight bytes cannot be erased remotely.

Customers use the existing persistent notification centre and browser notification preferences, including per-channel all updates, mentions and mute. Generic persisted inbox text avoids copying private message bodies; authorized API projections can provide previews. Invitation emails use the existing provider. Native push and new message-email automation are not added.

## Portal, CRM and meetings

The restricted `/customer/collaboration` workspace extends the existing customer login. It provides Messages, Files, Meetings and Account, with branding resolved from an authorized relationship and a switcher containing only that account's authorized relationships. It does not mount staff CRM, billing, administration or global directory screens. Context switching, revocation and sign-out dispose protected in-memory chat state, transport and media.

Staff create and manage client channels from Chat and the existing customer detail experience. CRM association shares the channel, not private customer fields. There is no canonical project entity suitable for an additional project grant in this repository; arbitrary project IDs are not accepted and project permissions are not inferred.

Phase 6 scheduled/instant client meetings are reused with explicit channel grants and customer guest-session bindings. A channel membership alone is not a reusable public guest credential. Portal meeting projections contain permitted meeting summaries and the caller's admission state; waiting-room approval remains required. Customer token issuance and media reconciliation recheck relationship, membership, provider/application session and meeting grant. Contact removal and channel archive revoke future issuance and request media removal, with reconciliation handling provider cleanup failures. Existing media capacity and room isolation remain authoritative.

## API and realtime surface

All routes below are under `/api/v1`. Staff operations require a current TENANT session and the relevant CRM/channel permissions. Customer operations require the validated CUSTOMER context; a relationship in the URL is validated against that account before selecting a business.

| Prefix | Routes and purpose |
| --- | --- |
| `/client-collaboration` | `GET /customers`, `/config`, `/channels`; `POST /channels` creates a dedicated external channel with an idempotent request ID. |
| `/client-collaboration/channels/:channelId` | `GET /access`; `POST /invitations`, `/invitations/:invitationId/revoke`, `/contacts`; `DELETE /contacts/:relationshipId`; `GET/POST /meetings` and `DELETE /meetings/:meetingId` manage explicit channel grants. |
| `/client-collaboration/relationships/:relationshipId` | `POST /revoke` removes that customer relationship across the business's client channels. |
| `/customer/collaboration` | `GET /session`; `POST /invitations/handoff`, `GET /invitations/pending`, `POST /invitations/accept`. Handoff requires the configured first-party origin; acceptance also requires the intended currently verified account. |
| `/customer/collaboration/:relationshipId/chat` | The existing conversation API for list/detail, messages, threads, read cursors, reactions, permitted member rosters, search, attachments, notifications/preferences, realtime tickets and events. Staff-only operations remain denied. |
| `/customer/collaboration/:relationshipId/meetings` | `GET /`; `POST /:meetingId/request`; `GET /:meetingId/sessions/:sessionId`; `POST /:meetingId/sessions/:sessionId/join` and `/leave`. Requests bind the customer identity and channel grant, use a scoped HttpOnly verifier and enforce origin/CSRF checks. |

`ClientCollaboration` owns relationship/invitation lifecycle and `CommunicationsAuthorization` validates the shared customer principal. `CommunicationsService`, attachment/discovery/notification services and `ClientMeetings` remain the canonical engines. Channel update, archive and staff membership use the existing staff communications routes.

Existing message, reaction, read-state, membership, attachment and recipient notification events are reused. Explicitly granted customer channels additionally receive safe meeting-created/updated/started/ended events; host waiting-room details and admission administration are not broadcast to customers. Reconnect replay rechecks current membership. Portal switches and sign-out dispose old subscriptions.

Customer meeting admission is bound to the authenticated session and JWT expiry. Reloading with the same live session can recover its admission; expiry or a new authentication session requires a fresh request and host approval.

## Schema, operations and retention

Migration order 95 adds collaboration relationships, hashed invitations/handoffs, explicit meeting grants, the immutable external channel marker and distinct external principal columns on existing tables. Tenant/customer constraints, principal checks, uniqueness and access indexes protect privileged writes as well as API queries. New tables are API-only with RLS enabled and grants revoked from public/anonymous/authenticated roles. Existing rows remain internal or legacy; no automatic access backfill occurs.

Channels archive without hard-deleting history. Relationship/member revocation retains message authorship snapshots and audit evidence. Invitations, acceptance, grant/removal, relationship revocation, creation and archive produce tenant-scoped audit records without message bodies. Existing retention/export/erasure tooling is not a comprehensive customer privacy workflow; an approved business retention policy is still required before production use.

Commercial limits use existing entitlement configuration and server-side serialized reservations; no pricing packages or payment flow are introduced. Shared attachment and media limits continue to apply.

## Verification

All installs, application builds and tests run in GitHub. Local work is limited to source preparation from the exact Phase 6 GitHub snapshot and review of returned evidence.

Pending GitHub results: build, typecheck, lint, full regression suite, customer identity/invitation tests, migration constraints, PostgreSQL races, shared-engine isolation, HTTP/WebSocket revocation, portal browser/accessibility checks and Phase 1–6 media/browser regression checks. Do not treat this paragraph as a passing result.

Inherited release findings from Phase 6: 63 dependency audit findings (1 critical, 32 high, 26 moderate, 4 low), and CodeQL alert 216 concerning the guest verifier cookie. These are not suppressed or represented as newly fixed by Phase 7. Current Phase 7 security results must be reviewed separately.

## Phase 8 readiness

Customer identity is not coupled to a meeting cookie. Explicit relationship context, bearer-authenticated APIs, stable principal IDs, pagination, message idempotency, cursor replay and shared read state can support future mobile clients. Native secure credential storage, push registration/delivery, universal links, native background reconnect and operating-system call integration remain future work.

Production impact: **BOTH VPS + CLOUDFLARE**. See [deployment requirements](communications-phase-7-deployment.md). No merge, deployment, migration, production service change or real invitation send was performed during implementation.
