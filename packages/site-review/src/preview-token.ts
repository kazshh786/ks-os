import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PublicReferenceSchema } from '@ks-os/contracts';
import { z } from 'zod';

export const PreviewTokenPayloadSchema = z.object({
  iss: z.literal('ks-os-sites-preview'),
  aud: z.literal('ks-os-public-renderer'),
  jti: z.string().uuid(),
  siteReference: PublicReferenceSchema,
  versionReference: PublicReferenceSchema,
  reviewCycleReference: PublicReferenceSchema.optional(),
  qualityRunReference: PublicReferenceSchema.optional(),
  purpose: z.enum(['AGENCY_REVIEW', 'CLIENT_REVIEW', 'QUALITY_AUDIT']),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).strict().superRefine((value, ctx) => {
  if (value.purpose === 'QUALITY_AUDIT' && !value.qualityRunReference) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['qualityRunReference'],
      message: 'Quality-audit preview tokens require a quality run.',
    });
  }
  if (value.purpose !== 'QUALITY_AUDIT' && value.qualityRunReference) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['qualityRunReference'],
      message: 'Review preview tokens cannot carry a quality run.',
    });
  }
  if (value.purpose === 'QUALITY_AUDIT' && value.reviewCycleReference) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewCycleReference'],
      message: 'Quality-audit preview tokens cannot carry a review cycle.',
    });
  }
});
export type PreviewTokenPayload = z.infer<typeof PreviewTokenPayloadSchema>;

export class PreviewTokenError extends Error {
  readonly code = 'SITE_PREVIEW_TOKEN_INVALID';

  constructor(message = 'The preview link is invalid or expired.') {
    super(message);
    this.name = 'PreviewTokenError';
  }
}

function signingKey(secret: string): string {
  if (secret.length < 32) throw new PreviewTokenError('Preview signing is unavailable.');
  return secret;
}

function signature(body: string, secret: string) {
  return createHmac('sha256', signingKey(secret))
    .update(`ks-os-site-preview:v1:${body}`)
    .digest();
}

export function signSitePreviewToken(input: {
  siteReference: string;
  versionReference: string;
  reviewCycleReference?: string;
  qualityRunReference?: string;
  purpose: PreviewTokenPayload['purpose'];
  secret: string;
  now?: Date;
  ttlSeconds?: number;
  jti?: string;
}): string {
  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const ttlSeconds = input.ttlSeconds ?? 3_600;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) {
    throw new PreviewTokenError('Preview token lifetime is invalid.');
  }
  const payload = PreviewTokenPayloadSchema.parse({
    iss: 'ks-os-sites-preview',
    aud: 'ks-os-public-renderer',
    jti: input.jti ?? randomUUID(),
    siteReference: input.siteReference,
    versionReference: input.versionReference,
    ...(input.reviewCycleReference
      ? { reviewCycleReference: input.reviewCycleReference }
      : {}),
    ...(input.qualityRunReference
      ? { qualityRunReference: input.qualityRunReference }
      : {}),
    purpose: input.purpose,
    iat: now,
    exp: now + ttlSeconds,
  });
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `v1.${body}.${signature(body, input.secret).toString('base64url')}`;
}

export function verifySitePreviewToken(input: {
  token: string;
  siteReference: string;
  versionReference: string;
  secret: string;
  now?: Date;
}): PreviewTokenPayload {
  if (input.token.length > 2_000) throw new PreviewTokenError();
  const [version, body, encodedSignature, extra] = input.token.split('.');
  if (version !== 'v1' || !body || !encodedSignature || extra) {
    throw new PreviewTokenError();
  }
  const expected = signature(body, input.secret);
  let supplied: Buffer;
  try {
    supplied = Buffer.from(encodedSignature, 'base64url');
  } catch {
    throw new PreviewTokenError();
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new PreviewTokenError();
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new PreviewTokenError();
  }
  const payload = PreviewTokenPayloadSchema.safeParse(decoded);
  if (!payload.success) throw new PreviewTokenError();
  const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (
    payload.data.exp <= now
    || payload.data.iat > now + 60
    || payload.data.exp - payload.data.iat > 86_400
    || payload.data.siteReference !== input.siteReference
    || payload.data.versionReference !== input.versionReference
  ) {
    throw new PreviewTokenError();
  }
  return payload.data;
}
