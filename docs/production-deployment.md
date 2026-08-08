# KS OS production deployment

## Deployment type

The standard production release is **BOTH** (VPS + Cloudflare):

1. **VPS** — Fastify API, durable site worker and shared Astro renderer (managed by GitHub Actions).
2. **Cloudflare** — `ks-os-web` Worker and static web assets routed through `kasimshah.com` and `www.kasimshah.com` (managed natively by Cloudflare Git integration).

The GitHub Actions workflow in `.github/workflows/deploy-production.yml` is the single deployment engine. Automatic deployments, the CLI command and the Agency portal button all invoke this same workflow.

## Automatic deployment after merge

A successful `CI` workflow on `main` triggers the production workflow automatically.

The release flow for automatic main deployments is:

1. `merge main`
2. `CI` passes
3. Cloudflare Git integration automatically builds and deploys Worker/Pages on push to `main`
4. GitHub Actions production workflow deploys VPS services (`ks-os-api`, `ks-os-site-worker`, `ks-os-sites`)
5. Workflow verifies VPS health checks
6. Workflow verifies Cloudflare public website (`https://kasimshah.com/`) and API health (`https://api.kasimshah.com/health`)
7. Release succeeds only when both VPS and Cloudflare are healthy

GitHub Actions does **NOT** run `wrangler deploy` or `pnpm deploy:cloudflare` in production.

## Manual BOTH / VPS / Cloudflare deployments

The Agency portal and CLI support manual releases:

- **both** (VPS + Cloudflare)
- **vps** (VPS only)
- **cloudflare** (Cloudflare only)

For manual `both` or `cloudflare` requests:
- The workflow triggers Cloudflare's native build pipeline using server-side Deploy Hooks (`CLOUDFLARE_DEPLOY_HOOK_URL`, `CLOUDFLARE_WORKER_DEPLOY_HOOK_URL`, `CLOUDFLARE_PAGES_DEPLOY_HOOK_URL`).
- Deploy Hook URLs are stored strictly in server-side GitHub secrets and are never exposed to browser JavaScript.
- The workflow polls and verifies public deployment health.
- Errors are reported without performing a direct `wrangler deploy` or `wrangler rollback`.

## CLI

From the repository root:

```bash
cd /srv/ks-os
pnpm deploy:production
```

This triggers the unified deployment workflow for **both VPS and Cloudflare** and waits for completion. The CLI requires GitHub CLI authentication and prints failed-step logs only when the run fails.

Targeted releases are also available:

```bash
cd /srv/ks-os
pnpm deploy:production:vps
pnpm deploy:production:cloudflare
```

A reviewed migration plan can be applied only through an explicit manual run:

```bash
cd /srv/ks-os
pnpm deploy:production -- --migrations
```

Do not use `--migrations` until the production migration plan has been reviewed.

## Agency portal

The **Deploy** control appears in the Agency portal header only for a `PLATFORM_OWNER` session.

The control choices make deployment ownership clear:

- **VPS + Cloudflare**: *"Deploy VPS and trigger the existing Cloudflare production pipeline."*
- **VPS only**: *"Deploy and verify VPS services."*
- **Cloudflare only**: *"Trigger and verify the existing Cloudflare production pipeline."*

The browser calls the API. The API stores and uses the GitHub token server-side, so credentials are never included in frontend code or responses.

## Secrets classification

Configure secrets according to their functional ownership:

### 1. VPS deployment secrets (GitHub Actions environment `production`)

| Secret | Purpose |
| --- | --- |
| `VPS_HOST` | VPS hostname or IP address reachable by GitHub Actions |
| `VPS_USER` | Restricted deployment account, normally `ksdeploy` |
| `VPS_SSH_PORT` | SSH port; omit or use `22` for default |
| `VPS_SSH_PRIVATE_KEY` | Private key for the deployment account |
| `VPS_KNOWN_HOSTS` | Pinned SSH host key entry for strict verification |

### 2. Cloudflare native deployment trigger secrets (GitHub Actions environment `production`)

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_DEPLOY_HOOK_URL` | Native Cloudflare Deploy Hook URL for manual triggering |
| `CLOUDFLARE_WORKER_DEPLOY_HOOK_URL` | Dedicated Worker Deploy Hook URL (if Workers and Pages use separate hooks) |
| `CLOUDFLARE_PAGES_DEPLOY_HOOK_URL` | Dedicated Pages Deploy Hook URL (if Workers and Pages use separate hooks) |

*Note: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are not required for production deployment or verification.*

### 3. Agency API secrets (VPS environment `/srv/ks-os/.env`)

```dotenv
KS_OS_GITHUB_DEPLOY_TOKEN=github-fine-grained-token
KS_OS_GITHUB_REPOSITORY=kazshh786/ks-os
KS_OS_GITHUB_DEPLOY_WORKFLOW=deploy-production.yml
```

`KS_OS_GITHUB_DEPLOY_TOKEN` must be a fine-grained token limited to this repository with **Actions: Read and write** access.

After changing the API environment, restart the API:

```bash
cd /srv/ks-os
sudo systemctl restart ks-os-api
sudo systemctl status ks-os-api --no-pager
curl -fsS http://127.0.0.1:5000/health
echo
```

## Cloudflare verification & rollback policy

The workflow verifies at minimum:
- `https://kasimshah.com/` (HTTP 200 and valid HTML shell content)
- `https://api.kasimshah.com/health` (HTTP 200 and JSON status `OK`, confirming commit/version match where available)

**Rollback ownership policy:**
- VPS deployment script retains its application rollback behavior for local VPS failures.
- GitHub Actions does **NOT** call `wrangler rollback` because Cloudflare Git integration owns deployment history.
- A failed Cloudflare verification fails the unified release and reports the error, but rollback responsibility remains with the Cloudflare deployment system.

## Release validation checks

The workflow release-checks step performs:

1. locked dependency installation;
2. full workspace build;
3. linting;
4. TypeScript checks;
5. the complete test suite;
6. migration manifest validation;
7. `wrangler deploy --dry-run` as a release validation step.
