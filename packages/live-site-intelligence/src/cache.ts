import type { LiveSiteCacheClass, PublicLiveSiteData } from './contracts.js';

export interface LiveSiteCachePolicy {
  cacheClass: LiveSiteCacheClass;
  shared: boolean;
  ttlSeconds: number;
  staleIfErrorSeconds: number;
}

export const LIVE_SITE_CACHE_POLICIES: Readonly<Record<LiveSiteCacheClass, LiveSiteCachePolicy>> = {
  PUBLISHED: { cacheClass: 'PUBLISHED', shared: true, ttlSeconds: 31_536_000, staleIfErrorSeconds: 0 },
  LIVE_SLOW: { cacheClass: 'LIVE_SLOW', shared: true, ttlSeconds: 300, staleIfErrorSeconds: 900 },
  LIVE_FAST: { cacheClass: 'LIVE_FAST', shared: true, ttlSeconds: 30, staleIfErrorSeconds: 120 },
  PERSONAL: { cacheClass: 'PERSONAL', shared: false, ttlSeconds: 0, staleIfErrorSeconds: 0 },
};

type CacheEntry = {
  value: PublicLiveSiteData;
  expiresAt: number;
  staleUntil: number;
};

export class BoundedLiveSiteCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly maxEntries = 500) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) {
      throw new Error('Live cache capacity must be between 1 and 10000 entries.');
    }
  }

  get(key: string, now = Date.now(), allowStale = false): PublicLiveSiteData | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt > now || (allowStale && entry.staleUntil > now)) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.value;
    }
    // Keep an expired-but-still-stale entry available for a subsequent source
    // failure in the same resolution attempt.
    if (!allowStale && entry.staleUntil > now) return null;
    this.entries.delete(key);
    return null;
  }

  set(key: string, value: PublicLiveSiteData, policy = LIVE_SITE_CACHE_POLICIES.LIVE_FAST, now = Date.now()) {
    if (!policy.shared || policy.ttlSeconds <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: now + policy.ttlSeconds * 1_000,
      staleUntil: now + (policy.ttlSeconds + policy.staleIfErrorSeconds) * 1_000,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  invalidateSite(siteReference: string) {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${siteReference}:`)) this.entries.delete(key);
    }
  }
}

export function liveSiteCacheControl(cacheClass: LiveSiteCacheClass) {
  const policy = LIVE_SITE_CACHE_POLICIES[cacheClass];
  if (!policy.shared) return 'private, no-store, max-age=0';
  return `public, max-age=${policy.ttlSeconds}, s-maxage=${policy.ttlSeconds}, stale-if-error=${policy.staleIfErrorSeconds}`;
}
