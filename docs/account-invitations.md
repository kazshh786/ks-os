# Account invitations

`account_invitations` is the canonical application access-intent table for agency, initial tenant-owner, and tenant-staff invitations. Supabase Auth owns authentication invite tokens; KS OS stores no raw or hashed Supabase invite token.

Creation is server-only:

1. Validate the administrator and target scope.
2. Create an invited agency record or invited tenant membership plus a pending local invitation.
3. Ask Supabase Auth Admin to invite the address.
4. Store only the returned Auth user ID and delivery mode.
5. Audit the action without the link or token.

If the address already belongs to Supabase, KS OS reuses that identity and sends an ordinary application invitation notification through Resend. The user signs in with the existing password. A new invitee uses Supabase's invite link and creates a password before local activation.

Acceptance requires an authenticated identity whose normalized email and Supabase user ID match the intended invitation. The transaction locks the invitation, checks its context/status/expiry, activates the local record, marks the invitation accepted, and supersedes other pending intents. Resend and cancellation are administrator-only and rate limited. Cancellation deactivates the pending local record.

Legacy `staff_invitations` remains for migration history only; new invitation writes use `account_invitations`.

