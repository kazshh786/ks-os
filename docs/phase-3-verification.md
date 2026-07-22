# Phase 3 Verification

Testing for the booking system encompasses:

## Frontend Testing
- Use of `vitest` + `@testing-library/react`.
- Explicit tests to ensure that `KSOSEngine` (Mock Mode) is completely disconnected in live environments.
- Comprehensive UI state testing: Validation errors, Loading states, Submission prevention, and Success redirections.

## Backend Integration Testing
- Use of Node's native test runner (`node:test`) mapped to `pnpm test`.
- **Public Endpoints**: Verified 400 bad requests, missing tenants, valid catalogue fetches.
- **Availability**: Mocked database returns to ensure proper Zod parsing and structure compliance.
- **Booking Creation**: Ensured idempotency requirements, valid payload acceptance, and proper status code (201).
- **Authentication**: Ensured that unauthenticated requests return 401, while Staff cannot transition bookings assigned to other staff members (403/400).
- **Timezones**: Tested `date-fns-tz` with London winter/summer boundaries to ensure correct local hour interpretation.

## Manual Browser Verification
*Note: As this development environment is running under Windows, the automated headless browser subagent could not execute Linux-based Chrome automation. Verification must be performed manually via the `http://localhost:5173/book/test-tenant` portal.*
