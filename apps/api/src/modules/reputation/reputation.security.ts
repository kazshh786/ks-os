import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ReviewProvider } from '@ks-os/contracts';
import { env } from '../../config/env.js';

export const reputationError = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function parsedUrl(raw: string) {
  if (raw.length > 2048) throw reputationError(400, 'REVIEW_LINK_INVALID', 'Review link is too long.');
  let url: URL;
  try { url = new URL(raw); } catch { throw reputationError(400, 'REVIEW_LINK_INVALID', 'Review link is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw reputationError(400, 'REVIEW_LINK_INVALID', 'Review links must use credential-free HTTPS.');
  }
  return url;
}

export function validateGoogleReviewUrl(raw: string) {
  const url = parsedUrl(raw);
  const host = url.hostname.toLowerCase();
  const gPage = host === 'g.page' && /^\/(?:r\/)?[^/]+\/review\/?$/i.test(url.pathname);
  const writeReview = host === 'search.google.com' && url.pathname === '/local/writereview' && !!url.searchParams.get('placeid');
  const mapsShortLink = host === 'maps.app.goo.gl' && /^\/[A-Za-z0-9_-]{4,}\/?$/.test(url.pathname);
  if (!gPage && !writeReview && !mapsShortLink) {
    throw reputationError(400, 'REVIEW_LINK_INVALID', 'Use a supported Google Business Profile review link.');
  }
  return url.toString();
}

export function validateTrustpilotReviewUrl(raw: string) {
  const url = parsedUrl(raw);
  const host = url.hostname.toLowerCase();
  const trusted = host === 'trustpilot.com' || host.endsWith('.trustpilot.com');
  const reviewPath = /^\/(?:review|evaluate|evaluate-link)\//i.test(url.pathname);
  if (!trusted || !reviewPath) throw reputationError(400, 'REVIEW_LINK_INVALID', 'Use a supported Trustpilot profile or evaluation link.');
  return url.toString();
}

export function validateTrustpilotSourceUrl(raw: string) {
  const url = parsedUrl(raw);
  const host = url.hostname.toLowerCase();
  if (!(host === 'trustpilot.com' || host.endsWith('.trustpilot.com')) || !/^\/reviews\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)) {
    throw reputationError(400, 'REVIEW_LINK_INVALID', 'Trustpilot review source link is invalid.');
  }
  return url.toString();
}

export function validateProviderUrl(provider: ReviewProvider, raw: string) {
  return provider === 'GOOGLE' ? validateGoogleReviewUrl(raw) : validateTrustpilotReviewUrl(raw);
}

export async function testProviderLink(provider: ReviewProvider, raw: string, fetcher: typeof fetch = fetch) {
  let current = validateProviderUrl(provider, raw);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetcher(current, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw reputationError(400, 'REVIEW_LINK_INVALID', 'Review link redirect could not be safely verified.');
      current = validateProviderUrl(provider, new URL(location, current).toString());
      continue;
    }
    if (response.status >= 200 && response.status < 400) return { ok: true, resolvedUrl: current };
    throw reputationError(400, 'REVIEW_LINK_INVALID', 'The provider did not accept this review link.');
  }
  throw reputationError(400, 'REVIEW_LINK_INVALID', 'Review link could not be verified.');
}

function encryptionKey(explicit?: string) {
  const source = explicit ?? env.INTEGRATION_ENCRYPTION_KEY;
  if (!source) throw reputationError(503, 'REVIEW_PROVIDER_NOT_AVAILABLE', 'Provider credential storage is not configured.');
  const key = /^[a-f0-9]{64}$/i.test(source) ? Buffer.from(source, 'hex') : Buffer.from(source, 'base64');
  if (key.length !== 32) throw reputationError(503, 'REVIEW_PROVIDER_NOT_AVAILABLE', 'Provider credential storage is not configured.');
  return key;
}

export function encryptProviderCredentials(value: Record<string, unknown>, explicitKey?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(explicitKey), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptProviderCredentials<T extends Record<string, unknown>>(envelope: string, explicitKey?: string): T {
  const [version, iv, tag, ciphertext] = envelope.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw reputationError(500, 'REVIEW_PROVIDER_AUTH_FAILED', 'Stored provider credentials are invalid.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(explicitKey), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')) as T;
  } catch { throw reputationError(500, 'REVIEW_PROVIDER_AUTH_FAILED', 'Stored provider credentials could not be opened.'); }
}

export function hashPublicToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function invitationSecret(explicit?: string) {
  const secret = explicit ?? env.REVIEW_INVITATION_TOKEN_SECRET;
  if (!secret || secret.length < 32) throw reputationError(503, 'REVIEW_PROVIDER_NOT_AVAILABLE', 'Review invitation token signing is not configured.');
  return secret;
}

// invitationId is a random UUID. HMAC turns it into an unlinkable 256-bit public
// token that can be re-derived only by the delivery worker; only its hash is stored.
export function deriveReviewInvitationToken(invitationId: string, explicitSecret?: string) {
  return createHmac('sha256', invitationSecret(explicitSecret)).update('review-invitation:v1:' + invitationId).digest('base64url');
}

export function deriveProviderReference(idempotencyKey: string, explicitSecret?: string) {
  return 'ksos_' + createHmac('sha256', invitationSecret(explicitSecret)).update('provider-reference:v1:' + idempotencyKey).digest('hex').slice(0, 32);
}

export function safeTokenEqual(expectedHash: string, rawToken: string) {
  const actual = Buffer.from(hashPublicToken(rawToken), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
