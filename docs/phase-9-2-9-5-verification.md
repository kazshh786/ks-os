# Phase 9.2–9.5 verification

- Compile the auth, contracts, database, API, and web packages.
- Run `apps/api/tests/team-operations.test.ts` for profile boundaries, protected capability elevation, removals, and strict time-off/commission input validation.
- Review and apply the migration through the controlled Supabase workflow before integration testing.
- Verify authenticated owner and staff flows in a browser after the migration is applied.
- Live pages surface API failures and do not substitute mock operational data.

At implementation time, the repository-wide API typecheck also reported pre-existing errors in the parallel `operations` and `reports` modules. Those are not suppressed by this phase.
