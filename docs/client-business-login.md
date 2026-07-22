# Client-business login

Business owners and staff use `/login`. Supabase verifies email and password. The API then finds active tenant memberships by `auth_user_id`.

- One active membership is selected automatically.
- Several active memberships lead to `/select-business`.
- No active membership leads to a neutral access-unavailable page.
- A suspended or deactivated membership never grants a workspace.
- A suspended tenant blocks all of its memberships.

The selection endpoint accepts only an opaque `businessReference`, rechecks that the authenticated identity has an active membership, and stores the selected membership in `application_sessions`. It never accepts a raw tenant ID or trusts browser storage.

Business routes derive the membership, role, tenant, and effective permissions on every request. Suspending one membership revokes sessions selected into that membership without removing the same identity's access to another active business.

