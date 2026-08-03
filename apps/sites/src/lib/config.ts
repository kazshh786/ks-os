import { z } from 'zod';
import { normalizePublicHostname } from './hostname.js';

export interface SitesRuntimeConfig {
  nodeEnv: 'development' | 'production' | 'test';
  fallbackDomain: string;
  previewHostname?: string;
  noIndexHostnames: string[];
  publicBookingOrigin?: string;
  previewTokenSecret?: string;
  trustedProxy: boolean;
  releaseVersion: string;
}

const RuntimeEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PUBLIC_SITES_FALLBACK_DOMAIN: z.string().optional(),
  PUBLIC_SITES_PREVIEW_HOST: z.string().optional(),
  PUBLIC_SITES_NOINDEX_HOSTS: z.string().optional(),
  PUBLIC_BOOKING_ORIGIN: z.string().url().optional(),
  SITE_PREVIEW_TOKEN_SECRET: z.string().min(32).optional(),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  RELEASE_VERSION: z.string().max(120).default('development'),
}).passthrough();

export function loadSitesRuntimeConfig(
  source: NodeJS.ProcessEnv = process.env,
): SitesRuntimeConfig {
  const parsed = RuntimeEnvironmentSchema.parse(source);
  const fallbackDomain = parsed.PUBLIC_SITES_FALLBACK_DOMAIN
    ?? (parsed.NODE_ENV === 'production' ? undefined : 'sites.localhost');
  if (!fallbackDomain) {
    throw new Error('PUBLIC_SITES_FALLBACK_DOMAIN is required in production.');
  }
  const normalizedFallback = normalizePublicHostname(fallbackDomain);
  if (
    parsed.NODE_ENV === 'production'
    && parsed.PUBLIC_BOOKING_ORIGIN
    && !parsed.PUBLIC_BOOKING_ORIGIN.startsWith('https://')
  ) {
    throw new Error('PUBLIC_BOOKING_ORIGIN must use HTTPS in production.');
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    fallbackDomain: normalizedFallback,
    previewHostname: parsed.PUBLIC_SITES_PREVIEW_HOST
      ? normalizePublicHostname(parsed.PUBLIC_SITES_PREVIEW_HOST)
      : undefined,
    noIndexHostnames: (parsed.PUBLIC_SITES_NOINDEX_HOSTS ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .map(normalizePublicHostname),
    publicBookingOrigin: parsed.PUBLIC_BOOKING_ORIGIN,
    previewTokenSecret: parsed.SITE_PREVIEW_TOKEN_SECRET,
    trustedProxy: parsed.TRUST_PROXY === 'true',
    releaseVersion: parsed.RELEASE_VERSION,
  };
}
