import { env } from '../../config/env.js';
import { reputationError, validateTrustpilotReviewUrl, validateTrustpilotSourceUrl } from './reputation.security.js';

type GoogleCredentials = { accessToken: string; refreshToken?: string; expiresAt?: number };
type TrustpilotCredentials = { apiKey: string; accessToken: string; refreshToken?: string; authorBusinessUserId?: string };

async function providerRequest<T>(url: string, init: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try { response = await fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
  catch { throw reputationError(502, 'REVIEW_SYNC_FAILED', 'The review provider is temporarily unavailable.'); }
  if (response.status === 401 || response.status === 403) throw reputationError(401, 'REVIEW_PROVIDER_AUTH_REQUIRED', 'The review provider connection needs to be reauthorised.');
  if (response.status === 429) throw reputationError(429, 'REVIEW_PROVIDER_RATE_LIMITED', 'The review provider rate limit was reached.');
  if (!response.ok) throw reputationError(502, 'REVIEW_SYNC_FAILED', 'The review provider request failed.');
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export class GoogleBusinessProfileProvider {
  isAvailable() {
    return Boolean(env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID && env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET && env.GOOGLE_BUSINESS_PROFILE_REDIRECT_URI);
  }

  authorizationUrl(state: string) {
    if (!this.isAvailable()) throw reputationError(503, 'REVIEW_PROVIDER_NOT_AVAILABLE', 'Google Business Profile OAuth is not configured.');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID!, redirect_uri: env.GOOGLE_BUSINESS_PROFILE_REDIRECT_URI!,
      response_type: 'code', access_type: 'offline', prompt: 'consent', state,
      scope: 'https://www.googleapis.com/auth/business.manage',
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<GoogleCredentials> {
    if (!this.isAvailable()) throw reputationError(503, 'REVIEW_PROVIDER_NOT_AVAILABLE', 'Google Business Profile OAuth is not configured.');
    const payload = await providerRequest<any>('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID!, client_secret: env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET!, redirect_uri: env.GOOGLE_BUSINESS_PROFILE_REDIRECT_URI!, grant_type: 'authorization_code' }),
    });
    if (!payload.access_token) throw reputationError(401, 'REVIEW_PROVIDER_AUTH_FAILED', 'Google authorisation did not return an access token.');
    return { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: Date.now() + Number(payload.expires_in ?? 3600) * 1000 };
  }

  async accessToken(credentials: GoogleCredentials) {
    if (!credentials.expiresAt || credentials.expiresAt > Date.now() + 60_000) return credentials.accessToken;
    if (!credentials.refreshToken || !this.isAvailable()) throw reputationError(401, 'REVIEW_PROVIDER_AUTH_REQUIRED', 'Google Business Profile must be reauthorised.');
    const payload = await providerRequest<any>('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: credentials.refreshToken, client_id: env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID!, client_secret: env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET!, grant_type: 'refresh_token' }),
    });
    return String(payload.access_token);
  }

  async listAccounts(credentials: GoogleCredentials) {
    const token = await this.accessToken(credentials);
    return providerRequest<any>('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: { Authorization: 'Bearer ' + token } });
  }

  async listLocations(credentials: GoogleCredentials, accountName: string) {
    if (!/^accounts\/[A-Za-z0-9_-]+$/.test(accountName)) throw reputationError(400, 'REVIEW_CONNECTION_INVALID', 'Google account identifier is invalid.');
    const token = await this.accessToken(credentials);
    const path = encodeURIComponent(accountName).replace('%2F', '/');
    return providerRequest<any>('https://mybusinessbusinessinformation.googleapis.com/v1/' + path + '/locations?readMask=name,title,storeCode,metadata&pageSize=100', { headers: { Authorization: 'Bearer ' + token } });
  }

  async listReviews(credentials: GoogleCredentials, accountId: string, locationId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(accountId) || !/^[A-Za-z0-9_-]+$/.test(locationId)) throw reputationError(400, 'REVIEW_CONNECTION_INVALID', 'Google location mapping is invalid.');
    const token = await this.accessToken(credentials);
    const reviews: any[] = [];
    let pageToken = '';
    for (let page = 0; page < 20; page += 1) {
      const params = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' });
      if (pageToken) params.set('pageToken', pageToken);
      const result = await providerRequest<any>('https://mybusiness.googleapis.com/v4/accounts/' + encodeURIComponent(accountId) + '/locations/' + encodeURIComponent(locationId) + '/reviews?' + params, { headers: { Authorization: 'Bearer ' + token } });
      reviews.push(...(result.reviews ?? []));
      pageToken = String(result.nextPageToken ?? '');
      if (!pageToken) return { reviews, averageRating: result.averageRating, totalReviewCount: result.totalReviewCount };
    }
    return { reviews };
  }

  async reply(credentials: GoogleCredentials, resourceName: string, reply: string) {
    if (!/^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/reviews\/[A-Za-z0-9_-]+$/.test(resourceName)) throw reputationError(400, 'EXTERNAL_REVIEW_REPLY_FAILED', 'Google review identifier is invalid.');
    const token = await this.accessToken(credentials);
    return providerRequest<any>('https://mybusiness.googleapis.com/v4/' + resourceName + '/reply', { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: reply }) });
  }

  async deleteReply(credentials: GoogleCredentials, resourceName: string) {
    const token = await this.accessToken(credentials);
    if (!/^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/reviews\/[A-Za-z0-9_-]+$/.test(resourceName)) throw reputationError(400, 'EXTERNAL_REVIEW_REPLY_FAILED', 'Google review identifier is invalid.');
    return providerRequest<void>('https://mybusiness.googleapis.com/v4/' + resourceName + '/reply', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  }
}

