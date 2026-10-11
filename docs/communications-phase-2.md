# Communications Phase 2: internal channels and messaging

## Branches and release status

- Phase 1: [PR #241](https://github.com/kazshh786/ks-os/pull/241), branch `codex/communications-phase-1`, dependency commit `ea4c5c8b204e38b682bce2c5a652111e209b9185`.
- Phase 2: [PR #245](https://github.com/kazshh786/ks-os/pull/245), branch `codex/communications-phase-2`, based on Phase 1. Its PR base deliberately excludes the Phase 1 diff.
- Both phases remain unmerged. Main, production infrastructure, environment settings and production databases have not been changed.
- Implementation and verification continue directly on GitHub at the user's request. The earlier local work is preserved, but is not the current source of truth.

Cloudflare's authenticated development-build details show `pnpm run deploy:cloudflare:preview` (`wrangler versions upload`), a preview version upload. The production GitHub workflow is triggered by successful main CI or explicit dispatch; neither has been triggered for this work. Cloudflare automatic deployment settings were inspected, not changed.

## Architecture

Phase 2 extends Phase 1's canonical conversations, messages, members, authorization service, read cursors and durable event journal. It does not create a second inbox or socket service. The existing KSOS shell, tenant authentication, business navigation and role routing expose Chat at `/app/chat/:conversationId?`. Threads and details use query parameters, so refresh and browser navigation preserve context.

The UI only lists CHANNEL and PRIVATE_CHANNEL conversations. The backend retains DIRECT, GROUP_DIRECT, PROJECT and CLIENT contracts for subsequent phases. Inbox/provider delivery remains isolated through the Phase 1 access-mode filters.

The browser opens one workspace subscription through the existing Fastify WebSocket adapter. Events contain identifiers and invalidations, not private message bodies. Content is fetched through authorized HTTP routes. Reconnect obtains a new single-use ticket, preserves the replay cursor and reconciles the current bounded window. The initial ticket cursor is captured before snapshots to avoid a snapshot/subscription gap. Events are deduplicated; decimal bigint positions are compared without conversion to JavaScript numbers.

A tenant advisory transaction lock orders journal commits across conversations; conversation row locks retain Phase 1 membership/write serialization. This favors correctness for normal small-team usage. Measure contention before large-workspace rollout. No Redis or new runtime dependency is added.

## User experience

Desktop uses channel navigation, timeline and an optional thread/details panel. Tablet reduces panel widths; mobile shows channel list, conversation or context panel one at a time. The layout has bounded internal scrolling, wrapping text, touch controls, dynamic viewport sizing and safe-area spacing.

Features:
- Search joined channels, collapse public/private groups, discover and join eligible public channels.
- Workspace-owner channel creation with visibility, description and initial participants.
- Owner/admin channel renaming, description editing, member search/add/remove and archive; owners can transfer ownership before leaving.
- Plain-text messages, sender initials/identity, dates, timestamps, edited markers and deletion tombstones.
- Multiline composer, Enter to send, Shift+Enter for newline, IME handling, a 16,000-character limit, persistent retry identity and visible failures.
- In-memory drafts per channel/thread, cleared on workspace/session reset; failed messages retain their text.
- Root-only main timeline, reply counts and separate thread history. Deleting a root preserves its replies.
- Six persistent reactions with counts and the user's selection.
- Scoped mention autocomplete, keyboard/mouse selection and persisted user/offset references rendered as safe React text.
- Unread badges and explicit mark-all-read. Automatic acknowledgement requires focus, document visibility, a visible timeline at its newest position, and the newest conversation message to be in the viewed root timeline. Replies unseen in another panel are not implicitly acknowledged.
- History pages of 50, a 200-message window, anchored older-page scrolling and an explicit return-to-latest control. Historical readers are not forced to jump on incoming messages.
- Existing dialog focus trap/restore behavior, labelled controls, visible focus, status/error messages and reduced-motion support.

## Backend additions

All paths are under `/api/v1/communications/conversations`; Phase 1 routes remain.

| Route | Behavior |
| --- | --- |
| GET `/capabilities` | Fresh actor identity and channel-creation permission |
| GET `/discover` | Tenant-scoped public channels the actor can join |
| GET `/people` | Owner-only initial-member lookup |
| GET `/:id/members`, `/:id/candidates` | Authorized members or invite candidates, with search/keyset paging |
| PATCH `/:id` | Name/description |
| POST `/:id/join`, `/leave`, `/archive`, `/owner` | Channel lifecycle and explicit ownership transfer |
| GET/PATCH/DELETE `/:id/messages/:messageId` | Read, own-message edit with optional version check, tombstone deletion |
| PUT `/:id/messages/:messageId/reactions` | Idempotent set/remove reaction |
| POST `/:id/messages/resolve` | Resolve at most 200 authorized message IDs |
| POST `/realtime-ticket`, WS `/events` | Actor-scoped workspace feed through the Phase 1 transport |

Existing list routes gain channel-only filtering and name search. Message creation gains a client UUID retry key and validated mentions. New event kinds are `conversation.updated`, `message.updated`, `message.deleted`, `message.reaction`. Editing/deletion/management use the existing transactional security-audit table without including message content.

## Database and migration order

| Order | Migration | Purpose |
| --- | --- | --- |
| 89 | `20260929120000_communications_foundation.sql` | Required unmerged Phase 1 foundation |
| 90 | `20261011040000_communications_channels.sql` | Phase 2 additions |

Phase 2 adds:
- Nullable `client_message_id` and a unique conversation/sender/retry-key index.
- Composite message scope uniqueness for new foreign keys.
- `communication_reactions`: unique message/user/emoji, allowlisted emoji and user lookup index.
- `communication_mentions`: message offsets, user identity and display-name snapshot; recipient lookup index for future notification delivery.
- Composite message foreign keys and annotation scope triggers enforcing active tenant/conversation membership.
- RLS and revoked browser-role privileges; server-mediated access only.
- Nullable ticket conversation scope for actor-bound workspace subscriptions.
- Tenant/event replay index.

The migration is additive and transactional. It does not convert existing inbox records. It can take table/index locks and must be rehearsed against staging. No production migration has been applied.

## Security and operational limits

Session, security-version, tenant and membership authorization is revalidated on HTTP operations and every realtime poll. Workspace owners have no private-channel membership bypass. Support sessions remain denied. Creation is restricted to current workspace owners; all active staff may discover/join eligible public channels.

Management requires channel OWNER/ADMIN; only OWNER transfers ownership. A channel cannot lose its owner through remove/leave. Only an author can edit/delete their message. Archive prevents posting, editing, reactions and membership administration while preserving history and allowing ordinary members to leave. Mentions cannot name inaccessible users, and reactions cannot target inaccessible messages. Message text is rendered without HTML interpretation.

Existing HTTP rate limits remain active. Each API process limits an actor to 12 concurrent Chat sockets. Single-use tickets expire after 30 seconds; polls are bounded to 100 events with heartbeat and slow-client handling. A removed member's workspace feed can receive their own removal invalidation but no subsequent/private message events; all cached-content reads are reauthorized.

No notification email, push, attachment, external participant or presence delivery is added. Unpruned journal retention and per-process socket limits are existing architecture constraints to revisit before high-volume rollout.

## Verification

The GitHub CI workflow runs the production build, repository lint, typecheck, complete test suite and migration plan using its isolated PostgreSQL service. No local build is used for final Phase 2 verification.

Coverage includes:
- Real migration/SQL tests in PGlite, HTTP injection and real WebSocket connections: tenant/private access, spoofing, membership, owner transfer, archive, history/thread paging, monotonic read state, mention constraints, reaction uniqueness, retry deduplication, edit conflicts, tombstones, rollback, replay and revocation.
- Vitest: composer success/failure/retry, mention keyboard selection, limits/IME/newlines, safe text rendering, private-channel creation, initial-history/event race, bigint ordering and reconnect/deduplication.
- CI-only Chromium: two independent authenticated test actors through production Chat components, the actual Fastify communications routes, migrated PGlite storage and real WebSocket transport. Covers unread navigation, messages, refresh persistence, threads, reactions, edits/deletion, offline recovery, revocation, older history, desktop/tablet/mobile widths, reduced viewport height and an axe accessibility scan. The test replaces only the outer Supabase session client with fixture identities; it does not bypass the communications authorization service.
- Browser screenshots are uploaded as `communications-browser` in the CI run.

The existing web/API lint commands print success rather than running a static linter. TypeScript, executable tests and the UX copy audit provide substantive checks; this limitation is not concealed as additional lint coverage.

Final run results are recorded in the PR once complete. The separate repository dependency audit currently fails on pre-existing dependencies (including a critical Astro advisory); Phase 2 adds no dependencies or lockfile changes. Vercel reports an account block. Neither has been bypassed.

## Deployment: BOTH VPS + CLOUDFLARE

A later approved release requires the VPS API/database changes and the Cloudflare web/proxy change. The Worker now preserves a successful upstream WebSocket upgrade; Vite's development proxy also enables WebSockets. Existing API-origin routing remains supported.

No new environment variable, storage bucket, Redis or server service is required. The API reverse proxy must permit WebSocket Upgrade and appropriately long-lived connections, and upstream logs must redact ticket query strings.

Before any merge/release, coordinate production automation: main's automatic workflow uses `APPLY_MIGRATIONS=0`, which is unsuitable for the first deployment of these schema-dependent changes. This PR does not pause or alter that workflow or Cloudflare automation.

Operator procedure after explicit deployment approval:
1. Verify a database backup and clean release checkout; rehearse both migrations in staging.
2. Review all pending entries with `pnpm db:migrations:plan`, including any unrelated pending migrations; validate the manifest.
3. Arrange the controlled release so migrations 89 and 90 precede new API traffic. The first deployment requires `APPLY_MIGRATIONS=1` through the existing reviewed VPS deployment process (or an explicitly coordinated migration-first procedure).
4. Release the matching API and Cloudflare web/proxy versions; verify health and authorized two-user messaging, private-channel denial, upgrade/reconnect and revoked access.
5. Retain the additive database schema on application rollback. Never roll back behind Phase 1's inbox isolation after private conversations exist.

No production command in this procedure was executed.

## Phase 3 readiness and remaining constraints

The canonical DIRECT/GROUP_DIRECT types, membership checks, stable message IDs, retry keys, thread references and workspace invalidation transport are preserved for the next UI phase. Presence/typing require a deliberately ephemeral, authorized protocol; they should not become durable message rows. Mention recipient records can support later notification policy and delivery.

Phase 3 UI, presence, typing, uploads, advanced search, notifications, calls and external guests remain intentionally out of scope. Physical-device keyboard behavior and production reverse-proxy connectivity still require coordinated staging/release checks. CI exercises a reduced browser viewport, not a native mobile keyboard. Dependency-audit and Vercel account failures remain release issues.
