import type { SitePageType } from '@ks-os/contracts';

const UUID_FRAGMENT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export const RESERVED_BLUEPRINT_PATHS = new Map<string, SitePageType>([
  ['/', 'HOME'],
  ['/services', 'SERVICE_HUB'],
  ['/locations', 'LOCATION_HUB'],
  ['/about', 'ABOUT'],
  ['/team', 'TEAM_HUB'],
  ['/contact', 'CONTACT'],
  ['/frequently-asked-questions', 'FAQ'],
  ['/policies', 'POLICIES'],
  ['/results', 'RESULTS'],
  ['/new-client-guide', 'NEW_CLIENT_GUIDE'],
  ['/aftercare-guide', 'AFTERCARE_GUIDE'],
  ['/consultation-guide', 'CONSULTATION_GUIDE'],
  ['/book', 'BOOKING'],
]);

export function slugifySegment(value: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized.slice(0, 80) || 'page';
}

export function defaultBlueprintPath(
  pageType: SitePageType,
  subjectName?: string,
) {
  if (pageType === 'SERVICE_DETAIL') {
    return `/services/${slugifySegment(subjectName || 'service')}`;
  }
  if (pageType === 'LOCATION_DETAIL') {
    return `/locations/${slugifySegment(subjectName || 'location')}`;
  }
  if (pageType === 'TEAM_DETAIL') {
    return `/team/${slugifySegment(subjectName || 'team-member')}`;
  }
  return [...RESERVED_BLUEPRINT_PATHS.entries()]
    .find(([, reservedType]) => reservedType === pageType)?.[0]
    || `/${slugifySegment(pageType)}`;
}

export function allocateUniqueBlueprintPath(
  desired: string,
  usedPaths: Set<string>,
) {
  if (!usedPaths.has(desired)) {
    usedPaths.add(desired);
    return desired;
  }
  let suffix = 2;
  while (usedPaths.has(`${desired}-${suffix}`)) suffix += 1;
  const allocated = `${desired}-${suffix}`;
  usedPaths.add(allocated);
  return allocated;
}

export function canonicalPathIssue(path: string, pageType: SitePageType) {
  if (
    path.includes('://')
    || path.includes('?')
    || path.includes('#')
    || path.includes('..')
    || path.includes('//')
    || path.includes('\\')
    || !/^\/(?:[a-z0-9]+(?:[a-z0-9/-]*[a-z0-9])?)?$/.test(path)
  ) {
    return 'CANONICAL_PATH_INVALID';
  }
  if (UUID_FRAGMENT.test(path)) return 'CANONICAL_PATH_CONTAINS_UUID';
  const reservedFor = RESERVED_BLUEPRINT_PATHS.get(path);
  if (reservedFor && reservedFor !== pageType) return 'RESERVED_PATH_COLLISION';
  if (pageType === 'BOOKING' && path !== '/book') return 'BOOKING_PATH_INVALID';
  if (pageType === 'HOME' && path !== '/') return 'HOME_PATH_INVALID';
  if (pageType === 'SERVICE_DETAIL' && !path.startsWith('/services/')) {
    return 'SERVICE_DETAIL_PATH_INVALID';
  }
  if (pageType === 'LOCATION_DETAIL' && !path.startsWith('/locations/')) {
    return 'LOCATION_DETAIL_PATH_INVALID';
  }
  if (pageType === 'TEAM_DETAIL' && !path.startsWith('/team/')) {
    return 'TEAM_DETAIL_PATH_INVALID';
  }
  return null;
}
