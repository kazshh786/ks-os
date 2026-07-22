# Phase 7.3 security

- Every query and mutation includes `tenant_id`.
- Own-task capabilities only expose assigned tasks; all-task access is explicit.
- Payment and refund tasks require `FINANCE_VIEW`, including for the assignee.
- Linked records and active assignees are verified in the same tenant.
- Assignment and lifecycle changes use dedicated endpoints.
- RLS is enabled and browser roles are revoked; the trusted API server is authoritative.
