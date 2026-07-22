# Workspace selection

An authenticated identity may have active memberships in several tenants. `/api/v1/workspace/session` returns only opaque membership/business references and display information.

When selection is required, `/select-business` posts `businessReference` to `/api/v1/auth/select-workspace`. The server joins the verified Auth user to an active membership and active tenant, then saves `selected_tenant_user_id` against the current verified Supabase `session_id`. Every subsequent tenant API request resolves that record again.

No tenant ID is accepted from local storage, query parameters, or arbitrary headers. React components cannot change the active workspace with local state. A membership that becomes suspended or deactivated stops resolving even if an old browser still displays it.

