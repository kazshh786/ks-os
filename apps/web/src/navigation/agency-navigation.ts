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
  Package,
  ScrollText,
  ShieldCheck,
  Users,
  Webhook,
  WandSparkles,
} from 'lucide-react';
import type { NavigationGroup } from './navigation.types';

export const agencyNavigation: NavigationGroup[] = [
  {
    id: 'agency-home',
    label: 'Home',
    items: [
      { id: 'agency-overview', label: 'Home', href: '/agency/overview', icon: Home, agencyCapabilitiesAny: ['analytics.read'] },
    ],
  },
  {
    id: 'agency-clients',
    label: 'Clients',
    items: [
      { id: 'businesses', label: 'Clients', href: '/agency/tenants', icon: Building2, agencyCapabilitiesAny: ['tenants.read'], activePrefixes: ['/agency/tenants/new'] },
    ],
  },
  {
    id: 'agency-work',
    label: 'Work',
    items: [
      { id: 'onboarding', label: 'Work queue', href: '/agency/onboarding', icon: ClipboardCheck, agencyCapabilitiesAny: ['tenants.read'] },
      { id: 'services', label: 'Managed delivery', href: '/agency/fulfilment', icon: FileCheck2, agencyCapabilitiesAny: ['fulfilment.read'] },
    ],
  },
  {
    id: 'agency-business',
    label: 'Agency',
    items: [
      { id: 'agency-bookings', label: 'Appointments', href: '/agency/bookings', icon: CalendarDays },
      { id: 'billing', label: 'Revenue and billing', href: '/agency/billing', icon: CreditCard, agencyCapabilitiesAny: ['billing.read'] },
      { id: 'plans', label: 'Packages', href: '/agency/plans', icon: Package, agencyCapabilitiesAny: ['plans.read'], activePrefixes: ['/agency/plans/'] },
      { id: 'agency-team', label: 'Agency team', href: '/agency/users', icon: Users, agencyCapabilitiesAny: ['agency.users.manage'], activePrefixes: ['/agency/users/'] },
      { id: 'agency-security', label: 'Security', href: '/agency/settings/security', icon: ShieldCheck },
    ],
  },
  {
    id: 'agency-platform',
    label: 'Platform',
    items: [
      { id: 'design-studio', label: 'Design library', href: '/agency/design-studio', icon: WandSparkles, agencyCapabilitiesAny: ['sites.templates.read'] },
      { id: 'template-library', label: 'Licensed templates', href: '/agency/templates', icon: LayoutTemplate, agencyCapabilitiesAny: ['sites.templates.read'] },
      { id: 'agency-analytics', label: 'Portfolio analytics', href: '/agency/analytics', icon: BarChart3, agencyCapabilitiesAny: ['analytics.read'] },
      { id: 'support', label: 'Support', href: '/agency/support', icon: Headphones, agencyCapabilitiesAny: ['support.read'] },
      { id: 'errors', label: 'System issues', href: '/agency/errors', icon: CircleAlert, agencyCapabilitiesAny: ['support.read'] },
      { id: 'jobs', label: 'Background jobs', href: '/agency/jobs', icon: Activity, agencyCapabilitiesAny: ['support.read'] },
      { id: 'webhooks', label: 'Integrations', href: '/agency/webhooks', icon: Webhook, agencyCapabilitiesAny: ['support.read'] },
      { id: 'audit', label: 'Audit trail', href: '/agency/audit', icon: ScrollText, agencyCapabilitiesAny: ['audit.read'] },
    ],
  },
];

export const managedBusinessNavigation: NavigationGroup[] = [
  {
    id: 'managed-business-main',
    label: 'Client workspace',
    items: [
      { id: 'managed-summary', label: 'Overview', href: '/agency/tenants/:tenantId', icon: Home, agencyCapabilitiesAny: ['tenants.read'] },
      { id: 'managed-onboarding', label: 'Launch', href: '/agency/tenants/:tenantId/onboarding', icon: ClipboardCheck, agencyCapabilitiesAny: ['tenants.read'] },
      { id: 'managed-website', label: 'Website', href: '/agency/tenants/:tenantId/fulfilment', icon: WandSparkles, agencyCapabilitiesAny: ['fulfilment.read', 'sites.studio.read'] },
      { id: 'managed-operations', label: 'Operations', href: '/agency/tenants/:tenantId/health', icon: Activity, agencyCapabilitiesAny: ['support.read'] },
      { id: 'managed-account', label: 'Account', href: '/agency/tenants/:tenantId/billing', icon: CreditCard, agencyCapabilitiesAny: ['billing.read'] },
    ],
  },
];
