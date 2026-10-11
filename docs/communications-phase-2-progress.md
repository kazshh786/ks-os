# Communications Phase 2 — development snapshot

This is an incomplete development snapshot based on GitHub Phase 1 commit
`ea4c5c8b204e38b682bce2c5a652111e209b9185`, which includes current main through
`23ffb5b`. Phase 1 remains unmerged. Do not merge or deploy this snapshot.

Implemented so far: owner-controlled channel creation, public discovery and joining,
channel metadata management and archiving, membership listing and candidate search,
ownership transfer and leaving, own-message editing and soft deletion, persistent
reactions and validated mention references, idempotent message retry keys, batched
message hydration, and an authorized workspace feed using the Phase 1 WebSocket
transport and journal. New UI components cover creation/details dialogs, composer,
mention selection, message actions, and bounded message timelines.

Still required: Chat page and navigation integration, complete responsive styling,
thread panel integration, end-to-end unread and revocation wiring, Phase 2 security
and frontend tests, accessibility review, typecheck, lint, production build and
final diff review. Existing components have not yet been fully reviewed or verified.

The original 16-test foundation suite passed locally after the first backend
extensions. This is not verification of the complete snapshot. An attempted API
typecheck found missing built workspace dependencies; no complete Phase 2 build
has passed. Further verification is intended to run on GitHub, per user instruction.

Migration dependencies: original omnichannel schema, Phase 1 migration
`20260929120000_communications_foundation.sql` (manifest order 89), then new Phase 2
`20261011040000_communications_channels.sql` (order 90). The latter adds reactions,
mentions, message retry keys, composite message scope and indexes, and nullable
conversation scope for actor-bound workspace subscription tickets. No production
migration has been applied.

Expected deployment classification once complete: **BOTH VPS + CLOUDFLARE**.
The first API deployment requires reviewed migrations with `APPLY_MIGRATIONS=1`.
Production deployment requires separate authorization and coordination.

Cloudflare build #749bc52f was inspected in the authenticated dashboard: its deploy
command is `pnpm run deploy:cloudflare:preview`, which invokes `wrangler versions
upload`. The prior development build uploaded a preview version, not a production
promotion. Phase 2 is isolated in PR #245 targeting the unmerged Phase 1 branch.
No production settings have been changed. Verification runs in GitHub Actions.
