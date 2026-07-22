# Supabase Auth configuration

Repository configuration does not change a remote Supabase project automatically. Apply the following in each intended project and verify staging before production.

## URLs

Set the Site URL to the canonical frontend origin. Add exact redirect allowlist entries for:

- `https://<frontend>/auth/callback`
- `https://<frontend>/customer/auth/callback`
- the equivalent local development URLs, normally `http://localhost:3000/...`

Use exact production URLs; avoid broad wildcards. Configure the repository values `TENANT_INVITE_REDIRECT_URL`, `AGENCY_INVITE_REDIRECT_URL`, tenant/agency/customer password-reset redirect variables, and `PUBLIC_APP_ORIGIN` to those same origins.

The browser client is configured for PKCE when a browser-initiated flow supplies a verifier, and the callback handles a one-use code only when that verifier exists. Supabase Admin invitations are intentionally different: Supabase documents that `inviteUserByEmail` does not use PKCE because invitation creation and acceptance normally happen in different browsers. The browser client therefore also detects and consumes Supabase's supported invitation/recovery session callback. KS OS never generates or stores the underlying token. See [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [Admin invitations](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), and [redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Email and SMTP

Configure production custom SMTP in Supabase Auth using the dedicated Resend authentication sender. Store the Resend API key only in deployment/project secrets. Keep `EMAIL_AUTH_FROM` on a verified sending domain and configure SPF, DKIM, and DMARC. Templates must use Supabase's generated confirmation URL variable; do not construct token URLs in KS OS.

Configure and brand the Supabase invitation, password-recovery, and email-change templates. Keep wording neutral so it does not reveal whether an account exists. Test expiry, resend, already-used link, and wrong-environment redirects.

## Auth policy

- Disable public signup for agency and tenant accounts.
- Keep customer magic-link behaviour separately configured.
- Enable TOTP MFA.
- Configure Supabase login, OTP, invite, recovery, and email-send rate limits appropriate to the environment.
- Use asymmetric signing keys and `getClaims` verification where available.
- Never expose `SUPABASE_SECRET_KEY` to Vite or the browser. `SUPABASE_SERVICE_ROLE_KEY` is accepted only as a legacy server-side fallback.

Relevant references: [Supabase Auth client guidance](https://supabase.com/docs/reference/javascript/auth), [TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp), [MFA assurance levels](https://supabase.com/docs/guides/auth/auth-mfa), and [Auth sessions](https://supabase.com/docs/guides/auth/sessions).

## Verification status

No Supabase MCP connection was available in the implementation environment. Therefore Auth settings, SMTP, users, migrations, RLS advisors, and the remote redirect allowlist were not inspected or changed. Verify them explicitly before deployment.