export class TrustpilotProvider {
  async generateInvitationLink(credentials: TrustpilotCredentials, input: { businessUnitId: string; locationId?: string | null; referenceId: string; email: string; name: string; locale: string }) {
    const result = await providerRequest<any>('https://invitations-api.trustpilot.com/v1/private/business-units/' + encodeURIComponent(input.businessUnitId) + '/invitation-links', {
      method: 'POST', headers: { Authorization: 'Bearer ' + credentials.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId: input.locationId || undefined, referenceId: input.referenceId, email: input.email, name: input.name, locale: input.locale }),
    });
    return { id: String(result.id), url: validateTrustpilotReviewUrl(String(result.url)) };
  }

  async listTemplates(credentials: TrustpilotCredentials, businessUnitId: string) {
    return providerRequest<any>('https://invitations-api.trustpilot.com/v1/private/business-units/' + encodeURIComponent(businessUnitId) + '/templates', { headers: { Authorization: 'Bearer ' + credentials.accessToken } });
  }

  private async reviewSourceUrl(credentials: TrustpilotCredentials, reviewId: string, locale: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(reviewId)) return null;
    try {
      const result = await providerRequest<any>('https://api.trustpilot.com/v1/reviews/' + encodeURIComponent(reviewId) + '/web-links?' + new URLSearchParams({ locale }), { headers: { apikey: credentials.apiKey } });
      return result.reviewUrl ? validateTrustpilotSourceUrl(String(result.reviewUrl)) : null;
    } catch (error: any) {
      if (['REVIEW_PROVIDER_AUTH_REQUIRED', 'REVIEW_PROVIDER_RATE_LIMITED'].includes(error?.code)) throw error;
      return null;
    }
  }

  async listReviews(credentials: TrustpilotCredentials, businessUnitId: string, locale = 'en-GB') {
    const reviews: any[] = [];
    let pageToken = '';
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams();
      if (pageToken) query.set('pageToken', pageToken);
      const result = await providerRequest<any>('https://api.trustpilot.com/v1/business-units/' + encodeURIComponent(businessUnitId) + '/all-reviews' + (query.size ? '?' + query : ''), { headers: { apikey: credentials.apiKey } });
      const pageReviews = result.reviews ?? [];
      for (let offset = 0; offset < pageReviews.length; offset += 5) {
        const chunk = pageReviews.slice(offset, offset + 5);
        reviews.push(...await Promise.all(chunk.map(async (review: any) => ({
          ...review,
          sourceUrl: await this.reviewSourceUrl(credentials, String(review.id ?? ''), locale),
        }))));
      }
      pageToken = String(result.nextPageToken ?? '');
      if (!pageToken) break;
    }
    return { reviews };
  }

  async reply(credentials: TrustpilotCredentials, reviewId: string, reply: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(reviewId) || !credentials.authorBusinessUserId) throw reputationError(400, 'EXTERNAL_REVIEW_REPLY_FAILED', 'Trustpilot reply identity is not configured.');
    return providerRequest<any>('https://api.trustpilot.com/v1/private/reviews/' + encodeURIComponent(reviewId) + '/reply', { method: 'POST', headers: { Authorization: 'Bearer ' + credentials.accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ authorBusinessUserId: credentials.authorBusinessUserId, message: reply }) });
  }

  async deleteReply(credentials: TrustpilotCredentials, reviewId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(reviewId)) throw reputationError(400, 'EXTERNAL_REVIEW_REPLY_FAILED', 'Trustpilot review identifier is invalid.');
    return providerRequest<void>('https://api.trustpilot.com/v1/private/reviews/' + encodeURIComponent(reviewId) + '/reply', { method: 'DELETE', headers: { Authorization: 'Bearer ' + credentials.accessToken } });
  }
}
