# Tenant offboarding

Offboarding is a lifecycle, never an immediate delete.

1. Record reason and move the tenant to `OFFBOARDING`.
2. Stop new operational use while preserving records.
3. Schedule the GoCardless subscription cancellation for the later of now and the minimum-term end.
4. Revoke support sessions, staff access and integration credentials at the appropriate date.
5. Complete/export contractual data, settle deliverables and document retention.
6. Mark `OFFBOARDED` and timestamp completion only when every obligation is complete.

Appointment payment data remains in the tenant's Stripe Connect domain and must not be converted into subscription records. Database foreign keys use restrict semantics for control-plane financial/audit records. No offboarding endpoint deletes tenant, customer, appointment, billing, audit or fulfilment data.

The authenticated agency worker endpoint `POST /api/v1/internal/agency-worker/offboarding` executes due provider cancellations, ends the active plan assignment, and marks the retained tenant `OFFBOARDED`. Tenant and public-booking authentication deny access while suspended or offboarding. Reactivation restores `ACTIVE` only after an operator verifies contract, subscription, entitlement and integration state.
