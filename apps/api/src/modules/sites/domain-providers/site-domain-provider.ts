export type SiteDomainProviderKey = 'CLOUDFLARE' | 'VERCEL';

export type ManagedSiteDnsRecord = {
  providerSafeReference?: string;
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
  ttl: number | null;
  classification: 'WEBSITE' | 'SECURITY';
  protected: boolean;
  managedByKsOs: boolean;
  proxied: boolean;
  reviewDecision: 'PRESERVE' | 'APPLY';
};

export type PreparedSiteDomain = {
  providerKey: SiteDomainProviderKey;
  providerSafeReference: string;
  ownershipStatus: 'CHALLENGE_PENDING' | 'VERIFIED';
  sslStatus: 'PENDING' | 'ACTIVE';
  dnsRecords: ManagedSiteDnsRecord[];
};

export type VerifiedSiteDomain = {
  providerKey: SiteDomainProviderKey;
  providerSafeReference: string;
  dnsActive: boolean;
  sslActive: boolean;
};

export interface SiteDomainProvider {
  readonly key: SiteDomainProviderKey;
  prepare(input: {
    hostname: string;
    existingProviderSafeReference?: string | null;
  }): Promise<PreparedSiteDomain>;
  verify(input: {
    hostname: string;
    providerSafeReference: string;
  }): Promise<VerifiedSiteDomain>;
}

export class SiteDomainProviderError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SiteDomainProviderError';
  }
}
