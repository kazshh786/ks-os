import type { PublicationReadinessResult } from '@ks-os/site-quality';
import type { WarningAcknowledgement } from './contracts.js';

export class PublicationReadinessError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PublicationReadinessError';
    this.code = code;
  }
}

export function assertPublicationReady(input: {
  readiness: PublicationReadinessResult;
  expectedDigestSha256: string;
  expectedQualityRunReference: string;
  acknowledgement?: WarningAcknowledgement;
}): void {
  if (!input.readiness.ready || input.readiness.status === 'BLOCKED') {
    throw new PublicationReadinessError(
      'PUBLICATION_READINESS_BLOCKED',
      input.readiness.blockingReasons.map(reason => reason.code).join(', ') || 'Publication readiness is blocked.',
    );
  }
  if (
    input.readiness.siteVersionDigest !== input.expectedDigestSha256
    || input.readiness.qualityRunReference !== input.expectedQualityRunReference
  ) {
    throw new PublicationReadinessError('PUBLICATION_PIN_MISMATCH', 'Readiness does not match the exact requested version and quality run.');
  }
  if (input.readiness.status === 'READY_WITH_WARNINGS') {
    const acknowledgement = input.acknowledgement;
    if (
      !acknowledgement
      || acknowledgement.siteVersionDigestSha256 !== input.expectedDigestSha256
      || acknowledgement.qualityRunReference !== input.expectedQualityRunReference
    ) {
      throw new PublicationReadinessError(
        'PUBLICATION_WARNING_ACKNOWLEDGEMENT_REQUIRED',
        'Current digest-bound warning acknowledgement is required.',
      );
    }
  }
}
