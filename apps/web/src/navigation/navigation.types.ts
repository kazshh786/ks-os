import type { Permission } from '@ks-os/auth';
import type { AgencyCapability } from '@ks-os/contracts';
import type { LucideIcon } from 'lucide-react';

export type PortalKind = 'business' | 'agency' | 'managed-business';

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  description?: string;
  roles?: Array<'owner' | 'staff'>;
  permissionsAny?: Permission[];
  agencyCapabilitiesAny?: AgencyCapability[];
  featureFlag?: string;
  activePrefixes?: string[];
  requiredEntitlement?: string;
  requiredPlan?: 'GROWTH' | 'SCALE';
  lockedBenefit?: string;
  locked?: boolean;
}

export interface NavigationGroup {
  id: string;
  label?: string;
  items: NavigationItem[];
}

export interface NavigationContext {
  portal: PortalKind;
  role?: 'owner' | 'staff';
  permissions?: Permission[];
  agencyCapabilities?: AgencyCapability[];
  featureFlags?: Record<string, boolean>;
  entitlements?: Record<string, { enabled?: boolean }>;
}

export interface ResolvedNavigationGroup extends Omit<NavigationGroup, 'items'> {
  items: NavigationItem[];
}
