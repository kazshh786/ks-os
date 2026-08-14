import { createHash } from 'node:crypto';
import {
  LiveSiteResolutionInputSchema,
  PublicLiveSiteDataSchema,
  type LiveSiteResolutionInput,
  type PublicLiveSiteData,
} from './contracts.js';
import { BoundedLiveSiteCache, LIVE_SITE_CACHE_POLICIES } from './cache.js';

export interface LiveSiteDataSource {
  resolveBatch(input: LiveSiteResolutionInput): Promise<PublicLiveSiteData>;
}

export function isSnapshotBoundAvailability(
  availability: {
    serviceReference: string;
    staffReference?: string | null;
    locationReference?: string | null;
  },
  input: Pick<LiveSiteResolutionInput, 'serviceReferences' | 'staffReferences' | 'locationReferences'>,
) {
  return input.serviceReferences.includes(availability.serviceReference)
    && (!availability.staffReference || input.staffReferences.includes(availability.staffReference))
    && (!availability.locationReference || input.locationReferences.includes(availability.locationReference));
}

function cacheKey(input: LiveSiteResolutionInput) {
  const digest = createHash('sha256').update(JSON.stringify({
    tenantReference: input.tenantReference,
    services: [...input.serviceReferences].sort(),
    staff: [...input.staffReferences].sort(),
    locations: [...input.locationReferences].sort(),
  })).digest('hex');
  return `${input.siteReference}:${digest}`;
}

function fallback(input: LiveSiteResolutionInput, code: 'LIVE_SOURCE_TIMEOUT' | 'LIVE_SOURCE_UNAVAILABLE', resolutionMs: number): PublicLiveSiteData {
  return PublicLiveSiteDataSchema.parse({
    schemaVersion: 1,
    dataClass: 'LIVE',
    siteReference: input.siteReference,
    resolvedAt: new Date().toISOString(),
    services: [],
    staff: [],
    locations: [],
    availability: [],
    campaigns: [],
    warnings: [{ code }],
    telemetry: {
      cacheClass: 'LIVE_FAST',
      cacheHit: false,
      fallbackActivated: true,
      queryCount: 0,
      resolutionMs,
    },
  });
}

export class LiveSiteDataResolver {
  constructor(
    private readonly source: LiveSiteDataSource,
    private readonly cache = new BoundedLiveSiteCache(),
    private readonly timeoutMs = 1_500,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10_000) {
      throw new Error('Live resolver timeout must be between 50ms and 10s.');
    }
  }

  async resolve(inputValue: LiveSiteResolutionInput): Promise<PublicLiveSiteData> {
    const input = LiveSiteResolutionInputSchema.parse(inputValue);
    const key = cacheKey(input);
    const cached = this.cache.get(key);
    if (cached) {
      return PublicLiveSiteDataSchema.parse({
        ...cached,
        telemetry: { ...cached.telemetry, cacheHit: true },
      });
    }

    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.source.resolveBatch(input),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('Live resolver timed out.'), { code: 'LIVE_SOURCE_TIMEOUT' })), this.timeoutMs);
        }),
      ]);
      const parsed = PublicLiveSiteDataSchema.parse({
        ...result,
        siteReference: input.siteReference,
        availability: result.availability.filter(item => isSnapshotBoundAvailability(item, input)),
        telemetry: {
          ...result.telemetry,
          cacheClass: 'LIVE_FAST',
          cacheHit: false,
          resolutionMs: Date.now() - started,
        },
      });
      this.cache.set(key, parsed, LIVE_SITE_CACHE_POLICIES.LIVE_FAST);
      return parsed;
    } catch (error) {
      const stale = this.cache.get(key, Date.now(), true);
      if (stale) {
        return PublicLiveSiteDataSchema.parse({
          ...stale,
          warnings: [...stale.warnings, { code: 'LIVE_SOURCE_UNAVAILABLE' }].slice(-100),
          telemetry: {
            ...stale.telemetry,
            cacheHit: true,
            fallbackActivated: true,
            resolutionMs: Date.now() - started,
          },
        });
      }
      return fallback(
        input,
        (error as { code?: unknown })?.code === 'LIVE_SOURCE_TIMEOUT'
          ? 'LIVE_SOURCE_TIMEOUT'
          : 'LIVE_SOURCE_UNAVAILABLE',
        Date.now() - started,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  invalidateSite(siteReference: string) {
    this.cache.invalidateSite(siteReference);
  }
}
