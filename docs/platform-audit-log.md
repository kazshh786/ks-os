# Platform audit log

`platform_audit_events` records agency user, support session, tenant, action, target, outcome, reason, request ID, privacy-preserving IP hash, safe metadata and timestamp.

Audit events are append-only. The migration installs a trigger that rejects updates and deletes, revokes those operations from `service_role`, enables RLS and revokes browser-role access. The application never stores request bodies, credentials, support tokens, bank information, medical notes or customer-form answers in audit metadata.

All agency mutations and support-mode tenant requests emit an event. Operational monitoring must alert on audit insert failure because an unaudited privileged mutation is a security incident. Retention and immutable archival should be set according to Kasim Shah LTD's legal and insurance requirements.

The `/agency/audit` page is capability guarded and returns a bounded recent window. Long-range access should use a private audited export, not an unbounded browser query.

