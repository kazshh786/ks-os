import { supabase } from '../lib/supabase';
import type { ApplicationContext } from '@ks-os/contracts';

let refreshPromise: Promise<string | null> | null = null;
let defaultContextOverride: ApplicationContext | null = null;
let lastApiError: { notice: ApiErrorNotice; occurredAt: number } | null = null;

export type AuthenticatedRequestInit = RequestInit & { authContext?: ApplicationContext };

export type ApiErrorNotice = {
  code: string;
  message: string;
  requestId?: string;
  statusCode: number;
};

export class ApiRequestError extends Error {
  code: string;
  requestId?: string;
  statusCode: number;

  constructor(notice: ApiErrorNotice) {
    super(notice.message);
    this.name = 'ApiRequestError';
    this.code = notice.code;
    this.requestId = notice.requestId;
    this.statusCode = notice.statusCode;
  }
}

function resolveApiUrl(url: string): string {
  if (!url.startsWith('/api/')) return url;
  const configuredOrigin = String(import.meta.env.VITE_API_ORIGIN || '').trim().replace(/\/$/, '');
  return configuredOrigin ? new URL(url, `${configuredOrigin}/`).toString() : url;
}

function requestContext(url: string, explicit?: ApplicationContext): ApplicationContext {
  if (explicit) return explicit;
  if (defaultContextOverride) return defaultContextOverride;
  const pathname = url.startsWith('http') ? new URL(url).pathname : url;
  if (pathname.startsWith('/api/v1/customer') || window.location.pathname.startsWith('/customer')) return 'CUSTOMER';
  if (pathname.startsWith('/api/v1/agency') || window.location.pathname.startsWith('/agency')) return 'AGENCY';
  return 'TENANT';
}

function fallbackErrorMessage(statusCode: number) {
  if (statusCode === 400 || statusCode === 422) return 'Check the information provided and try again.';
  if (statusCode === 401) return 'Your session has ended. Sign in again.';
  if (statusCode === 403) return 'You do not have permission to do this.';
  if (statusCode === 404) return 'The requested item could not be found.';
  if (statusCode === 409) return 'This conflicts with a recent change. Refresh and try again.';
  if (statusCode === 429) return 'Too many requests were sent. Wait a moment and try again.';
  if (statusCode >= 500) return 'The service could not complete this request. Try again.';
  return 'The request could not be completed.';
}

function stripEmbeddedErrorCode(message: string) {
  return message.replace(/\s*Error code:\s*[A-Z0-9_-]+\.?\s*$/i, '').trim();
}

function dispatchApiError(notice: ApiErrorNotice) {
  lastApiError = { notice, occurredAt: Date.now() };
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ApiErrorNotice>('ks-api-error', { detail: notice }));
}

function isExpectedSignedOutProbe(requestUrl: string, statusCode: number) {
  if (typeof window === 'undefined' || statusCode !== 401) return false;
  const pathname = new URL(requestUrl, window.location.origin).pathname;
  return pathname === '/api/v1/agency/session' && window.location.pathname.startsWith('/agency/login');
}

export function latestApiErrorNotice(maxAgeMs = 3_000): ApiErrorNotice | null {
  if (!lastApiError || Date.now() - lastApiError.occurredAt > maxAgeMs) return null;
  return lastApiError.notice;
}

export async function apiErrorFromResponse(response: Response, fallbackMessage?: string): Promise<ApiRequestError> {
  const body = await response.clone().json().catch(() => ({}));
  const payload = body && typeof body === 'object' ? body as any : {};
  const details = payload.error?.details && typeof payload.error.details === 'object' ? payload.error.details : {};
  const code = String(payload.error?.code || payload.code || `HTTP_${response.status}`);
  const rawMessage = String(payload.error?.message || payload.message || fallbackMessage || fallbackErrorMessage(response.status));
  const notice: ApiErrorNotice = {
    code,
    message: stripEmbeddedErrorCode(rawMessage),
    requestId: typeof details.requestId === 'string' ? details.requestId : undefined,
    statusCode: response.status,
  };
  return new ApiRequestError(notice);
}

