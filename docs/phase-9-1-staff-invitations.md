# Phase 9.1 staff invitations

Owners create a tenant-scoped pending record before the backend-only Supabase admin adapter calls `inviteUserByEmail`. Role is fixed to `staff`; redirect origin is server configured. No raw token/password/link is stored or logged. Provider failure cancels the local pending record. Acceptance verifies bearer claims, normalized email, auth user ID, pending state and expiry, then atomically creates/activates membership and accepts the invitation.

Existing auth identities belonging to another tenant are rejected under the current single-tenant membership limitation without exposing their other membership.
