# Phase 8 mobile authentication and device contract

This is backend readiness for future native applications. No native app, production identity setting, real provider login or device push was deployed or exercised here.

## Reuse the existing identity provider

Use the same Supabase project and existing user identities. Use an official provider SDK with Authorization Code + PKCE, an external system browser, a fresh verifier/state per attempt and an exactly registered callback. Production applications use claimed HTTPS Universal/App Links; sandbox clients may use a custom callback scheme only when it exactly matches the configured reverse-domain application ID. Native apps must never receive the API's service-role key, database credentials or a client secret.

After the callback, the native SDK exchanges the one-use authorization code with Supabase using the verifier retained on that installation. Access and refresh tokens go into iOS Keychain or Android Keystore-backed encrypted storage. Never log them, place them in notification payloads or URL query strings, or store them in ordinary preferences. The OAuth authorization code in the callback is the standard short-lived code, not an access or refresh token. Clear the callback promptly. Existing customer invitation acceptance continues through the first-party browser handoff; native applications must open that secure flow in the system browser, not copy an invitation verifier into a new unreviewed native credential exchange.

Supabase owns refresh-token rotation and suspicious reuse detection. KSOS adds no refresh-token family, token exchange proxy or parallel identity store. SDK refreshes must be serialized on each device, persist the rotated refresh credential atomically, and preserve the provider session ID. A new sign-in on another installation must create its own provider session; copying one refresh credential between devices is unsupported and registration rejects binding the same provider session to another installation.

Current reference behavior: [PKCE code exchange](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [session expiry and refresh-token reuse detection](https://supabase.com/docs/guides/auth/sessions), and [local/global/other-session sign-out](https://supabase.com/docs/guides/auth/signout). Provider reuse detection has documented retry exceptions; the implementation does not claim every repeated refresh attempt is malicious.

## Configuration and APIs

`MOBILE_APPLICATIONS_JSON` is a server-side allowlist of objects with `applicationId`, `platform` (`IOS`/`ANDROID`), `environment` (`SANDBOX`/`PRODUCTION`) and `redirectUri`. No application IDs, Apple identifiers or provider credentials are seeded. Omission disables registration. Match these IDs/environments with push-provider configuration and register each callback with Supabase. Enable independent provider sessions rather than a single-session-per-user policy. Keep provider access-token expiry short and retain provider refresh reuse detection; verify actual project settings during an approved release.

Requests use the normal `Authorization: Bearer ...` and explicit `X-KS-Application-Context: TENANT` or `CUSTOMER`. Agency/support access is not a mobile context. Native-only operations additionally require `X-KS-Device-Id`, the opaque ID returned by registration. That ID is a lookup hint, never authentication; the guard binds it to the authenticated provider account and session on every request.

| Route under `/api/v1/auth/mobile` | Contract |
| --- | --- |
| `GET /config` | Public allowlist, provider protocol and client storage requirements; no secrets. |
| `POST /session` | Body `{platform, applicationId, environment, installationId, deviceName?}`. The installation ID is a random UUID generated per installation, hashed at rest and never used as evidence of identity. Returns the safe device DTO. Identical retries update the display name/activity; another installation cannot steal a session binding. |
| `GET /devices` | Own active devices first, then recent revoked history, maximum 100 records. At most 20 active registrations exist per account. No provider account/session IDs, installation hashes or push tokens are returned. |
| `DELETE /devices/:deviceId` | Revoke one owned mobile provider session and all its KSOS context bindings. Other devices remain valid. |
| `POST /devices/revoke-others` | Requires the current mobile device binding. Revokes all other owned mobile devices, preserving this device and unrelated browser sessions. Returns explicit scope `OTHER_MOBILE_DEVICES`. Existing global logout remains available for all sessions. |

Existing `/auth/context`, `/workspace/session`, `/workspace/memberships` and `/auth/select-workspace` provide staff business discovery/selection. Existing `/customer/collaboration/session` and relationship-scoped customer routes provide authorized customer business contexts. Device registration grants no tenant, customer relationship, conversation or meeting membership. Push contexts are separate explicit opt-ins, authorized against the selected staff membership or customer relationship.

Responses use `Cache-Control: no-store`. Device mutations use authenticated account/context rate limits. A changed network address cannot bypass that key. Device labels are short display text, not trusted platform attestation or hardware identity.

## Expiry and revocation

The existing application ledger remains unique by `(auth_session_id, application_context)`. `hard_expires_at` is initialized once from the original creation time and existing context cap (staff defaults to 24 hours; customer to 720 hours). It cannot be extended by refresh or configuration changes. Existing rows initialize on their next authenticated request; background processing fails closed using their earlier expiry until that happens. Foreground requests still require a valid, unexpired provider access JWT.

Background push authorization checks a current provider session, nonrevoked KSOS context and its immutable hard expiry. It deliberately does not require the last access JWT to remain unexpired while the app is idle. Account security cutoffs are checked against the provider session's original creation time, so refreshing an old credential cannot change its login age. Per-event tenant, principal, membership, preferences and resource authorization remain mandatory.

Revoking a registered mobile device removes its matching Supabase session and marks its KSOS context/device rows revoked atomically. The narrow API-only database function resolves the owned device and exact `(session_id, auth_user_id)` pair; it exposes no provider records and stores no refresh credentials. This follows the provider's own [session logout implementation](https://github.com/supabase/auth/blob/master/internal/models/sessions.go). All future authenticated native operations reject the revoked binding, including a copied JWT that omits the device header. Registered mobile sessions also participate in existing session revoke/local logout/global logout APIs. Revocation history cannot be reset by registration retries.

The migration function owner must have the intended provider-table permissions; grant execution only to the trusted API role. Review the deployed provider schema before release, and verify actual provider refresh failure after revocation on staging. Provider logout and JWT validation are separate: a signed JWT may remain cryptographically valid until expiry, but KSOS rejects its removed provider/device/app session. Notifications already accepted by Apple/Google and previously displayed notifications cannot be recalled.

## Verification boundary

The private session helper checks provider-row presence, explicit `not_after`, identity confirmation and ban state. Hosted Supabase inactivity/time-box/single-session settings can also be enforced during provider refresh before asynchronous row cleanup; the helper does not reimplement all provider policy. Align provider settings with KSOS hard expiry and verify those cases on the deployed provider during staging. Registered native membership cutoffs use the original provider sign-in time even after JWT renewal or business switching.

GitHub tests exercise production migration SQL, private grants, binding immutability, independently seeded staff/customer/provider sessions, cross-account denial, device-specific/all-other-device revocation, expired foreground credentials versus live background sessions, hard-expiry immutability, provider logout, account cutoffs, account/context rate limits and real PostgreSQL registration/revocation races.

These tests do not claim a live Supabase PKCE round trip, provider refresh rotation/reuse detection, native secure storage, claimed-link association, physical-device background behavior or Apple/Google delivery. The SDK/provider behavior and actual project settings require controlled staging/device verification after credentials and app identifiers exist. No real authentication email or push send is part of these tests.
