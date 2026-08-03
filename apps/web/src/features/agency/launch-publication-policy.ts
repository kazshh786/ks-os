export type LaunchDomain = {
  domainType?: string;
  type?: string;
  domainRole?: string;
  role?: string;
  status?: string;
  ownershipStatus?: string;
  sslStatus?: string;
};

export type LaunchQuality = {
  reference?: string;
  siteVersionReference?: string;
  status?: string;
  publicationGateStatus?: string;
};

const domainType = (domain: LaunchDomain) => domain.domainType || domain.type;
const domainRole = (domain: LaunchDomain) => domain.domainRole || domain.role;

export function activeManagedHostname(domains: LaunchDomain[]) {
  return domains.some(domain =>
    domain.status === 'ACTIVE'
    && domain.ownershipStatus === 'VERIFIED'
    && domain.sslStatus === 'ACTIVE'
    && (
      domainType(domain) === 'FALLBACK'
      || (domainType(domain) === 'CUSTOM' && domainRole(domain) === 'CANONICAL')
    ));
}

export function launchPublicationPolicy(input: {
  domains: LaunchDomain[];
  quality?: LaunchQuality;
  versionReference?: string;
  reviewApproved: boolean;
  warningsAcknowledged: boolean;
}) {
  const warningsRequireAcknowledgement = input.quality?.publicationGateStatus === 'READY_WITH_WARNINGS';
  const qualityReady = input.quality?.status === 'READY'
    && ['READY', 'READY_WITH_WARNINGS'].includes(input.quality.publicationGateStatus || '')
    && input.quality.siteVersionReference === input.versionReference;
  const managedHostnameActive = activeManagedHostname(input.domains);
  return {
    warningsRequireAcknowledgement,
    qualityReady,
    managedHostnameActive,
    canPublish: Boolean(
      input.reviewApproved
      && qualityReady
      && managedHostnameActive
      && (!warningsRequireAcknowledgement || input.warningsAcknowledged)
    ),
  };
}

export function launchPollingRequired(input: {
  qualityStatus?: string;
  publicationStatus?: string;
  domainStatuses: string[];
}) {
  const qualityActive = Boolean(input.qualityStatus && !['READY', 'FAILED', 'CANCELLED', 'STALE'].includes(input.qualityStatus));
  const publicationActive = Boolean(input.publicationStatus && !['LIVE', 'FAILED', 'CANCELLED'].includes(input.publicationStatus));
  const domainActive = input.domainStatuses.some(status => [
    'RESERVED', 'DNS_DISCOVERY_PENDING', 'DNS_REVIEW_REQUIRED', 'VERIFYING', 'SSL_PENDING',
  ].includes(status));
  return qualityActive || publicationActive || domainActive;
}
