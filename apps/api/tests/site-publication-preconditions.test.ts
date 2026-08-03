import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasActiveManagedHostname,
  publicationBlockCode,
  type PublicationPreconditionInput,
} from '../src/modules/sites/publication-preconditions.js';

const ready: PublicationPreconditionInput = {
  versionDigest: 'a'.repeat(64), qualityDigest: 'a'.repeat(64),
  versionStatus: 'APPROVED', reviewApproved: true,
  qualityStatus: 'READY', gateStatus: 'READY', acknowledgeWarnings: false,
  siteStatus: 'APPROVED', managedHostnameActive: true,
};

test('an active verified fallback satisfies the managed-hostname publication gate', () => {
  assert.equal(hasActiveManagedHostname([{ domainType: 'FALLBACK', domainRole: 'FALLBACK', status: 'ACTIVE', ownershipStatus: 'VERIFIED', sslStatus: 'ACTIVE' }]), true);
  assert.equal(publicationBlockCode(ready), null);
});

test('an active verified canonical custom domain satisfies the same provider-neutral gate', () => {
  assert.equal(hasActiveManagedHostname([{ domainType: 'CUSTOM', domainRole: 'CANONICAL', status: 'ACTIVE', ownershipStatus: 'VERIFIED', sslStatus: 'ACTIVE' }]), true);
});

test('publication fails closed without exact review, quality, domain, or warning acknowledgement', () => {
  assert.equal(publicationBlockCode({ ...ready, reviewApproved: false }), 'PUBLICATION_REVIEW_REQUIRED');
  assert.equal(publicationBlockCode({ ...ready, qualityStatus: 'RUNNING' }), 'PUBLICATION_READINESS_BLOCKED');
  assert.equal(publicationBlockCode({ ...ready, managedHostnameActive: false }), 'PUBLICATION_MANAGED_HOSTNAME_REQUIRED');
  assert.equal(publicationBlockCode({ ...ready, gateStatus: 'READY_WITH_WARNINGS' }), 'PUBLICATION_WARNING_ACKNOWLEDGEMENT_REQUIRED');
  assert.equal(publicationBlockCode({ ...ready, gateStatus: 'READY_WITH_WARNINGS', acknowledgeWarnings: true }), null);
});
