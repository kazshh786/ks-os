# Phase 7 deployment requirements — review only

## Classification and safety evidence

**BOTH VPS + CLOUDFLARE**: the VPS needs API/authentication/realtime/meeting changes and migration 95; Cloudflare needs the restricted portal and staff frontend changes. Existing routes can serve the portal; no new domain, DNS, firewall rule, LiveKit server or per-business media infrastructure is required.

Read-only check on 23 October 2026 confirmed the Cloudflare `ks-os-web` production branch is `main`. Non-production branch builds are enabled with version command `pnpm run deploy:cloudflare:preview`, which resolves to `wrangler versions upload`; production uses `pnpm run deploy:cloudflare`, which resolves to `wrangler deploy`. Uploading a development version does not replace the live production version. Settings were not changed.

The GitHub production workflow listens for CI completion on `main` or an explicit manual dispatch. Phase 7 is a stacked development PR; none of those production triggers is requested. Vercel is obsolete and excluded from this phase.

## Prerequisites and release sequence

1. Review and approve the complete Phase 1–7 dependency stack and current security findings. Preserve the separate PRs during review.
2. Confirm backups, restore rehearsal, business retention policy, tenant/customer isolation tests, current dependency audit disposition and production readiness of Phase 5/6 media infrastructure.
3. Review migration `20261023010000_communications_client_channels.sql` (manifest order 95) against the actual production database. Earlier communications migrations must already exist. It performs no access backfill.
4. Schedule migration locking/index work. It adds columns and creates indexes on existing message/member/attachment tables, and changes reaction/preference primary-key layouts while retaining old staff uniqueness. Large tables require a maintenance window or separately reviewed online-index staging. Do not run this migration automatically just to test an app deployment.
5. The new customer-provider-session function is SECURITY DEFINER with a fixed search path and a boolean-only result. Review its owner and grant EXECUTE only to the actual trusted API role (the migration grants `service_role`; a distinct API DB role needs an explicit reviewed equivalent). Frontend roles must not gain access to `auth.sessions` or `auth.users`.
6. Apply reviewed migrations through the repository's deployment tooling only after explicit approval. The normal `APPLY_MIGRATIONS=0` VPS deployment does not install schema 95. This release requires a separate approved migration step or approved `APPLY_MIGRATIONS=1` operation.
7. Deploy compatible API code before exposing the new frontend, then publish the approved Cloudflare version. Keep production traffic away from a frontend that expects an unapplied schema.
8. Verify application health, customer passwordless sign-in/callback, invitation ownership, business switching, internal/customer boundaries, file upload/download, notification links, socket reconnect/revocation and meeting waiting/admission/media removal using controlled accounts.

This is a plan, not authorization to run these operations.

## Configuration

Reuse existing Supabase, API origin, private Chat storage and scanner settings, mail outbox/provider, LiveKit configuration and guest-meeting secrets. Configure these API settings only during the approved release:

| Setting | Requirement |
| --- | --- |
| `PUBLIC_CUSTOMER_PORTAL_ORIGIN` | Exact HTTPS origin hosting the existing customer portal; no path, query, credentials or fragment. Local HTTP is allowed only for isolated development. |
| `CUSTOMER_COLLABORATION_SECRET` | Independently generated secret of at least 32 characters. Rotation invalidates pending invitation capabilities. Never put it in frontend build variables. |
| `COLLABORATION_DEFAULT_CHANNELS` | Optional default active channels per tenant: 50, maximum 1000. |
| `COLLABORATION_DEFAULT_CONTACTS` | Optional default active collaboration relationships per tenant: 100, maximum 5000. |
| `COLLABORATION_DEFAULT_CHANNEL_CONTACTS` | Optional default external contacts per channel: 20, maximum 200; the existing total 101-participant channel bound still applies. |

Existing plan/override keys `communications.client_channels`, `communications.external_contacts` and `communications.channel_contacts` take priority. Values must be nonnegative integer `{limit: ...}` configuration. Creation/acceptance/addition serialize under the tenant lock before reserving capacity. No new pricing package is seeded.

The customer magic-link callback must remain an allowed first-party Supabase redirect. Portal and invitation handoff requests use the same first-party origin; arbitrary custom-domain handoffs are not supported.

No new external dependency, paid email provider, Redis deployment or separate auth tenant is needed. Preview versions must not be used to mutate production data during review.

## Rollback and limitations

Disable customer-facing entry points through an approved release if necessary, and retain the additive schema and customer history. Rolling back only to pre-95 API code is unsafe once external principals exist: old code assumes staff-only reaction/preferences/author fields. A rollback must retain authorization that denies external principals or use a reviewed compatibility release. Never drop customer messages or grants as an automatic rollback.

Provider removal may fail temporarily during a media outage; authorization prevents new tokens immediately and reconciliation retries connected-participant removal. Existing downloaded content cannot be recalled. Real production TLS/NAT/TURN routing, physical Safari/mobile devices, email delivery reputation and capacity remain staging/production release checks, not claims made by isolated GitHub runners.

Keep customer relationship/channel revocation audit tombstones for at least the maximum invitation lifetime (7 days). Acceptance consults these durable timestamps as well as current grants, preventing an old-email invitation from restoring access after a revoke and later reactivation. Future retention/erasure tooling must preserve this revocation barrier.

Self-hosted LiveKit does not cryptographically revoke an already issued JWT when a participant is removed. Existing tokens have a 60-second issuance TTL; fresh issuance is denied immediately and webhooks/reconciliation remove unauthorized reconnects. Preserve this inherited Phase 5/6 limitation in the release review rather than claiming instantaneous token invalidation.
