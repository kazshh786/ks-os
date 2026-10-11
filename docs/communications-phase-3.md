# Communications Phase 3 — direct messages, groups and presence

Phase 3 branch `codex/communications-phase-3` is based on Phase 2 commit `12ca8e90b59e40068c7c40ce54ffd0472595d570` (PR #245), which depends on Phase 1 PR #241. All phases remain unmerged.

## Implementation

The canonical conversation, membership, message, read-cursor and event services are reused. A sorted participant-pair key and tenant-scoped unique database index enforce one DIRECT conversation per pair; the existing transaction lock serializes concurrent starts. Both participant orders reopen the same conversation.

GROUP_DIRECT creation is available to active workspace members. The creator owns the group; only owners/admins manage participants and names. Removed/left members lose all history and realtime access. Reinvited members regain complete history. Owner departure passes ownership to the earliest active participant; a final departure archives the empty group. DIRECT participants are fixed.

Chat adds New message, recipient selection, optional group naming, direct/group navigation, recent activity ordering, previews, presence text and read indicators. Existing channels, composer, editing/deletion, mentions, reactions, threads, bounded history and responsive panels remain shared.

## Ephemeral realtime

The existing socket accepts strict, bounded `activity`, `watch` and `typing` control frames. Durable message writes remain authenticated HTTP requests. `ephemeral.snapshot` contains authorized presence, typing identities and participant read cursors; it has no durable journal sequence or draft content.

Connection leases expire after 45 seconds; transport heartbeats maintain live leases. Inactivity after five minutes or a hidden document produces AWAY; any active tab produces ONLINE; no live lease means OFFLINE. Typing is throttled to two-second updates and expires after five seconds, stops on blur/send and clears on disconnect.

A per-API-server in-memory registry matches the current single API service deployment. No Redis or database keystroke writes are introduced. A deployment with multiple API processes/replicas MUST provide a shared ephemeral adapter before rollout; durable messages and canonical DM identity remain database-backed. Restarts correctly reset presence offline, then reconnect restores it.

Every snapshot revalidates the receiving actor and current membership. Presence is only returned for active same-tenant users sharing a direct/group conversation. Typing and read cursors are restricted to the selected authorized conversation. Control frames cannot specify a sender; extra identity fields are rejected. Existing socket limits, slow-client handling, reauthorization and reconnect remain.

Read cursors remain monotonic, one per participant. Persisted own messages show Sent; peers whose cursor covers a message appear under Read by. Device delivery is not claimed.

## Migration and deployment

Migration 91: `20261011060000_communications_direct.sql`, after Phase 1 order 89 and Phase 2 order 90. It adds `direct_key`, unique pair and recent-activity indexes, and a fixed-participant guard. Legacy direct conversations are backfilled; malformed membership or duplicate histories fail migration for explicit operator review, rather than losing or merging data automatically.

Deployment classification: **BOTH VPS + CLOUDFLARE**. No new environment variables, dependencies or services. Rehearse migrations 89–91 in staging, review pending migrations and coordinate a controlled first release with `APPLY_MIGRATIONS=1`. Main's automatic deployment currently uses 0. WebSocket Upgrade support and ticket-query redaction remain required.

No production migrations, deployment commands, infrastructure changes or Cloudflare automation modifications are authorized or performed.

## Verification

Implementation is edited directly through GitHub; builds/tests run in GitHub Actions. Results and outstanding limitations will be recorded in the PR once verification finishes. The existing web/API lint scripts are placeholders, not substantive lint coverage. Pre-existing dependency audit failures and the Vercel account block remain release issues.

## Phase 4 readiness

Canonical conversation IDs, bounded message APIs, mention relationships, read cursors and durable invalidations remain ready for attachment policy, authorized search and notification preferences. Push delivery, uploads, external users and calls are deliberately excluded.
