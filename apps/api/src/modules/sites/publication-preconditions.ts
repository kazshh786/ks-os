export type ManagedDomainSignal = {
  domainType: 'FALLBACK' | 'CUSTOM';
  domainRole: 'FALLBACK' | 'ALIAS' | 'CANONICAL';
  status: string;
  ownershipStatus: string;
  sslStatus: string;
};

export function hasActiveManagedHostname(domains: ManagedDomainSignal[]) {
  return domains.some(domain =>
    domain.status === 'ACTIVE'
    && domain.ownershipStatus === 'VERIFIED'
    && domain.sslStatus === 'ACTIVE'
    && (
      domain.domainType === 'FALLBACK'
      || (domain.domainType === 'CUSTOM' && domain.domainRole === 'CANONICAL')
    ));
}

export type PublicationPreconditionInput = {
  versionDigest: string | null;
  qualityDigest: string | null;
  versionStatus: string;
  reviewApproved: boolean;
  qualityStatus: string;
  gateStatus: string;
  acknowledgeWarnings: boolean;
  siteStatus: string;
  managedHostnameActive: boolean;
};

export type PublicationBlockCode =
  | 'PUBLICATION_PIN_MISMATCH'
  | 'PUBLICATION_REVIEW_REQUIRED'
  | 'PUBLICATION_READINESS_BLOCKED'
  | 'PUBLICATION_WARNING_ACKNOWLEDGEMENT_REQUIRED'
  | 'PUBLICATION_SITE_UNAVAILABLE'
  | 'PUBLICATION_MANAGED_HOSTNAME_REQUIRED';

export function publicationBlockCode(input: PublicationPreconditionInput): PublicationBlockCode | null {
  if (!input.versionDigest || input.versionDigest !== input.qualityDigest) return 'PUBLICATION_PIN_MISMATCH';
  if (!input.reviewApproved || !['APPROVED', 'PUBLISHED'].includes(input.versionStatus)) return 'PUBLICATION_REVIEW_REQUIRED';
  if (input.qualityStatus !== 'READY' || !['READY', 'READY_WITH_WARNINGS'].includes(input.gateStatus)) return 'PUBLICATION_READINESS_BLOCKED';
  if (input.gateStatus === 'READY_WITH_WARNINGS' && !input.acknowledgeWarnings) return 'PUBLICATION_WARNING_ACKNOWLEDGEMENT_REQUIRED';
  if (['SUSPENDED', 'ARCHIVED'].includes(input.siteStatus)) return 'PUBLICATION_SITE_UNAVAILABLE';
  if (!input.managedHostnameActive) return 'PUBLICATION_MANAGED_HOSTNAME_REQUIRED';
  return null;
}
