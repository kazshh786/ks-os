# Authenticated navigation information architecture

## Business workspace

1. Primary: Dashboard, Booking Calendar, Bookings
2. Customer Operations: Walk-in Desk, Customers, Forms
3. Sales and Money: Point of Sale, Payments, Finance
4. Growth and Insights: Analytics, Reports, Reviews
5. Work Management: Tasks, Automations, Operations
6. Administration: Team, Locations & Resources, Booking Page, Booking Policies, Integrations, Communications, Business Settings, Security

Dashboard and owner administration remain owner-only. Staff destinations are resolved from the server-issued booking, customer, forms, point-of-sale, reputation, tasks, and operations capabilities. Groups with no visible items are omitted. Create booking requires `BOOKINGS_CREATE` for staff and is always available to owners.

The public booking page is a secondary external action rather than a global module. Users may open it in a new tab or copy its URL.

## Agency portal

1. Agency: Overview, Businesses
2. Customer Delivery: Onboarding, Services, Support
3. Commercial: Billing, Plans
4. Operations: Jobs, Webhooks
5. Insights and Compliance: Analytics, Audit Logs
6. Administration: Team, Security

Every destination is filtered with agency capabilities and backed by an `AgencyCapabilityRoute` for direct URL attempts. The API remains the security boundary.

## Managed-business context

Opening `/agency/tenants/:tenantId` replaces the global agency navigation list with:

1. Summary
2. Onboarding
3. Billing
4. Features
5. Services
6. System Health

The same agency-styled sidebar shows Back to Businesses, Managing business, business name, lifecycle status, an authorized-business selector, a live-impact warning, and an explicit exit. The header also retains the business name. This is an agency management view, not the tenant workspace.

Operators with `support.session.start` receive an explicit Open support workspace action. It opens a reason, access-level, and expiry dialog before creating the audited session. The tenant workspace then displays the persistent support banner and returns to the selected agency business when exited.

## Responsive behavior

- Desktop: persistent 272 px sidebar with a persisted collapse preference.
- Collapsed desktop: 76 px rail with 40–44 px controls, icons, active state, accessible names, and hover/focus tooltips.
- Tablet and mobile: the persistent sidebar is replaced by a modal drawer from the contextual header.
- Mobile drawer: visible close control, scrollable grouped content, current identity, body scroll lock, Escape handling, Tab focus containment, and trigger focus restoration.

## Header and breadcrumbs

The header contains only current context: mobile menu, portal/business eyebrow, page title, nested context, help, bounded notification entry, workspace switcher where a tenant identity has multiple memberships, and MFA state in the agency portal. It never duplicates global navigation or exposes technical tenant/infrastructure data.

Nested routes inherit the active parent destination from the central matcher. Shallow routes use the page title without a redundant global tab bar.

## Portal direction

```text
Agency portal -> agency-managed business -> audited support workspace
Business workspace -X-> agency portal
```

Business navigation configuration contains only `/app/*` destinations. Agency configuration contains only `/agency/*` destinations. Tenant and agency session providers deliberately ignore the other portal context, and the respective route guards require their own session type.
