import {
  Activity, BarChart3, Building2, ClipboardCheck, CreditCard, FileCheck2,
  Headphones, LayoutDashboard, Package, ScrollText, Settings2, ShieldCheck,
  Users, Webhook,
} from 'lucide-react';
import type { NavigationGroup } from './navigation.types';

export const agencyNavigation: NavigationGroup[] = [
  {
    id: 'agency', label: 'Agency',
    items: [
      { id: 'agency-overview', label: 'Overview', href: '/agency/overview', icon: LayoutDashboard, agencyCapabilitiesAny: ['analytics.read'] },
      { id: 'businesses', label: 'Businesses', href: '/agency/tenants', icon: Building2, agencyCapabilitiesAny: ['tenants.read'], activePrefixes: ['/agency/tenants/new'] },
    ],
  },
  {
    id: 'customer-delivery', label: 'Customer Delivery',
    items: [
      { id: 'onboarding', label: 'Onboarding', href: '/agency/onboarding', icon: ClipboardCheck, agencyCapabilitiesAny: ['tenants.read'] },
      { id: 'services', label: 'Services', href: '/agency/fulfilment', icon: FileCheck2, agencyCapabilitiesAny: ['fulfilment.read'] },
      { id: 'support', label: 'Support', href: '/agency/support', icon: Headphones, agencyCapabilitiesAny: ['support.read'] },
    ],
  },
  {
    id: 'commercial', label: 'Commercial',
    items: [
      { id: 'billing', label: 'Billing', href: '/agency/billing', icon: CreditCard, agencyCapabilitiesAny: ['billing.read'] },
      { id: 'plans', label: 'Plans', href: '/agency/plans', icon: Package, agencyCapabilitiesAny: ['plans.read'], activePrefixes: ['/agency/plans/'] },
    ],
  },
  {
    id: 'agency-operations', label: 'Operations',
    items: [
      { id: 'jobs', label: 'Jobs', href: '/agency/jobs', icon: Activity, agencyCapabilitiesAny: ['support.read'] },
      { id: 'webhooks', label: 'Webhooks', href: '/agency/webhooks', icon: Webhook, agencyCapabilitiesAny: ['support.read'] },
    ],
  },
  {
    id: 'insights', label: 'Insights and Compliance',
    items: [
      { id: 'agency-analytics', label: 'Analytics', href: '/agency/analytics', icon: BarChart3, agencyCapabilitiesAny: ['analytics.read'] },
      { id: 'audit', label: 'Audit Logs', href: '/agency/audit', icon: ScrollText, agencyCapabilitiesAny: ['audit.read'] },
    ],
  },
  {
    id: 'agency-admin', label: 'Administration',
    items: [
      { id: 'agency-team', label: 'Team', href: '/agency/users', icon: Users, agencyCapabilitiesAny: ['agency.users.manage'], activePrefixes: ['/agency/users/'] },
      { id: 'agency-security', label: 'Security', href: '/agency/settings/security', icon: ShieldCheck },
    ],
  },
];

export const managedBusinessNavigation: NavigationGroup[] = [
  {
    id: 'managed-business',
    items: [
      { id: 'managed-summary', label: 'Summary', href: '/agency/tenants/:tenantId', icon: LayoutDashboard, agencyCapabilitiesAny: ['tenants.read'] },
      { id: 'managed-onboarding', label: 'Onboarding', href: '/agency/tenants/:tenantId/onboarding', icon: ClipboardCheck, agencyCapabilitiesAny: ['tenants.read'] },
      { id: 'managed-billing', label: 'Billing', href: '/agency/tenants/:tenantId/billing', icon: CreditCard, agencyCapabilitiesAny: ['billing.read'] },
      { id: 'managed-features', label: 'Features', href: '/agency/tenants/:tenantId/entitlements', icon: Settings2, agencyCapabilitiesAny: ['plans.read'] },
      { id: 'managed-services', label: 'Services', href: '/agency/tenants/:tenantId/fulfilment', icon: FileCheck2, agencyCapabilitiesAny: ['fulfilment.read'] },
      { id: 'managed-health', label: 'System Health', href: '/agency/tenants/:tenantId/health', icon: Activity, agencyCapabilitiesAny: ['support.read'] },
    ],
  },
];
