# Phase 9.1 team report

Phase 9.1 adds live owner-only team management under `/app/settings/team`. Canonical roles remain `owner|staff`. Supabase Auth owns credentials/session/invitation authentication; the `users` record owns tenant membership and lifecycle state. The current identity model remains explicitly single-tenant per Supabase user.

The reviewed additive migration is `20260719170000_phase_9_1_team_management.sql` and is not applied automatically.
