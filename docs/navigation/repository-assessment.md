# Authenticated navigation repository assessment

## Previous business shell

`StaffWorkspaceLayout.tsx` combined three global navigation models: a 64 px icon rail, a horizontally scrolling module tab bar, and a permanently visible right panel. The rail mixed a public booking link, the tenant workspace, and a tenant-facing `/agency/system` link labelled as an agency control plane. The tab bar gave unrelated operational, financial, growth, and settings destinations equal visual weight.

The right panel derived a checkout candidate by loading and filtering the global bookings collection. It also exposed internal health, pipeline, heartbeat, and tenant-ID language. This reduced the usable width of calendars, reports, and forms.

## Previous agency shell

`AgencyLayout.tsx` used a global sidebar but added a second horizontal navigation bar for `/agency/tenants/:tenantId/*`. Labels exposed internal language such as Fulfilment, Entitlements, Audit, Agency users, and Health. The business being managed was not persistently identified in the global navigation, and switching or exiting management was not explicit.

## Authentication and authorization

- `/app/*` is wrapped by `ProtectedRoute` and obtains tenant identity from `AuthProvider` and `/api/v1/workspace/session`.
- `/agency/*` is wrapped by `AgencyGuard`, which loads a distinct `CONTEXT=AGENCY` session, checks application-session validity, and enforces MFA where required.
- Tenant authorization uses the `owner`/`staff` role plus server-issued capabilities from `@ks-os/auth`.
- Agency authorization uses the four agency roles and server-issued `AgencyCapability` values from `@ks-os/contracts`.
- API authorization remains authoritative. Frontend filtering prevents known inaccessible destinations from being presented but is not a replacement for server checks.

## Support access

The existing support mechanism is suitable for one-way agency-to-business access. An agency operator with `support.session.start` creates an expiring, tenant-bound token with a reason and scope. The API hashes the token, audits creation and use, scopes requests to the selected tenant, and blocks high-risk finance, refund, team, integration, reputation-connection, and agency paths. The browser stores the short-lived token in session storage and sends it only for tenant requests.

The previous entry UI was duplicated and described as an “audited support session” without sufficiently explaining the live-business effect. Exit returned to the business list rather than the selected business.

## Routes requiring special handling

- Nested report, finance, form, team, integration, communications, automation, task, and operations URLs must keep their parent navigation item active.
- `/app/settings` requires exact matching so it does not override more specific settings destinations.
- `/agency/tenants/:tenantId` must match Summary exactly; each child route must activate its own management item.
- `/app/settings/locations` and `/app/settings/resources` remain separate routes represented by one “Locations & Resources” destination.
- Staff land on the calendar; owners retain the dashboard landing page.
- Agency identities without analytics access land on Businesses rather than an inaccessible Overview.

## Performance findings

`WorkspaceContext` loaded the full booking collection on every tenant-shell mount and reloaded it for booking and event update notifications. Only the old global right panel consumed that collection. Booking, dashboard, reception, and point-of-sale pages already own their scoped data requests. The global booking state and listeners can therefore be removed without changing page-level data behavior. The operations badge continues to use the existing bounded summary hook.

## Problems addressed

- Competing navigation systems and weak hierarchy
- Tenant-facing agency route and language
- Global technical diagnostics and tenant identifiers
- Unnecessary full-booking shell query
- Permission-blind links and empty group headings
- Inaccurate broad route activation
- Missing mobile focus management
- Ambiguous agency-managed-business and support states
- Missing route-level agency capability checks
