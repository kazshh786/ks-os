# Phase 9.2–9.5 Team Operations

This phase adds server-enforced staff access profiles, approved time off, tenant-scoped locations and resources, staff performance reporting, and estimated commission rules. Existing `owner` and `staff` membership roles remain unchanged; profiles refine staff capabilities without becoming new authentication roles.

The reviewed migration is `packages/database/migrations/20260719200000_phase_9_2_9_5_team_operations.sql`. It is intentionally not applied automatically. Payroll, payouts, and accounting are outside this phase.

