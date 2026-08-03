import { describe, expect, it } from 'vitest';
import { activeManagedHostname, launchPollingRequired, launchPublicationPolicy } from './launch-publication-policy';

const fallback = { domainType: 'FALLBACK', domainRole: 'FALLBACK', status: 'ACTIVE', ownershipStatus: 'VERIFIED', sslStatus: 'ACTIVE' };
const custom = { domainType: 'CUSTOM', domainRole: 'CANONICAL', status: 'ACTIVE', ownershipStatus: 'VERIFIED', sslStatus: 'ACTIVE' };
const quality = { reference: 'quality', siteVersionReference: 'version', status: 'READY', publicationGateStatus: 'READY' };

describe('launch publication policy', () => {
  it('allows either an activated fallback or verified canonical custom hostname', () => {
    expect(activeManagedHostname([fallback])).toBe(true);
    expect(activeManagedHostname([custom])).toBe(true);
    expect(launchPublicationPolicy({ domains: [fallback], quality, versionReference: 'version', reviewApproved: true, warningsAcknowledged: false }).canPublish).toBe(true);
  });

  it('fails closed for missing review, stale quality and missing hostname', () => {
    expect(launchPublicationPolicy({ domains: [fallback], quality, versionReference: 'version', reviewApproved: false, warningsAcknowledged: false }).canPublish).toBe(false);
    expect(launchPublicationPolicy({ domains: [fallback], quality, versionReference: 'different', reviewApproved: true, warningsAcknowledged: false }).canPublish).toBe(false);
    expect(launchPublicationPolicy({ domains: [], quality, versionReference: 'version', reviewApproved: true, warningsAcknowledged: false }).canPublish).toBe(false);
  });

  it('requires acknowledgement only for ready-with-warnings', () => {
    const warned = { ...quality, publicationGateStatus: 'READY_WITH_WARNINGS' };
    expect(launchPublicationPolicy({ domains: [fallback], quality: warned, versionReference: 'version', reviewApproved: true, warningsAcknowledged: false }).canPublish).toBe(false);
    expect(launchPublicationPolicy({ domains: [fallback], quality: warned, versionReference: 'version', reviewApproved: true, warningsAcknowledged: true }).canPublish).toBe(true);
  });

  it('polls active work and stops after terminal completion', () => {
    expect(launchPollingRequired({ qualityStatus: 'RUNNING', publicationStatus: undefined, domainStatuses: [] })).toBe(true);
    expect(launchPollingRequired({ qualityStatus: 'READY', publicationStatus: 'LIVE', domainStatuses: ['ACTIVE'] })).toBe(false);
  });
});
