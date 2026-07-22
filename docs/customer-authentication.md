# Customer Authentication — Phase 10.1

## Overview

Customer authentication in KS OS uses Supabase passwordless magic-link sign-in (OTP via email). Customers never create a password. This document describes the flow, session handling, and security properties.

## Sign-in Flow

```
1. Customer visits /customer/login
2. Customer enters their email address
3. The frontend calls: supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })
4. Supabase emails a magic link
5. Customer clicks link → /customer/auth/callback?code=...
6. Frontend calls: supabase.auth.exchangeCodeForSession(code)
7. Session is established; customer is redirected to /customer (or /customer/claim/:token)
```

## Session Representation

Supabase returns a JWT access token. The frontend stores the session via the Supabase JS client (using localStorage or cookies as configured). The `fetchWithAuth` client wrapper attaches `Authorization: Bearer <token>` to all API requests.

On the API side, `auth.ts` calls `supabase.auth.getClaims(token)` to verify and decode the JWT without a database roundtrip. The decoded identity is stored as `request.authIdentity`:

```typescript
request.authIdentity = {
  authUserId,  // Supabase Auth UID (uuid)
  email,       // Normalised email
};
```

## Staff vs Customer Session Isolation

Both staff and customers may share the same Supabase project, but the application logic enforces a hard separation:

| Context | request.auth | request.authIdentity |
|---|---|---|
| Staff session | Set (with tenantId, role, permissions) | Set |
| Customer session | Not set | Set |
| Unauthenticated | Not set | Not set |

`CustomerAuthService.requireIdentity()` throws `CUSTOMER_ACCESS_DENIED (403)` if `request.auth` is truthy. This prevents a staff user from accidentally or maliciously using the customer portal API.

## Token Refresh

If the API returns 401, the frontend's `fetchWithAuth` function automatically calls `supabase.auth.refreshSession()` and retries the request once. If the refresh fails, the user is signed out and redirected to `/customer/login`.

## Sign-Out

Clicking "Sign out" in the portal calls `supabase.auth.signOut()` and navigates to `/customer/login`. The session is immediately invalidated client-side.

## Security Notes

- Magic-link emails are sent by Supabase directly and are not routed through KS OS email infrastructure.
- The email address is not enumerated: the login form always displays the same "check your inbox" message whether an account exists or not.
- SMS OTP is explicitly excluded from Phase 10.1.
- Magic-link expiry is controlled by Supabase configuration (default 1 hour).
