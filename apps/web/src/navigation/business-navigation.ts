import {
  BarChart3, Boxes, Building2, CalendarDays, ClipboardList, CreditCard,
  FileText, FormInput, Globe2, Landmark, LayoutDashboard, MapPinned, MessagesSquare, Scissors,
  Mail, Plug, Settings2, ShieldCheck, ShoppingCart, Sparkles, Users, Workflow,
} from 'lucide-react';
import type { ModuleKey } from '@ks-os/contracts';
import type { NavigationGroup } from './navigation.types';

export const businessNavigation: NavigationGroup[] = [
  {
    id: 'primary',
    items: [
      { id: 'dashboard', label: 'Dashboard', href: '/app/dashboard', icon: LayoutDashboard, roles: ['owner'] },
      { id: 'services', label: 'Services', href: '/app/services', icon: Scissors, roles: ['owner'] },
      { id: 'calendar', label: 'Booking Calendar', href: '/app/calendar', icon: CalendarDays, permissionsAny: ['BOOKINGS_VIEW_OWN', 'BOOKINGS_VIEW_ALL'], activePrefixes: ['/app/bookings'] },
      { id: 'tasks', label: 'Tasks', href: '/app/tasks/my', icon: ClipboardList, permissionsAny: ['TASKS_VIEW_OWN', 'TASKS_VIEW_ALL'], activePrefixes: ['/app/tasks'] },
    ],
  },
  {
    id: 'customer-operations', label: 'Customer Operations',
    items: [
      { id: 'operations', label: 'Inbox', href: '/app/operations', icon: MessagesSquare, permissionsAny: ['OPERATIONS_VIEW_ASSIGNED', 'OPERATIONS_VIEW_ALL', 'OPERATIONS_MANAGE'], activePrefixes: ['/app/operations/'] },
      { id: 'customers', label: 'Customers', href: '/app/clients', icon: Users, permissionsAny: ['CLIENTS_VIEW_BASIC'], activePrefixes: ['/app/clients/'] },
      { id: 'forms', label: 'Forms', href: '/app/forms', icon: FormInput, permissionsAny: ['FORMS_VIEW_ASSIGNED', 'FORMS_VIEW_ALL', 'FORMS_MANAGE'], activePrefixes: ['/app/forms/', '/app/form-submissions/'] },
    ],
  },
  {
    id: 'sales-money', label: 'Sales and Money',
    items: [
      { id: 'pos', label: 'Point of Sale', href: '/app/pos', icon: ShoppingCart, permissionsAny: ['POS_USE'] },
      { id: 'payments', label: 'Payments', href: '/app/payments', icon: CreditCard, roles: ['owner'], activePrefixes: ['/app/payments/'] },
      { id: 'finance', label: 'Finance', href: '/app/finance', icon: Landmark, roles: ['owner'], activePrefixes: ['/app/finance/'] },
    ],
  },
  {
    id: 'growth', label: 'Growth and Insights',
    items: [
      { id: 'analytics', label: 'Analytics', href: '/app/analytics', icon: BarChart3, roles: ['owner'], requiredEntitlement: 'analytics.advanced', requiredPlan: 'GROWTH', lockedBenefit: 'Understand booking conversion, customer retention, staff utilisation and location performance.' },
      { id: 'reports', label: 'Reports', href: '/app/reports', icon: FileText, roles: ['owner'], activePrefixes: ['/app/reports/'] },
      { id: 'reviews', label: 'Reviews', href: '/app/reputation', icon: Sparkles, permissionsAny: ['REPUTATION_VIEW'], activePrefixes: ['/app/reputation/'] },
      { id: 'email-marketing', label: 'Email Marketing', href: '/app/email-marketing/automated-emails', icon: Mail, roles: ['owner'], activePrefixes: ['/app/email-marketing/'] },
      { id: 'inventory', label: 'Inventory', href: '/app/inventory', icon: Boxes, roles: ['owner'], requiredEntitlement: 'inventory.enabled', requiredPlan: 'GROWTH', lockedBenefit: 'Monitor stock levels and product performance alongside checkout activity.' },
    ],
  },
  {
    id: 'work', label: 'Work Management',
    items: [
      { id: 'automations', label: 'Automations', href: '/app/automations', icon: Workflow, roles: ['owner'], activePrefixes: ['/app/automations/', '/app/automation-runs/'], requiredEntitlement: 'automations.enabled', requiredPlan: 'GROWTH', lockedBenefit: 'Automate confirmations, reminders, forms, rebooking and follow-up work.' },
    ],
  },
  {
    id: 'admin', label: 'Administration',
    items: [
      { id: 'team', label: 'Team', href: '/app/settings/team', icon: Users, roles: ['owner'], activePrefixes: ['/app/settings/team/'] },
      { id: 'locations', label: 'Locations and resources', href: '/app/settings/locations', icon: MapPinned, roles: ['owner'], activePrefixes: ['/app/settings/resources'] },
      { id: 'booking-page', label: 'Booking Page', href: '/app/settings/booking-page', icon: Globe2, roles: ['owner'], activePrefixes: ['/app/settings/booking/customer-management'] },
      { id: 'stripe-payments', label: 'Stripe and Payments', href: '/app/settings/payments', icon: CreditCard, roles: ['owner'], activePrefixes: ['/app/settings/payments/'] },
      { id: 'integrations', label: 'Integrations', href: '/app/settings/integrations', icon: Plug, roles: ['owner'], activePrefixes: ['/app/settings/integrations/'] },
      { id: 'communications', label: 'Communications', href: '/app/settings/communications', icon: MessagesSquare, roles: ['owner'], activePrefixes: ['/app/settings/communications/', '/app/settings/email-history'] },
      { id: 'business-settings', label: 'Business Settings', href: '/app/settings', icon: Settings2, roles: ['owner'] },
      { id: 'security', label: 'Security', href: '/app/settings/security', icon: ShieldCheck, roles: ['owner', 'staff'] },
    ],
  },
];

export const businessSecondaryActions = [
  { id: 'booking-page', label: 'View booking page', icon: Building2 },
  { id: 'copy-booking-page', label: 'Copy booking link', icon: ClipboardList },
] as const;

/** Map established navigation IDs onto canonical engines without changing routes. */
export const navigationModule: Readonly<Record<string, ModuleKey>> = {
  dashboard:'dashboard',services:'services',calendar:'calendar',tasks:'tasks',operations:'operations',
  customers:'crm',forms:'forms',pos:'pos',payments:'payments',finance:'finance',analytics:'analytics',
  reports:'reports',reviews:'reputation','email-marketing':'email-marketing',inventory:'inventory',
  automations:'automations',team:'team',locations:'locations','booking-page':'booking-page',
  'stripe-payments':'payments',integrations:'integrations',communications:'communications',
  'business-settings':'settings',security:'security',
};
