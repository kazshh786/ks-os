# Incident runbooks

Every incident records severity (SEV-1 safety/security or total outage; SEV-2 major degradation/data risk; SEV-3 limited impact), incident commander, communications owner, timeline, request/release IDs and preserved evidence. Contain first; do not destroy logs or rotate all credentials before evidence capture.

| Incident | Detection and containment | Recovery and verification |
|---|---|---|
| Primary database outage | Readiness 503, connection alerts; stop workers/writes, preserve logs, open provider incident | Fail over/PITR per DR guide; verify integrity, auth, booking and backlog before traffic |
| Corrupt deployment | Error/latency spike after release; remove release from traffic | Restore previous compatible release; forward-fix schema; run smoke tests and monitor 30 minutes |
| Accidental deletion | Audit/user report; freeze affected tenant and retention jobs | Restore to isolation, compare, controlled transactional merge, verify relationships, document proof |
| Credential compromise | Secret scan/provider alert/anomalous auth; disable key/account and sessions | Rotate least-dependent secret first, redeploy, replay-safe verification, review audit and scope |
| Storage outage | Upload/download failures; pause export workers | Provider recovery/failover, verify private ACLs and sample hashes, resume bounded queue |
| Queue/worker outage | Oldest-job age/retry spike; stop poison job | Scale/restart consumers, quarantine poison messages, preserve idempotency, drain gradually |
| Payment provider outage | Provider/webhook/checkout error spike; disable new provider actions | Use provider status, retain pending states, reconcile webhooks/payments before resuming |
| Webhook backlog | Pending age/count rises; block manual bulk replay | Restore consumers, process oldest-first with signature/idempotency checks, reconcile totals |
| Domain/certificate failure | Uptime/TLS expiry alert; preserve current DNS | Renew/replace certificate, validate chain/hostname/redirect/HSTS, monitor propagation |
| Major security incident | Detection rule, audit spike, disclosure; isolate affected services/accounts | Engage legal/DPO/forensics, rotate scoped credentials, restore trusted release, notify per policy |

For all runbooks: communicate at the cadence set by severity, escalate to provider/support/legal when thresholds are crossed, verify from an external client, document residual risk, and hold a blameless review within five working days with owned actions.

