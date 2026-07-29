import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  CircleAlert,
  ClipboardCheck,
  CreditCard,
  FileCheck2,
  Headphones,
  Home,
  LayoutTemplate,
  ListChecks,
  Package,
  ScrollText,
  Settings2,
  ShieldCheck,
  Users,
  Webhook,
  WandSparkles,
} from 'lucide-react';
import type { NavigationGroup } from './navigation.types';

export const agencyNavigation: NavigationGroup[] = [
  {
    id: 'agency-home',
    label: 'Run the agency',
    items: [
      { id: 'agency-overview', label: 'Home', href: '/agency/overview', icon: Home, agencyCapabilitiesAny: ['analytics.read'] },
      { id: 'businesses', label: 'Clients', href: '/agency/tenants', icon: Building2, agencyCapabilitiesAny: ['tenants.read'], activePrefixes: ['/agency/tenants/new'] },
      { id: 'onboarding', label: 'Onboarding', href: '/agency/onboarding', icon: ClipboardCheck, agencyCapabilitiesAny: ['tenants.read'] },
    ],
  },
  {
    id: 'agency-delivery',
    label: 'Deliver client work',
    items: [
      { id: 'fact-finding', label: 'Fact finding', href: '/agency/fact-finding', icon: ListChecks, agencyCapabilitiesAny: ['fact_finding.read'] },
      { id: 'provisioning', label: 'Website delivery', href: '/agency/provisioning', icon: WandSparkles, agencyCapabilitiesAny: ['provisioning.read'] },
      { id: 'design-studio', label: 'Design Studio', href: '/agency/design-studio', icon: WandSparkles, agencyCapabilitiesAny: ['sites.templates.read'] },
      { id: 'template-library', label: 'Licensed imports', href: '/agency/templates', icon: LayoutTemplate, agencyCapabilitiesAny: ['sites.templates.read'] },
      { id: 'services', label: 'Managed services', href: '/agency/fulfilment', icon: FileCheck2, agencyCapabilitiesAny: ['fulfilment.read'] },
      { id: 'support', label: 'Support centre', href: '/agency/support', icon: Headphones, agencyCapabilitiesAny: ['support.read'] },
    ],
  },
  {
    id: 'agency-commercial',
    label: 'Commercial',
    items: [
      { id: 'agency-bookings', label: 'Agency appointments', href: '/agency/bookings', icon: CalendarDays },
      { id: 'billing', label: 'Revenue and billing', href: '/agency/billing', icon: CreditCard, agencyCapabilitiesAny: ['billing.read'] },
      { id: 'plans', label: 'Packages and plans', href: '/agency/plans', icon: Package, agencyCapabilitiesAny: ['plans.read'], activePrefixes: ['/agency/plans/'] },
    ],
  },
  {
    id: 'agency-platform',
    label: 'Platform',
    items: [
      { id: 'agency-analytics', label: 'Portfolio analytics', href: '/agency/analytics', icon: BarChart3, agencyCapabilitiesAny: ['analytics.read'] },
      { id: 'errors', label: 'System issues', href: '/agency/errors', icon: CircleAlert, agencyCapabilitiesAny: ['support.read'] },
      { id: 'jobs', label: 'Background jobs', href: '/agency/jobs', icon: Activity, agencyCapabilitiesAny: ['support.read'] },
      { id: 'webhooks', label: 'Integrations and webhooks', href: '/agency/webhooks', icon: Webhook, agencyCapabilitiesAny: ['support.read'] },
      { id: 'audit', label: 'Audit trail', href: '/agency/audit', icon: ScrollText, agencyCapabilitiesAny: ['audit.read'] },
    ],
  },
  {
    id: 'agency-settings',
    label: 'Agency settings',
    items: [
      { id: 'agency-team', label: 'Agency team', href: '/agency/users', icon: Users, agencyCapabilitiesAny: ['agency.users.manage'], activePrefixes: ['/agency/users/'] },
      { id: 'agency-security', label: 'Security', href: '/agency/settings/security', icon: ShieldCheck },
    ],
  },
];

export const managedBusinessNavigation: NavigationGroup[] = [
  {
    id: 'managed-business-main',
    label: 'Client workspace',
    items: [
      { id: 'managed-summary', label: 'Workspace overview', href: '/agency/tenants/:tenantId', icon: Home, agencyCapabilitiesAny: ['tenants.read'] },
      { id: 'managed-onboarding', label: 'Setup and launch', href: '/agency/tenants/:tenantId/onboarding', icon: ClipboardCheck, agencyCapabilitiesAny: ['tenants.read'] },
      { id: 'managed-users', label: 'Users and access', href: '/agency/tenants/:tenantId/users', icon: Users, agencyCapabilitiesAny: ['tenants.read'] },
      { id: 'managed-billing', label: 'Billing and subscription', href: '/agency/tenants/:tenantId/billing', icon: CreditCard, agencyCapabilitiesAny: ['billing.read'] },
      { id: 'managed-features', label: 'Package and features', href: '/agency/tenants/:tenantId/entitlements', icon: Settings2, agencyCapabilitiesAny: ['plans.read'] },
      { id: 'managed-services', label: 'Delivery work', href: '/agency/tenants/:tenantId/fulfilment', icon: FileCheck2, agencyCapabilitiesAny: ['fulfilment.read'] },
      { id: 'managed-health', label: 'Technical health', href: '/agency/tenants/:tenantId/health', icon: Activity, agencyCapabilitiesAny: ['support.read'] },
    ],
  },
];
