# Site publication rollback runbook

1. Identify the current pointer and a prior immutable `PUBLISHED` snapshot for
   the same tenant and site.
2. Record the agency reason and request rollback through the controlled API/job
   path.
3. The worker verifies ownership and snapshot kind, then advances the pointer
   version atomically. Snapshot contents are never rewritten.
4. Invalidate tenant/site/snapshot cache tags and rerun bounded health checks.
5. Confirm the prior snapshot reference is live on every active hostname.

If the target snapshot is from another tenant/site, is not `PUBLISHED`, or
fails integrity validation, the rollback must fail closed.
