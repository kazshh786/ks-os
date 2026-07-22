# Phase 6.1 verification

Automated coverage includes strict schema rejection, required/unknown/type/option answer validation, deterministic non-plaintext token hashing, safe public rendering and success rendering. The migration was not applied to production.

At implementation time, Phase 6.1 shared packages compiled. Full API verification was blocked by concurrent, out-of-scope Phase 6.3 SMS sources referencing missing schema/package symbols. The web typecheck also exceeded the execution timeout after consent-form compile errors were resolved. Re-run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` after that concurrent work is reconciled.

Manual browser verification requires a migrated development database and fictitious data. Verify two published versions, original-version rendering, owner/assigned-staff/unrelated-staff access, link regeneration/cancellation/expiry, duplicate submission, log redaction, and explicit live failures without mock substitution.
