import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithAuth, uploadWithAuth } from './client';

const { getSession, refreshSession, signOut } = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession, refreshSession, signOut } },
}));

const session = (accessToken: string) => ({
  data: { session: { access_token: accessToken } },
  error: null,
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchWithAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    refreshSession.mockResolvedValue({ data: { session: null }, error: null });
    signOut.mockResolvedValue({ error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    sessionStorage.clear();
  });

  it('marks string request bodies as JSON by default', async () => {
    await fetchWithAuth('/api/v1/bookings', {
      method: 'POST',
      body: JSON.stringify({ serviceId: 'service-id' }),
    });

    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(request?.headers).get('Content-Type')).toBe('application/json');
  });

  it('preserves an explicitly supplied content type', async () => {
    await fetchWithAuth('/api/v1/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'content',
    });

    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(request?.headers).get('Content-Type')).toBe('text/plain');
  });

  it('strips staff support credentials from explicit CUSTOMER requests even when supplied as a header', async () => {
    getSession.mockResolvedValue(session('customer-token')); sessionStorage.setItem('ks-os-support-session', 'staff-support-secret');
    await fetchWithAuth('/api/v1/customer/collaboration/session', { authContext: 'CUSTOMER', headers: { 'X-KS-Support-Session': 'caller-supplied-secret' } });
    const headers = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers); expect(headers.get('X-KS-Application-Context')).toBe('CUSTOMER'); expect(headers.get('Authorization')).toBe('Bearer customer-token'); expect(headers.has('X-KS-Support-Session')).toBe(false);
  });

  it('uses the CUSTOMER ledger context for file uploads without a staff support header', async () => {
    const headers = new Headers(); sessionStorage.setItem('ks-os-support-session', 'staff-support-secret'); getSession.mockResolvedValue(session('customer-token'));
    class UploadRequest { upload = { onprogress: null }; timeout = 0; responseText = '{}'; status = 200; onload: (() => void) | null = null; onerror = null; ontimeout = null; onabort = null; open() {} setRequestHeader(key: string, value: string) { headers.set(key, value); } send() { queueMicrotask(() => this.onload?.()); } abort() {} }
    vi.stubGlobal('XMLHttpRequest', UploadRequest);
    await uploadWithAuth('/api/v1/customer/collaboration/relationship-a/chat/channel-a/files/file-a', new Blob(['file']), new AbortController().signal, vi.fn(), 'CUSTOMER');
    expect(headers.get('X-KS-Application-Context')).toBe('CUSTOMER'); expect(headers.get('Authorization')).toBe('Bearer customer-token'); expect(headers.has('X-KS-Support-Session')).toBe(false);
  });

  it('retries with a token already rotated by another auth listener', async () => {
    getSession
      .mockResolvedValueOnce(session('old-token'))
      .mockResolvedValueOnce(session('new-token'));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })));

    const response = await fetchWithAuth('/api/v1/workspace/session');

    expect(response.status).toBe(200);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    const [, retryRequest] = vi.mocked(fetch).mock.calls[1];
    expect(new Headers(retryRequest?.headers).get('Authorization')).toBe('Bearer new-token');
  });

  it('recovers a session rotated elsewhere when manual refresh loses the race', async () => {
    getSession
      .mockResolvedValueOnce(session('old-token'))
      .mockResolvedValueOnce(session('old-token'))
      .mockResolvedValueOnce(session('new-token'));
    refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Invalid Refresh Token: Refresh Token Not Found'),
    });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })));

    const response = await fetchWithAuth('/api/v1/workspace/session');

    expect(response.status).toBe(200);
    expect(signOut).not.toHaveBeenCalled();
    const [, retryRequest] = vi.mocked(fetch).mock.calls[1];
    expect(new Headers(retryRequest?.headers).get('Authorization')).toBe('Bearer new-token');
  });

  it('returns the API failure without revoking the browser session when refresh cannot recover', async () => {
    getSession
      .mockResolvedValueOnce(session('old-token'))
      .mockResolvedValueOnce(session('old-token'))
      .mockResolvedValueOnce({ data: { session: null }, error: null });
    refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Invalid Refresh Token: Refresh Token Not Found'),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    const response = await fetchWithAuth('/api/v1/workspace/session');

    expect(response.status).toBe(401);
    expect(signOut).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
