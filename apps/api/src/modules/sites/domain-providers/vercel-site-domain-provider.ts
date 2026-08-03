import { normalizeCustomHostname } from '@ks-os/site-publishing';
import {
  SiteDomainProviderError,
  type ManagedSiteDnsRecord,
  type PreparedSiteDomain,
  type SiteDomainProvider,
  type VerifiedSiteDomain,
} from './site-domain-provider.js';

type VercelDomainResponse = {
  name?: string;
  verified?: boolean;
  verification?: Array<{ type?: string; domain?: string; value?: string }>;
};
type VercelConfigResponse = {
  misconfigured?: boolean;
  recommendedCNAME?: Array<{ value?: string; rank?: number }>;
  recommendedIPv4?: Array<{ value?: string; rank?: number }>;
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const safeText = (value: unknown, maximum = 2_000) =>
  typeof value === 'string' ? value.slice(0, maximum) : '';

export class VercelSiteDomainProvider implements SiteDomainProvider {
  readonly key = 'VERCEL' as const;

  constructor(
    private readonly environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
    private readonly request: typeof fetch = fetch,
  ) {}

  private configuration() {
    const token = this.environment.VERCEL_AUTH_TOKEN;
    const projectId = this.environment.VERCEL_PROJECT_ID;
    if (!token || !projectId) {
      throw new SiteDomainProviderError(
        503,
        'VERCEL_PROVIDER_UNAVAILABLE',
        'The legacy Vercel domain adapter is not configured on the API server.',
      );
    }
    return { token, projectId, teamId: this.environment.VERCEL_TEAM_ID || '' };
  }

  private async vercel<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { token, teamId } = this.configuration();
    const query = teamId ? `${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}` : '';
    let response: Response;
    try {
      response = await this.request(`https://api.vercel.com${path}${query}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new SiteDomainProviderError(503, 'VERCEL_REQUEST_FAILED', 'Vercel could not be reached for the legacy domain operation.');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = object(object(payload).error);
      throw new SiteDomainProviderError(
        response.status,
        `VERCEL_${safeText(error.code, 80).toUpperCase() || 'DOMAIN_ERROR'}`,
        safeText(error.message, 500) || 'Vercel rejected the legacy domain request.',
      );
    }
    return payload as T;
  }

  private routing(hostname: string, config: VercelConfigResponse): ManagedSiteDnsRecord {
    const cname = [...(config.recommendedCNAME || [])]
      .sort((left, right) => Number(left.rank || 0) - Number(right.rank || 0))
      .find(item => safeText(item.value));
    if (cname?.value) {
      return {
        type: 'CNAME', name: hostname, value: safeText(cname.value), ttl: 300,
        classification: 'WEBSITE', protected: true, managedByKsOs: false,
        proxied: false, reviewDecision: 'PRESERVE',
      };
    }
    const ipv4 = [...(config.recommendedIPv4 || [])]
      .sort((left, right) => Number(left.rank || 0) - Number(right.rank || 0))
      .find(item => safeText(item.value));
    if (!ipv4?.value) {
      throw new SiteDomainProviderError(502, 'VERCEL_ROUTING_RECORD_MISSING', 'Vercel did not return a safe routing record.');
    }
    return {
      type: 'A', name: hostname, value: safeText(ipv4.value), ttl: 300,
      classification: 'WEBSITE', protected: true, managedByKsOs: false,
      proxied: false, reviewDecision: 'PRESERVE',
    };
  }

  async prepare(input: {
    hostname: string;
    existingProviderSafeReference?: string | null;
  }): Promise<PreparedSiteDomain> {
    const hostname = normalizeCustomHostname(input.hostname);
    const { projectId } = this.configuration();
    const attached = input.existingProviderSafeReference
      ? { name: hostname, verified: false, verification: [] }
      : await this.vercel<VercelDomainResponse>(
        `/v9/projects/${encodeURIComponent(projectId)}/domains`,
        { method: 'POST', body: JSON.stringify({ name: hostname }) },
      );
    const config = await this.vercel<VercelConfigResponse>(`/v6/domains/${encodeURIComponent(hostname)}/config`);
    const verification = Array.isArray(attached.verification) ? attached.verification : [];
    const dnsRecords: ManagedSiteDnsRecord[] = [
      this.routing(hostname, config),
      ...verification.flatMap(item => {
        const type = safeText(item.type, 10).toUpperCase();
        const value = safeText(item.value);
        if (!['TXT', 'CNAME', 'A'].includes(type) || !value) return [];
        return [{
          type: type as 'TXT' | 'CNAME' | 'A',
          name: safeText(item.domain, 253).toLowerCase() || hostname,
          value,
          ttl: 300,
          classification: type === 'TXT' ? 'SECURITY' as const : 'WEBSITE' as const,
          protected: true,
          managedByKsOs: false,
          proxied: false,
          reviewDecision: 'PRESERVE' as const,
        }];
      }),
    ];
    return {
      providerKey: this.key,
      providerSafeReference: input.existingProviderSafeReference || safeText(attached.name) || hostname,
      ownershipStatus: attached.verified ? 'VERIFIED' : 'CHALLENGE_PENDING',
      sslStatus: attached.verified && config.misconfigured === false ? 'ACTIVE' : 'PENDING',
      dnsRecords,
    };
  }

  async verify(input: {
    hostname: string;
    providerSafeReference: string;
  }): Promise<VerifiedSiteDomain> {
    const hostname = normalizeCustomHostname(input.hostname);
    const { projectId } = this.configuration();
    const verified = await this.vercel<VercelDomainResponse>(
      `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(hostname)}/verify`,
      { method: 'POST', body: '{}' },
    );
    const config = await this.vercel<VercelConfigResponse>(`/v6/domains/${encodeURIComponent(hostname)}/config`);
    return {
      providerKey: this.key,
      providerSafeReference: input.providerSafeReference,
      dnsActive: verified.verified === true && config.misconfigured === false,
      sslActive: verified.verified === true && config.misconfigured === false,
    };
  }
}
