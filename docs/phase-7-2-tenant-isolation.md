# Phase 7.2 tenant isolation

Tenant identity always comes from the authenticated server context. Every read and mutation includes `tenant_id`; source retry updates also include it. The table is private, has RLS enabled, and revokes `anon` and `authenticated`; browser clients can only use the authenticated API.

Cross-tenant issue IDs and assignee IDs produce not-found or invalid-assignee responses without exposing another tenant's record.
