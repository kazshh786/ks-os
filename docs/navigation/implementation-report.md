# Authenticated navigation implementation report

## Summary

The authenticated web application now uses one shared navigation component system for the tenant workspace, agency portal, and agency-managed-business context. Long link lists live in typed configuration modules, are filtered once against role/capability context, and use one route matcher for active state.

## Implementation

- Added typed business, agency, and managed-business navigation configurations.
- Added central role, permission, agency-capability, feature-flag, route-template, filtering, and matching utilities.
- Added reusable sidebar, group, item, mobile drawer, contextual header, managed-business context, and account-menu components.
- Replaced the tenant icon rail, global horizontal tabs, right diagnostics panel, and `/agency/system` link.
- Replaced agency tenant horizontal tabs with the managed-business sidebar.
- Added persisted independent collapse preferences for both portals.
- Added tenant workspace switching only for actual tenant memberships.
- Added agency authorized-business switching only in agency management context.
- Added a permission-checked support dialog and clearer live-business banner/exit path.
- Added tenant capability checks to staff routes and agency capability checks to agency routes.
- Removed the full-booking query and event listeners from `WorkspaceContext`.

## Accessibility and responsive behavior

Navigation uses named `aside`/`nav` landmarks, visible labels, `aria-current`, labelled icon controls, minimum-height controls, visible focus rings, text-safe truncation, and non-color active semantics. The mobile drawer locks page scrolling, contains Tab focus, closes with Escape, restores focus, and exposes a visible close button. Collapsed items retain names through title and hover/focus tooltips.

## Security and portal separation

Tenant navigation contains no agency route. Agency navigation is built only after the agency session and its server-issued capabilities are available. Direct agency page routes now require matching capabilities in addition to `AgencyGuard`; API permission enforcement remains authoritative. Support entry requires `support.session.start`, a selected tenant, a reason, scope, and expiry. API high-risk support-path blocking and audit behavior are unchanged.

## Performance

The application shell no longer waits for or retains every booking. Booking/calendar data remains route-owned. Only the existing bounded operations-summary request is used for an actionable navigation badge, and the agency tenant selector loads only while managing a tenant.

## Verification

The implementation is covered by navigation resolution, capability filtering, feature filtering, portal isolation, nested active matching, owner/staff layouts, managed-business context, mobile focus containment, Escape, scroll-lock, and focus-restoration tests.

- `pnpm lint`: passed across all workspaces (the repository lint scripts are currently placeholders).
- `pnpm typecheck`: passed across all 10 workspace projects.
- `pnpm test`: passed; 292 API tests, 55 web tests, 2 notification tests, and 1 email-template test.
- `pnpm build`: passed across all workspaces, including the Vite production build.
- Browser check: business and agency guards redirected to their separate sign-in routes; desktop and 390 px pages rendered meaningful content without a Vite overlay or page errors.
- `git diff --check`: passed.

## Remaining optional improvements

- A permission-aware command palette was intentionally left out because it was optional and should be designed alongside cross-feature search endpoints.
- Rich entity-name breadcrumbs require page-level route metadata or loaders; the shared header currently provides reliable module and managed-business context.
- Automated visual regression and computed color-contrast checks would benefit from a dedicated authenticated browser fixture in CI.
- The existing Vite build still reports a large main-chunk warning; route-level lazy loading should be handled as a separate performance change.
