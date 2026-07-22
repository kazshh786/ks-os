# Master-admin support context

Agency administrators cannot become a tenant user by changing a URL or supplying a tenant ID. They must start the existing audited support-session flow with a reason, bounded duration, and `READ_ONLY` or `STANDARD_SUPPORT` scope.

The raw support token is returned once, stored only in browser session storage for the handoff, and stored as SHA-256 in the database. Tenant requests still carry an AAL2 agency identity. Fastify validates the support token, agency actor, expiry, revocation, tenant, scope, and high-risk route denylist before producing a tenant context.

The workspace shows the Phase 12 support banner. Audit events identify the agency administrator, support session, tenant, route, request, and outcome. Finance, refunds, team access, Stripe connection, review credentials, and agency routes remain blocked. Ending or expiring support removes tenant access immediately.

