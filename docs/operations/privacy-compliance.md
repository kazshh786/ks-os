# Privacy, consent and audit operations

Only `PLATFORM_OWNER` and `AGENCY_ADMINISTRATOR` capabilities can manage privacy workflows. Support and fulfilment roles cannot. Browser roles have no direct database privileges on compliance tables; calls pass through the authenticated agency API.

Audit metadata is recursively filtered before insertion. Keys resembling passwords, tokens, secrets, cookies, card/bank data, medical data or form answers become `[REDACTED]`, and `contains_redactions` is set. Audit records are append-only through the existing database trigger and revoked update/delete grants. The compliance audit UI supports bounded pagination, date/category/outcome/search filters, event detail and queued CSV exports. Access to a client through audited support mode records the agency actor, tenant, route, result and request ID.

Consent is evidence, not mutable profile state. Grant or withdrawal creates a new `consent_records` row with wording/version, source, privacy-preserving IP hash, user agent and evidence metadata. A withdrawal can reference the record it supersedes. Never update old consent evidence.

Subject-access workflow: create request → verify identity out of band → set `PROCESSING` → privacy worker generates tenant/client-isolated JSON → private Storage object and checksum are recorded → request becomes `READY_FOR_DOWNLOAD` → authorised operator obtains a two-minute signed URL. Artifacts expire after 72 hours. Do not email raw exports.

Deletion workflow: verify identity → document dependency/retention review → choose strategy → approve and schedule. The worker checks active legal holds before action. `ANONYMISE` removes client contact/medical fields while preserving appointment and financial integrity; `DEACTIVATE` revokes sessions and deactivates memberships. Hard deletion, pseudonymisation and retention exceptions return to manual review until controller-approved processors exist. Completion audit stores only a proof hash, never deleted personal data.

Retention policies start disabled and dry-run enabled. Each creation writes an immutable version snapshot. Live runs require an enabled policy; the run idempotency key prevents duplicate daily execution. Approvers must review dry-run counts, legal holds, downstream backups/search/caches and the category-specific processor before enabling live action.

Data minimisation rules: do not log URLs containing tokens, request bodies, form answers, medical notes, raw IPs, full recipients, credentials or payment details. Prefer structured reason codes over free text. Transient links, report files and privacy exports require expiry. Sensitive fields remain restricted to role-specific routes.

