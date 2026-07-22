# Authentication & Authorization Plan

This document describes the role permission levels, authentication flow, and security constraints of the KS OS platform.

---

## 1. Canonical Roles

Roles are defined in `@ks-os/auth` ([packages/auth](file:///c:/Users/syedk/Documents/ks-os-antigravity-starter/KS-OS-Platform/packages/auth)) to ensure unified typing and prevent duplicate string literals:

* `agency_admin` $\rightarrow$ Platform administrator. Full access to provision tenants, manage subscription plans, and audit system automation outboxes.
* `owner` $\rightarrow$ Salon/business owner. Full admin privileges over their specific tenant workspace (staff schedules, products, billing settings).
* `manager` $\rightarrow$ Salon manager. Manage bookings, client lists, timesheets, and POS registers for their specific tenant.
* `staff` $\rightarrow$ Service providers. Access their own calendar, roster, and CRM records. Cannot edit pricing policies or delete clients.
* `receptionist` $\rightarrow$ Reception desk operator. Full checkout access, schedule calendar bookings, look up CRM history, and resolve conflicts.

---

## 2. Permissions Matrix

The helper function `hasPermission(role, action)` determines if a user can execute specific operations:

| Permissions | agency_admin | owner | manager | receptionist | staff |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `manage_workspace` | Yes | Yes | No | No | No |
| `manage_staff` | No | Yes | Yes | No | No |
| `manage_bookings` | No | Yes | Yes | Yes | No |
| `checkout_pos` | No | Yes | Yes | Yes | No |
| `view_calendar` | No | Yes | Yes | Yes | Yes |
| `provision_tenants` | Yes | No | No | No | No |

---

## 3. Developer Bypass & Production Lockdown

During bootstrap and staging, developer impersonation is supported to test layouts:
1. **Auth Bypass Active Banner**: When dev auth is active, an amber warning banner is rendered at the top of the portal.
2. **Production Mode Enforcement**: The helper `AuthContext.tsx` blocks `DEV_AUTH_ENABLED` if `import.meta.env.PROD === true`.
3. **Identity Verification**: Production authentication utilizes **Supabase Auth** JWT verification. The backend validates JWT signature keys and parses tenant identity context directly from token metadata payload.
