import { TenantRole } from '@ks-os/contracts';
import type { Capability } from './capabilities.js';

/**
 * =========================================================================
 * SECURITY NOTICE
 * =========================================================================
 * Frontend permission checks are for user interface flow control only
 * (e.g. hiding tabs, disabling buttons).
 * 
 * They DO NOT constitute security enforcement. The apps/api server must
 * strictly validate and enforce every single tenant and role permission
 * boundary on the server-side for all queries and mutations.
 */

// Canonical Roles definitions
export const ROLES = {
  AGENCY_ADMIN: 'agency_admin',
  OWNER: 'owner',
  MANAGER: 'manager',
  STAFF: 'staff',
  RECEPTIONIST: 'receptionist'
} as const;

// App permissions
export const PERMISSIONS = {
  PROVISION_TENANT: 'provision_tenant',
  VIEW_AGENCY_BILLING: 'view_agency_billing',
  SYSTEM_ADMIN: 'system_admin',
  
  MANAGE_SALON_SETTINGS: 'manage_salon_settings',
  MANAGE_STAFF_SCHEDULES: 'manage_staff_schedules',
  CREATE_BOOKINGS: 'create_bookings',
  UPDATE_BOOKINGS: 'update_bookings',
  CHECKOUT_POS: 'checkout_pos',
  VIEW_CRM: 'view_crm',
  EDIT_CRM_NOTES: 'edit_crm_notes',
  MANAGE_FORMS: 'manage_forms'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS] | Capability;

// Role-to-permissions map
const ROLE_PERMISSIONS: Record<TenantRole, Permission[]> = {
  agency_admin: [
    PERMISSIONS.PROVISION_TENANT,
    PERMISSIONS.VIEW_AGENCY_BILLING,
    PERMISSIONS.SYSTEM_ADMIN
  ],
  owner: [
    PERMISSIONS.MANAGE_SALON_SETTINGS,
    PERMISSIONS.MANAGE_STAFF_SCHEDULES,
    PERMISSIONS.CREATE_BOOKINGS,
    PERMISSIONS.UPDATE_BOOKINGS,
    PERMISSIONS.CHECKOUT_POS,
    PERMISSIONS.VIEW_CRM,
    PERMISSIONS.EDIT_CRM_NOTES,
    PERMISSIONS.MANAGE_FORMS
  ],
  manager: [
    PERMISSIONS.MANAGE_STAFF_SCHEDULES,
    PERMISSIONS.CREATE_BOOKINGS,
    PERMISSIONS.UPDATE_BOOKINGS,
    PERMISSIONS.CHECKOUT_POS,
    PERMISSIONS.VIEW_CRM,
    PERMISSIONS.EDIT_CRM_NOTES,
    PERMISSIONS.MANAGE_FORMS
  ],
  staff: [
    PERMISSIONS.CREATE_BOOKINGS,
    PERMISSIONS.UPDATE_BOOKINGS,
    PERMISSIONS.CHECKOUT_POS,
    PERMISSIONS.VIEW_CRM,
    PERMISSIONS.EDIT_CRM_NOTES
  ],
  receptionist: [
    PERMISSIONS.CREATE_BOOKINGS,
    PERMISSIONS.UPDATE_BOOKINGS,
    PERMISSIONS.CHECKOUT_POS,
    PERMISSIONS.VIEW_CRM,
    PERMISSIONS.EDIT_CRM_NOTES
  ]
};

/**
 * Validates whether a user role with optional JSON-based permission overrides is authorized for a specific action.
 */
export function hasPermission(
  role: TenantRole,
  permission: Permission,
  overrides?: Record<string, boolean>
): boolean {
  // 1. Check if permission is explicitly revoked via override
  if (overrides && overrides[permission] === false) {
    return false;
  }

  // 2. Check if permission is explicitly granted via override
  if (overrides && overrides[permission] === true) {
    return true;
  }

  // 3. Fallback to standard role defaults
  const allowed = ROLE_PERMISSIONS[role] || [];
  return allowed.includes(permission);
}

export * from './booking.policies.js';
export * from './capabilities.js';
