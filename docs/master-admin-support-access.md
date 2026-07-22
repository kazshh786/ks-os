# Master-admin support access

Support access is a controlled session, not impersonation. An authorised agency operator selects a tenant, enters a reason and chooses a scope/duration. The default is 30 minutes and the hard maximum is two hours.

The API returns an opaque token once. Only its SHA-256 hash is stored. The browser keeps the raw token in `sessionStorage`, sends it in `X-KS-Support-Session`, and clears it when ended. Do not put this token in a query string, logs, analytics or persistent storage.

Each request re-verifies the agency JWT, agency session, support token hash, actor, tenant, expiry and revocation. The real agency actor, support session and tenant are retained in `platform_audit_events`. The tenant workspace displays an amber banner with reason and expiry.

Support access blocks agency routes, finance, refunds, team/access administration, Stripe connection management and reputation provider connection management. The block is enforced at the API boundary. Read-only scope is recorded; endpoints should continue adding fine-grained read-only checks as new mutable modules are introduced.

To end access, use the banner or revoke the session from the agency API. Suspending an agency user also revokes that user's agency sessions.

