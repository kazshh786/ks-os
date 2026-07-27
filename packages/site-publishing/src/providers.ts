import type { DnsRecord } from './dns.js';

export interface ProviderResult {
  providerSafeReference: string;
  state: 'PENDING' | 'READY' | 'FAILED';
  retryable: boolean;
  safeMessage?: string;
}

export interface CloudflareDnsProvider {
  createOrReuseZone(hostname: string, idempotencyKey: string): Promise<ProviderResult>;
  discoverDnsRecords(hostname: string): Promise<readonly DnsRecord[]>;
  assignedNameservers(hostname: string): Promise<readonly string[]>;
  nameserverDelegationState(hostname: string): Promise<'PENDING' | 'ACTIVE' | 'FAILED'>;
  applyReviewedWebsiteRecords(
    hostname: string,
    records: readonly DnsRecord[],
    idempotencyKey: string,
  ): Promise<ProviderResult>;
  removeManagedWebsiteRecords(hostname: string, idempotencyKey: string): Promise<ProviderResult>;
}

export interface VercelSiteDomainProvider {
  attachToSharedSitesProject(hostname: string, idempotencyKey: string): Promise<ProviderResult>;
  inspectProjectSpecificConfiguration(hostname: string): Promise<{
    verification: 'PENDING' | 'VERIFIED' | 'CONFLICT';
    ssl: 'PENDING' | 'ACTIVE' | 'FAILED';
    requiredRecords: readonly DnsRecord[];
    ownershipChallengeDigestSha256?: string;
  }>;
  removeFromSharedSitesProject(hostname: string, idempotencyKey: string): Promise<ProviderResult>;
}

export class ProviderDisabledError extends Error {
  readonly code = 'PROVIDER_DISABLED';
  constructor(provider: string) {
    super(`${provider} provider operations are disabled.`);
  }
}

export class DisabledCloudflareDnsProvider implements CloudflareDnsProvider {
  private fail(): never { throw new ProviderDisabledError('Cloudflare'); }
  async createOrReuseZone(): Promise<ProviderResult> { return this.fail(); }
  async discoverDnsRecords(): Promise<readonly DnsRecord[]> { return this.fail(); }
  async assignedNameservers(): Promise<readonly string[]> { return this.fail(); }
  async nameserverDelegationState(): Promise<'PENDING' | 'ACTIVE' | 'FAILED'> { return this.fail(); }
  async applyReviewedWebsiteRecords(): Promise<ProviderResult> { return this.fail(); }
  async removeManagedWebsiteRecords(): Promise<ProviderResult> { return this.fail(); }
}

export class DisabledVercelSiteDomainProvider implements VercelSiteDomainProvider {
  private fail(): never { throw new ProviderDisabledError('Vercel'); }
  async attachToSharedSitesProject(): Promise<ProviderResult> { return this.fail(); }
  async inspectProjectSpecificConfiguration(): Promise<never> { return this.fail(); }
  async removeFromSharedSitesProject(): Promise<ProviderResult> { return this.fail(); }
}

export class FakeCloudflareDnsProvider implements CloudflareDnsProvider {
  readonly zones = new Map<string, ProviderResult>();
  readonly records = new Map<string, readonly DnsRecord[]>();
  async createOrReuseZone(_hostname: string, idempotencyKey: string) {
    const existing = this.zones.get(idempotencyKey);
    if (existing) return existing;
    const result: ProviderResult = {
      providerSafeReference: `cf-zone-${this.zones.size + 1}`,
      state: 'PENDING',
      retryable: false,
    };
    this.zones.set(idempotencyKey, result);
    return result;
  }
  async discoverDnsRecords(hostname: string) { return this.records.get(hostname) ?? []; }
  async assignedNameservers() { return ['ns1.example.test', 'ns2.example.test']; }
  async nameserverDelegationState() { return 'ACTIVE' as const; }
  async applyReviewedWebsiteRecords(_hostname: string, _records: readonly DnsRecord[], key: string) {
    return { providerSafeReference: `cf-apply-${key.slice(0, 12)}`, state: 'READY' as const, retryable: false };
  }
  async removeManagedWebsiteRecords(_hostname: string, key: string) {
    return { providerSafeReference: `cf-remove-${key.slice(0, 12)}`, state: 'READY' as const, retryable: false };
  }
}

export class FakeVercelSiteDomainProvider implements VercelSiteDomainProvider {
  readonly attachments = new Map<string, ProviderResult>();
  async attachToSharedSitesProject(_hostname: string, idempotencyKey: string) {
    const existing = this.attachments.get(idempotencyKey);
    if (existing) return existing;
    const result: ProviderResult = {
      providerSafeReference: `vercel-domain-${this.attachments.size + 1}`,
      state: 'PENDING',
      retryable: false,
    };
    this.attachments.set(idempotencyKey, result);
    return result;
  }
  async inspectProjectSpecificConfiguration(hostname: string) {
    return {
      verification: 'VERIFIED' as const,
      ssl: 'ACTIVE' as const,
      requiredRecords: [],
      ownershipChallengeDigestSha256: `digest:${hostname}`,
    };
  }
  async removeFromSharedSitesProject(_hostname: string, key: string) {
    return { providerSafeReference: `vercel-remove-${key.slice(0, 12)}`, state: 'READY' as const, retryable: false };
  }
}
