# Backup and disaster recovery

## Proposed objectives (approval required)

Tier 0 Auth/database: RPO 15 minutes, RTO 2 hours. Tier 1 booking/API/private files: RPO 1 hour, RTO 4 hours. Tier 2 reporting/analytics: RPO 24 hours, RTO 24 hours. Proposed maximum tolerable customer-facing downtime is four hours.

Enable Supabase scheduled backups and point-in-time recovery for production. Retain daily backups 35 days, monthly backups 12 months, and quarterly recovery-test evidence 24 months, subject to legal approval. Copy encrypted backups to a separately administered account/region with MFA, least-privilege restore roles and deletion protection. Configure provider alerts for missed/failed backups. Never place dumps or credentials in Git.

Private Storage backup must include uploads, report exports that remain within retention, privacy exports that have not expired, and required integration artefacts. Git is the source of truth for application code, migrations and infrastructure configuration; secrets must be backed up only through the approved secret manager.

## Full restore

1. Declare an incident, freeze writes/workers/webhooks and record the release/database identifiers.
2. Verify restore operator, target isolation, encryption, free capacity and `DATABASE_URL`; never overwrite the only good copy.
3. Restore the selected snapshot/PITR point into a new Supabase project or isolated database.
4. Configure separate Auth, Storage, queue and provider test credentials. Do not point restored staging at live payment/email/SMS webhooks.
5. Run migration status/checksum validation, foreign-key/orphan checks, critical row counts and `SELECT 1`.
6. Start API, then workers, then web. Verify `/health/live`, `/health/ready`, authentication, tenant isolation, availability and a test-mode booking. Confirm payment records without creating charges.
7. Restore Storage into a private bucket and sample hashes/metadata. Verify expired privacy/report files remain unavailable.
8. Record start/end time, chosen recovery point, validation evidence, errors and approver. Switch DNS/traffic only after incident commander approval.
9. Rollback by routing traffic to the previous healthy stack; never attempt destructive database rollback. Use an reviewed forward fix when schema changed.

For individual files, restore to a quarantine prefix, verify hash/ownership/content type, malware-scan if applicable, then copy to the canonical path. For accidental deletion, place the affected tenant under operational hold, restore to isolation, extract only required records with referential checks, then audit the controlled merge.

Quarterly recovery tests must restore a recent backup into an isolated environment and record RPO/RTO achieved, table counts, constraints, authentication, booking, non-charging payment records, Storage samples and smoke-test results. A failed test is a severity-2 incident and blocks claims of recoverability.

