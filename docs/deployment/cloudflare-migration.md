# KS OS Cloudflare migration

This runbook moves the KS OS Vite frontend from Vercel to Cloudflare Workers. The existing Fastify API and background workers remain on the VPS and are not deployed as part of this cutover.

## Deployment classification

- Frontend deployment: Cloudflare Worker `ks-os-web` with static assets
- Production cutover: Vercel to Cloudflare for `app.kasimshah.com`
- Backend: existing VPS API at `https://api.kasimshah.com`, unchanged
- Database: existing production Supabase project, unchanged
- Vercel: retained as a disabled reference while its account-level deployment restriction remains

## Worker behaviour

The Worker reproduces the relevant Vercel behaviour:

- builds and serves `apps/web/dist`
- falls back to `index.html` for direct React Router navigation
- sends `/api` and `/api/*` through the Worker before static asset handling
- proxies those requests to `https://api.kasimshah.com`
- preserves the path, query string, method, streaming body, authorization, cookies and other request headers
- forwards the original hostname and proxy metadata to the API

Browser API requests remain same-origin. Do not set `VITE_API_ORIGIN` in the Cloudflare production build.

## Cloudflare build settings

- Application: `ks-os-web`
- Production branch during migration: `infra/cloudflare-migration`
- Production branch after PR merge: `main`
- Root directory: `/`
- Build command: `pnpm --filter web... build`
- Deploy command: `pnpm run deploy:cloudflare`
- Non-production deploy command: `pnpm run deploy:cloudflare:preview`
- Node version: `24`
- pnpm version: `11.13.1`
- Worker configuration: `wrangler.jsonc`

Cloudflare installs dependencies from the lockfile before running the build command. Do not add `pnpm install` to the build command.

## Build variables

Configure these on the production build trigger. Values must not be committed or printed:

- `NODE_VERSION`
- `PNPM_VERSION`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The Supabase values must come from the existing production project containing real users and data, not the similarly named empty project. Other frontend variables currently referenced by `apps/web` are `VITE_API_ORIGIN`, `VITE_DEV_AUTH_ENABLED`, `VITE_ENABLE_MOCK_DATA`, `VITE_PASSWORD_RESET_ORIGIN`, and `VITE_PUBLIC_WORKSPACE_DOMAIN`; their production-safe defaults are intentional for this deployment.

## Pre-cutover validation

Do not attach the production domain until the `workers.dev` deployment passes all checks:

1. Build with `pnpm --filter web... build`.
2. Validate with `pnpm exec wrangler deploy --dry-run`.
3. Open `/`, `/login`, `/agency/login`, and `/customer/login` in a real browser.
4. Confirm React mounts, the login UI is visible, direct nested routes refresh successfully, and JavaScript assets never return HTML.
5. Confirm there are no fatal console errors or missing Supabase variable errors.
6. Confirm `/api/health` reaches the Fastify API and returns JSON.
7. Verify the VPS independently at `https://api.kasimshah.com/health`.
8. Confirm API requests stay on the current frontend origin under `/api/*`.

## Recorded pre-cutover state

Captured on 2026-08-03 before any production DNS change:

- `app.kasimshah.com`: CNAME to `c0c1627977efc9ea.vercel-dns-017.com`
- Cloudflare proxy: disabled
- Cloudflare TTL setting: Automatic (`1` through the API; externally observed as 300 seconds)
- HTTP response: `402 DEPLOYMENT_DISABLED`, served by Vercel
- Vercel domain assignment: retained on the `ks-os` project
- `api.kasimshah.com`: unchanged and healthy; do not modify its DNS record

## Production cutover

1. Reconfirm the recorded CNAME still belongs to `app.kasimshah.com` and still targets Vercel.
2. Remove only that conflicting CNAME.
3. Attach `app.kasimshah.com` to `ks-os-web` as a Cloudflare Worker Custom Domain.
4. Wait for DNS and certificate activation.
5. Browser-test `https://app.kasimshah.com/` and `https://app.kasimshah.com/login`.
6. Confirm the response is served by Cloudflare, not Vercel, and no longer returns HTTP 402.
7. Confirm `/api/health`, nested routes, Supabase initialization, and the visible login screen still work.

Cut over only `app.kasimshah.com` first. The other Vercel domains (`booking.kasimshah.com`, `ks-agency.kasimshah.com`, and `barebeautykeighley.kasimshah.com`) require separate hostname-behaviour and browser validation before any later cutover.

## Supabase Auth

Keep the production Site URL at `https://app.kasimshah.com`. Prefer exact redirect URLs for production, including the application paths used for `/auth/callback`, `/reset-password`, `/agency/*`, and `/customer/*`. Add a precise Worker preview URL only while it is required for an authentication test; do not add a broad production wildcard.

## VPS handling

No VPS deployment, service restart, or database migration is part of this frontend migration. Health verification is read-only:

```bash
curl -fsS https://api.kasimshah.com/health
```

## Rollback

Vercel is currently disabled, so this rollback restores the previous routing state but may still return HTTP 402 until the Vercel billing restriction is resolved.

1. Detach the `app.kasimshah.com` Custom Domain from `ks-os-web`.
2. Restore only this exact DNS record:
   - Type: `CNAME`
   - Name: `app.kasimshah.com`
   - Target: `c0c1627977efc9ea.vercel-dns-017.com`
   - Proxy: disabled
   - TTL: Automatic (previously observed as 300 seconds externally)
3. Confirm DNS resolves to the restored Vercel target.
4. Re-test `/` and `/login` and record the response.
5. Leave `api.kasimshah.com`, the VPS, Supabase, and all additional domains unchanged.
