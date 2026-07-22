# Phase 9.1 team security

Management routes require owner auth and derive tenant/user from server context. Requests cannot set tenant, role, email, auth ID or lifecycle state through profile patches. The service-role key is backend-only. Invitation messages are neutral, provider errors are safe, and the live provider never falls back to mock staff.

Public catalogue/availability now require active membership, booking enabled, and tenant service eligibility. Suspended/deactivated users are denied during auth-context resolution.
