import {
  BarChart3, Bell, Boxes, Building2, CalendarDays, ClipboardList, ConciergeBell, CreditCard,
  FileText, FormInput, Globe2, Landmark, LayoutDashboard, MapPinned, MessagesSquare, Scissors, Clock3,
  Plug, ReceiptText, Settings2, ShieldCheck, ShoppingCart, Sparkles, Users, Workflow,
} from 'lucide-react';
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
      { id: 'walk-in-desk', label: 'Walk-in Desk', href: '/app/calendar?walkin=1', icon: ConciergeBell, permissionsAny: ['BOOKINGS_CREATE'] },
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
      { id: 'inventory', label: 'Inventory', href: '/app/inventory', icon: Boxes, roles: ['owner'], requiredEntitlement: 'inventory.enabled', requiredPlan: 'GROWTH', lockedBenefit: 'Monitor stock levels and product performance alongside checkout activity.' },
    ],
  },
  {
    id: 'work', label: 'Work Management',
    items: [
      { id: 'automations', label: 'Automations', href: '/app/automations', icon: Workflow, roles: ['owner'], activePrefixes: ['/app/automations/', '/app/automation-runs/'], requiredEntitlement: 'automations.enabled', requiredPlan: 'GROWTH', lockedBenefit: 'Automate confirmations, reminders, forms, rebooking and follow-up work.' },
      { id: 'operations', label: 'Operations', href: '/app/operations', icon: Bell, permissionsAny: ['OPERATIONS_VIEW_ASSIGNED', 'OPERATIONS_VIEW_ALL', 'OPERATIONS_MANAGE'], activePrefixes: ['/app/operations/'] },
    ],
  },
  {
    id: 'admin', label: 'Administration',
    items: [
      { id: 'team', label: 'Team', href: '/app/settings/team', icon: Users, roles: ['owner'], activePrefixes: ['/app/settings/team/'] },
      { id: 'availability', label: 'Availability', href: '/app/settings/availability', icon: Clock3, roles: ['owner'] },
      { id: 'locations', label: 'Locations and resources', href: '/app/settings/locations', icon: MapPinned, roles: ['owner'], activePrefixes: ['/app/settings/resources'] },
      { id: 'booking-page', label: 'Booking Page', href: '/app/settings/booking-page', icon: Globe2, roles: ['owner'] },
      { id: 'booking-policies', label: 'Booking Policies', href: '/app/settings/booking/customer-management', icon: ReceiptText, roles: ['owner'] },
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
