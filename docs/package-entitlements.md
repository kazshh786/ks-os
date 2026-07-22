# Package entitlements

Core, Growth and Scale are stable plan identities. Commercial terms live in immutable `platform_plan_versions`; assignments always point to a version so historic contracts do not change when a new version is published.

Entitlements are `BOOLEAN`, `QUANTITY`, `USAGE` or `SERVICE_LEVEL` and have `UNAVAILABLE`, `INTERNAL_PILOT`, `BETA`, `GENERALLY_AVAILABLE` or `RETIRED` availability. Ordinary assignments resolve generally available entitlements only. Explicit tenant overrides are reasoned, time-bounded and audited.

The initial historically versioned terms are Core £297 setup/£97 monthly, Growth £397/£297, and Scale £697/£497. They live in data, not feature logic. The versions seed staff, location and monthly booking allowances plus POS, automations, advanced analytics, inventory release state and support service level. API services—not navigation visibility—enforce premium features and limits. Monthly booking usage is derived from tenant-scoped appointment records, so retries cannot double-charge a quota counter.

Downgrades compare current active staff/locations with the target allowance. If over limit, the API returns blockers and preserves all data. Safe changes can be immediate or scheduled at the next subscription boundary. A scheduled change never mutates the old plan version.
