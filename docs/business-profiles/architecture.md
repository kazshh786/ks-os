# Business Profile foundation

KSOS remains one React/Vite application, one Fastify API, and the existing Supabase/Drizzle database. Tenant means business. Identity, membership selection, owner/staff levels, access profiles and capability overrides remain the security foundations.

## Resolution

Universal core → authenticated tenant → normalized business type and product answers → Business Profile → enabled implemented modules → entitlements → user capabilities → navigation and dashboard.

The server resolves the selected membership in AuthenticationService.workspaceSession before reading the joined tenant's businessType and businessProfile. Neither body parameters nor Supabase user metadata selects a profile. A session without a selected membership has no business profile. Staff use the identical tenant configuration and retain their own effective capabilities. Business Profile configuration never grants access to an API or upgrades a plan.

## Central registries

packages/contracts/src/business-profile.ts contains:
- BUSINESS_TYPES: the twenty canonical types, labels and explicit legacy aliases.
- normalizeBusinessType: case, diacritic, whitespace and punctuation normalization with exact alias lookup; unknown input returns null.
- MODULE_REGISTRY: canonical keys, implementation status, real route, capability alternatives, owner restrictions, entitlement keys and industry recommendations.
- resolveBusinessProfile: terminology, recommended and enabled modules, navigation metadata, dashboard composition, operating model, optional engines, future pipeline metadata and onboarding defaults.
- terminology and canUseProfileModule: shared presentation and visibility helpers.

No destructive type migration is performed. Existing free text remains stored as supplied. Known salon aliases become salon profiles. Unknown legacy types retain the existing experience in compatibility mode until configured. An owner explicitly saving setup may change the type. Profile state returned to callers is independent of other tenants.

Inventory is an existing beta engine. Communications includes existing settings and history; Inbox is the existing operations/conversations engine. Documents and work are foundations, while sales, projects, social, fleet, dispatch, routes and assets are planned. Their recommendations can be recorded but they have no production navigation route.

## Navigation and dashboard

Existing navigation IDs map to registry keys through navigationModule. The resolver applies profile enablement and implementation status, then plan entitlements and existing capabilities/owner restrictions. Unentitled modules are hidden when a resolved profile is available. The existing locked-link fallback remains for older session payloads. Existing route and API guards remain authoritative; hiding navigation is not authorization.

Salon keeps its established navigation when entitled. Logistics defaults to available CRM, tasks, inbox, forms, communications, payments, finance and administration; fleet/routes are not manufactured. Agency adds its client terminology and existing email tools without fake project pages.

DashboardOverview loads the existing live dashboard endpoint. DashboardWidgets composes independently selectable booking summary, customer summary, revenue summary, operations, daily trend, top services and staff utilisation. BookingOperationsSummary is mounted only for booking profiles. Current revenue and operational aggregates retain their existing transaction/booking semantics; this is not a new universal finance or job reporting service.

## Product onboarding

/app/onboarding is owner-only and linked from Business information. It collects business name/type, team size, buying methods, work delivery, resources, payment methods and management needs. Plain-language answers generate module defaults. Selecting a type proposes defaults; the owner can adjust every choice before saving. Unsupported needs are retained without creating non-working tools.

GET and PUT /api/v1/workspace/product-onboarding operate exclusively on request.auth.tenantId. PUT uses a strict closed schema, rejects tenant identifiers, arbitrary permissions/modules and support impersonation, and updates tenant name/type/configuration with an audit event in one transaction. Failed validation does not mutate data.

An owner accessing an ONBOARDING tenant with no completed product setup is sent to this flow. Existing ACTIVE businesses retain their working experience and can opt in through settings. Staff are never redirected to setup. Workspace selection runs first and remains available. This phase uses the existing account provisioning/invitation entrypoints; it does not introduce public self-service tenant creation or rewrite signup authentication.

Agency/commercial onboarding remains the agency sales, contract, fact-finding and provisioning workflow. Product onboarding configures the business owner's operational workspace. Neither workflow is treated as the other's completion status.

## Persistence and deployment

The additive migration 20260905120000_business_profile_foundation.sql adds nullable tenants.business_profile JSONB. The migration is registered in the existing manifest. Its version 1 object contains completedAt and validated answers. No existing tenant or CRM fields are dropped, backfilled or rewritten. No table, Business model, auth identity, role or permission system is added. Tenant deletion clears the configuration.

Deployment classification: **VPS only**. No Cloudflare infrastructure changes.
Apply the migration before starting code that selects the new tenant column. Inspect status and the repository migration plan; do not deploy with APPLY_MIGRATIONS=0 while this migration is pending. Use the repository's VPS dry run, approved deployment procedure, systemd status and /health checks. Rollback may leave the nullable additive column in place. No production deployment is part of branch validation.

## CRM extensions

Existing clients remains the canonical CRM record. CRM_FIELD_GROUPS identifies implemented identity/contact fields, engagement fields and salon care fields, and explicitly lists future universal fields. It does not pretend address, relationships, status, source, owner, notes and tags are already fully implemented.

SalonCareDetails contains the existing medical/patch-test presentation and is shown only by profiles enabling salon-care. Existing backend medical-data capabilities remain intact. Existing production columns and historical data remain unchanged.

BusinessFieldDefinitionSchema establishes future typed, namespaced, capability-aware extension definitions. It is not a custom-object or arbitrary field-write API. Future storage must bind definitions and values to the authenticated tenant and canonical client, enforce type validation and sensitive-field permissions on the server, audit writes, and exclude unauthorized fields from exports.

## Adding an industry or engine

1. Add a canonical key, display label and unambiguous aliases.
2. Provide terminology and choose a reusable operating model.
3. Configure recommendations, onboarding defaults, CRM extensions and dashboard widgets centrally.
4. Add only real, verified engine routes to implemented metadata; keep future engines planned/foundation.
5. Map navigation to canonical modules, preserving route/API capability guards and entitlements.
6. Test normalized aliases, unknown fallback, owner/staff visibility, plan filtering, session tenant scope and rendering.
7. Update the gap analysis. Prefer shared capabilities over a separate industry application.

Future business-specific access profiles such as finance, driver or teacher should be presets over existing capabilities, not new authentication roles.

## Audited businessType uses

The initial audit found nineteen code files referencing businessType: the database schema; agency contracts and creation screens; agency provisioning/internal booking tenant creation; lifecycle deletion; website generation/blueprint/provisioning inputs; bootstrap scripts; and their tests. These store or pass through descriptive data rather than branching operational UI. Existing writes remain compatible with free text. Website pipelines still use descriptive business input and do not depend on canonical uppercase values. The operational profile resolver is the central place for industry behaviour.

## Verification

The branch adds normalization, registry, profile, navigation/capability/entitlement, product route scoping and workspace session tests. Existing authentication, selection, invitation, tenant-isolation, CRM and salon dashboard tests remain part of the repository suite. GitHub CI runs pnpm build, pnpm lint, pnpm typecheck and pnpm test, plus migration planning. The repository's web and API lint scripts currently print success rather than performing a full lint analysis; typecheck and tests provide the substantive automated checks.
