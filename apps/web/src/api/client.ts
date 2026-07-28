import { supabase } from '../lib/supabase';
import type { ApplicationContext } from '@ks-os/contracts';

let refreshPromise: Promise<string | null> | null = null;
let defaultContextOverride: ApplicationContext | null = null;

export type AuthenticatedRequestInit = RequestInit & { authContext?: ApplicationContext };

const defaultProductionApiOrigin = 'https://api.kasimshah.com';

function resolveApiUrl(url: string): string {
  if (!url.startsWith('/api/')) return url;
  const configuredOrigin = String(import.meta.env.VITE_API_ORIGIN || '').trim().replace(/\/$/, '');
  const origin = configuredOrigin || (import.meta.env.PROD ? defaultProductionApiOrigin : '');
  return origin ? new URL(url, `${origin}/`).toString() : url;
}

function requestContext(url: string, explicit?: ApplicationContext): ApplicationContext {
  if (explicit) return explicit;
  if (defaultContextOverride) return defaultContextOverride;
  const pathname = url.startsWith('http') ? new URL(url).pathname : url;
  if (pathname.startsWith('/api/v1/customer') || window.location.pathname.startsWith('/customer')) return 'CUSTOMER';
  if (pathname.startsWith('/api/v1/agency') || window.location.pathname.startsWith('/agency')) return 'AGENCY';
  return 'TENANT';
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

  let response = await makeRequest(token);

  if (response.status === 401) {
    const recoveredToken = await recoverAccessToken(token);
    if (recoveredToken) {
      token = recoveredToken;
      response = await makeRequest(token);
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
  if (!response.ok) {
    throw new Error('Failed to fetch clients');
  }
  return response.json();
}

export async function getClientProfile(clientId: string) {
  const response = await fetchWithAuth(`/api/v1/clients/${clientId}`);
  if (!response.ok) {
    if (response.status === 404) throw new Error('Client not found');
    if (response.status === 403) throw new Error('Access denied');
    throw new Error('Failed to fetch client profile');
  }
  return response.json();
}
