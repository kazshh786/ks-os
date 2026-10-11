# Communications Phase 4: files, search and notifications

## Scope and branch dependency

Phase 4 is developed in GitHub on `codex/communications-phase-4`, based on Phase 3 PR #246 (`0ef63a2f36945cae304c378afe6d99bb0783e937`). Phase 3 depends on Phase 2 #245 and Phase 1 #241. All phases remain unmerged. No production deployment, VPS change, bucket creation or production migration is part of this work.

The pre-implementation audit confirmed the Fastify/Vite/PostgreSQL architecture, authenticated journal sockets, canonical message/membership/attachment tables, Supabase private storage adapters and existing internal notifications. The parent local workspace is a collection of old checkouts rather than the current Git checkout; those files are preserved. Changes, builds and tests for this phase run through GitHub.

## Architecture and important files

- `communications.attachments.ts`: upload reservation, ownership, state transitions, message binding, authenticated downloads, listing and retryable cleanup.
- `communications.file-policy.ts`: bounded validation, image decoding/re-encoding, archive checks and scanner adapter.
- `communications.storage.ts`: provider-independent put/get/remove interface backed by existing Supabase service-role storage.
- `communications.discovery.ts`: authorization-scoped full-text search, notification read APIs and preferences.
- `communications.notifications.ts`: transactionally persisted recipient notifications and journal invalidations.
- Existing communications service/routes/contracts connect these to the Phase 1–3 transaction, audit, membership and socket model.
- `ChatAttachments.tsx`, `ChatSearch.tsx`, `ChatNotifications.tsx`: reuse Chat dialogs, CSS tokens, composer/timeline, authenticated requests and the current socket.
- Shared database models and additive migration 92 extend existing tables rather than building competing file/notification repositories.
- `cleanup-chat-files.ts`: bounded operator-run maintenance command.
- Existing inbox service tolerates pending attachment rows without changing inbox access rules.

## Storage, lifecycle and security

Release requires a **private** Supabase bucket named `private-chat`. The API refuses a public/missing bucket and never creates one from a request. Migration 92 installs a restrictive anon/authenticated Storage policy for this bucket when the Storage schema is present. Service-role credentials stay in the API. No storage keys or signed bearer download URLs are returned to clients.

All original/thumbnail downloads use the normal authenticated API, check active tenant session and current conversation membership, fetch bytes, then recheck access after storage IO. Responses are no-store, nosniff and attachment-disposition. Removed participants lose future access immediately; already downloaded bytes cannot be revoked. Reinvitation follows Phase 3's full-history policy.

Existing `conversation_attachments` gains nullable message association, conversation/uploader scope, status, scanner status, thumbnail key, deletion and expiry. State proceeds PENDING → VALIDATING → AVAILABLE or QUARANTINED/REJECTED; cancellation/message deletion marks DELETED. A send atomically binds only available, unexpired files owned by that sender in that conversation. Attachment-only messages and thread files are supported. Retry identity includes the attachment set.

Uploads expire after 24 hours if unsent; rejected attempts expire after one hour. Object keys are recorded before storage writes, including thumbnails, so interrupted operations remain discoverable for cleanup. Deleting a message immediately blocks downloads and schedules both objects for deletion; editing text preserves files. Cleanup deletes objects before recording completion, making retries safe. Up to ten expired records are cleaned opportunistically on upload reservation. Schedule the bounded cleanup command periodically during the coordinated release; no scheduler is provisioned by this branch. Expired metadata tombstones remain for accounting/audit.

Default limits: 10 MiB per upload, hard maximum 25 MiB; ten attachments per message; twenty pending files and sixty attempts per user/hour; two incoming/processing uploads per API process. Database upload accounting works across replicas, while processing concurrency is process-local. Requests are authenticated before binary buffering.

Filename normalization strips traversal separators, controls, bidi overrides and unsafe syntax. Names are display/download labels, never storage paths. Content inspection is independent of browser MIME. HTML, SVG, scripts and executable formats are denied. ZIP central-directory inspection rejects encryption, multi-volume/ZIP64 structures, traversal, nested archives, executable entries, macro/ActiveX entries, excessive entries, expansion and compression ratios; archives are never extracted on the API.

PNG/JPEG/WebP/GIF are decoded within a 20-million-pixel limit, one frame, five-second processing limit, bounded sharp concurrency/cache, then re-encoded to metadata-free WebP. Full images are downloaded only on request; timeline images use separate 320×240-bounded thumbnails. Animated GIF becomes a static first frame. Downloads use the normalized .webp extension. This is sanitization, **not a virus-scan claim**.

UTF-8 TXT/CSV is validated (formula-bearing CSV cells are rejected) and served strictly as a download. PDF, Office and ZIP require a scanner CLEAN result and otherwise remain quarantined and unsendable. Office macro containers and nested archive executables are denied before scanning. No operational antivirus service is installed. Legacy OLE Office files are checked for container signature and require the scanner to inspect content.

