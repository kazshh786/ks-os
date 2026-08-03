import { isIP } from 'node:net';
import { normalizeCustomHostname } from '@ks-os/site-publishing';
import {
  SiteDomainProviderError,
  type ManagedSiteDnsRecord,
  type PreparedSiteDomain,
  type SiteDomainProvider,
  type VerifiedSiteDomain,
} from './site-domain-provider.js';

type CloudflareRecord = {
  id?: string;
  type?: string;
  name?: string;
  content?: string;
  ttl?: number;
  proxied?: boolean;
};

type CloudflareEnvelope<T> = {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
};

const safeText = (value: unknown, maximum = 500) =>
  typeof value === 'string' ? value.slice(0, maximum) : '';

export class CloudflareSiteDomainProvider implements SiteDomainProvider {
  readonly key = 'CLOUDFLARE' as const;

  constructor(
    private readonly environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
    private readonly request: typeof fetch = fetch,
  ) {}

  private configuration() {
    const token = this.environment.CLOUDFLARE_API_TOKEN;
    const zoneId = this.environment.CLOUDFLARE_ZONE_ID;
    if (!token || !zoneId) {
      throw new SiteDomainProviderError(
        503,
        'CLOUDFLARE_PROVIDER_UNAVAILABLE',
        'Cloudflare domain integration is not configured on the API server.',
      );
    }
    const originHost = this.environment.SITE_RENDERER_ORIGIN_HOST?.trim();
    const originIp = this.environment.SITE_RENDERER_ORIGIN_IP?.trim();
    if (originHost) {
      return {
        token,
        zoneId,
        type: 'CNAME' as const,
        content: normalizeCustomHostname(originHost),
      };
    }
    if (originIp && isIP(originIp) === 4) {
      return { token, zoneId, type: 'A' as const, content: originIp };
    }
    throw new SiteDomainProviderError(
      503,
      'SITE_RENDERER_ORIGIN_REQUIRED',
      'Configure a dedicated renderer origin hostname or an intentional public IPv4 address.',
    );
  }

  private async cloudflare<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { token } = this.configuration();
    let response: Response;
    try {
      response = await this.request(`https://api.cloudflare.com/client/v4${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new SiteDomainProviderError(
        503,
        'CLOUDFLARE_REQUEST_FAILED',
        'Cloudflare could not be reached for the domain operation.',
      );
    }
    const payload = await response.json().catch(() => ({})) as CloudflareEnvelope<T>;
    if (!response.ok || payload.success === false) {
      const error = payload.errors?.[0];
      throw new SiteDomainProviderError(
        response.status >= 400 ? response.status : 502,
        error?.code ? `CLOUDFLARE_${error.code}` : 'CLOUDFLARE_DOMAIN_ERROR',
        safeText(error?.message) || 'Cloudflare rejected the domain operation.',
      );
    }
    if (payload.result === undefined) {
      throw new SiteDomainProviderError(
        502,
        'CLOUDFLARE_RESPONSE_INVALID',
        'Cloudflare returned an incomplete domain response.',
      );
    }
    return payload.result;
  }

  private async records(hostname: string): Promise<CloudflareRecord[]> {
    const { zoneId } = this.configuration();
    const query = new URLSearchParams({ name: hostname, per_page: '100' });
    return this.cloudflare<CloudflareRecord[]>(
      `/zones/${encodeURIComponent(zoneId)}/dns_records?${query.toString()}`,
    );
  }

  private databaseRecord(record: CloudflareRecord): ManagedSiteDnsRecord {
    return {
      providerSafeReference: record.id,
      type: record.type === 'A' ? 'A' : 'CNAME',
      name: safeText(record.name, 253).toLowerCase(),
      value: safeText(record.content, 2_000),
      ttl: typeof record.ttl === 'number' && record.ttl >= 60 ? record.ttl : null,
      classification: 'WEBSITE',
      protected: false,
      managedByKsOs: true,
      proxied: record.proxied === true,
      reviewDecision: 'APPLY',
    };
  }

  async prepare(input: {
    hostname: string;
    existingProviderSafeReference?: string | null;
  }): Promise<PreparedSiteDomain> {
    const hostname = normalizeCustomHostname(input.hostname);
    const config = this.configuration();
    const existing = await this.records(hostname);
    const tracked = input.existingProviderSafeReference
      ? existing.find(record => record.id === input.existingProviderSafeReference)
      : undefined;
    const exact = existing.find(record =>
      record.type === config.type
      && safeText(record.name).toLowerCase() === hostname
      && safeText(record.content).toLowerCase() === config.content.toLowerCase());

    if (input.existingProviderSafeReference && !tracked && !exact) {
      throw new SiteDomainProviderError(
        409,
        'CLOUDFLARE_TRACKED_RECORD_MISSING',
        'The previously managed Cloudflare record is missing; manual review is required.',
      );
    }

    const selected = tracked || exact;
    const conflicts = existing.filter(record => record.id !== selected?.id);
    if (
      conflicts.some(record => ['A', 'AAAA', 'CNAME'].includes(safeText(record.type).toUpperCase()))
      || (config.type === 'CNAME' && conflicts.length > 0)
    ) {
      throw new SiteDomainProviderError(
        409,
        'CLOUDFLARE_HOSTNAME_CONFLICT',
        'The requested hostname already has DNS records that KS OS will not modify.',
      );
    }

    const { zoneId } = config;
    const body = JSON.stringify({
      type: config.type,
      name: hostname,
      content: config.content,
      ttl: 1,
      proxied: true,
      comment: 'Managed by KS OS public-sites domain service',
    });
    let record: CloudflareRecord;
    if (selected?.id) {
      const alreadyReady = selected.type === config.type
        && safeText(selected.content).toLowerCase() === config.content.toLowerCase()
        && selected.proxied === true;
      record = alreadyReady
        ? selected
        : await this.cloudflare<CloudflareRecord>(
          `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(selected.id)}`,
          { method: 'PATCH', body },
        );
    } else {
      record = await this.cloudflare<CloudflareRecord>(
        `/zones/${encodeURIComponent(zoneId)}/dns_records`,
        { method: 'POST', body },
      );
    }
    if (!record.id) {
      throw new SiteDomainProviderError(
        502,
        'CLOUDFLARE_RECORD_REFERENCE_MISSING',
        'Cloudflare did not return a safe DNS record reference.',
      );
    }
    return {
      providerKey: this.key,
      providerSafeReference: record.id,
      ownershipStatus: 'VERIFIED',
      sslStatus: 'PENDING',
      dnsRecords: [this.databaseRecord({
        ...record,
        type: config.type,
        name: hostname,
        content: config.content,
        proxied: true,
      })],
    };
  }

  async verify(input: {
    hostname: string;
    providerSafeReference: string;
  }): Promise<VerifiedSiteDomain> {
    const hostname = normalizeCustomHostname(input.hostname);
    const config = this.configuration();
    const record = (await this.records(hostname)).find(candidate =>
      candidate.id === input.providerSafeReference
      && candidate.type === config.type
      && safeText(candidate.name).toLowerCase() === hostname
      && safeText(candidate.content).toLowerCase() === config.content.toLowerCase()
      && candidate.proxied === true);
    return {
      providerKey: this.key,
      providerSafeReference: input.providerSafeReference,
      dnsActive: Boolean(record),
      sslActive: false,
    };
  }
}
