# Agency login

Agency operators use `/agency/login`. Password verification remains in the Supabase browser client; Fastify does not receive a password. After identity verification, `/api/v1/agency/session` permits only an active `agency_users` record and returns a safe agency session projection.

Privileged roles are routed to `/agency/mfa/enrol` or `/agency/mfa/challenge`. `/agency` remains guarded until the verified token carries AAL2. Tenant owners and customers receive access denied even if their Supabase password is valid.

Agency invites are created by a Platform Owner through the server-side Admin client. An invited operator must follow the secure invite, create a password when the Supabase identity is new, accept the local access intent, and complete required MFA before the control plane opens.

Suspension increments `security_version` and revokes agency/application sessions. Reactivation does not revive old sessions. Security settings list opaque session references and allow local or global sign-out.

