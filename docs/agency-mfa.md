# Agency MFA

KS OS uses Supabase TOTP factors. No TOTP secret or QR payload reaches Fastify or application storage.

Enrolment calls `mfa.enroll`, shows the Supabase-generated QR code once, and completes with `challengeAndVerify`. Returning users list verified TOTP factors and complete a new challenge. The API reads the verified JWT `aal` claim and blocks protected agency capabilities until AAL2 is present.

MFA recovery is not self-service and there are no application backup codes. A different authenticated Platform Owner must complete the external identity-verification runbook, provide a detailed reason, and call the rate-limited recovery endpoint. The server deletes the specified factor through Supabase Auth Admin, revokes every local agency session, increments the security version, and appends an audit event. The target must enrol a new authenticator on next login. Platform Owners cannot reset their own factor through this endpoint.

Supabase documents that deleting a verified factor signs the target out of active Auth sessions; KS OS also enforces local revocation for immediate application denial. See [Supabase admin factor deletion](https://supabase.com/docs/reference/javascript/auth-admin-deletefactor).

