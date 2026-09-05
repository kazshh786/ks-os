import { canUseProfileModule } from '@ks-os/contracts';
import { navigationModule } from './business-navigation';
import type { NavigationContext, NavigationGroup, NavigationItem, ResolvedNavigationGroup } from './navigation.types';

export function resolveNavigation(groups: NavigationGroup[], context: NavigationContext): ResolvedNavigationGroup[] {
  return groups.map(group => ({
    ...group,
    items: group.items.filter(item => isNavigationItemVisible(item, context)).map(item => ({
      ...item,
      label: context.portal === 'business' && context.businessProfile && item.id === 'customers'
        ? context.businessProfile.terminology.customers : item.label,
      locked: Boolean(item.requiredEntitlement && context.entitlements && context.entitlements[item.requiredEntitlement]?.enabled !== true),
    })),
  })).filter(group => group.items.length > 0);
}

export function isNavigationItemVisible(item: NavigationItem, context: NavigationContext): boolean {
  if (context.portal === 'business' && context.businessProfile && !context.businessProfile.compatibilityMode) {
    const moduleKey = navigationModule[item.id];
    if (!moduleKey || !canUseProfileModule(context.businessProfile, moduleKey, context)) return false;
  }
  const expectedPrefix = context.portal === 'business' ? '/app/' : '/agency/';
  if (!item.href.startsWith(expectedPrefix)) return false;
  if (item.featureFlag && !context.featureFlags?.[item.featureFlag]) return false;
  if (item.roles && (!context.role || !item.roles.includes(context.role))) return false;
  if (item.permissionsAny?.length && context.role !== 'owner' && !item.permissionsAny.some(permission => context.permissions?.includes(permission))) return false;
  if (item.agencyCapabilitiesAny?.length && !item.agencyCapabilitiesAny.some(capability => context.agencyCapabilities?.includes(capability))) return false;
  return true;
}

export function navigationHref(item: NavigationItem, parameters: Record<string, string> = {}): string {
  return Object.entries(parameters).reduce((href, [key, value]) => href.replace(`:${key}`, value), item.href);
}

export function isNavigationItemActive(item: NavigationItem, pathname: string, parameters: Record<string, string> = {}): boolean {
  const href = navigationHref(item, parameters);
  if (pathname === href) return true;
  return item.activePrefixes?.some(prefix => pathname.startsWith(navigationHref({ ...item, href: prefix }, parameters))) ?? false;
}

export function findActiveNavigationItem(groups: ResolvedNavigationGroup[], pathname: string, parameters: Record<string, string> = {}): NavigationItem | undefined {
  const candidates = groups.flatMap(group => group.items).filter(item => isNavigationItemActive(item, pathname, parameters));
  return candidates.sort((left, right) => navigationHref(right, parameters).length - navigationHref(left, parameters).length)[0];
}