export function formatApiError(error: unknown, fallback = 'The request could not be completed.') {
  if (error instanceof ApiRequestError) {
    return `${error.message} Error code: ${error.code}.${error.requestId ? ` Reference: ${error.requestId}.` : ''}`;
  }
  return error instanceof Error ? error.message : fallback;
}

export function setDefaultAuthContextOverride(context: ApplicationContext | null) {
  defaultContextOverride = context;
}

async function currentAccessToken(): Promise<string | null> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return null;
  return session.access_token;
}

async function recoverAccessToken(previousToken: string | null): Promise<string | null> {
  const storedToken = await currentAccessToken();
  if (storedToken && storedToken !== previousToken) return storedToken;

  if (!refreshPromise) {
    const pendingRefresh = (async () => {
      const { data: { session }, error } = await supabase.auth.refreshSession();
      if (!error && session) return session.access_token;

      // Another tab or auth listener may have rotated the refresh token first.
      // Re-read persisted session state rather than revoking a valid browser session.
      await new Promise(resolve => window.setTimeout(resolve, 50));
      return currentAccessToken();
    })();
    refreshPromise = pendingRefresh;
    void pendingRefresh.finally(() => {
      if (refreshPromise === pendingRefresh) refreshPromise = null;
    });
  }

  return refreshPromise;
}

export async function fetchWithAuth(url: string, options: AuthenticatedRequestInit = {}): Promise<Response> {
  const { authContext, ...fetchOptions } = options;
  const context = requestContext(url, authContext);
  const requestUrl = resolveApiUrl(url);
  let token = await currentAccessToken();

  const makeRequest = async (accessToken: string | null) => {
    const headers = new Headers(fetchOptions.headers);
    headers.set('X-KS-Application-Context', context);
    if (fetchOptions.body == null) {
      headers.delete('Content-Type');
    } else if (typeof fetchOptions.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    const supportToken = sessionStorage.getItem('ks-os-support-session');
    if (supportToken) headers.set('X-KS-Support-Session', supportToken);
    return fetch(requestUrl, { ...fetchOptions, headers });
  };

  let response: Response;
  try {
    response = await makeRequest(token);

    if (response.status === 401) {
      const recoveredToken = await recoverAccessToken(token);
      if (recoveredToken) {
        token = recoveredToken;
        response = await makeRequest(token);
      }
    }
  } catch {
    const notice: ApiErrorNotice = {
      code: 'NETWORK_REQUEST_FAILED',
      message: 'The server could not be reached. Check your connection and try again.',
      statusCode: 0,
    };
    dispatchApiError(notice);
    throw new ApiRequestError(notice);
  }

  if (!response.ok) {
    const error = await apiErrorFromResponse(response);
    if (!isExpectedSignedOutProbe(requestUrl, response.status)) {
      dispatchApiError({ code: error.code, message: error.message, requestId: error.requestId, statusCode: error.statusCode });
    }
  }

  return response;
}

export async function getClients(params?: { search?: string; limit?: number; cursor?: string; sort?: string; page?: number }) {
  const url = new URL('/api/v1/clients', window.location.origin);
  if (params) {
    if (params.search) url.searchParams.append('search', params.search);
    if (params.limit) url.searchParams.append('limit', params.limit.toString());
    if (params.cursor) url.searchParams.append('cursor', params.cursor);
    if (params.sort) url.searchParams.append('sort', params.sort);
    if (params.page) url.searchParams.append('page', params.page.toString());
  }
  const response = await fetchWithAuth(url.toString());
  if (!response.ok) throw await apiErrorFromResponse(response, 'Failed to fetch clients');
  return response.json();
}

export async function getClientProfile(clientId: string) {
  const response = await fetchWithAuth(`/api/v1/clients/${clientId}`);
  if (!response.ok) throw await apiErrorFromResponse(response, 'Failed to fetch client profile');
  const data = await response.json();
  return { data };
}