Scanner adapter: POST bytes to the configured trusted endpoint with content type and SHA-256 header, optional bearer token, 15-second timeout, no redirects. Response must be JSON `{status:"CLEAN"|"INFECTED",sha256:"matching digest"}`. Errors, mismatches and unavailable scanners fail closed. Use HTTPS or loopback HTTP. Evaluate scanner memory/CPU, archive support, signature updates and capacity before enabling document sharing.

## Search

PostgreSQL native English full-text search uses an explicit `to_tsvector('english',body)` GIN expression and matching `websearch_to_tsquery`. No external search system is introduced. Tenant, active membership, native message and deletion filters run in SQL; conversation names are selected only from authorized rows.

Conversation/sender/date/attachment filters and descending position cursors give stable bounded pagination. Threads are included. Results are rendered as text with React highlighting, never raw HTML. Selecting a result fetches a bounded message window at its position and opens its thread when applicable, so older messages do not require loading entire history.

## Notifications

The existing `internal_notifications` table holds generic Chat update text with conversation/message references. A unique recipient/source identity prevents duplicates. Content/name previews are hydrated only through current authorization; deleted messages and removed memberships disappear from Chat notification results. The general inbox never receives copied private message text.

DM/group/channel messages, mentions, thread replies and invitations create database records within the same transaction as their source. Current member settings select ALL, MENTIONS or NONE. Global browser/in-app flags and direct-message preference control creation. Do Not Disturb suppresses transient delivery while preserving history.

Existing authenticated journal sockets carry recipient-scoped notification invalidations. Stable records remain recoverable after disconnect. Browser clients refresh on socket events, reconnect and a bounded thirty-second fallback. Read state is recipient-owned and persists. Browser alerts require explicit permission and a persisted opt-in; denied/unsupported browsers receive a clear message. Notification clicks navigate to the conversation/message. Alerts are suppressed for the actively viewed conversation; generic browser text avoids OS-level private preview leaks. Stable notification tags replace duplicate browser alerts.

Notifications operate while **Chat is open**. Browser sound is controlled through the standard notification silent flag and depends on browser/OS support. No background Web Push, service workers, VAPID keys, native push or email sends are added. Browser permission is device-specific even though preferences persist across sessions.

## Database and release

**Deployment classification: BOTH VPS + CLOUDFLARE.**

VPS hosts the new API/storage processing and migrations; Cloudflare serves the changed web interface. Migration **92** follows **89 → 90 → 91**. It extends attachments and existing notifications, adds communication preferences and targeted event recipients, and adds full-text/sender/file/notification/cleanup indexes.

Migration 92 is transactional. The initial GIN index scans existing native messages and ordinary CREATE INDEX takes a write-blocking lock. Measure table size and rehearse on a staging copy; for a large live table, coordinate an operator-reviewed concurrent index build and migration reconciliation before release. Do not blindly apply this during busy traffic. The coordinated first deployment requires `APPLY_MIGRATIONS=1` after review of every pending migration. Main automatic deployment remains configured with 0.

Configuration:
- Existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
- `CHAT_FILE_MAX_BYTES`, `CHAT_FILE_ALLOWLIST` (comma-separated supported extensions), `CHAT_UPLOAD_PENDING_LIMIT`, `CHAT_UPLOADS_PER_HOUR` are optional bounded overrides.
- `CHAT_SCAN_URL` and optional `CHAT_SCAN_TOKEN` are required to release PDF/Office/ZIP uploads from quarantine.
- Dedicated private bucket, restrictive Storage policy and periodic `pnpm --filter api exec tsx src/cli/cleanup-chat-files.ts` maintenance require coordinated release setup.
- Review API proxy upload body/time limits and retain WebSocket Upgrade support/ticket redaction.

The GitHub production workflow is main/manual-only. Previously inspected Cloudflare development builds upload preview versions; no production promotion is requested. Production automation settings are unchanged.

## Verification and remaining limits

Exact final GitHub run IDs, counts and known external check failures are recorded in PR #248. Tests cover migrated PostgreSQL, real HTTP/WebSockets, cross-tenant/private file access, validation/quarantine, binding/deletion/cleanup, search filters/pagination/tombstones, preferences/idempotency and notification revocation. Browser regression covers Phases 1–3 plus uploads, thumbnails, files panel, search anchors and notification settings. Unit tests cover upload progress/drop/paste, permission opt-in and blob cleanup.

Existing repository web/API lint scripts are placeholder success commands, not substantive static lint coverage. Existing dependency-audit/Vercel account issues require release review. Physical-device keyboards, production proxy limits and the chosen scanner need staging verification. Scanner-dependent formats intentionally remain blocked until release configuration exists.

Phase 5 can reuse stable conversation IDs, membership authorization, recipient preferences and the authenticated event transport for future LiveKit integration. Calls, guests, mobile push and semantic search remain out of scope.

Implementation references: [PostgreSQL text search indexes](https://www.postgresql.org/docs/current/textsearch-tables.html), [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [sharp input limits](https://sharp.pixelplumbing.com/api-constructor/), [browser notification permission](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API).
