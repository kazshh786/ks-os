# Site publication runbook

1. Confirm the target version has an exact `READY` quality run and a
   `READY` or acknowledged `READY_WITH_WARNINGS` publication gate.
2. Request publication in Site Studio. The API creates an idempotent
   publication run and durable worker job.
3. Monitor the publication run and job. A successful run records an immutable
   snapshot and advances the atomic pointer.
4. Confirm the expected snapshot reference, canonical hostname, `/book`,
   sitemap, robots, SSL, and health evidence.
5. If validation changes before execution, the worker fails closed. Resolve
   the reported gate and start a new quality run; do not edit the old evidence.

Never update a snapshot body or publication pointer manually. Never create a
tenant-specific hosting project.
