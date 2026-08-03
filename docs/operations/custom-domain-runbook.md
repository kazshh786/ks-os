# Custom domain runbook

1. Add the normalized hostname in Site Studio.
2. Run DNS discovery and review every returned record.
3. Preserve all email, security, service, and unrelated records. Conflicting
   apex or `www` records require an explicit agency decision.
4. Where nameserver delegation is required, give the customer the reviewed
   instructions and wait for independently verified delegation. Do not infer
   success from elapsed time.
5. Apply only approved website records, then verify ownership, certificate
   state, canonical routing, and health before activation.
6. For suspension or removal, preserve evidence and provider references.
   Removal starts a reassignment cooldown; only managed records may be removed.

If providers are disabled or credentials are incomplete, stop. Do not mark the
domain verified or active.
