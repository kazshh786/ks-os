# KS OS production deployment

KS OS deploys the Fastify API, durable site worker, and shared Astro renderer as one release. Public website content remains tenant data: only an immutable published snapshot selected by `site_publication_pointers` is rendered. Preview snapshots are never a public-host fallback.

## Production topology

- Repository: `kazshh786/ks-os`
- VPS checkout: `/srv/ks-os`
- Runtime user: `ksdeploy`
- API: `ks-os-api`, `127.0.0.1:5000`
- Durable website worker: `ks-os-site-worker`, health/readiness on `127.0.0.1:8091`
- Shared website renderer: `ks-os-sites`, `127.0.0.1:5001`
- Plesk/nginx terminates origin traffic and preserves `Host` and forwarded headers.
- Cloudflare owns public DNS/proxying. `playground.kasimshah.com` is noindex; this policy is not global.

The environment file is `/srv/ks-os/.env`. Never commit, print, or overwrite it during deployment. In addition to the normal database/Supabase values, website production requires:

```dotenv
NODE_ENV=production
PUBLIC_SITES_FALLBACK_DOMAIN=kasimshah.com
PUBLIC_SITES_PREVIEW_HOST=preview.sites.kasimshah.com
PUBLIC_SITES_NOINDEX_HOSTS=playground.kasimshah.com
PUBLIC_BOOKING_ORIGIN=https://app.kasimshah.com
SITE_PREVIEW_TOKEN_SECRET=<distinct secret of at least 32 characters>
SITE_DOMAIN_PROVIDER=cloudflare
CLOUDFLARE_ZONE_ID=<zone reference>
CLOUDFLARE_API_TOKEN=<server-side scoped token>
SITE_RENDERER_ORIGIN_HOST=<dedicated origin hostname>
SITE_AI_GENERATION_ENABLED=true
SITE_AI_PROVIDER=gemini
SITE_AI_MODEL=<governed model name>
SITE_AI_API_KEY=<server-side key>
SITE_QUALITY_ENABLED=true
SITE_QUALITY_BROWSER_ENABLED=true
```

`SITE_RENDERER_ORIGIN_IP` is an explicit IPv4 fallback only. Prefer the dedicated origin hostname. Never use `VITE_` for provider, database, preview, or AI secrets.

## First service installation

From the repository checkout on the VPS:

```bash
cd /srv/ks-os
sudo install -m 0644 scripts/deploy/systemd/ks-os-site-worker.service /etc/systemd/system/ks-os-site-worker.service
sudo install -m 0644 scripts/deploy/systemd/ks-os-sites.service /etc/systemd/system/ks-os-sites.service
sudo systemctl daemon-reload
sudo systemctl enable ks-os-site-worker ks-os-sites
```

Apply the relevant tracked directive from `scripts/deploy/plesk/` through Plesk's **Additional nginx directives** UI. Do not edit generated Plesk vhost files. The renderer configuration and playground vhost both apply noindex only to the playground hostname; the preview route enforces signed access, no-store, and noindex itself.

Cloudflare records must be exact and proxied only for KS OS-managed website A/CNAME routes. Existing mail, verification, and unrelated records are preserved. Before switching traffic, confirm the origin route with:

```bash
cd /srv/ks-os
curl --fail --header 'Host: playground.kasimshah.com' http://127.0.0.1:5001/health
```

## Controlled deployment

The checkout must be clean and on `DEPLOY_BRANCH` (default `main`). The script uses a fast-forward merge; it does not discard local changes.

```bash
cd /srv/ks-os
bash scripts/deploy/deploy-vps.sh --dry-run
```

The dry run installs the locked dependency graph, builds every workspace, runs deployment preflight, validates the migration manifest, and prints the migration plan. It applies no migration and restarts no service.

After reviewing the exact migration plan:

```bash
cd /srv/ks-os
APPLY_MIGRATIONS=1 bash scripts/deploy/deploy-vps.sh
```

The release is successful only when the API, worker health, worker readiness, and renderer health all return HTTP 200. A failed release checks out the previous application commit, rebuilds it, and restarts all three services. Database down-migrations are never automatic; use a new compensating migration when required.

## Guarded Luma playground bootstrap

Run only after migrations, service health, Cloudflare/Plesk routing, and production environment validation succeed:

```bash
cd /srv/ks-os
LIVE_PLAYGROUND_BOOTSTRAP_ENABLED=true \
LIVE_PLAYGROUND_SUBDOMAIN=playground \
LIVE_PLAYGROUND_HOSTNAME=playground.kasimshah.com \
pnpm playground:website:bootstrap
```

The command is intentionally pinned to the fictional `Luma Beauty Studio` workspace and is resumable. It creates/reuses canonical booking data, completes the normal fact-finding review and locked-brief lifecycle, validates a ten-page Northlight provisioning draft, and queues the existing durable provisioning workflow. It outputs references only and never prints generated passwords or credentials.

It does **not** approve its own website review. An authorised person must inspect the signed preview in Site Studio, record the real review decision, run the exact-version quality gate, explicitly acknowledge any warnings, and then publish. Only the pointer-backed live URL is valid evidence of launch.

## Live verification

After human approval and publication, verify at minimum:

```bash
cd /srv/ks-os
curl --fail --silent https://playground.kasimshah.com/health
curl --fail --silent --head https://playground.kasimshah.com/
curl --fail --silent https://playground.kasimshah.com/robots.txt
```

Confirm `/`, representative service/about/contact pages, and the real `/book` path return successful responses; tenant identity and canonical metadata are correct; playground responses include noindex; preview responses remain token-protected; and the API, worker, and renderer remain healthy after traffic begins.
