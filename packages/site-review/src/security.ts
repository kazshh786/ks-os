import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  type PreviewSessionPurposeSchema,
  type ReviewParticipantRole,
  type ReviewScope,
} from './contracts.js';
import type { z } from 'zod';
import { SiteReviewPolicyError } from './lifecycle.js';

export type PreviewSessionPurpose = z.infer<typeof PreviewSessionPurposeSchema>;

export interface IssuedReviewToken {
  token: string;
  digestSha256: string;
}

export interface StoredReviewSession {
  tokenDigestSha256: string;
  reviewCycleReference: string;
  siteReference: string;
  versionReference: string;
  participantReference: string;
  participantRole: ReviewParticipantRole;
  purpose: PreviewSessionPurpose;
  allowedScope: ReviewScope;
  expiresAt: Date;
  revokedAt?: Date | null;
}

export function digestReviewToken(token: string): string {
  return createHash('sha256')
    .update(`ks-os-site-review:v1:${token}`, 'utf8')
    .digest('hex');
}

export function issueReviewToken(): IssuedReviewToken {
  const token = `ksr_${randomBytes(32).toString('base64url')}`;
  return { token, digestSha256: digestReviewToken(token) };
}

export function deriveReviewInvitationToken(input: {
  invitationReference: string;
  reviewCycleReference: string;
  reviewRevision: number;
  secret: string;
}): string {
  if (input.secret.length < 32) {
    throw new SiteReviewPolicyError(
      'SITE_REVIEW_INVITATION_UNAVAILABLE',
      'Review invitation signing is unavailable.',
    );
  }
  const body = Buffer.from(JSON.stringify({
    v: 1,
    invitationReference: input.invitationReference,
    reviewCycleReference: input.reviewCycleReference,
    reviewRevision: input.reviewRevision,
  }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', input.secret)
    .update(`ks-os-site-review-invitation:v1:${body}`)
    .digest('base64url');
  return `ksri_${body}.${signature}`;
}

export function tokenDigestMatches(token: string, expectedDigest: string): boolean {
  if (!/^ksr_[A-Za-z0-9_-]{43}$/.test(token) || !/^[a-f0-9]{64}$/.test(expectedDigest)) {
    return false;
  }
  const actual = Buffer.from(digestReviewToken(token), 'hex');
  const expected = Buffer.from(expectedDigest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateReviewSession(input: {
  token: string;
  stored: StoredReviewSession | null;
  expectedReviewCycleReference?: string;
  expectedSiteReference?: string;
  expectedVersionReference?: string;
  now?: Date;
}): StoredReviewSession {
  const { stored } = input;
  if (
    !stored
    || !tokenDigestMatches(input.token, stored.tokenDigestSha256)
    || stored.revokedAt
    || stored.expiresAt.getTime() <= (input.now ?? new Date()).getTime()
    || (
      input.expectedReviewCycleReference !== undefined
      && stored.reviewCycleReference !== input.expectedReviewCycleReference
    )
    || (
      input.expectedSiteReference !== undefined
      && stored.siteReference !== input.expectedSiteReference
    )
    || (
      input.expectedVersionReference !== undefined
      && stored.versionReference !== input.expectedVersionReference
    )
  ) {
    throw new SiteReviewPolicyError(
      'SITE_REVIEW_SESSION_INVALID',
      'The review session is invalid, expired, revoked, or outside its allowed scope.',
    );
  }
  return stored;
}
