import { businessNavigation } from './business-navigation';
import { describe, expect, it } from 'vitest';
import { agencyNavigation, managedBusinessNavigation } from './agency-navigation';
import { findActiveNavigationItem, isNavigationItemActive, navigationHref, resolveNavigation } from './navigation.utils';

const labels = (groups: ReturnType<typeof resolveNavigation>) => groups.flatMap(group => group.items.map(item => item.label));

describe('navigation resolution', () => {
  it('shows the complete business administration navigation to an owner', () => {
    const groups = resolveNavigation(businessNavigation, { portal: 'business', role: 'owner', permissions: [] });
    expect(labels(groups)).toEqual(expect.arrayContaining(['Dashboard', 'Booking Calendar', 'Tasks', 'Finance', 'Team', 'Business Settings']));
    expect(labels(groups)).not.toContain('Bookings');
    expect(groups.every(group => group.items.length > 0)).toBe(true);
  });

  it('promotes tasks after the calendar and places the inbox with customer operations', () => {
    const primary = businessNavigation.find(group => group.id === 'primary');
    expect(primary?.items.map(item => item.label)).toEqual(['Dashboard', 'Services', 'Booking Calendar', 'Tasks']);
    expect(businessNavigation.find(group => group.id === 'customer-operations')?.items.map(item => item.label)).toEqual(['Inbox', 'Customers', 'Forms']);
    expect(businessNavigation.find(group => group.id === 'work')?.items.map(item => item.label)).toEqual(['Automations']);
  });

  it('only shows staff destinations granted by capabilities and removes empty groups', () => {
    const groups = resolveNavigation(businessNavigation, {
      portal: 'business', role: 'staff', permissions: ['BOOKINGS_VIEW_OWN', 'TASKS_VIEW_OWN'],
    });
    expect(labels(groups)).toEqual(['Booking Calendar', 'Tasks', 'Security']);
    expect(labels(groups)).not.toContain('Dashboard');
    expect(labels(groups)).not.toContain('Bookings');
    expect(labels(groups)).not.toContain('Finance');
    expect(groups.map(group => group.label)).not.toContain('Growth');
  });

  it('filters agency navigation using server-issued capabilities', () => {
    const groups = resolveNavigation(agencyNavigation, {
      portal: 'agency', agencyCapabilities: ['tenants.read', 'support.read', 'support.session.start'],
    });
    expect(labels(groups)).toEqual(expect.arrayContaining([
      'Clients',
      'Onboarding',
      'Support centre',
      'System issues',
      'Background jobs',
      'Integrations and webhooks',
      'Security',
    ]));
    expect(labels(groups)).not.toContain('Home');
    expect(labels(groups)).not.toContain('Revenue and billing');
    expect(labels(groups)).not.toContain('Agency team');
  });

  it('honours feature flags without leaving an empty group label', () => {
    const flagged = [{ id: 'flagged', label: 'Experimental', items: [{ ...businessNavigation[0].items[0], id: 'experiment', featureFlag: 'experiment' }] }];
    expect(resolveNavigation(flagged, { portal: 'business', role: 'owner', featureFlags: {} })).toEqual([]);
    expect(labels(resolveNavigation(flagged, { portal: 'business', role: 'owner', featureFlags: { experiment: true } }))).toEqual(['Dashboard']);
  });

  it('keeps premium features visible and marks them locked for Core', () => {
    const groups = resolveNavigation(businessNavigation, {
      portal: 'business',
      role: 'owner',
      permissions: [],
      entitlements: {
        'analytics.advanced': { enabled: false },
        'automations.enabled': { enabled: false },
        'inventory.enabled': { enabled: false },
      },
    });
    const premium = groups.flatMap(group => group.items).filter(item => ['analytics', 'automations', 'inventory'].includes(item.id));
    expect(premium.map(item => item.label)).toEqual(expect.arrayContaining(['Analytics', 'Automations', 'Inventory']));
    expect(premium.every(item => item.locked && item.requiredPlan === 'GROWTH')).toBe(true);
  });

  it('keeps portal links one-way in each navigation tree', () => {
    expect(businessNavigation.flatMap(group => group.items).every(item => item.href.startsWith('/app/'))).toBe(true);
    expect([...agencyNavigation, ...managedBusinessNavigation].flatMap(group => group.items).every(item => item.href.startsWith('/agency/'))).toBe(true);
    expect(resolveNavigation(agencyNavigation, { portal: 'business', role: 'owner', agencyCapabilities: ['tenants.read'] })).toEqual([]);
    expect(resolveNavigation(businessNavigation, { portal: 'agency', role: 'owner', permissions: [] })).toEqual([]);
  });
});

describe('route matching', () => {
  it('matches nested routes to the most specific configured parent', () => {
    const groups = resolveNavigation(businessNavigation, { portal: 'business', role: 'owner', permissions: [] });
    expect(findActiveNavigationItem(groups, '/app/reports/finance')?.label).toBe('Reports');
    expect(findActiveNavigationItem(groups, '/app/settings/booking-page')?.label).toBe('Booking Page');
    expect(findActiveNavigationItem(groups, '/app/bookings')?.label).toBe('Booking Calendar');
  });

  it('replaces managed-business route parameters and matches exact tenant routes', () => {
    const groups = resolveNavigation(managedBusinessNavigation, { portal: 'managed-business', agencyCapabilities: ['tenants.read', 'billing.read'] });
    const summary = groups[0].items.find(item => item.id === 'managed-summary')!;
    const users = groups[0].items.find(item => item.id === 'managed-users')!;
    expect(navigationHref(summary, { tenantId: 'tenant-1' })).toBe('/agency/tenants/tenant-1');
    expect(navigationHref(users, { tenantId: 'tenant-1' })).toBe('/agency/tenants/tenant-1/users');
    expect(isNavigationItemActive(summary, '/agency/tenants/tenant-1', { tenantId: 'tenant-1' })).toBe(true);
    expect(isNavigationItemActive(summary, '/agency/tenants/tenant-1/users', { tenantId: 'tenant-1' })).toBe(false);
    expect(isNavigationItemActive(users, '/agency/tenants/tenant-1/users', { tenantId: 'tenant-1' })).toBe(true);
    expect(isNavigationItemActive(summary, '/agency/tenants/tenant-1/billing', { tenantId: 'tenant-1' })).toBe(false);
  });
});
