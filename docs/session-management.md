# Session management

Supabase owns credential sessions. KS OS maintains a context-specific application session ledger using the verified Auth `session_id` claim.

Each record includes an opaque public reference, application context, selected membership where relevant, assurance level, security-version snapshot, bounded device summary, hashed IP, expiry, last-seen time, and revocation state. It contains no access or refresh token.

Agency sessions retain the Phase 12 eight-hour hard maximum. Tenant sessions default to 24 hours and customer application sessions to 30 days, each capped by the Supabase JWT/session expiry and configurable within bounded environment ranges.

`/api/v1/auth/sessions` lists sessions for the current identity and explicit context. A user can revoke one session, sign out locally, or sign out everywhere. Global sign-out revokes local sessions, increments agency/membership security versions, and advances the local `sessions_valid_after` cutoff; the frontend also requests Supabase global sign-out. The API compares the verified JWT `iat` claim to that cutoff, so an already-issued JWT cannot establish a replacement application session after global revocation.

Suspension, deactivation, MFA recovery, and administrator revocation also revoke local sessions and advance the applicable account or membership cutoff. Reactivation never clears the cutoff and therefore requires a newly issued Supabase token. A tenant membership cutoff applies only to that membership, so access to unrelated businesses remains intact.
