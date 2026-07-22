# Agency authentication

Agency identities use Supabase Auth for credentials but server-owned `agency_users` rows for authorisation. They do not require a `users` tenant membership.

Roles are `PLATFORM_OWNER`, `AGENCY_ADMINISTRATOR`, `SUPPORT_ADMINISTRATOR` and `FULFILMENT_ADMINISTRATOR`. Capabilities are derived on the API from the stored role. JWT metadata is never accepted as a role source.

Platform owners, agency administrators and support administrators must present an `aal2` JWT. `/agency/login` enrols or challenges a TOTP factor with Supabase MFA. Fulfilment administrators may use `aal1`, though MFA is recommended for every operator.

Agency sessions are keyed by the verified Supabase `session_id`, limited to the earlier of JWT expiry or eight hours from the original database session creation, checked for revocation on every request, listable, and revocable singly or in bulk. Supabase project inactivity and maximum-lifetime settings should be configured as an additional layer. Login/session endpoints are rate-limited; enable Supabase CAPTCHA and suitable Auth rate limits in production.

## First owner bootstrap

Create the person in Supabase Auth, then use a privileged database connection once:

```sql
insert into agency_users(auth_user_id,email_normalized,display_name,role,status)
values ('<supabase-user-uuid>','owner@example.com','Platform Owner','PLATFORM_OWNER','ACTIVE');
```

The owner must enrol TOTP on first agency login. Later agency users are invited through the owner-only API.

Required environment: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `AGENCY_INVITE_REDIRECT_URL` and a 32+ character `AUDIT_IP_HASH_SECRET`. `SUPABASE_SERVICE_ROLE_KEY` remains supported only as a legacy fallback.
