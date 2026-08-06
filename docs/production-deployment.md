# KS OS production deployment

## Deployment type

The standard production release is **both**:

1. **VPS** — API, site worker and shared renderer.
2. **Cloudflare** — `ks-os-web` Worker and the static web assets routed through `kasimshah.com` and `www.kasimshah.com`.

The GitHub Actions workflow in `.github/workflows/deploy-production.yml` is the single deployment engine. Automatic deployments, the CLI command and the Agency portal button all invoke this same workflow.

## Automatic deployment after merge

A successful `CI` workflow on `main` triggers the production workflow automatically.

The release will not start if CI fails. Automatic releases:

- deploy **both VPS and Cloudflare**;
- rebuild and re-run release checks;
- never apply database migrations;
- run one at a time through the `production-deploy` concurrency group;
- expose detailed output only when a stage fails.

## CLI

From the repository root:

```bash
cd /srv/ks-os
pnpm deploy:production
```

This deploys **both VPS and Cloudflare** and waits for GitHub Actions to finish. The CLI requires GitHub CLI authentication and prints failed-step logs only when the run fails.

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

The control supports:

- VPS + Cloudflare;
- VPS only;
- Cloudflare only;
- an optional reviewed migration toggle for VPS releases;
- status polling without exposing credentials;
- failed stage names only, with a link to the protected GitHub run for full operator diagnostics.

The browser calls the API. The API stores and uses the GitHub token server-side, so the token is never included in frontend code or responses.

## GitHub production environment

Create a GitHub Actions environment named `production`. Configure branch protection or required reviewers according to the production approval policy.

Add these environment secrets:

| Secret | Purpose |
| --- | --- |
| `VPS_HOST` | VPS hostname or IP address reachable by GitHub Actions |
| `VPS_USER` | Restricted deployment account, normally `ksdeploy` |
| `VPS_SSH_PORT` | SSH port; omit or use `22` for the default |
| `VPS_SSH_PRIVATE_KEY` | Private key for the deployment account |
| `VPS_KNOWN_HOSTS` | Pinned SSH host key entry for strict verification |
| `CLOUDFLARE_API_TOKEN` | Scoped token permitted to deploy the Worker |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account containing the Worker |

The VPS deployment account must be able to:

- read and fast-forward `/srv/ks-os` from `origin/main`;
- run the locked pnpm toolchain;
- restart `ks-os-api`, `ks-os-site-worker` and `ks-os-sites` through narrowly scoped passwordless `sudo` rules;
- install `/run/ks-os/release.env` through the existing deployment script.

## API runtime configuration

Set the following server-only variables in the production API environment:

```dotenv
KS_OS_GITHUB_DEPLOY_TOKEN=github-fine-grained-token
KS_OS_GITHUB_REPOSITORY=kazshh786/ks-os
KS_OS_GITHUB_DEPLOY_WORKFLOW=deploy-production.yml
```

`KS_OS_GITHUB_DEPLOY_TOKEN` must be a fine-grained token limited to this repository with **Actions: Read and write** access. The repository and workflow values are optional when the defaults above are correct.

After changing the API environment, restart the API:

```bash
cd /srv/ks-os
sudo systemctl restart ks-os-api
sudo systemctl status ks-os-api --no-pager
curl -fsS http://127.0.0.1:5000/health
echo
```

## Release checks

The workflow performs:

1. locked dependency installation;
2. full workspace build;
3. linting;
4. TypeScript checks;
5. the complete test suite;
6. migration manifest validation;
7. a Cloudflare dry run when Cloudflare is included;
8. the existing VPS dry run and deployment script;
9. systemd and local VPS health checks;
10. Cloudflare production deployment and public web/API checks.

The existing VPS script retains its application rollback behavior. If a Cloudflare deployment completes but its public verification fails, the workflow requests a Cloudflare rollback to the previous deployment.

## Required one-time validation

Before enabling automatic production deployment:

1. add all GitHub environment secrets;
2. add the API deployment token to the VPS environment;
3. run the workflow manually with `target=both` and `apply_migrations=false`;
4. confirm the VPS services, `https://api.kasimshah.com/health` and `https://kasimshah.com/` are healthy;
5. enable or retain the `workflow_run` automatic trigger.
