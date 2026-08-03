# Phase 15.9 site publishing and domains

Phase 15.9 publishes data, not application deployments. Every tenant website is
served by the existing shared `apps/sites` renderer. A publication creates an
immutable `PUBLISHED` render snapshot and atomically advances the site's
`site_publication_pointers` row. No tenant-specific project or deployment is
created.

Publication is fail-closed. The worker rechecks that the exact site-version
digest, quality run, policy, knowledge pack, template, renderer, and warning
acknowledgement remain valid. A previous snapshot remains available for
rollback. Runtime resolution reads only the active pointer.

Fallback hostnames use `<tenant-subdomain>.sites.kasimshah.com`. Custom
hostnames pass normalization, ownership, DNS review, verification, SSL, and
health states before activation. Provider credentials remain server-side.
Provider-disabled mode records no implied success and makes no network call.

DNS discovery classifies records before any plan can be approved. Email,
security, service, and unrelated records are protected. KS OS may modify or
remove only records it created and tracks. Managed website records remain
DNS-only so the shared renderer and certificate provider retain control.

The additive migration is
`20260727130000_phase_15_9_site_publishing_domains.sql`. It adds publication,
pointer, domain evidence, provider-operation, health, cache, rollback, and
audit records with tenant/site scope triggers, RLS, least-privilege grants, and
append-only evidence protections.

Development migration application is a separate, explicitly authorised
operation. This implementation does not deploy, publish a real site, or call
Cloudflare or Vercel.
